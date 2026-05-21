import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import {
  applyColumnMap,
  autoDetectColumns,
  countBy,
  isOverdue,
  parseCsvFile,
  type ColumnMap,
  type WorkOrder,
} from '../lib/workOrderCsv';
import { formatDateTime } from '../lib/format';

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

export default function DashboardPage() {
  const workOrders = useStore((s) => s.workOrders);
  const setWorkOrders = useStore((s) => s.setWorkOrders);
  const addProject = useStore((s) => s.addProject);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showColMap, setShowColMap] = useState(false);
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');

  async function handleFile(file: File) {
    setError(null);
    try {
      const { headers, rows } = await parseCsvFile(file);
      if (headers.length === 0) {
        setError('CSV has no header row.');
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
    } catch (e) {
      setError(`Failed to parse CSV: ${(e as Error).message}`);
    }
  }

  function updateColumn(key: keyof ColumnMap, value: string) {
    if (!workOrders) return;
    const newMap: ColumnMap = { ...workOrders.columnMap, [key]: value || null };
    // Re-derive rows from raw extra+mapped data — but we discarded raw rows.
    // For lean v1, re-import the file is the cleanest; for now just update
    // the mapping and re-apply against current rows treating extra as full row.
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

  function startProjectFromWO(wo: WorkOrder) {
    const tpl = TEMPLATES[0]; // Dishwasher template by default — user can change later
    const name = wo.shortDescription || wo.number || 'New project';
    const project = tpl.build(name);
    project.workOrderId = wo.number.toUpperCase();
    project.location = wo.location || project.location;
    if (wo.shortDescription && !project.description?.includes(wo.shortDescription)) {
      project.description = `${wo.shortDescription}\n\n${project.description ?? ''}`.trim();
    }
    addProject(project);
    navigate(`/projects/${project.id}`);
  }

  const filtered = useMemo(() => {
    if (!workOrders) return [];
    const q = filter.trim().toLowerCase();
    return workOrders.rows.filter((r) => {
      if (stateFilter && r.state !== stateFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (!q) return true;
      const hay = [
        r.number,
        r.shortDescription,
        r.assignedTo,
        r.location,
        r.assignmentGroup,
        ...Object.values(r.extra),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [workOrders, filter, stateFilter, priorityFilter]);

  const stats = useMemo(() => {
    if (!workOrders) return null;
    const rows = workOrders.rows;
    return {
      total: rows.length,
      byState: countBy(rows, 'state'),
      byPriority: countBy(rows, 'priority'),
      overdue: rows.filter((r) => isOverdue(r.dueDate)).length,
    };
  }, [workOrders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Work Order Dashboard</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
            {workOrders ? 'Re-import CSV' : 'Import Nuvolo CSV'}
          </button>
          {workOrders && (
            <button className="btn-ghost text-rose-600" onClick={() => setWorkOrders(null)}>
              Clear
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {error && (
        <div className="card p-3 text-sm text-rose-700 border-rose-300 bg-rose-50">
          {error}
        </div>
      )}

      {!workOrders ? (
        <EmptyState onPick={() => fileRef.current?.click()} />
      ) : (
        <>
          <section className="card p-3 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <strong className="text-slate-700">Source:</strong>{' '}
              {workOrders.sourceFilename}
            </span>
            <span>
              <strong className="text-slate-700">Imported:</strong>{' '}
              {formatDateTime(workOrders.importedAt)}
            </span>
            <span>
              <strong className="text-slate-700">Rows:</strong>{' '}
              {workOrders.rows.length}
            </span>
            <button
              className="text-brand-600 hover:underline ml-auto"
              onClick={() => setShowColMap((v) => !v)}
            >
              {showColMap ? 'Hide column mapping' : 'Adjust column mapping'}
            </button>
          </section>

          {showColMap && (
            <section className="card p-4 space-y-2">
              <h2 className="font-semibold text-sm">Column mapping</h2>
              <p className="text-xs text-slate-500">
                Auto-detected from your CSV headers. Override here if anything's
                off.
              </p>
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

          {stats && (
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Total open" value={stats.total} />
              <StatTile
                label="Overdue"
                value={stats.overdue}
                tone={stats.overdue > 0 ? 'rose' : 'slate'}
              />
              <StatTile
                label="States"
                value={stats.byState.size}
                detail={[...stats.byState.entries()]
                  .slice(0, 3)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              />
              <StatTile
                label="Priorities"
                value={stats.byPriority.size}
                detail={[...stats.byPriority.entries()]
                  .slice(0, 3)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              />
            </section>
          )}

          <section className="card p-3 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="input flex-1"
                placeholder="Search FWKD #, description, location, assignee…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {stats && stats.byState.size > 1 && (
                <select
                  className="input sm:w-44"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                >
                  <option value="">All states</option>
                  {[...stats.byState.keys()].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              {stats && stats.byPriority.size > 1 && (
                <select
                  className="input sm:w-40"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="">All priorities</option>
                  {[...stats.byPriority.keys()].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="text-xs text-slate-500">
              Showing {filtered.length} of {workOrders.rows.length}
            </div>

            <div className="overflow-x-auto -mx-3">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Pri</th>
                    <th className="px-3 py-2">Assigned</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const overdue = isOverdue(r.dueDate);
                    return (
                      <tr
                        key={`${r.number}-${i}`}
                        className="border-b last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                          {r.number || '—'}
                        </td>
                        <td className="px-3 py-2">{r.shortDescription || '—'}</td>
                        <td className="px-3 py-2">
                          {r.state && (
                            <span className="pill bg-slate-100 text-slate-700">
                              {r.state}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{r.priority || '—'}</td>
                        <td className="px-3 py-2 text-xs">{r.assignedTo || '—'}</td>
                        <td
                          className={`px-3 py-2 text-xs ${
                            overdue ? 'text-rose-600 font-medium' : ''
                          }`}
                        >
                          {r.dueDate || '—'}
                          {overdue && ' ⚠'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="btn-ghost text-xs"
                            onClick={() => startProjectFromWO(r)}
                            disabled={!r.number}
                            title="Create a project pre-filled with this work order"
                          >
                            Start project →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="text-center text-sm text-slate-500 py-6">
                  No rows match your filters.
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="card p-8 text-center space-y-3">
      <h2 className="font-semibold">No work order data loaded yet</h2>
      <p className="text-sm text-slate-600 max-w-md mx-auto">
        Export an "Open Work Orders" report from Nuvolo as CSV (right-click any
        list view header → "Export → CSV"), drop it in your OneDrive folder, and
        import it here whenever you want a fresh view.
      </p>
      <button className="btn-primary" onClick={onPick}>
        Pick CSV file
      </button>
      <p className="text-xs text-slate-500">
        The file stays on this device. Nothing is uploaded to a server.
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  tone = 'slate',
}: {
  label: string;
  value: number;
  detail?: string;
  tone?: 'slate' | 'rose';
}) {
  const ring =
    tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white';
  return (
    <div className={`rounded-xl border ${ring} p-3`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
      {detail && (
        <div className="text-[11px] text-slate-500 mt-1 truncate" title={detail}>
          {detail}
        </div>
      )}
    </div>
  );
}
