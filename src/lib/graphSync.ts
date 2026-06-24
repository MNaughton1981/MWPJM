/**
 * Cross-device sync via Microsoft Graph (OneDrive for Business).
 *
 * This is the "it just syncs" path that the file-based folder sync
 * couldn't deliver on mobile (the File System Access API is desktop
 * Chromium only). Here, the signed-in user's Graph token lets the app
 * read/write a single JSON snapshot directly in their OneDrive — on
 * ANY device and ANY browser, including the Pixel home-screen PWA.
 *
 * The snapshot shape and the merge semantics are shared with the
 * file-based path (see lib/sync.ts): `currentSyncPayload()` builds it,
 * `parseSyncPayload()` validates it, and `applyMergedState()` does the
 * union-by-id / newest-wins merge that never drops local-only data.
 *
 * Storage location: <OneDrive root>/MWPJM/mwpjm-state.json — a normal,
 * user-visible folder, using the delegated `Files.ReadWrite` scope
 * (user-consentable, no tenant admin approval needed).
 */

import { useStore } from '../state/store';
import { getGraphToken } from './graphAuth';
import { GRAPH_SYNC_FILENAME, GRAPH_SYNC_FOLDER } from './graphConfig';
import {
  applyMergedState,
  currentSyncPayload,
  parseSyncPayload,
  type MergeSummary,
} from './sync';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

/** Turn a non-OK Graph response into a readable Error. */
async function graphError(res: Response, context: string): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch {
    // body wasn't JSON; ignore
  }
  return new Error(
    `${context} (HTTP ${res.status}${detail ? `: ${detail}` : ''})`,
  );
}

/**
 * Ensure the MWPJM folder exists in the user's OneDrive root. Creating
 * the file by path doesn't reliably create missing parents, so we
 * provision the folder up front. A 409 (already exists) is fine.
 */
async function ensureFolder(token: string): Promise<void> {
  const check = await graphFetch(
    token,
    `/me/drive/root:/${encodeURIComponent(GRAPH_SYNC_FOLDER)}`,
  );
  if (check.ok) return;
  if (check.status !== 404) {
    throw await graphError(check, 'Could not check OneDrive folder');
  }
  const create = await graphFetch(token, '/me/drive/root/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: GRAPH_SYNC_FOLDER,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'replace',
    }),
  });
  if (!create.ok && create.status !== 409) {
    throw await graphError(create, 'Could not create OneDrive folder');
  }
}

/**
 * Download the remote sync file's text, or null if it doesn't exist
 * yet (no device has pushed). Throws on any other error.
 */
async function downloadRemote(token: string): Promise<string | null> {
  const res = await graphFetch(
    token,
    `/me/drive/root:/${encodeURIComponent(GRAPH_SYNC_FOLDER)}/${encodeURIComponent(
      GRAPH_SYNC_FILENAME,
    )}:/content`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await graphError(res, 'Could not read sync file');
  return res.text();
}

/** Upload (create or overwrite) the remote sync file. */
async function uploadRemote(token: string, json: string): Promise<void> {
  await ensureFolder(token);
  const res = await graphFetch(
    token,
    `/me/drive/root:/${encodeURIComponent(GRAPH_SYNC_FOLDER)}/${encodeURIComponent(
      GRAPH_SYNC_FILENAME,
    )}:/content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: json,
    },
  );
  if (!res.ok) throw await graphError(res, 'Could not write sync file');
}

/** Result of a Graph sync, surfaced in the Settings UI. */
export type GraphSyncResult =
  | { kind: 'merged'; summary: MergeSummary; syncedAt: string }
  | { kind: 'pushed-new'; syncedAt: string };

/**
 * Two-way sync with OneDrive in one call:
 *   1. Download the remote snapshot (if any) and merge it in
 *      (union-by-id, newest wins, never drops local-only data).
 *   2. Upload the resulting local state back, so the remote file
 *      converges to the union and other devices pick it up next pull.
 *
 * This is what the "Sync now" button and auto-sync both call.
 */
export async function graphSyncNow(): Promise<GraphSyncResult> {
  const token = await getGraphToken();
  try {
    const remoteText = await downloadRemote(token);
    let result: GraphSyncResult;
    if (remoteText) {
      const payload = parseSyncPayload(remoteText);
      const summary = applyMergedState(payload);
      result = { kind: 'merged', summary, syncedAt: new Date().toISOString() };
    } else {
      result = { kind: 'pushed-new', syncedAt: new Date().toISOString() };
    }
    // Upload the (possibly merged) local state so remote converges.
    const json = JSON.stringify(currentSyncPayload(), null, 2);
    await uploadRemote(token, json);
    useStore.setState({
      graphLastSyncedAt: result.syncedAt,
      graphSyncError: null,
    });
    return result;
  } catch (e) {
    useStore.setState({ graphSyncError: (e as Error).message });
    throw e;
  }
}

/**
 * Push-only: upload current local state to OneDrive without merging
 * first. Used by the debounced auto-sync subscription, where pulling on
 * every keystroke would be wasteful — the periodic explicit "Sync now"
 * and the pull-on-open handle the inbound direction.
 */
export async function graphPushNow(): Promise<void> {
  const token = await getGraphToken();
  try {
    const json = JSON.stringify(currentSyncPayload(), null, 2);
    await uploadRemote(token, json);
    useStore.setState({
      graphLastSyncedAt: new Date().toISOString(),
      graphSyncError: null,
    });
  } catch (e) {
    useStore.setState({ graphSyncError: (e as Error).message });
    throw e;
  }
}

// ---------- Auto-sync subscription ----------
//
// Mirrors lib/sync.ts startAutoSync, but writes to OneDrive over Graph
// instead of a connected folder. Debounced so a burst of edits
// coalesces into one upload. Unlike the folder path, this works on
// every device/browser as long as the user is signed in.

let stopFn: (() => void) | null = null;

export function startGraphAutoSync(debounceMs = 3000): () => void {
  stopGraphAutoSync();

  let timer: number | null = null;

  const unsubscribe = useStore.subscribe((state, prev) => {
    const persistedSliceUnchanged =
      state.projects === prev.projects &&
      state.settings === prev.settings &&
      state.workOrders === prev.workOrders &&
      state.savedVendors === prev.savedVendors &&
      state.savedHosts === prev.savedHosts &&
      state.savedVendorEvents === prev.savedVendorEvents;
    if (persistedSliceUnchanged) return;

    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      graphPushNow().catch(() => {
        // Error already recorded in graphSyncError; UI surfaces it.
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

export function stopGraphAutoSync(): void {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
}
