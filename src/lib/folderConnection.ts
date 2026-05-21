/**
 * Optional Chromium-only "watch this folder" support via the File System
 * Access API. The user grants permission once; we store the directory
 * handle in IndexedDB so it survives reloads. On supported browsers (Chrome
 * + Edge on desktop, Chrome on Android) we can then read the newest .csv
 * file from that folder with a single click — no file-picker navigation.
 *
 * Falls back gracefully on Safari / iOS where the API isn't available;
 * callers should feature-detect with isFolderApiSupported().
 */

const DB_NAME = 'mwpjm-fs';
const STORE = 'handles';
const KEY = 'reportFolder';

// ---------- IndexedDB helpers ----------

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

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Public API ----------

export function isFolderApiSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker === 'function';
}

export interface ConnectedFolder {
  name: string;
}

/** Prompt the user to pick a folder. Stores the handle for next time. */
export async function pickReportFolder(): Promise<ConnectedFolder> {
  if (!isFolderApiSupported()) {
    throw new Error('Folder access not supported on this browser.');
  }
  const win = window as unknown as {
    showDirectoryPicker: (opts?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  };
  const handle = await win.showDirectoryPicker({
    id: 'mwpjm-reports',
    mode: 'read',
    startIn: 'documents',
  });
  await idbSet(KEY, handle);
  return { name: handle.name };
}

export async function getStoredFolderName(): Promise<string | undefined> {
  const h = await idbGet<FileSystemDirectoryHandle>(KEY);
  return h?.name;
}

/** Re-prompt for permission if the browser dropped it (it does, sometimes). */
async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  const opts = { mode: 'read' as const };
  if (h.queryPermission) {
    const q = await h.queryPermission(opts);
    if (q === 'granted') return true;
  }
  if (h.requestPermission) {
    const r = await h.requestPermission(opts);
    return r === 'granted';
  }
  return false;
}

export interface LatestCsvResult {
  file: File;
  filename: string;
  lastModified: number;
  totalCsvCount: number;
}

/**
 * Find and read the most recently modified .csv file in the connected
 * folder. Returns null if the folder has no .csv files.
 */
export async function readLatestCsv(): Promise<LatestCsvResult | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY);
  if (!handle) {
    throw new Error('No folder connected. Connect a folder first.');
  }
  const ok = await ensurePermission(handle);
  if (!ok) {
    throw new Error('Permission to read the folder was denied.');
  }

  let best: { file: File; name: string; lastModified: number } | null = null;
  let csvCount = 0;
  const dir = handle as FileSystemDirectoryHandle & {
    values: () => AsyncIterable<FileSystemHandle>;
  };
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue;
    if (!entry.name.toLowerCase().endsWith('.csv')) continue;
    csvCount++;
    const fileHandle = entry as FileSystemFileHandle;
    const f = await fileHandle.getFile();
    if (!best || f.lastModified > best.lastModified) {
      best = { file: f, name: entry.name, lastModified: f.lastModified };
    }
  }

  if (!best) return null;
  return {
    file: best.file,
    filename: best.name,
    lastModified: best.lastModified,
    totalCsvCount: csvCount,
  };
}

export async function clearFolderHandle(): Promise<void> {
  await idbDelete(KEY);
}
