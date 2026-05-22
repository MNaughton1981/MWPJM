import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import {
  buildAppData,
  downloadJson,
  parseAppDataFile,
} from '../lib/exporters';
import { DEFAULT_NUVOLO_EMAIL } from '../lib/nuvolo';

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const projects = useStore((s) => s.projects);
  const replaceAll = useStore((s) => s.replaceAll);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

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
        <div>
          <label className="label">
            Your email (for "✅ To Do" — sent to yourself with TODO: prefix)
          </label>
          <input
            className="input"
            type="email"
            placeholder="you@mathworks.com"
            value={settings.userEmail}
            onChange={(e) => setSettings({ userEmail: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Optional. If blank, the To Do button opens your mail client with
            an empty To: field. Set up an Outlook rule to auto-flag messages
            with subject starting <code>TODO:</code> so they appear in
            Microsoft To Do's "Flagged email" list.
          </p>
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
        <div>
          <label className="label">Work order URL pattern (for clickable FWKD links)</label>
          <input
            className="input font-mono text-xs"
            placeholder="https://mathworks.service-now.com/...?number={wo}"
            value={settings.nuvoloWorkOrderUrlPattern}
            onChange={(e) =>
              setSettings({ nuvoloWorkOrderUrlPattern: e.target.value })
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            Determines what happens when you click a FWKD link in the app.
            <strong> To get the right URL:</strong> open a real WO in Nuvolo on
            your laptop, copy the URL from the address bar, and paste it here
            with the FWKD number replaced by <code>{'{wo}'}</code>. On Android,
            if the Nuvolo mobile app has registered <code>service-now.com</code>{' '}
            links, tapping a FWKD link will offer to open it in the app.
          </p>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Nuvolo report folder path</h2>
        <div>
          <label className="label">
            Where you export open-work-order CSVs (display-only reminder)
          </label>
          <input
            className="input font-mono text-xs"
            placeholder="C:\Users\you\OneDrive\…\open_work_orders"
            value={settings.reportFolderPath}
            onChange={(e) => setSettings({ reportFolderPath: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Browsers can't read this path directly for security reasons. Use{' '}
            <Link to="/reports" className="text-brand-600 hover:underline">
              Reports → Connect folder
            </Link>{' '}
            to grant the app permission (Chrome / Edge only).
          </p>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Photo naming pattern</h2>
        <div>
          <label className="label">Template for downloaded photo filenames</label>
          <input
            className="input font-mono text-sm"
            value={settings.photoNamingPattern}
            onChange={(e) => setSettings({ photoNamingPattern: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Placeholders: <code>{'{wo}'}</code> <code>{'{project}'}</code>{' '}
            <code>{'{date}'}</code> <code>{'{caption}'}</code>{' '}
            <code>{'{seq}'}</code> <code>{'{ext}'}</code>. Default produces
            something like <code>FWKD123_2026-05-21_001_dishwasher-rough-in.jpg</code>.
          </p>
        </div>
      </section>

      <section className="card p-4 space-y-3">
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
