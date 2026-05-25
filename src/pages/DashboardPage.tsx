import { useMemo, useState } from 'react';
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
 * Sentinel value the Assigned dropdown uses to mean "rows assigned to
 * me" (where 'me' is settings.technicianName). Picked to be something
 * that can never collide with an actual ServiceNow user name string.
 */
const ASSIGNED_ME_VALUE = '__me__';

/** Created-date filter buckets. Keep these short — the user just wants
 *  "what just came in?" answered quickly on a list of 25–100 rows. */
type CreatedFilter = '' | '24h' | '7d' | '30d' | 'older';
const CREATED_LABELS: Record<CreatedFilter, string> = {
  '': 'All time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  older: 'Older than 30 days',
};

/**
 * Fuzzy "is this row assigned to the user named X?" check. We compare
 * lowercase trimmed strings and accept either-direction containment so
 * "Matt Naughton" in the CSV still matches a settings value of
 * "Matt N." or vice versa. Strict equality would miss too many real
 * cases — Nuvolo uses display names, technicians often type initials.
 */
function isAssignedToMe(row: WorkOrder, technicianName: string): boolean {
  const a = row.assignedTo.toLowerCase().trim();
  const t = technicianName.toLowerCase().trim();
  if (!a || !t) return false;
  return a.includes(t) || t.includes(a);
}

/** Returns true if the row's openedAt date falls in the requested
 *  bucket. Rows with no openedAt fail every non-empty filter — i.e.
 *  if you ask for "last 7 days" and we don't know when something
 *  opened, it doesn't qualify. */
function matchesCreatedFilter(
  row: WorkOrder,
  filter: CreatedFilter,
  now: number,
): boolean {
  if (filter === '') return true;
  if (!row.openedAt) return false;
  const t = new Date(row.openedAt).getTime();
  if (isNaN(t)) return false;
  const ageMs = now - t;
  const day = 24 * 60 * 60 * 1000;
  switch (filter) {
    case '24h':
      return ageMs < 1 * day;
    case '7d':
      return ageMs < 7 * day;
    case '30d':
      return ageMs < 30 * day;
    case 'older':
      return ageMs >= 30 * day;
  }
}

/**
 * Read-only dashboard view of the most recent work order import.
 * Import management lives on the Reports page (/reports).
 */
export default function DashboardPage() {
  const workOrders = useStore((s) => s.workOrders);
  const addProject = useStore((s) => s.addProject);
  const woUrlPattern = useStore((s) => s.settings.nuvoloWorkOrderUrlPattern);
  const technicianName = useStore((s) => s.settings.technicianName);
  const navigate = useNavigate();

  // Active filter state — kept flat (no filter object) so each control
  // owns one piece of state and reset is just "clear them all".
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [assignedFilter, setAssignedFilter] = useState<string>('');
  const [createdFilter, setCreatedFilter] = useState<CreatedFilter>('');

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

  // Stable "now" timestamp captured on the first render of this filter
  // pass — used by the Created bucket math so we don't subtly drift
  // mid-render across multiple rows.
  const filtered = useMemo(() => {
    if (!workOrders) return [];
    const q = filter.trim().toLowerCase();
    const now = Date.now();
    return workOrders.rows.filter((r) => {
      if (stateFilter && r.state !== stateFilter) return false;
      if (assignedFilter === ASSIGNED_ME_VALUE) {
        if (!isAssignedToMe(r, technicianName)) return false;
      } else if (assignedFilter && r.assignedTo !== assignedFilter) {
        return false;
      }
      if (!matchesCreatedFilter(r, createdFilter, now)) return false;
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
  }, [
    workOrders,
    filter,
    stateFilter,
    assignedFilter,
    createdFilter,
    technicianName,
  ]);

  // Aggregates we surface in the stats line. Computed off the *full*
  // import (not the filtered set) so the line is a stable summary,
  // not a moving target while the user is filtering.
  const stats = useMemo(() => {
    if (!workOrders) return null;
    const rows = workOrders.rows;
    const overdueCount = rows.filter((r) => isOverdue(r.dueDate)).length;
    const mineCount = technicianName
      ? rows.filter((r) => isAssignedToMe(r, technicianName)).length
      : 0;
    const assignees = new Set<string>();
    for (const r of rows) {
      if (r.assignedTo) assignees.add(r.assignedTo);
    }
    const sortedAssignees = [...assignees].sort((a, b) =>
      a.localeCompare(b),
    );
    const hasOpenedAtData = rows.some((r) => !!r.openedAt);
    return {
      total: rows.length,
      overdue: overdueCount,
      mine: mineCount,
      byState: countBy(rows, 'state'),
      assignees: sortedAssignees,
      hasOpenedAtData,
    };
  }, [workOrders, technicianName]);

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

  const anyFilter =
    !!filter || !!stateFilter || !!assignedFilter || !!createdFilter;
  function clearAllFilters() {
    setFilter('');
    setStateFilter('');
    setAssignedFilter('');
    setCreatedFilter('');
  }
  function showOnlyMine() {
    setAssignedFilter(ASSIGNED_ME_VALUE);
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

      {/* Stats summary line — replaces the 4-card grid. Three at-a-glance
          counts of the *full* import, with "assigned to you" doubling
          as a one-tap shortcut into the Assigned filter below. */}
      {stats && (
        <div className="text-sm text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            <span className="font-semibold text-slate-900">{stats.total}</span>{' '}
            work {stats.total === 1 ? 'order' : 'orders'}
          </span>
          {stats.overdue > 0 && (
            <span className="text-rose-600">
              ⚠ <span className="font-semibold">{stats.overdue}</span> overdue
            </span>
          )}
          {technicianName && (
            <button
              type="button"
              onClick={showOnlyMine}
              className={`underline-offset-2 ${
                assignedFilter === ASSIGNED_ME_VALUE
                  ? 'text-brand-700 font-semibold underline'
                  : 'text-brand-600 hover:underline'
              }`}
              title={`Filter the list to rows assigned to ${technicianName}`}
            >
              👤 <span className="font-semibold">{stats.mine}</span> assigned to
              you
            </button>
          )}
        </div>
      )}

      <section className="card p-3 space-y-3">
        {/* === Filter row ===
            Search input gets full width (it's the hottest path for
            "find FWKD0043871"). Below it, a wrapping flex of compact
            dropdowns: State, Assigned, Created — all reactive, all
            independent. */}
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Search FWKD #, description, location, assignee…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 items-center">
            {stats && stats.byState.size > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                State:
                <select
                  className="input py-1 text-sm"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                >
                  <option value="">All states</option>
                  {[...stats.byState.entries()].map(([s, n]) => (
                    <option key={s} value={s}>
                      {s} ({n})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {stats && stats.assignees.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                Assigned:
                <select
                  className="input py-1 text-sm"
                  value={assignedFilter}
                  onChange={(e) => setAssignedFilter(e.target.value)}
                >
                  <option value="">Anyone</option>
                  {/* Top option: "Me (yourname)" — only if a technician
                      name is set in Settings, otherwise the dropdown is
                      just the raw assignee list. */}
                  {technicianName && (
                    <option value={ASSIGNED_ME_VALUE}>
                      Me ({technicianName})
                    </option>
                  )}
                  {stats.assignees.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {stats && stats.hasOpenedAtData && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                Created:
                <select
                  className="input py-1 text-sm"
                  value={createdFilter}
                  onChange={(e) =>
                    setCreatedFilter(e.target.value as CreatedFilter)
                  }
                  title="Filter by when the work order was opened — handy for finding tickets that just came in"
                >
                  {(Object.keys(CREATED_LABELS) as CreatedFilter[]).map((k) => (
                    <option key={k} value={k}>
                      {CREATED_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {anyFilter && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="btn-ghost text-xs"
                title="Clear every active filter"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-500">
          Showing {filtered.length} of {workOrders.rows.length}
          {assignedFilter === ASSIGNED_ME_VALUE && (
            <span className="ml-2 pill bg-brand-50 text-brand-700">
              you only
            </span>
          )}
          {createdFilter && (
            <span className="ml-2 pill bg-slate-100 text-slate-700">
              {CREATED_LABELS[createdFilter]}
            </span>
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
                        title="Create a quick-view follow-up workboard, pre-filled with this work order's details"
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
