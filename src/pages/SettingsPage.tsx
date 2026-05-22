import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import {
  buildAppData,
  downloadJson,
  parseAppDataFile,
} from '../lib/exporters';
import { DEFAULT_NUVOLO_EMAIL, DEFAULT_WO_URL_PATTERN } from '../lib/nuvolo';
import { BUILD_TIME, forceAppUpdate } from '../lib/appUpdate';
import {
  getStoredFolderName,
  isFolderApiSupported,
} from '../lib/folderConnection';
import {
  applySyncedState,
  DEFAULT_SYNC_FILENAME,
  pullFromFile,
  pullFromFolder,
  pushNow,
  type SyncPayload,
} from '../lib/sync';
import { formatDateTime } from '../lib/format';

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const projects = useStore((s) => s.projects);
  const replaceAll = useStore((s) => s.replaceAll);
  const lastSyncedAt = useStore((s) => s.lastSyncedAt);
  const syncError = useStore((s) => s.syncError);

  const fileRef = useRef<HTMLInputElement>(null);
  const syncFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<string | undefined>();
  const [busy, setBusy] = useState<'push' | 'pull' | null>(null);
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

  async function pushSyncNow() {
    setSyncMsg(null);
    setBusy('push');
    try {
      const payload = await pushNow(settings.syncFilename || DEFAULT_SYNC_FILENAME);
      setSyncMsg(
        `Pushed ${payload.projects.length} project(s) to "${settings.syncFilename || DEFAULT_SYNC_FILENAME}".`,
      );
    } catch (e) {
      setSyncMsg(`Push failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function pullSyncFromFolder() {
    setSyncMsg(null);
    setBusy('pull');
    try {
      const payload = await pullFromFolder(
        settings.syncFilename || DEFAULT_SYNC_FILENAME,
      );
      if (!payload) {
        setSyncMsg(
          `No "${settings.syncFilename || DEFAULT_SYNC_FILENAME}" found in the connected folder yet. Push from another device first, or wait for OneDrive to sync.`,
        );
        return;
      }
      applyAfterConfirm(payload, 'connected folder');
    } catch (e) {
      setSyncMsg(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function pullSyncFromFile(file: File) {
    setSyncMsg(null);
    setBusy('pull');
    try {
      const payload = await pullFromFile(file);
      applyAfterConfirm(payload, file.name);
    } catch (e) {
      setSyncMsg(`Pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function applyAfterConfirm(payload: SyncPayload, source: string) {
    const ok = window.confirm(
      `Replace local state with the version from ${source}?\n\n` +
        `Synced: ${formatDateTime(payload.syncedAt)}\n` +
        `Projects: ${payload.projects.length}\n` +
        (payload.workOrders
          ? `Work orders: ${payload.workOrders.rows.length} (${payload.workOrders.sourceFilename})\n`
          : 'Work orders: none\n') +
        `\nAny edits made on this device since the last sync will be lost.`,
    );
    if (!ok) {
      setSyncMsg('Pull cancelled — local state unchanged.');
      return;
    }
    applySyncedState(payload);
    setSyncMsg(
      `Applied ${payload.projects.length} project(s) from ${source}.`,
    );
  }

  function syncStatusLine(): string {
    if (syncError) return `Last error: ${syncError}`;
    if (!lastSyncedAt) return 'Never synced from this device.';
    return `Last synced ${formatDateTime(lastSyncedAt)}`;
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
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-brand-600 hover:underline"
              onClick={() =>
                setSettings({ nuvoloWorkOrderUrlPattern: DEFAULT_WO_URL_PATTERN })
              }
              disabled={
                settings.nuvoloWorkOrderUrlPattern === DEFAULT_WO_URL_PATTERN
              }
              title="Restore the shipped default pattern"
            >
              ↺ Reset to default
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Used for the clickable FWKD links in the app (Project page and
            Work Orders table). The shipped default points to Nuvolo's{' '}
            <code>x_nuvo_eam_facilities_work_orders</code> table on{' '}
            <code>mathworks.service-now.com</code> and looks up the work
            order by its number — ServiceNow auto-loads the form view when
            exactly one record matches.
          </p>
          <p className="text-xs text-slate-500 mt-1">
            <strong>If the link doesn't open the right WO,</strong> open one
            in Nuvolo on your laptop, copy the URL from the address bar, and
            paste it here with the FWKD number replaced by{' '}
            <code>{'{wo}'}</code>. Modern Nuvolo URLs that look like{' '}
            <code>/now/nav/ui/classic/params/target/...?sys_id=...</code> are
            desktop-UI wrappers — the simpler{' '}
            <code>/x_nuvo_eam_facilities_work_orders.do?sysparm_query=number=&#123;wo&#125;</code>{' '}
            form is more mobile-friendly. On Android, if the Nuvolo mobile
            app has registered <code>service-now.com</code> links, tapping a
            FWKD link will offer to open it in the app.
          </p>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Security team notifications</h2>
        <div>
          <label className="label">Security team email</label>
          <input
            className="input"
            type="email"
            placeholder="security@mathworks.com"
            value={settings.securityEmail}
            onChange={(e) => setSettings({ securityEmail: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Where the per-vendor "🛡️ Notify security" button sends its
            structured visit-notice email. If blank, the button is disabled.
          </p>
        </div>
        <div>
          <label className="label">Preamble (top of every notification)</label>
          <textarea
            className="input min-h-[60px]"
            value={settings.securityPreamble}
            onChange={(e) => setSettings({ securityPreamble: e.target.value })}
          />
          <p className="text-xs text-slate-500 mt-1">
            Customize for your facility — include badge / FOB / specific
            access instructions if helpful.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={settings.securityCcSelf}
            onChange={(e) => setSettings({ securityCcSelf: e.target.checked })}
          />
          CC me on security notifications (uses "Your email" above)
        </label>
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
        <div>
          <h2 className="font-semibold">Sync state via OneDrive</h2>
          <p className="text-xs text-slate-500 mt-1">
            Auto-write a JSON snapshot of your projects, settings, and last
            imported work-order CSV to the connected folder. OneDrive
            replicates it to your other devices, where you can pull the
            latest with one tap. <strong>Photos stay on the device that
            took them</strong> — they're too big to ship through this
            channel; only the captions / filenames travel.
          </p>
        </div>

        {!folderApi && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            <strong>Auto-sync isn't supported on this browser.</strong> On
            iPhone Safari and mobile Chrome, use <em>Pull from file…</em> below
            to import a synced state file you've opened from the OneDrive
            app.
          </div>
        )}

        {folderApi && !connectedFolder && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
            Connect a folder on{' '}
            <Link to="/reports" className="text-brand-600 hover:underline">
              Reports → Connect folder
            </Link>{' '}
            first. The sync file lives in that same folder, next to your
            CSV exports.
          </div>
        )}

        {folderApi && connectedFolder && (
          <>
            <div className="text-xs text-slate-500">
              Folder:{' '}
              <span className="pill bg-emerald-100 text-emerald-800">
                ✓ {connectedFolder}
              </span>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={settings.syncEnabled}
                onChange={(e) =>
                  setSettings({ syncEnabled: e.target.checked })
                }
              />
              <span>
                <strong>Auto-sync to this folder</strong> — write the latest
                state file every time something changes. Recommended on the
                desktop you use most.
              </span>
            </label>
          </>
        )}

        <div>
          <label className="label">Sync file name</label>
          <input
            className="input font-mono text-xs"
            value={settings.syncFilename}
            placeholder={DEFAULT_SYNC_FILENAME}
            onChange={(e) => setSettings({ syncFilename: e.target.value })}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Defaults to <code>{DEFAULT_SYNC_FILENAME}</code>. All devices
            should agree on the same filename.
          </p>
        </div>

        <div className="text-xs text-slate-600">{syncStatusLine()}</div>

        <div className="flex flex-wrap gap-2">
          {folderApi && connectedFolder && (
            <>
              <button
                className="btn-primary text-sm"
                onClick={pushSyncNow}
                disabled={busy !== null}
                title="Write the current state to the connected folder right now"
              >
                {busy === 'push' ? 'Pushing…' : '↑ Push now'}
              </button>
              <button
                className="btn-secondary text-sm"
                onClick={pullSyncFromFolder}
                disabled={busy !== null}
                title="Read the sync file from the connected folder and apply it"
              >
                {busy === 'pull' ? 'Pulling…' : '↓ Pull from folder'}
              </button>
            </>
          )}
          <button
            className="btn-secondary text-sm"
            onClick={() => syncFileRef.current?.click()}
            disabled={busy !== null}
            title="Pick a sync file from your device (works everywhere — use this on mobile)"
          >
            Pull from file…
          </button>
          <input
            ref={syncFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pullSyncFromFile(f);
              e.target.value = '';
            }}
          />
        </div>

        {syncMsg && (
          <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-2">
            {syncMsg}
          </p>
        )}
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="font-semibold">Manual backup</h2>
        <p className="text-sm text-slate-600">
          One-shot export and import. Useful for archiving a snapshot, or
          bootstrapping a new device before you've set up sync above.
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
          For the everyday "what did I just open on the desktop" case, prefer
          the auto-sync section above. This manual flow is for one-off
          snapshots and migrating between accounts.
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
        <div className="border-t pt-3 mt-2 space-y-2">
          <div className="text-xs text-slate-500">
            Current build:{' '}
            <code className="font-mono text-slate-700">{BUILD_TIME}</code>
          </div>
          <button
            className="btn-secondary text-xs"
            onClick={async () => {
              const ok = window.confirm(
                'Force the app to fetch the latest deploy? This will clear cached app code and reload — your projects, photos, and settings stay intact.',
              );
              if (!ok) return;
              await forceAppUpdate();
            }}
            title="Unregister the service worker, clear app caches, and reload"
          >
            ↻ Force app update
          </button>
          <p className="text-[11px] text-slate-500">
            Use this if you've deployed a new version but still see the old UI.
            Your projects / photos / settings stay intact (they're stored
            separately in localStorage and IndexedDB, not in the app cache).
          </p>
        </div>
      </section>
    </div>
  );
}
