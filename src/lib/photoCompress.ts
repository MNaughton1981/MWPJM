/**
 * Client-side photo compression for email attachment.
 *
 * Uses the browser's native Canvas API to resize and re-encode photos
 * to JPEG at a target file size (~1 MB default). This lets the user
 * capture photos at full resolution for local archiving (IndexedDB
 * keeps the original blob untouched) while keeping the share/email
 * payload under the typical 25 MB server cap even with many photos.
 *
 * Strategy:
 *   1. Decode the original blob into an ImageBitmap (off-main-thread
 *      on browsers that support it).
 *   2. Scale down to fit within maxDimension (default 1600px) — this
 *      alone drops a 12 MP phone photo from ~4 MB to ~600-800 KB at
 *      q=0.8.
 *   3. Draw onto an OffscreenCanvas (or regular Canvas fallback).
 *   4. Export as JPEG at the configured quality.
 *   5. If the result is still over targetBytes, iteratively lower
 *      quality until it fits or we hit a floor (0.4).
 *
 * IMPORTANT: photos are processed STRICTLY SEQUENTIALLY. An earlier
 * implementation used Promise.all for parallelism, but on a phone with
 * 12 high-resolution photos that meant 12 ImageBitmaps decoded into
 * memory simultaneously (~50 MB RGBA each) plus 12 OffscreenCanvases
 * — peak memory ~750 MB, which routinely tripped Android Chrome's
 * low-memory tab killer and turned the PWA into a white screen.
 *
 * Returns a File with the same name (swapped to .jpg extension) and
 * the compressed MIME type. If compression fails for any reason (e.g.
 * the blob isn't a decodable image), returns the original File
 * unchanged — never throws.
 */

export interface CompressOptions {
  /** Max width or height in pixels. Default 1600. */
  maxDimension?: number;
  /** Target output size in bytes. Default ~1 MB. */
  targetBytes?: number;
  /** Starting JPEG quality (0–1). Default 0.8. */
  quality?: number;
  /** Minimum JPEG quality floor. Default 0.4. */
  minQuality?: number;
}

/**
 * Default max dimension. 1600px is plenty for a work-order note:
 * field-of-view detail is preserved, but a 12 MP source (4032 × 3024)
 * shrinks to 1600 × 1200 = 1.9 MP — about 1/6 the pixel count and
 * roughly 1/6 the memory during the encode step.
 */
const DEFAULT_MAX_DIM = 1600;
const DEFAULT_TARGET = 1_000_000; // 1 MB
const DEFAULT_QUALITY = 0.8;
const MIN_QUALITY = 0.4;

/**
 * Yield to the event loop. Used between sequential photo compressions
 * so the browser can paint progress UI and the JS GC can collect the
 * canvas / bitmap from the previous iteration before we allocate the
 * next one. setTimeout(0) yields harder than Promise.resolve() — the
 * latter only flushes microtasks, the former lets the renderer paint.
 */
function yieldToBrowser(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Compress a single photo File for email attachment. Returns a new
 * File ≤ targetBytes (best-effort), or the original if compression
 * isn't possible or the original is already small enough.
 */
export async function compressPhoto(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const maxDim = opts.maxDimension ?? DEFAULT_MAX_DIM;
  const target = opts.targetBytes ?? DEFAULT_TARGET;
  let quality = opts.quality ?? DEFAULT_QUALITY;
  const floor = opts.minQuality ?? MIN_QUALITY;

  // Skip if already under target
  if (file.size <= target) return file;

  // We hold the bitmap in `let` so we can null it out in `finally` to
  // help the GC reclaim ~50 MB of bitmap data before the next photo.
  // The canvas itself goes out of scope when the function returns —
  // no need to hold a separate reference at this scope.
  let bitmap: ImageBitmap | null = null;

  try {
    // Decode
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Compute scaled dimensions
    let w = width;
    let h = height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Prefer OffscreenCanvas (off-main-thread, lower memory pressure)
    // but fall back to a regular HTMLCanvasElement on browsers that
    // don't expose it (older iOS Safari).
    let blob: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(w, h);
      const ctx = oc.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      bitmap = null;

      // Encode with iterative quality reduction
      while (true) {
        blob = await oc.convertToBlob({ type: 'image/jpeg', quality });
        if (blob.size <= target || quality <= floor) break;
        quality -= 0.1;
        if (quality < floor) quality = floor;
      }
    } else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      bitmap = null;

      // HTMLCanvasElement.toBlob is callback-based; promisify it.
      const toBlob = (q: number): Promise<Blob | null> =>
        new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', q));
      while (true) {
        const b = await toBlob(quality);
        if (!b) return file;
        blob = b;
        if (blob.size <= target || quality <= floor) break;
        quality -= 0.1;
        if (quality < floor) quality = floor;
      }
    }

    // Build output File
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch {
    // If anything goes wrong (unsupported format, OffscreenCanvas not
    // available, etc.), return the original — never break the flow.
    return file;
  } finally {
    // Aggressively release the source bitmap so the GC can reclaim
    // it before the next photo. Without this, a tight loop processing
    // 12 photos can hold ~600 MB of dead-but-uncollected bitmap data.
    if (bitmap) {
      try {
        bitmap.close();
      } catch {
        /* noop */
      }
    }
    bitmap = null;
  }
}

/**
 * Compress an array of photo Files SEQUENTIALLY. Returns compressed
 * versions in the same order. Yields to the browser between photos
 * so progress UI can paint and the GC can run.
 *
 * onProgress is called with (doneCount, total) after each photo
 * completes — wire it to a button label like "Compressing 3/12…" so
 * the user can see the work is moving and the app hasn't hung.
 */
export async function compressPhotos(
  files: File[],
  opts: CompressOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<File[]> {
  const out: File[] = [];
  const total = files.length;
  // Notify with "0 of N" so the UI can render the initial state
  // immediately (otherwise it would only update after the first
  // photo finishes, which on a slow phone can be 1-2 s of silence).
  onProgress?.(0, total);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const compressed = await compressPhoto(f, opts);
    out.push(compressed);
    onProgress?.(i + 1, total);
    // Yield between photos (except the last) so the browser can paint
    // the progress update and reclaim the previous photo's bitmap.
    if (i < files.length - 1) {
      await yieldToBrowser();
    }
  }
  return out;
}

/**
 * Estimate the total size of an array of files in a human-readable
 * string like "4.2 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
