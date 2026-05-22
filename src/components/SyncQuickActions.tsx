import { useEffect, useRef, useState } from 'react';
import {
  applySyncedState,
  DEFAULT_SYNC_FILENAME,
  pullFromFile,
  pullFromFolder,
  pushNow,
  pushViaShareOrDownload,
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
 * The Pull button is always shown — it can always do something useful:
 *   - With a connected folder: reads the folder via File System Access.
 *   - Otherwise: opens the file picker as a fallback.
 *
 * The Push button is also always shown, but the underlying transport
 * adapts to the device:
 *   - Connected folder (Chromium desktop): writes via File System Access.
 *   - Mobile / no folder: routes through navigator.share (system share
 *     sheet → user picks OneDrive) with a download anchor as fallback.
 *     This is what makes mobile-to-desktop sync actually work — without
 *     it, mobile capture was silently stuck on the device.
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
      setMsg('Pull cancelled.');
      return;
    }
    applySyncedState(payload);
    setMsg(`Applied ${payload.projects.length} project(s) from ${source}.`);
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
      setMsg(`Pull failed: ${(e as Error).message}`);
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
      setMsg(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handlePush() {
    setMsg(null);
    setBusy('push');
    try {
      if (canFolderSync) {
        const payload = await pushNow(filename);
        setMsg(
          `Pushed ${payload.projects.length} project(s) at ${formatDateTime(
            payload.syncedAt,
          )}.`,
        );
      } else {
        // Mobile (or desktop without a connected folder) — route through
        // the system share sheet so the user can drop the file into the
        // OneDrive app, falling back to a download if share-with-files
        // isn't available.
        const result = await pushViaShareOrDownload(filename);
        if (result.method === 'aborted') {
          setMsg('Share cancelled.');
        } else if (result.method === 'share') {
          setMsg(
            `Shared ${result.payload!.projects.length} project(s). Pick OneDrive → save into your sync folder (overwrite if asked).`,
          );
        } else {
          setMsg(
            `Downloaded ${result.payload!.projects.length} project(s). Move "${filename}" into your OneDrive sync folder.`,
          );
        }
      }
    } catch (e) {
      setMsg(`Push failed: ${(e as Error).message}`);
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
            ? 'Pull the latest synced state from the connected folder'
            : 'Pick a sync file from your device (e.g. via OneDrive)'
        }
      >
        {busy === 'pull' ? '↓ Pulling…' : '↓ Pull'}
      </button>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={handlePush}
        disabled={busy !== null}
        title={
          canFolderSync
            ? 'Push the current state to the connected folder'
            : 'Share or download the current state — pick OneDrive in the share sheet to send it to your sync folder'
        }
      >
        {busy === 'push' ? '↑ Pushing…' : '↑ Push'}
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
