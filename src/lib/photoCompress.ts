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
 *   2. Scale down to fit within maxDimension (default 1920px) — this
 *      alone drops a 12 MP phone photo from ~4 MB to ~800 KB at q=0.8.
 *   3. Draw onto an OffscreenCanvas (or regular Canvas fallback).
 *   4. Export as JPEG at the configured quality.
 *   5. If the result is still over targetBytes, iteratively lower
 *      quality until it fits or we hit a floor (0.4).
 *
 * Returns a File with the same name (swapped to .jpg extension) and
 * the compressed MIME type. If compression fails for any reason (e.g.
 * the blob isn't a decodable image), returns the original File
 * unchanged — never throws.
 */

export interface CompressOptions {
  /** Max width or height in pixels. Default 1920. */
  maxDimension?: number;
  /** Target output size in bytes. Default ~1 MB. */
  targetBytes?: number;
  /** Starting JPEG quality (0–1). Default 0.8. */
  quality?: number;
  /** Minimum JPEG quality floor. Default 0.4. */
  minQuality?: number;
}

const DEFAULT_MAX_DIM = 1920;
const DEFAULT_TARGET = 1_000_000; // 1 MB
const DEFAULT_QUALITY = 0.8;
const MIN_QUALITY = 0.4;

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

  try {
    // Decode
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Compute scaled dimensions
    let w = width;
    let h = height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Draw
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    // Encode with iterative quality reduction
    let blob: Blob;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= target || quality <= floor) break;
      quality -= 0.1;
      if (quality < floor) quality = floor;
    }

    // Build output File
    const ext = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], ext, { type: 'image/jpeg' });
  } catch {
    // If anything goes wrong (unsupported format, OffscreenCanvas not
    // available, etc.), return the original — never break the flow.
    return file;
  }
}

/**
 * Compress an array of photo Files in parallel. Returns compressed
 * versions in the same order. Total output size is best-effort ≤
 * files.length × targetBytes.
 */
export async function compressPhotos(
  files: File[],
  opts: CompressOptions = {},
): Promise<File[]> {
  return Promise.all(files.map((f) => compressPhoto(f, opts)));
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
