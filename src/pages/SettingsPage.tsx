import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  buildAppData,
  downloadJson,
  parseAppDataFile,
} from '../lib/exporters';
import { DEFAULT_NUVOLO_EMAIL } from '../lib/nuvolo';
import {
  clearFolderHandle,
  getStoredFolderName,
  isFolderApiSupported,
  pickReportFolder,
} from '../lib/folderConnection';

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const projects = useStore((s) => s.projects);
  const replaceAll = useStore((s) => s.replaceAll);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<string | undefined>();
  const [folderError, setFolderError] = useState<string | null>(null);
  const folderApi = isFolderApiSupported();

  useEffect(() => {
    getStoredFolderName().then(setConnectedFolder);
  }, []);

  function exportBackup() {
    const data = buildAppData(projects, settings);
    downloadJson(`mwpjm-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
  }

  async function onImport(file: File) {
    try {
      const data = await parseAppDataFile(file);
      const ok = window.confirm(
        `Import ${data.projects.length} project(s)? This will REPLACE your current local data.`,
      );
      if (!ok) return;
      replaceAll({ projects: data.projects, settings: data.settings ?? settings });
      setImportMsg(`Imported ${data.projects.length} project(s).`);
    } catch (e) {
      setImportMsg(`Import failed: ${(e as Error).message}`);
    }
  }

  async function connectFolder() {
    setFolderError(null);
    try {
      const result = await pickReportFolder();
      setConnectedFolder(result.name);
    } catch (e) {
      // User cancellation throws AbortError — don't treat as an error
      if ((e as { name?: string }).name === 'AbortError') return;
      setFolderError((e as Error).message);
    }
  }

  async function disconnectFolder() {
    await clearFolderHandle();
    setConnectedFolder(undefined);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Technician</h2>
        <div>
          <label className="label">Your name (used in update sign-off)</label>
          <input
            className="input"
            placeholder="Mike N."
            value={settings.technicianName}
            onChange={(e) => setSettings({ technicianName: e.target.value })}
          />
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Nuvolo email integration</h2>
        <div>
          <label className="label">Inbound email address</label>
          <input
            className="input"
            value={settings.nuvoloEmail}
            onChange={(e) => setSettings({ nuvoloEmail: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Default: <code>{DEFAULT_NUVOLO_EMAIL}</code>. Updates are sent from
            your default mail client (Outlook, Gmail, Mail) — no credentials are
            stored here. Nuvolo ingests the message because the FWKD ID appears
            in the subject line.
          </p>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Nuvolo report folder</h2>
        <div>
          <label className="label">
            Where you export open-work-order reports
          </label>
          <input
            className="input font-mono text-xs"
            placeholder="C:\Users\you\OneDrive\…\open_work_orders"
            value={settings.reportFolderPath}
            onChange={(e) => setSettings({ reportFolderPath: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Shown as a reminder on the Dashboard. Browsers can't read this path
            directly for security reasons — use the "Connect folder" button
            below to grant the app permission to read it (Chrome / Edge only).
          </p>
        </div>

        <div>
          <label className="label">Connected folder (auto-refresh)</label>
          {!folderApi ? (
            <p className="text-xs text-slate-500">
              This browser doesn't support folder access. On iPhone Safari,
              you'll always pick the file manually from OneDrive.
            </p>
          ) : connectedFolder ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="pill bg-emerald-100 text-emerald-800">
                Connected: <strong className="ml-1">{connectedFolder}</strong>
              </span>
              <button className="btn-ghost text-xs" onClick={disconnectFolder}>
                Disconnect
              </button>
              <button className="btn-secondary text-xs" onClick={connectFolder}>
                Re-connect / change
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-primary" onClick={connectFolder}>
                Connect folder…
              </button>
              <p className="text-xs text-slate-500">
                You'll be prompted to navigate to your{' '}
                <code className="text-xs">open_work_orders</code> folder once.
              </p>
            </div>
          )}
          {folderError && (
            <p className="text-xs text-rose-600 mt-1">{folderError}</p>
          )}
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Sync via OneDrive</h2>
        <p className="text-sm text-slate-600">
          The app stores everything locally on this device. To share data
          between your laptop and phone, export a backup file into a folder
          that OneDrive (or another cloud drive) syncs, then Import it on the
          other device.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={exportBackup}>
            Export backup (.json)
          </button>
          <button
            className="btn-secondary"
            onClick={() => fileRef.current?.click()}
          >
            Import backup (.json)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        {importMsg && (
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
            {importMsg}
          </p>
        )}
        <p className="text-xs text-slate-500">
          Tip: save the backup file to e.g. <code>OneDrive/MWPJM/mwpjm.json</code>{' '}
          so it auto-syncs to your phone. On the phone, open the file from the
          OneDrive app and use Import here.
        </p>
      </section>

      <section className="card p-4 space-y-2">
        <h2 className="font-semibold">About</h2>
        <p className="text-sm text-slate-600">
          MWPJM is a local-first PWA. No server, no account. Your data lives in
          this browser's storage (and any backup files you create).
        </p>
        <p className="text-xs text-slate-500">
          Install: in Chrome on your Pixel, tap the menu → "Add to Home screen."
          On iPhone Safari, tap the share button → "Add to Home Screen."
        </p>
      </section>
    </div>
  );
}
