import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import {
  countBy,
  isOverdue,
  type WorkOrder,
} from '../lib/workOrderCsv';
import { buildWorkOrderUrl } from '../lib/nuvolo';
import { formatDateTime } from '../lib/format';

/**
 * Read-only dashboard view of the most recent work order import.
 * Import management lives on the Reports page (/reports).
 */
export default function DashboardPage() {
  const workOrders = useStore((s) => s.workOrders);
  const addProject = useStore((s) => s.addProject);
  const woUrlPattern = useStore((s) => s.settings.nuvoloWorkOrderUrlPattern);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  // Boolean filter — separate from the column filters because "overdue"
  // is computed (isOverdue(dueDate)) rather than a single column value.
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  const anyFilter =
    !!filter || !!stateFilter || !!priorityFilter || onlyOverdue;

  function clearAllFilters() {
    setFilter('');
    setStateFilter('');
    setPriorityFilter('');
    setOnlyOverdue(false);
  }

  // Toggle helpers so clicking the same chip a second time clears the
  // filter (idiomatic for chip-style filters).
  function toggleStateFilter(s: string) {
    setStateFilter((cur) => (cur === s ? '' : s));
  }
  function togglePriorityFilter(p: string) {
    setPriorityFilter((cur) => (cur === p ? '' : p));
  }

  function startProjectFromWO(wo: WorkOrder) {
    // Default to the lightweight Work Order Follow-up template — quick
    // tracking, no trades / timetable. User can flip to "full" later
    // from the project page if they need that scope.
    const tpl = TEMPLATES.find((t) => t.id === 'work-order-followup') ?? TEMPLATES[0];
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
      if (onlyOverdue && !isOverdue(r.dueDate)) return false;
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
  }, [workOrders, filter, stateFilter, priorityFilter, onlyOverdue]);

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
        <h1 className="text-xl font-semibold">Dashboard</h1>
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
          <h1 className="text-xl font-semibold">Dashboard</h1>
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
          <StatTile
            label="Total open"
            value={stats.total}
            onClick={anyFilter ? clearAllFilters : undefined}
            title={
              anyFilter
                ? 'Clear all active filters and show every row'
                : 'No filters active'
            }
          />
          <StatTile
            label="Overdue"
            value={stats.overdue}
            tone={stats.overdue > 0 ? 'rose' : 'slate'}
            active={onlyOverdue}
            onClick={
              stats.overdue > 0
                ? () => setOnlyOverdue((v) => !v)
                : undefined
            }
            title={
              stats.overdue === 0
                ? 'Nothing overdue'
                : onlyOverdue
                  ? 'Showing only overdue rows — click to show all'
                  : 'Show only overdue rows'
            }
          />
          <StatTile
            label="States"
            value={stats.byState.size}
            detailChips={[...stats.byState.entries()].slice(0, 3).map(
              ([k, v]) => ({
                key: k,
                label: `${k}: ${v}`,
                active: stateFilter === k,
                onClick: () => toggleStateFilter(k),
                title:
                  stateFilter === k
                    ? `Showing only "${k}" — click to clear`
                    : `Filter to "${k}"`,
              }),
            )}
          />
          <StatTile
            label="Priorities"
            value={stats.byPriority.size}
            detailChips={[...stats.byPriority.entries()].slice(0, 3).map(
              ([k, v]) => ({
                key: k,
                label: `${k}: ${v}`,
                active: priorityFilter === k,
                onClick: () => togglePriorityFilter(k),
                title:
                  priorityFilter === k
                    ? `Showing only "${k}" — click to clear`
                    : `Filter to "${k}"`,
              }),
            )}
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
          {onlyOverdue && (
            <span className="ml-2 pill bg-rose-100 text-rose-700">
              overdue only
            </span>
          )}
          {anyFilter && (
            <button
              className="ml-2 text-brand-600 hover:underline"
              onClick={clearAllFilters}
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
                {/* Action column placed right after # so on a phone the
                    user can tap "Open Workboard" without scrolling the
                    table sideways. */}
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Pri</th>
                <th className="px-3 py-2">Assigned</th>
                <th className="px-3 py-2">Due</th>
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
                      {r.number ? (
                        (() => {
                          const url = buildWorkOrderUrl(r.number, woUrlPattern);
                          return url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-600 hover:underline"
                              title="Open this work order in Nuvolo"
                            >
                              {r.number}
                            </a>
                          ) : (
                            r.number
                          );
                        })()
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => startProjectFromWO(r)}
                        disabled={!r.number}
                        title="Create a quick-view follow-up workboard in MWPJM, pre-filled with this work order's details"
                      >
                        Open Workboard
                      </button>
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

interface StatTileChip {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}

function StatTile({
  label,
  value,
  detail,
  detailChips,
  tone = 'slate',
  onClick,
  active,
  title,
}: {
  label: string;
  value: number;
  detail?: string;
  detailChips?: StatTileChip[];
  tone?: 'slate' | 'rose';
  onClick?: () => void;
  active?: boolean;
  title?: string;
}) {
  const baseRing =
    tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white';
  // When the tile is the *active* filter source, give it a stronger
  // ring so the user sees what's currently constraining the view.
  const activeRing =
    tone === 'rose'
      ? 'border-rose-500 ring-2 ring-rose-300 bg-rose-50'
      : 'border-brand-500 ring-2 ring-brand-200 bg-brand-50';
  const ring = active ? activeRing : baseRing;

  // Common inner content used in both the static and clickable variants
  // so we don't duplicate markup.
  const inner: ReactNode = (
    <>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
      {detail && (
        <div className="text-[11px] text-slate-500 mt-1 truncate" title={detail}>
          {detail}
        </div>
      )}
      {detailChips && detailChips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {detailChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={(e) => {
                // Don't bubble to the parent tile (if any) — chip click
                // should set the column filter without also tripping a
                // tile-level onClick.
                e.stopPropagation();
                c.onClick();
              }}
              title={c.title ?? c.label}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border transition ${
                c.active
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-brand-400 hover:text-brand-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </>
  );

  // Clickable tile: render as a button so it gets keyboard focus and
  // proper a11y. Static tile: plain div, same look.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`text-left rounded-xl border ${ring} p-3 transition hover:shadow hover:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-300`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      className={`rounded-xl border ${ring} p-3`}
      title={title}
    >
      {inner}
    </div>
  );
}
