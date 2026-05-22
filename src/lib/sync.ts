/**
 * Cross-device state sync via the connected OneDrive folder.
 *
 * Local-first design with no backend: the desktop writes a single JSON
 * file (default name `mwpjm-state.json`) into the same folder that's
 * already connected for CSV refreshes on the Reports page. OneDrive's
 * own sync moves the file to the user's other devices. The phone (or
 * any other device with the app installed) pulls the file at any time
 * — either via the connected folder on Chromium desktop, or via the
 * native file picker on mobile Safari/Chrome where the File System
 * Access API isn't available.
 *
 * Photos are intentionally NOT synced. They live in per-device
 * IndexedDB blobs and are too large to ship through this lightweight
 * channel. Photo *metadata* (filename, caption, captured-at) flows
 * with the rest of the project so mobile sees that "5 photos exist
 * on the desktop"; the user keeps the binary photos on the device
 * that captured them.
 */

import { useStore } from '../state/store';
import {
  isFolderApiSupported,
  readFileFromFolder,
  writeFileToFolder,
} from './folderConnection';
import type { Project, Settings } from '../types';
import type { ImportedWorkOrders } from './workOrderCsv';

export const DEFAULT_SYNC_FILENAME = 'mwpjm-state.json';

/**
 * The on-disk shape of the sync file. Versioned so we can evolve it
 * without breaking older devices that haven't been refreshed yet.
 */
export interface SyncPayload {
  version: 1;
  /** ISO timestamp marking when this snapshot was written. */
  syncedAt: string;
  projects: Project[];
  settings: Settings;
  /** Most recent CSV import — included so the mobile dashboard sees
   *  the same Work Orders the desktop just refreshed. */
  workOrders: ImportedWorkOrders | null;
}

function buildPayload(): SyncPayload {
  const state = useStore.getState();
  return {
    version: 1,
    syncedAt: new Date().toISOString(),
    projects: state.projects,
    settings: state.settings,
    workOrders: state.workOrders,
  };
}

/**
 * Validate and normalize a parsed JSON object into a SyncPayload.
 * Throws with a user-friendly message if the file isn't a sync file.
 */
export function parseSyncPayload(text: string): SyncPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Sync file has an unexpected shape.');
  }
  const p = parsed as Partial<SyncPayload>;
  if (!Array.isArray(p.projects)) {
    throw new Error('Sync file is missing the projects list.');
  }
  if (!p.settings || typeof p.settings !== 'object') {
    throw new Error('Sync file is missing settings.');
  }
  return {
    version: 1,
    syncedAt:
      typeof p.syncedAt === 'string' ? p.syncedAt : new Date().toISOString(),
    projects: p.projects,
    settings: p.settings as Settings,
    workOrders: (p.workOrders as ImportedWorkOrders | null) ?? null,
  };
}

/**
 * Write the current store state to the connected folder.
 *
 * On success: updates `lastSyncedAt` and clears `syncError` in the store.
 * On failure: records the error in `syncError` and re-throws so callers
 * (the auto-sync subscriber, or a manual "Push now" click) can react.
 *
 * This is the desktop / Chromium path that uses the File System Access
 * API. Mobile and other environments without that API should call
 * `pushViaShareOrDownload` instead, which routes through the system
 * share sheet (preferred) or a download anchor (fallback).
 */
export async function pushNow(
  filename: string = DEFAULT_SYNC_FILENAME,
): Promise<SyncPayload> {
  const payload = buildPayload();
  const json = JSON.stringify(payload, null, 2);
  try {
    await writeFileToFolder(filename, json);
    useStore.setState({
      lastSyncedAt: payload.syncedAt,
      syncError: null,
    });
    return payload;
  } catch (e) {
    useStore.setState({ syncError: (e as Error).message });
    throw e;
  }
}

/**
 * Whether `navigator.share` accepts files. Used by the sync UI to
 * decide which Push variant to surface — folder-write (desktop with
 * a connected folder) or share-sheet (mobile, where the user picks
 * the OneDrive app from the system share sheet and saves into their
 * sync folder there).
 */
export function isShareFileSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: unknown) => Promise<void>;
  };
  return typeof nav.share === 'function' && typeof nav.canShare === 'function';
}

/**
 * Mobile / non-folder push path. Builds the same SyncPayload as
 * `pushNow`, then ships it via:
 *
 *   1. `navigator.share({ files: [...] })` — preferred on mobile. The
 *      OS share sheet opens, the user picks OneDrive (or any other
 *      destination), and the file lands there. Returns method:'share'.
 *   2. Anchor-tag download — universal fallback. The browser saves
 *      the file to the user's downloads folder; they must manually
 *      move it into their OneDrive sync folder afterward. Returns
 *      method:'download'.
 *   3. method:'aborted' if the user dismissed the share sheet — in
 *      that case lastSyncedAt is NOT touched.
 *
 * Closes the gap that the original `pushNow` left open: mobile Chrome
 * has no File System Access API, so without this, mobile work could
 * never reach the desktop through sync. Pull works either direction;
 * push needed a separate path on mobile.
 */
export async function pushViaShareOrDownload(
  filename: string = DEFAULT_SYNC_FILENAME,
): Promise<{ method: 'share' | 'download' | 'aborted'; payload?: SyncPayload }> {
  const payload = buildPayload();
  const json = JSON.stringify(payload, null, 2);
  const file = new File([json], filename, { type: 'application/json' });

  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: 'MWPJM sync state',
        text: 'Save this file into your MWPJM sync folder in OneDrive.',
      });
      useStore.setState({
        lastSyncedAt: payload.syncedAt,
        syncError: null,
      });
      return { method: 'share', payload };
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        return { method: 'aborted' };
      }
      // Fall through to download for any other error rather than
      // failing outright — the user can still recover by moving the
      // download into OneDrive manually.
    }
  }

  // Download fallback — works in every browser that can drop a Blob
  // through an anchor click (i.e. every browser).
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  useStore.setState({
    lastSyncedAt: payload.syncedAt,
    syncError: null,
  });
  return { method: 'download', payload };
}

/**
 * Read the sync file from the connected folder. Returns null if the
 * file isn't present (e.g. you've connected a folder on this device
 * but no other device has pushed to it yet).
 */
export async function pullFromFolder(
  filename: string = DEFAULT_SYNC_FILENAME,
): Promise<SyncPayload | null> {
  const file = await readFileFromFolder(filename);
  if (!file) return null;
  const text = await file.text();
  return parseSyncPayload(text);
}

/**
 * Mobile / Safari fallback: read a sync file the user picked from a
 * file dialog. Lets the user navigate to the file in the OneDrive app
 * and import it without needing the File System Access API.
 */
export async function pullFromFile(file: File): Promise<SyncPayload> {
  const text = await file.text();
  return parseSyncPayload(text);
}

/**
 * Apply a parsed payload to the store. Replaces local projects /
 * settings / workOrders. Marks `lastSyncedAt` as the source's
 * syncedAt so we can detect "the file is older than what's local"
 * on the next pull.
 */
export function applySyncedState(payload: SyncPayload): void {
  useStore.getState().applySyncedState({
    projects: payload.projects,
    settings: payload.settings,
    workOrders: payload.workOrders,
    syncedAt: payload.syncedAt,
  });
}

// ---------- Auto-sync subscription ----------
//
// Subscribes to the store and writes the file every time projects,
// settings, or workOrders change. Debounced so a burst of edits
// (typing into a field, dragging milestones around) coalesces into a
// single write. Reference-equality on the watched slices means
// updates to `lastSyncedAt` / `syncError` themselves don't cause a
// re-write loop.

let stopFn: (() => void) | null = null;

export function startAutoSync(
  filename: string = DEFAULT_SYNC_FILENAME,
  debounceMs = 2000,
): () => void {
  if (!isFolderApiSupported()) {
    throw new Error(
      'Auto-sync requires a Chromium-based browser on desktop (Chrome / Edge).',
    );
  }

  // Replace any existing subscription if start is called again.
  stopAutoSync();

  let timer: number | null = null;

  // Push immediately so the file always exists once the user enables
  // auto-sync, even if they don't make any further edits this session.
  pushNow(filename).catch(() => {
    // Already recorded in syncError — UI will surface it.
  });

  const unsubscribe = useStore.subscribe((state, prev) => {
    const persistedSliceUnchanged =
      state.projects === prev.projects &&
      state.settings === prev.settings &&
      state.workOrders === prev.workOrders;
    if (persistedSliceUnchanged) return;

    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      pushNow(filename).catch(() => {
        // Error already recorded; nothing else to do here.
      });
    }, debounceMs);
  });

  stopFn = () => {
    unsubscribe();
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  return stopFn;
}

export function stopAutoSync(): void {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
}
