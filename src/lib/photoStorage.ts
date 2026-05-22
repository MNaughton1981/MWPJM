/**
 * Photo blob storage in IndexedDB. Photo metadata lives in the regular
 * zustand store (localStorage) alongside the rest of the project; the
 * actual binary data lives here, keyed by `${projectId}/${photoId}`.
 *
 * Why split: localStorage tops out around 5 MB per origin in most
 * browsers — a single phone photo is 2-5 MB, so even one photo can
 * blow the cap. IndexedDB has no practical limit for our use case.
 */

const DB_NAME = 'mwpjm-photos';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function key(projectId: string, photoId: string): string {
  return `${projectId}/${photoId}`;
}

export async function savePhoto(
  projectId: string,
  photoId: string,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key(projectId, photoId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPhoto(
  projectId: string,
  photoId: string,
): Promise<Blob | undefined> {
  const db = await openDb();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key(projectId, photoId));
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePhoto(
  projectId: string,
  photoId: string,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key(projectId, photoId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Bulk-delete all blobs for a project. Called when the project is deleted. */
export async function deleteProjectPhotos(projectId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const prefix = `${projectId}/`;
    const req = store.openKeyCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const k = String(cursor.key);
      if (k.startsWith(prefix)) store.delete(cursor.key);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- filename generation ----------

const SLUG_RE = /[^a-z0-9]+/g;

function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max);
}

export interface FilenameArgs {
  pattern: string;
  workOrderId?: string;
  projectName: string;
  caption: string;
  capturedAt: string; // ISO datetime
  seq: number;
  originalName: string;
}

/**
 * Render a photo filename from a template like
 *   {wo}_{date}_{seq}_{caption}.{ext}
 * Available placeholders:
 *   {wo}      — work order ID, or "no-wo" if blank
 *   {project} — slugified project name
 *   {date}    — capturedAt as YYYY-MM-DD
 *   {caption} — slugified caption (or "photo" if blank)
 *   {seq}     — zero-padded sequence number (001, 002, …)
 *   {ext}     — original file extension
 *
 * If the pattern omits {ext}, the extension is appended automatically.
 */
export function buildFilename(args: FilenameArgs): string {
  const extMatch = args.originalName.match(/\.([a-z0-9]+)$/i);
  const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
  const date = (args.capturedAt || new Date().toISOString()).slice(0, 10);
  const seq = String(args.seq).padStart(3, '0');
  const caption = slugify(args.caption) || 'photo';
  const wo = args.workOrderId?.trim() || 'no-wo';
  const project = slugify(args.projectName, 30) || 'project';

  let name = args.pattern
    .replace(/\{wo\}/g, wo)
    .replace(/\{project\}/g, project)
    .replace(/\{date\}/g, date)
    .replace(/\{caption\}/g, caption)
    .replace(/\{seq\}/g, seq)
    .replace(/\{ext\}/g, ext);

  if (!args.pattern.includes('{ext}')) name += `.${ext}`;
  return name;
}

export const DEFAULT_PHOTO_NAMING_PATTERN = '{wo}_{date}_{seq}_{caption}.{ext}';
