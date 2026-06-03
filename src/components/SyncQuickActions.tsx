import { useEffect, useRef, useState } from 'react';
import {
  applySyncedState,
  DEFAULT_SYNC_FILENAME,
  pullFromFile,
  refreshFromFolder,
  type RefreshStatus,
} from '../lib/sync';
import {
  getStoredFolderName,
  isFolderApiSupported,
} from '../lib/folderConnection';
import { useStore } from '../state/store';
import { formatDateTime } from '../lib/format';

/**
 * Compact sync controls for the Workboards page header.
 *
 * The dual "Send / Get" buttons that used to live here made users
 * think about direction every time, even though most of the time the
 * mental model is just "make sure my devices are in sync." This
 * component now exposes a single "🔄 Refresh" button backed by
 * `refreshFromFolder` which does the right thing: pull, apply if the
 * file is newer, push if local changes need to be sent.
 *
 * Companion behaviors:
 *
 *   - **Auto-pull on mount**, when `syncEnabled` is on AND a folder
 *     is connected. Silently pulls the latest from the folder once
 *     per page open. If the file is newer, it's applied and a small
 *     "Loaded changes from another device" pill flashes. If nothing
 *     changed, no UI noise. Switches the user's mental model from
 *     "I have to remember to refresh" to "the Workboards list is
 *     fresh by definition."
 *
 *   - **Freshness indicator** showing "Synced 4m ago" / "Synced 1h
 *     ago" next to the button. Tinted slate when fresh (< 5m), amber
 *     when stale (> 30m). Updates every 30s so the relative time
 *     stays sensible without re-rendering on every state change.
 *
 *   - **File-picker fallback** for mobile / Safari (no File System
 *     Access API). The Refresh button opens a file picker so the
 *     user can grab the snapshot from the OneDrive app.
 *
 * The full Settings page sync section keeps the explicit Send / Get
 * buttons for power users who want fine-grained control. This
 * component is the everyday "I'm in the field, give me the latest"
 * action.
 */
export default function SyncQuickActions() {
  const syncFilename = useStore((s) => s.settings.syncFilename);
  const syncEnabled = useStore((s) => s.settings.syncEnabled);
  const lastSyncedAt = useStore((s) => s.lastSyncedAt);
  const filename = syncFilename || DEFAULT_SYNC_FILENAME;

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<string | undefined>();
  // `now` is just a tick value used to recompute the freshness label
  // every 30s. We don't actually use the value anywhere except as a
  // dependency to force a re-render.
  const [now, setNow] = useState(Date.now());

  const fileRef = useRef<HTMLInputElement>(null);
  const folderApi = isFolderApiSupported();
  const canFolderSync = folderApi && Boolean(connectedFolder);

  // Tick the freshness label once a half-minute. Cheap; only
  // triggers a re-render of this small component.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    getStoredFolderName().then(setConnectedFolder);
  }, []);

  // Auto-clear status after 5s so the header doesn't accumulate stale
  // messages from previous syncs.
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);

  // Auto-pull on mount.
  //
  // Conditions:
  //   - File System Access folder API is supported on this browser
  //   - A folder has been connected (we have a stored handle)
  //   - syncEnabled is true (user has opted into "manage sync for me")
  //
  // We respect syncEnabled=false as "user wants manual control" and
  // skip auto-pull in that case — the Refresh button is still there
  // to do it on demand.
  //
  // Runs only ONCE per component mount via the ref guard. Without it
  // the effect would re-fire if any dep flipped (e.g. connectedFolder
  // resolves from the IDB read) and we'd pull repeatedly.
  const autoPullDoneRef = useRef(false);
  useEffect(() => {
    if (autoPullDoneRef.current) return;
    if (!canFolderSync) return;
    if (!syncEnabled) return;
    autoPullDoneRef.current = true;

    refreshFromFolder(filename, 'pull-only')
      .then((status) => {
        if (status.kind === 'applied') {
          setMsg(
            `Loaded ${status.projectsCount} project(s) from another device.`,
          );
        }
        // 'already-current', 'no-file', 'no-folder', 'pushed' — silent.
        // (Auto-pull never pushes, so 'pushed' shouldn't happen here.)
        if (status.kind === 'error') {
          // Don't surface — auto-pull failure is invisible by design.
          // User can manually tap Refresh to see the actual error.
          // eslint-disable-next-line no-console
          console.warn('Auto-pull failed:', status.message);
        }
      })
      .catch(() => {
        // Belt and suspenders — refreshFromFolder already returns
        // {kind:'error'} on most failures, but just in case.
      });
  }, [canFolderSync, syncEnabled, filename]);

  async function handleRefreshClick() {
    if (!canFolderSync) {
      // Mobile / no-folder fallback: pick a snapshot from the device.
      fileRef.current?.click();
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const status = await refreshFromFolder(filename, 'pull-and-push');
      setMsg(formatStatus(status));
    } finally {
      setBusy(false);
    }
  }

  async function handlePullFromFile(file: File) {
    setBusy(true);
    setMsg(`Reading "${file.name}"…`);
    try {
      const payload = await pullFromFile(file);
      // The user explicitly picked this file — they want it applied.
      // Skip the "are you sure?" prompt the older flow used, which
      // most people blew through without reading anyway. The lib
      // function is non-destructive in the sense that it preserves
      // photos in IndexedDB, so the worst case is "I picked the wrong
      // file and now my list looks weird"; recoverable by re-syncing.
      applySyncedState(payload);
      setMsg(`✓ Loaded ${payload.projects.length} project(s) from ${file.name}.`);
    } catch (e) {
      setMsg(`Load failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const freshness = formatFreshness(lastSyncedAt, now);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {lastSyncedAt && (
        <span
          className={`text-[11px] ${freshness.color}`}
          title={`Last synced: ${formatDateTime(lastSyncedAt)}`}
        >
          {freshness.label}
        </span>
      )}
      <button
        type="button"
        className="btn-secondary text-xs"
        onClick={handleRefreshClick}
        disabled={busy}
        title={
          canFolderSync
            ? 'Pull the latest from your other devices, push your local changes if any. One tap, both directions.'
            : 'Pick a snapshot file from your device picker (e.g. via the OneDrive app).'
        }
      >
        {busy ? '🔄 Syncing…' : '🔄 Refresh'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handlePullFromFile(f);
          e.target.value = '';
        }}
      />
      {msg && (
        <span
          className="text-[11px] text-slate-600 ml-1 max-w-[14rem] sm:max-w-xs truncate"
          title={msg}
        >
          {msg}
        </span>
      )}
    </div>
  );
}

/**
 * Translate a RefreshStatus into a status pill label. Kept short so
 * the message strip in the header stays compact.
 */
function formatStatus(status: RefreshStatus): string {
  switch (status.kind) {
    case 'no-folder':
      return 'No folder connected. Use Settings → Sync to connect one.';
    case 'no-file':
      return 'No sync file in the folder yet — nothing to load.';
    case 'already-current':
      return 'Already up to date.';
    case 'applied':
      return `Loaded ${status.projectsCount} project(s) from another device.`;
    case 'pushed':
      return `Sent ${status.projectsCount} project(s) to the folder.`;
    case 'error':
      return `Refresh failed: ${status.message}`;
  }
}

/**
 * Compute a relative time label for the freshness indicator, plus a
 * Tailwind text-color class. Color escalates as freshness ages so a
 * stale state catches the eye:
 *   - Fresh (< 5m):    slate-500 (no alarm)
 *   - Mid (5–30m):     slate-500
 *   - Stale (30–60m):  amber-600
 *   - Older:           amber-600
 *
 * "Just now" / "Xm ago" / "Xh ago" / "Xd ago" — keeps the pill short
 * regardless of how long it's been.
 */
function formatFreshness(
  lastSyncedAt: string | null,
  // `now` triggers re-renders via the parent's setInterval; we don't
  // actually use the value here (we read Date.now() fresh below) but
  // the parameter is what gets memoization to invalidate.
  _now: number,
): { label: string; color: string } {
  if (!lastSyncedAt) {
    return { label: 'Not synced', color: 'text-slate-500' };
  }
  const ms = Date.now() - new Date(lastSyncedAt).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return { label: 'Synced just now', color: 'text-slate-500' };
  if (m < 60) {
    const color = m >= 30 ? 'text-amber-600' : 'text-slate-500';
    return { label: `Synced ${m}m ago`, color };
  }
  const h = Math.floor(m / 60);
  if (h < 24) return { label: `Synced ${h}h ago`, color: 'text-amber-600' };
  const d = Math.floor(h / 24);
  return { label: `Synced ${d}d ago`, color: 'text-amber-600' };
}
