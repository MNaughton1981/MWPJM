import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import {
  countBy,
  isOverdue,
  type WorkOrder,
} from '../lib/workOrderCsv';
import { formatDateTime } from '../lib/format';

/**
 * Read-only dashboard view of the most recent work order import.
 * Import management lives on the Reports page (/reports).
 */
export default function DashboardPage() {
  const workOrders = useStore((s) => s.workOrders);
  const addProject = useStore((s) => s.addProject);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');

  function startProjectFromWO(wo: WorkOrder) {
    const tpl = TEMPLATES[0];
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

  if (!workOrders) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Open Work Order Dashboard</h1>
        <div className="card p-8 text-center space-y-3">
          <h2 className="font-semibold">No work order data loaded yet</h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Connect to your Nuvolo CSV report folder, or import a CSV manually,
            on the Reports page.
          </p>
          <Link to="/reports" className="btn-primary">
            Go to Reports →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Open Work Order Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Source: <span className="font-mono">{workOrders.sourceFilename}</span>{' '}
            · Imported {formatDateTime(workOrders.importedAt)}
          </p>
        </div>
        <Link to="/reports" className="btn-secondary text-sm">
          ↻ Manage / Refresh
        </Link>
      </div>

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
          {(stateFilter || priorityFilter || filter) && (
            <button
              className="ml-2 text-brand-600 hover:underline"
              onClick={() => {
                setFilter('');
                setStateFilter('');
                setPriorityFilter('');
              }}
            >
              Clear filters
            </button>
          )}
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
