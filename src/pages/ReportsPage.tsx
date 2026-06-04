import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../state/store';
import {
  applyColumnMap,
  autoDetectColumns,
  parseWorkOrderFile,
  type ColumnMap,
} from '../lib/workOrderCsv';
import {
  clearFolderHandle,
  getStoredFolderName,
  isFolderApiSupported,
  pickReportFolder,
  readLatestReport,
} from '../lib/folderConnection';
import { formatDateTime } from '../lib/format';
import PageTOC, { type PageTOCItem } from '../components/PageTOC';

const TOC_ITEMS: PageTOCItem[] = [
  { id: 'sec-folder', label: 'OneDrive folder', icon: '📁' },
  { id: 'sec-import', label: 'Load latest report', icon: '↻' },
  { id: 'sec-current', label: 'Current import', icon: '📊' },
  { id: 'sec-mapping', label: 'Column mapping', icon: '🔗' },
  { id: 'sec-howto', label: 'How to refresh from Nuvolo', icon: '❓' },
];

const COLUMN_LABELS: Record<keyof ColumnMap, string> = {
  number: 'Work Order # (FWKD…)',
  shortDescription: 'Short description',
  state: 'State / Status',
  priority: 'Priority',
  assignedTo: 'Assigned to',
  openedAt: 'Opened',
  dueDate: 'Due date',
  location: 'Location',
  assignmentGroup: 'Assignment group',
};

/**
 * The Reports page is where the user manages the inflow of Nuvolo data:
 *   - Connecting to (or disconnecting from) the OneDrive folder
 *   - Triggering a refresh / picking a new file
 *   - Reviewing the column mapping
 * The Dashboard page is purely a read view of whatever has been loaded here.
 */
export default function ReportsPage() {
  const workOrders = useStore((s) => s.workOrders);
  const setWorkOrders = useStore((s) => s.setWorkOrders);
  const reportFolderPath = useStore((s) => s.settings.reportFolderPath);
  const reportsSubfolder = useStore((s) => s.settings.reportsSubfolder);
  const syncFilename = useStore((s) => s.settings.syncFilename);
  const setSettings = useStore((s) => s.setSettings);

  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [connectedFolder, setConnectedFolder] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const folderApi = isFolderApiSupported();

  useEffect(() => {
    getStoredFolderName().then(setConnectedFolder);
  }, []);

  async function handleFile(file: File, scannedLocation?: string) {
    setError(null);
    // Immediate feedback the instant a file is chosen — on mobile the
    // OneDrive picker closes and drops you back here with no native
    // confirmation, so without this the tap feels like it did nothing
    // while a large .xlsx parses.
    setInfo(`Reading "${file.name}"…`);
    setRefreshing(true);
    try {
      const { headers, rows } = await parseWorkOrderFile(file);
      if (headers.length === 0) {
        setInfo(null);
        setError('File has no header row (or first row was empty).');
        return;
      }
      const map = autoDetectColumns(headers);
      const mapped = applyColumnMap(rows, map);
      setWorkOrders({
        importedAt: new Date().toISOString(),
        sourceFilename: file.name,
        rawHeaders: headers,
        columnMap: map,
        rows: mapped,
      });
      const from = scannedLocation ? ` from ${scannedLocation}` : '';
      setInfo(`✓ Imported ${mapped.length} row(s) from "${file.name}"${from}.`);
    } catch (e) {
      setInfo(null);
      setError(`Failed to parse file: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshFromFolder() {
    setError(null);
    setInfo(null);
    setRefreshing(true);
    try {
      const result = await readLatestReport(reportsSubfolder, [
        syncFilename || 'mwpjm-state.json',
      ]);
      if (!result) {
        const where = reportsSubfolder
          ? `the "${reportsSubfolder}" subfolder or the connected folder`
          : 'the connected folder';
        setError(
          `No .csv / .xlsx / .json files found in ${where}.`,
        );
        return;
      }
      await handleFile(result.file, result.scannedLocation);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function connectFolder() {
    setError(null);
    try {
      const r = await pickReportFolder();
      setConnectedFolder(r.name);
      setInfo(`Connected to "${r.name}". Click Refresh to load the newest CSV.`);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      setError((e as Error).message);
    }
  }

  async function disconnectFolder() {
    await clearFolderHandle();
    setConnectedFolder(undefined);
    setInfo('Folder disconnected.');
  }

  function updateColumn(key: keyof ColumnMap, value: string) {
    if (!workOrders) return;
    const newMap: ColumnMap = { ...workOrders.columnMap, [key]: value || null };
    const reconstructedRows: Record<string, string>[] = workOrders.rows.map((r) => {
      const row: Record<string, string> = { ...r.extra };
      const m = workOrders.columnMap;
      if (m.number) row[m.number] = r.number;
      if (m.shortDescription) row[m.shortDescription] = r.shortDescription;
      if (m.state) row[m.state] = r.state;
      if (m.priority) row[m.priority] = r.priority;
      if (m.assignedTo) row[m.assignedTo] = r.assignedTo;
      if (m.openedAt) row[m.openedAt] = r.openedAt;
      if (m.dueDate) row[m.dueDate] = r.dueDate;
      if (m.location) row[m.location] = r.location;
      if (m.assignmentGroup) row[m.assignmentGroup] = r.assignmentGroup;
      return row;
    });
    setWorkOrders({
      ...workOrders,
      columnMap: newMap,
      rows: applyColumnMap(reconstructedRows, newMap),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pull open work orders from Nuvolo — CSV, Excel, or JSON exports
            all work.
          </p>
        </div>
        {workOrders && (
          <Link to="/dashboard" className="btn-primary">
            View Dashboard →
          </Link>
        )}
      </div>

      {error && (
        <div className="card p-3 text-sm text-rose-700 border-rose-300 bg-rose-50">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="card p-3 text-sm text-emerald-800 border-emerald-300 bg-emerald-50">
          {info}
        </div>
      )}

      {/* === Section 1: folder connection === */}
      <PageTOC items={TOC_ITEMS} />

      <section id="sec-folder" className="card p-4 space-y-3 scroll-mt-20">
        <h2 className="font-semibold">OneDrive folder</h2>
        <p className="text-xs text-slate-500">
          Configured path (display only — set in Settings):
        </p>
        <div className="font-mono text-[11px] bg-slate-50 border border-slate-200 rounded p-2 break-all">
          {reportFolderPath || (
            <span className="italic text-slate-400">no path set</span>
          )}
        </div>

        {!folderApi ? (
          <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded p-2">
            <strong>Folder access not supported on this browser.</strong> On
            iPhone Safari you'll always pick the file manually from the OneDrive
            app. Use the file picker below — CSV, Excel, and JSON all work.
          </div>
        ) : connectedFolder ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill bg-emerald-100 text-emerald-800">
              ✓ Connected: <strong className="ml-1">{connectedFolder}</strong>
            </span>
            <button className="btn-secondary text-xs" onClick={connectFolder}>
              Re-connect / change
            </button>
            <button className="btn-ghost text-xs" onClick={disconnectFolder}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" onClick={connectFolder}>
              Connect folder…
            </button>
            <span className="text-xs text-slate-500">
              You'll grant the app one-time read permission for that folder.
            </span>
          </div>
        )}
      </section>

      {/* === Section 2: import === */}
      <section id="sec-import" className="card p-4 space-y-3 scroll-mt-20">
        <h2 className="font-semibold">Load latest report</h2>

        {/* On mobile there's no folder API, so the file picker IS the
            primary (and only) path. Make that obvious + tell the user
            the one thing that trips everyone up: tap the FILE itself,
            not a folder. */}
        {!folderApi && (
          <div className="text-xs text-slate-700 bg-blue-50 border border-blue-200 rounded p-3 space-y-1">
            <p className="font-semibold text-blue-900">📱 On your phone</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>Tap <strong>📄 Pick file from OneDrive</strong> below.</li>
              <li>
                In the picker, open your OneDrive folder and{' '}
                <strong>tap the CSV/Excel file itself</strong> — not the
                folder. Tapping a folder just opens it; only tapping a file
                brings you back here.
              </li>
              <li>You'll land back on this page with the import loaded.</li>
            </ol>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {folderApi && connectedFolder && (
            <button
              className="btn-primary"
              onClick={refreshFromFolder}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh from folder'}
            </button>
          )}
          <button
            className={folderApi ? 'btn-secondary' : 'btn-primary'}
            onClick={() => fileRef.current?.click()}
            disabled={refreshing}
          >
            {!folderApi ? '📄 Pick file from OneDrive' : 'Pick file…'}
          </button>
          {workOrders && (
            <button
              className="btn-ghost text-rose-600 text-sm"
              onClick={() => {
                setWorkOrders(null);
                setInfo('Cleared current import.');
              }}
            >
              Clear current import
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <p className="text-xs text-slate-500">
          Accepts <code>.csv</code>, <code>.xlsx</code>, and <code>.json</code>.
          {folderApi
            ? ' Refresh picks the most recently modified one in the connected folder.'
            : ' Pick the most recent export from your OneDrive folder.'}{' '}
          Filename doesn't matter — Nuvolo can name it however it wants. Helpful
          when Excel hijacks a CSV download and saves it as <code>.xlsx</code>,
          or when a Power Automate flow drops Excel attachments straight into
          the folder.
        </p>
      </section>

      {/* === Section 3: current import === */}
      {workOrders ? (
        <section id="sec-current" className="card p-4 space-y-2 scroll-mt-20">
          <h2 className="font-semibold">Current import</h2>
          <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <dt className="text-xs text-slate-500">Filename</dt>
              <dd className="font-mono text-xs break-all">
                {workOrders.sourceFilename}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Imported</dt>
              <dd className="text-xs">{formatDateTime(workOrders.importedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Rows</dt>
              <dd className="font-semibold">{workOrders.rows.length}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section id="sec-current" className="card p-6 text-center text-sm text-slate-500 scroll-mt-20">
          No data loaded yet. Connect a folder and refresh, or pick a CSV
          manually above.
        </section>
      )}

      {/* === Section 4: column mapping === */}
      {workOrders && (
        <section id="sec-mapping" className="card p-4 space-y-3 scroll-mt-20">
          <div>
            <h2 className="font-semibold">Column mapping</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Auto-detected from the file's column headers. Override here if
              anything's off — the dashboard will reflect changes immediately.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(Object.keys(COLUMN_LABELS) as (keyof ColumnMap)[]).map((k) => (
              <div key={k}>
                <label className="label">{COLUMN_LABELS[k]}</label>
                <select
                  className="input"
                  value={workOrders.columnMap[k] ?? ''}
                  onChange={(e) => updateColumn(k, e.target.value)}
                >
                  <option value="">— not mapped —</option>
                  {workOrders.rawHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* === Section 5: how-to === */}
      <section id="sec-howto" className="card p-4 text-xs text-slate-600 space-y-3 scroll-mt-20">
        <h2 className="font-semibold text-sm text-slate-800">
          How to refresh from Nuvolo
        </h2>
        <div>
          <p className="font-medium text-slate-700">Manual export (today)</p>
          <ol className="list-decimal pl-5 space-y-1 mt-1">
            <li>In Nuvolo, open your "Open Work Orders" list view.</li>
            <li>
              Right-click any column header → <em>Export → CSV</em> (or
              JSON / Excel — all three work here).
            </li>
            <li>
              Save (or schedule the report to save) into your{' '}
              <code>open_work_orders</code> folder in OneDrive.
            </li>
            <li>
              Come back here and click <strong>↻ Refresh from folder</strong>.
              The newest <code>.csv</code> / <code>.xlsx</code> /{' '}
              <code>.json</code> wins.
            </li>
          </ol>
          <p className="mt-2 text-slate-500">
            Heads up: if you double-click the downloaded file before saving,
            Excel may grab it and save as <code>.xlsx</code>. That's fine —
            the dashboard reads Excel files too.
          </p>
        </div>
        <div className="border-t pt-2">
          <p className="font-medium text-slate-700">
            Auto-route via Power Automate (zero-touch)
          </p>
          <ol className="list-decimal pl-5 space-y-1 mt-1">
            <li>
              In Nuvolo, schedule the report to email you on a cadence (e.g.
              hourly during work hours).
            </li>
            <li>
              In Power Automate, create a flow: trigger{' '}
              <em>"When a new email arrives (V3)"</em> filtered to that
              report's subject line, action{' '}
              <em>"Create file (OneDrive)"</em> targeting your{' '}
              <code>open_work_orders</code> folder.
            </li>
            <li>
              The Excel attachment lands as <code>.xlsx</code> in the folder
              automatically; OneDrive syncs it to your laptop and phone; the
              next <strong>↻ Refresh</strong> picks it up.
            </li>
          </ol>
        </div>
        <p className="pt-1">
          Since OneDrive syncs to your phone automatically, you can refresh
          from the same connected folder on the Pixel too.
        </p>
        <p className="text-slate-500">
          Want to change the path?{' '}
          <Link to="/settings" className="text-brand-600 hover:underline">
            Edit it in Settings →
          </Link>
        </p>
        <details>
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
            Update the saved path
          </summary>
          <div className="mt-2 space-y-1">
            <input
              className="input font-mono text-xs"
              value={reportFolderPath}
              onChange={(e) => setSettings({ reportFolderPath: e.target.value })}
            />
            <p className="text-[11px] text-slate-500">
              This is just a reminder string. The actual permission is granted
              by clicking "Connect folder" above.
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}
