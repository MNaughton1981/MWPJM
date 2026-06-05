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
  return (
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === 'function'
  );
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

/**
 * Re-prompt for permission if the browser dropped it (it does, sometimes).
 * Pass `mode: 'readwrite'` when you need to write — this can escalate from
 * an existing read-only grant, in which case the browser shows one extra
 * permission prompt.
 */
async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  const opts = { mode };
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

export interface LatestReportResult {
  file: File;
  filename: string;
  lastModified: number;
  totalCount: number;
  /** The detected file extension (e.g. '.csv', '.xlsx'). Useful for
   *  status messages so the user knows which format was picked up. */
  extension: string;
  /** Where the file was found — the connected folder root, or a named
   *  subfolder (e.g. 'reports'). Lets the UI tell the user exactly
   *  which location was scanned. */
  scannedLocation: string;
}

/**
 * Resolve a named subfolder inside the connected folder. Returns the
 * child directory handle, or null if it doesn't exist (and create is
 * false). Used to keep stored content organized under one connected
 * "Data" folder — e.g. `Data/photos/`, `Data/reports/` — without
 * requiring a second folder-permission grant.
 *
 * Pass `{ create: true }` to make the subfolder if it's missing (needed
 * when WRITING, e.g. saving a photo). For reads we pass create:false so
 * a missing subfolder is a soft "not there yet" rather than an error.
 */
export async function getSubfolderHandle(
  name: string,
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY);
  if (!handle) {
    throw new Error('No folder connected. Connect a folder first.');
  }
  const ok = await ensurePermission(
    handle,
    opts.create ? 'readwrite' : 'read',
  );
  if (!ok) {
    throw new Error('Permission to the folder was denied.');
  }
  const dir = handle as FileSystemDirectoryHandle & {
    getDirectoryHandle: (
      name: string,
      opts?: { create?: boolean },
    ) => Promise<FileSystemDirectoryHandle>;
  };
  try {
    return await dir.getDirectoryHandle(name, { create: !!opts.create });
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return null;
    throw e;
  }
}

/**
 * Scan a single directory handle for the most recently modified
 * supported work-order export. Shared by readLatestReport for both the
 * subfolder and the root-fallback passes.
 */
async function scanDirForLatestReport(
  dir: FileSystemDirectoryHandle,
  ignoreNames: string[] = [],
): Promise<{
  best: { file: File; name: string; lastModified: number; extension: string } | null;
  totalCount: number;
}> {
  const supported = ['.csv', '.xlsx', '.xls', '.json'];
  const ignore = new Set(ignoreNames.map((n) => n.toLowerCase()));
  let best: {
    file: File;
    name: string;
    lastModified: number;
    extension: string;
  } | null = null;
  let totalCount = 0;
  const iterable = dir as FileSystemDirectoryHandle & {
    values: () => AsyncIterable<FileSystemHandle>;
  };
  for await (const entry of iterable.values()) {
    if (entry.kind !== 'file') continue;
    const lower = entry.name.toLowerCase();
    const matchedExt = supported.find((ext) => lower.endsWith(ext));
    if (!matchedExt) continue;
    // Skip the app's own files (the Excel data workbook + the JSON sync
    // snapshot). Without this, "Refresh" can grab MWPJM-Data.xlsx or
    // mwpjm-state.json when the connected folder also holds them, and
    // the parser then (correctly) rejects them as non-report files.
    if (ignore.has(lower)) continue;
    totalCount++;
    const fileHandle = entry as FileSystemFileHandle;
    const f = await fileHandle.getFile();
    if (!best || f.lastModified > best.lastModified) {
      best = {
        file: f,
        name: entry.name,
        lastModified: f.lastModified,
        extension: matchedExt,
      };
    }
  }
  return { best, totalCount };
}

/**
 * Find and read the most recently modified work order export in the
 * connected folder. Scans for `.csv`, `.xlsx`, `.xls`, and `.json` so
 * the same folder works whether your Power Automate flow drops Excel
 * attachments or you export ServiceNow JSON manually. Returns null if
 * no supported file is found.
 *
 * If `subfolder` is provided (e.g. 'reports'), that subfolder is scanned
 * first. When the subfolder doesn't exist OR contains no supported file,
 * it gracefully falls back to scanning the connected folder root — so
 * existing setups (reports sitting in the root) keep working while the
 * new `Data/reports/` layout is also supported.
 */
export async function readLatestReport(
  subfolder?: string,
  ignoreNames: string[] = [],
): Promise<LatestReportResult | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY);
  if (!handle) {
    throw new Error('No folder connected. Connect a folder first.');
  }
  const ok = await ensurePermission(handle);
  if (!ok) {
    throw new Error('Permission to read the folder was denied.');
  }

  // Always skip the app's own data workbook; callers add the configured
  // sync filename (default mwpjm-state.json) on top. Lowercased compare.
  const ignore = ['mwpjm-data.xlsx', ...ignoreNames];

  let best: {
    file: File;
    name: string;
    lastModified: number;
    extension: string;
  } | null = null;
  let totalCount = 0;
  let scannedLocation = handle.name;

  // First pass: the configured subfolder, if any.
  const sub = (subfolder ?? '').trim();
  if (sub) {
    try {
      const subHandle = await getSubfolderHandle(sub, { create: false });
      if (subHandle) {
        const res = await scanDirForLatestReport(subHandle, ignore);
        if (res.best) {
          best = res.best;
          totalCount = res.totalCount;
          scannedLocation = `${handle.name}/${sub}`;
        }
      }
    } catch {
      // Ignore subfolder errors and fall back to the root scan below.
    }
  }

  // Fallback (or default) pass: the connected folder root.
  if (!best) {
    const res = await scanDirForLatestReport(handle, ignore);
    best = res.best;
    totalCount = res.totalCount;
    scannedLocation = handle.name;
  }

  if (!best) return null;
  return {
    file: best.file,
    filename: best.name,
    lastModified: best.lastModified,
    totalCount,
    extension: best.extension,
    scannedLocation,
  };
}

export async function clearFolderHandle(): Promise<void> {
  await idbDelete(KEY);
}

// ---------- Read / write a single named file in the connected folder ----------
//
// These helpers are used by the cross-device sync layer (lib/sync.ts) to
// drop a single state JSON next to the user's CSV exports. The browser
// already has a handle to the folder; we just open one named child file
// inside it.

/**
 * Write content to a file in the connected folder, creating it if
 * it doesn't exist and overwriting it if it does. Accepts text (JSON
 * sync files) or binary (BufferSource/Blob — e.g. the Excel .xlsx
 * workbook). Throws if no folder is connected or the user denies the
 * readwrite permission upgrade.
 */
export async function writeFileToFolder(
  filename: string,
  content: string | BufferSource | Blob,
): Promise<void> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY);
  if (!handle) {
    throw new Error('No folder connected. Connect a folder first.');
  }
  const ok = await ensurePermission(handle, 'readwrite');
  if (!ok) {
    throw new Error('Write permission to the folder was denied.');
  }
  const dir = handle as FileSystemDirectoryHandle & {
    getFileHandle: (
      name: string,
      opts?: { create?: boolean },
    ) => Promise<FileSystemFileHandle>;
  };
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const fh = fileHandle as FileSystemFileHandle & {
    createWritable: () => Promise<{
      write: (data: string | BufferSource | Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  };
  const writable = await fh.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

/**
 * Read a single file by name from the connected folder. Returns null if
 * the file isn't there yet (so the caller can distinguish "first run on
 * this device" from a real error).
 */
export async function readFileFromFolder(
  filename: string,
): Promise<File | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(KEY);
  if (!handle) {
    throw new Error('No folder connected. Connect a folder first.');
  }
  const ok = await ensurePermission(handle, 'read');
  if (!ok) {
    throw new Error('Read permission to the folder was denied.');
  }
  const dir = handle as FileSystemDirectoryHandle & {
    getFileHandle: (
      name: string,
      opts?: { create?: boolean },
    ) => Promise<FileSystemFileHandle>;
  };
  try {
    const fileHandle = await dir.getFileHandle(filename, { create: false });
    return await fileHandle.getFile();
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return null;
    throw e;
  }
}


// ---------- One-tap folder setup ----------
//
// Creates the standard subfolder structure inside the connected Data
// folder + seeds MWPJM-Data.xlsx if it doesn't exist. Called from
// Settings -> "Set up folders" button. Requires a connected folder
// with readwrite permission.

export interface SetupResult {
  created: string[];
  alreadyExisted: string[];
  error?: string;
}

/**
 * Create the standard subfolder structure and seed the Excel workbook.
 * Returns which subfolders were created vs. already existed.
 */
export async function setupWorkboardFolders(
  photosSubfolder: string,
  reportsSubfolder: string,
  meetingReportsSubfolder: string,
): Promise<SetupResult> {
  const created: string[] = [];
  const alreadyExisted: string[] = [];

  const folders = [photosSubfolder, reportsSubfolder, meetingReportsSubfolder];

  for (const name of folders) {
    if (!name.trim()) continue;
    // Check if it exists first
    const existing = await getSubfolderHandle(name, { create: false });
    if (existing) {
      alreadyExisted.push(name);
    } else {
      await getSubfolderHandle(name, { create: true });
      created.push(name);
    }
  }

  return { created, alreadyExisted };
}
