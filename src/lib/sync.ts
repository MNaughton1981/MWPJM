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
import type { Project, SavedVendor, Settings } from '../types';
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
  /**
   * The user's vendor "book" — global, not per-project. Synced so
   * saving a vendor on desktop makes it pickable on mobile next
   * time the user adds one. Optional field for backwards-compat
   * with snapshots written before the vendor book existed.
   */
  savedVendors?: SavedVendor[];
}

function buildPayload(): SyncPayload {
  const state = useStore.getState();
  return {
    version: 1,
    syncedAt: new Date().toISOString(),
    projects: state.projects,
    settings: state.settings,
    workOrders: state.workOrders,
    savedVendors: state.savedVendors,
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
    savedVendors: Array.isArray(p.savedVendors) ? p.savedVendors : [],
  };
}

/**
 * Write the current store state to the connected folder.
 *
 * On success: updates `lastSyncedAt` and clears `syncError` in the store.
 * On failure: records the error in `syncError` and re-throws so callers
 * (the auto-sync subscriber, or a manual "Push now" click) can react.
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
    savedVendors: payload.savedVendors ?? [],
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
      state.workOrders === prev.workOrders &&
      state.savedVendors === prev.savedVendors;
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

// ---------- Smart "Refresh" — one button does the right thing ----------
//
// The dual Send / Get buttons made users think about direction every
// time. Most of the time the user just wants their devices to be in
// sync — they don't care which way data flowed last. `refreshFromFolder`
// collapses that into a single "do the right thing" action:
//
//   1. Read the sync file from the connected folder.
//   2. If the file is newer than this device's last sync, apply it.
//   3. Else if this device has un-synced local changes, push them.
//   4. Else: no-op, return 'already-current'.
//
// Used by SyncQuickActions on the Workboards page header. The same
// function powers auto-pull-on-mount (with `direction: 'pull-only'`
// to skip step 3) so users opening the Workboards page on a device
// that's been idle automatically see the latest state from the
// device they were last on.

/**
 * Crude "do we have unpushed edits?" detector. Compares the most
 * recent project `updatedAt` against `lastSyncedAt`. If any project
 * was touched after the last sync, there's something to push.
 *
 * Doesn't catch every case (e.g. settings-only edits don't bump any
 * project's updatedAt), but in practice the pattern is "user edits a
 * workboard, then opens the other device" so this is enough.
 */
export function hasLocalChanges(): boolean {
  const state = useStore.getState();
  if (!state.lastSyncedAt) return state.projects.length > 0;
  const lastSyncMs = new Date(state.lastSyncedAt).getTime();
  for (const p of state.projects) {
    if (new Date(p.updatedAt).getTime() > lastSyncMs) return true;
  }
  return false;
}

export type RefreshStatus =
  /** No folder connected (or browser doesn't support the folder API). */
  | { kind: 'no-folder' }
  /** Folder connected, but no sync file there yet. Pull was a no-op. */
  | { kind: 'no-file' }
  /** Already at parity with the file. Nothing changed. */
  | { kind: 'already-current' }
  /** File was newer than us — applied. */
  | { kind: 'applied'; projectsCount: number; syncedAt: string }
  /** We were newer (and had local changes) — pushed. */
  | { kind: 'pushed'; projectsCount: number; syncedAt: string }
  /** Refresh hit an error. */
  | { kind: 'error'; message: string };

/**
 * One-button sync. See header comment above for the algorithm.
 *
 * `direction` controls whether the function may push:
 *   - 'pull-and-push' (manual Refresh button): full algorithm.
 *   - 'pull-only' (auto-pull on page mount): skips the push step.
 *     The reasoning: on auto-pull we don't want a passive page open
 *     to silently overwrite the file. Pushing is reserved for
 *     explicit user actions (manual Refresh) or auto-sync's
 *     edit-driven debounce.
 */
export async function refreshFromFolder(
  filename: string = DEFAULT_SYNC_FILENAME,
  direction: 'pull-only' | 'pull-and-push' = 'pull-and-push',
): Promise<RefreshStatus> {
  if (!isFolderApiSupported()) return { kind: 'no-folder' };

  let payload: SyncPayload | null;
  try {
    payload = await pullFromFolder(filename);
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }

  const state = useStore.getState();
  const localLastSync = state.lastSyncedAt;
  const localSyncedMs = localLastSync
    ? new Date(localLastSync).getTime()
    : 0;

  // No file exists yet. If we have data and pushing is allowed, write
  // it so the file gets created. Otherwise no-op.
  if (!payload) {
    if (direction === 'pull-and-push' && state.projects.length > 0) {
      try {
        const pushed = await pushNow(filename);
        return {
          kind: 'pushed',
          projectsCount: pushed.projects.length,
          syncedAt: pushed.syncedAt,
        };
      } catch (e) {
        return { kind: 'error', message: (e as Error).message };
      }
    }
    return { kind: 'no-file' };
  }

  const fileSyncedMs = new Date(payload.syncedAt).getTime();

  // File is newer than us — apply.
  if (fileSyncedMs > localSyncedMs) {
    applySyncedState(payload);
    return {
      kind: 'applied',
      projectsCount: payload.projects.length,
      syncedAt: payload.syncedAt,
    };
  }

  // We're newer (or tied) — push if we have local changes.
  if (
    direction === 'pull-and-push' &&
    fileSyncedMs <= localSyncedMs &&
    hasLocalChanges()
  ) {
    try {
      const pushed = await pushNow(filename);
      return {
        kind: 'pushed',
        projectsCount: pushed.projects.length,
        syncedAt: pushed.syncedAt,
      };
    } catch (e) {
      return { kind: 'error', message: (e as Error).message };
    }
  }

  return { kind: 'already-current' };
}
