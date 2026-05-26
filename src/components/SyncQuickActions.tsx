import { useEffect, useRef, useState } from 'react';
import {
  applySyncedState,
  DEFAULT_SYNC_FILENAME,
  pullFromFile,
  pullFromFolder,
  pushNow,
  type SyncPayload,
} from '../lib/sync';
import {
  getStoredFolderName,
  isFolderApiSupported,
} from '../lib/folderConnection';
import { useStore } from '../state/store';
import { formatDateTime } from '../lib/format';

/**
 * Compact sync controls for header rows (Dashboard, etc).
 *
 * The buttons shown adapt to the device's capabilities:
 *
 *   - Mobile / Safari (File System Access API absent): only "↓ Get
 *     latest" is shown, and it opens a file picker so the user can
 *     grab the synced state file from the OneDrive app.
 *   - Desktop, no folder yet connected: same as mobile — Get falls
 *     back to the file picker. Send is hidden because it has nowhere
 *     to write.
 *   - Desktop with a connected folder: both "↓ Get latest" (reads the
 *     folder) and "↑ Send updates" (writes the folder) are shown.
 *
 * Labels deliberately match the full Settings page sync section
 * (Send / Get) instead of the older Push / Pull terminology — they
 * say which way data is flowing without making the user memorize
 * which direction "push" or "pull" means in this app.
 *
 * Status messages are shown inline next to the buttons and clear
 * themselves after a few seconds, so the header stays compact and
 * doesn't accumulate stale chrome.
 *
 * The Settings page has the full sync UI (auto-sync toggle, filename
 * input, error display, last-synced timestamp). This component is the
 * "I'm in the field, give me the latest data" quick action.
 */
export default function SyncQuickActions() {
  const syncFilename = useStore((s) => s.settings.syncFilename);
  const filename = syncFilename || DEFAULT_SYNC_FILENAME;

  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<string | undefined>();

  const fileRef = useRef<HTMLInputElement>(null);
  const folderApi = isFolderApiSupported();
  const canFolderSync = folderApi && Boolean(connectedFolder);

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

  function applyAfterConfirm(payload: SyncPayload, source: string) {
    const woLine = payload.workOrders
      ? `Work orders: ${payload.workOrders.rows.length} (${payload.workOrders.sourceFilename})\n`
      : 'Work orders: none\n';
    const ok = window.confirm(
      `Replace local state with the version from ${source}?\n\n` +
        `Synced: ${formatDateTime(payload.syncedAt)}\n` +
        `Projects: ${payload.projects.length}\n` +
        woLine +
        `\nAny edits made on this device since the last sync will be lost.`,
    );
    if (!ok) {
      setMsg('Load cancelled.');
      return;
    }
    applySyncedState(payload);
    setMsg(`Loaded ${payload.projects.length} project(s) from ${source}.`);
  }

  async function handlePullFromFolder() {
    setMsg(null);
    setBusy('pull');
    try {
      const payload = await pullFromFolder(filename);
      if (!payload) {
        setMsg(`No "${filename}" in the connected folder yet.`);
        return;
      }
      applyAfterConfirm(payload, 'connected folder');
    } catch (e) {
      setMsg(`Load failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handlePullFromFile(file: File) {
    setMsg(null);
    setBusy('pull');
    try {
      const payload = await pullFromFile(file);
      applyAfterConfirm(payload, file.name);
    } catch (e) {
      setMsg(`Load failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handlePush() {
    setMsg(null);
    setBusy('push');
    try {
      const payload = await pushNow(filename);
      setMsg(
        `Sent ${payload.projects.length} project(s) at ${formatDateTime(
          payload.syncedAt,
        )}.`,
      );
    } catch (e) {
      setMsg(`Send failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function handlePullClick() {
    if (canFolderSync) {
      handlePullFromFolder();
    } else {
      fileRef.current?.click();
    }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button
        type="button"
        className="btn-secondary text-xs"
        onClick={handlePullClick}
        disabled={busy !== null}
        title={
          canFolderSync
            ? 'Get the latest state another device sent — loads from the connected OneDrive folder.'
            : 'Pick a snapshot file from your device picker (e.g. via the OneDrive app).'
        }
      >
        {busy === 'pull' ? '↓ Loading…' : '↓ Get latest'}
      </button>
      {canFolderSync && (
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={handlePush}
          disabled={busy !== null}
          title="Send THIS device's current state to OneDrive so other devices can load the latest."
        >
          {busy === 'push' ? '↑ Sending…' : '↑ Send updates'}
        </button>
      )}
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
