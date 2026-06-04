import { useEffect, useMemo, useRef, useState } from 'react';
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
 * Module-scoped cache of the Dashboard's filter / search selections.
 *
 * DashboardPage unmounts when you navigate away (into a workboard, to
 * Reports, etc.) and remounts when you come back — which would normally
 * reset every filter to its default and force you to re-apply them.
 * Stashing the selections at module scope lets them survive that
 * remount for the session, so the Dashboard comes back exactly how you
 * left it. Session-scoped by design: a full app reload starts clean,
 * which matches the usual "fresh slate when I reopen" expectation.
 */
const dashboardFilterCache: {
  search: string;
  stateFilter: string;
  assignees: string[];
  createdFilter: CreatedFilter;
} = {
  search: '',
  stateFilter: '',
  assignees: [],
  createdFilter: '',
};

/**
 * Map work order state to a color class for the card header bar.
 * Open states = blue, in-progress = muted olive (#98B06F),
 * closed/resolved = slate.
 */
function getStateColor(state: string): string {
  const s = state?.toLowerCase() || '';
  if (s.includes('open') || s.includes('new') || s.includes('pending')) {
    return 'bg-blue-500 text-white';
  }
  if (s.includes('progress') || s.includes('work') || s.includes('assigned')) {
    return 'bg-[#98B06F] text-white';
  }
  if (s.includes('closed') || s.includes('resolved') || s.includes('complete')) {
    return 'bg-slate-500 text-white';
  }
  // Default fallback
  return 'bg-slate-400 text-white';
}

/**
 * Fuzzy "does this CSV assignee name match the user's technician name?"
 * check. We compare lowercase trimmed strings and accept either-direction
 * containment so "Matt Naughton" in the CSV still matches a settings
 * value of "Matt N." or vice versa. Strict equality would miss too many
 * real cases — Nuvolo uses display names, technicians often type
 * initials.
 *
 * Used both for the "N assigned to you" stats count (over every row)
 * and for the "👤 assigned to you" shortcut button (which expands the
 * technician name into the matching subset of CSV assignees and ticks
 * those checkboxes in the multi-select filter).
 */
function nameMatchesTechnician(
  name: string,
  technicianName: string,
): boolean {
  const a = name.toLowerCase().trim();
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
  //
  // assignedFilter is a Set of selected assignee names (multi-select).
  // Empty set = no assignee restriction (i.e. show everyone). When
  // non-empty, a row passes only if its `assignedTo` is in the set.
  // The "👤 N assigned to you" stats-line shortcut expands the user's
  // settings.technicianName into the matching subset of CSV assignees
  // and seeds those into the set. There's no "Me" sentinel — the
  // selection is always concrete CSV names, which makes the "Showing
  // N of M" pill and the multi-select popover share one mental model.
  const [filter, setFilter] = useState(() => dashboardFilterCache.search);
  const [stateFilter, setStateFilter] = useState<string>(
    () => dashboardFilterCache.stateFilter,
  );
  const [assignedFilter, setAssignedFilter] = useState<Set<string>>(
    () => new Set(dashboardFilterCache.assignees),
  );
  const [createdFilter, setCreatedFilter] = useState<CreatedFilter>(
    () => dashboardFilterCache.createdFilter,
  );

  // Persist the current selections to the module-scope cache so they
  // survive navigating away and back (see dashboardFilterCache doc).
  useEffect(() => {
    dashboardFilterCache.search = filter;
    dashboardFilterCache.stateFilter = stateFilter;
    dashboardFilterCache.assignees = [...assignedFilter];
    dashboardFilterCache.createdFilter = createdFilter;
  }, [filter, stateFilter, assignedFilter, createdFilter]);

  function startProjectFromWO(wo: WorkOrder) {
    // Dedupe by FWKD — if a workboard already exists for this work
    // order (active OR archived), navigate to it rather than creating
    // a new one. This addresses the cross-device friction where
    // tapping "Open Workboard" for the same FWKD on desktop and
    // mobile would create two distinct workboards. With dedupe, the
    // second tap on either device lands on the existing workboard
    // (assuming sync has run; race window between two devices opening
    // the same FWKD before sync still exists, but that's a sync-time
    // merge problem for a future PR — this catches the common case).
    //
    // We pull `projects` directly from the store at click time rather
    // than from a hook so we always see the current list, including
    // any that were just synced down or just archived.
    const woNumber = wo.number?.toUpperCase();
    if (woNumber) {
      const existing = useStore
        .getState()
        .projects.find(
          (p) => p.workOrderId?.toUpperCase() === woNumber,
        );
      if (existing) {
        navigate(`/projects/${existing.id}`);
        return;
      }
    }

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
      if (assignedFilter.size > 0 && !assignedFilter.has(r.assignedTo))
        return false;
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
  }, [workOrders, filter, stateFilter, assignedFilter, createdFilter]);

  // Aggregates we surface in the stats line. Computed off the *full*
  // import (not the filtered set) so the line is a stable summary,
  // not a moving target while the user is filtering.
  const stats = useMemo(() => {
    if (!workOrders) return null;
    const rows = workOrders.rows;
    const overdueCount = rows.filter((r) => isOverdue(r.dueDate)).length;
    const mineCount = technicianName
      ? rows.filter((r) =>
          nameMatchesTechnician(r.assignedTo, technicianName),
        ).length
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

  // The set of CSV assignee names that fuzzy-match the user's
  // technician name — the "expansion" of "me" into the actual values
  // in the column. Cached so we can both seed the multi-select (when
  // the stats-line shortcut is clicked) and detect whether the
  // multi-select currently mirrors that exact set (so we can light up
  // the shortcut in active styling).
  const meMatches = useMemo<Set<string>>(() => {
    if (!stats || !technicianName) return new Set();
    return new Set(
      stats.assignees.filter((a) =>
        nameMatchesTechnician(a, technicianName),
      ),
    );
  }, [stats, technicianName]);

  const showingOnlyMine =
    meMatches.size > 0 &&
    assignedFilter.size === meMatches.size &&
    [...assignedFilter].every((n) => meMatches.has(n));

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
    !!filter ||
    !!stateFilter ||
    assignedFilter.size > 0 ||
    !!createdFilter;
  function clearAllFilters() {
    setFilter('');
    setStateFilter('');
    setAssignedFilter(new Set());
    setCreatedFilter('');
  }
  function showOnlyMine() {
    // Replace the current selection with exactly the matching CSV
    // names. If the user has no technician name set or no match, this
    // is a no-op — the stats-line button only renders when there's
    // something to expand.
    if (meMatches.size === 0) return;
    setAssignedFilter(new Set(meMatches));
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

      {/* Stats summary line — three at-a-glance counts of the *full*
          import. "assigned to you" doubles as a one-tap shortcut: it
          ticks the matching CSV names in the multi-select Assigned
          filter below. (We can't put a "Me" option in the multi-select
          itself because that would mix two different things —
          settings-derived sentinel vs. actual column values — and make
          the active-filter pill weird to label.) */}
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
          {technicianName && stats.mine > 0 && (
            <button
              type="button"
              onClick={showOnlyMine}
              className={`underline-offset-2 ${
                showingOnlyMine
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
            controls: State (single-select), Assigned (multi-select
            checkbox popover — handles long assignee lists), Created
            (single-select date bucket). All reactive, all independent. */}
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
              <AssigneeMultiSelect
                assignees={stats.assignees}
                selected={assignedFilter}
                onChange={setAssignedFilter}
              />
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
          {assignedFilter.size > 0 && (
            <span
              className="ml-2 pill bg-brand-50 text-brand-700"
              title={[...assignedFilter].join(', ')}
            >
              {showingOnlyMine
                ? 'you only'
                : assignedFilter.size === 1
                  ? [...assignedFilter][0]
                  : `${assignedFilter.size} assignees`}
            </span>
          )}
          {createdFilter && (
            <span className="ml-2 pill bg-slate-100 text-slate-700">
              {CREATED_LABELS[createdFilter]}
            </span>
          )}
        </div>

        {/* Work order cards — single-column responsive layout with
            colored top bar and clean field grid. No horizontal scroll. */}
        <div className="space-y-3">
          {filtered.map((r, i) => {
            const overdue = isOverdue(r.dueDate);
            // Status color mapping
            const stateColor = getStateColor(r.state);
            return (
              <div
                key={`${r.number}-${i}`}
                className="bg-white rounded-lg border border-slate-200 overflow-hidden"
              >
                {/* Thin colored top bar with FWKD / description / status pill */}
                <div
                  className={`${stateColor} px-3 py-2 flex items-center justify-between gap-2 flex-wrap`}
                >
                  <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                    {r.number ? (
                      (() => {
                        const url = buildWorkOrderUrl(r.number, woUrlPattern);
                        return url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm font-semibold hover:underline"
                            title="Open this work order in Nuvolo"
                          >
                            {r.number}
                          </a>
                        ) : (
                          <span className="font-mono text-sm font-semibold">
                            {r.number}
                          </span>
                        );
                      })()
                    ) : (
                      <span className="font-mono text-sm text-slate-400">—</span>
                    )}
                    <span className="text-sm truncate">
                      {r.shortDescription || 'No description'}
                    </span>
                  </div>
                  {r.state && (
                    <span className="pill bg-white/30 backdrop-blur-sm text-inherit text-xs">
                      {r.state}
                    </span>
                  )}
                </div>

                {/* Fields in clean grid below header */}
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-slate-500">Priority</span>
                    <div className="font-medium">{r.priority || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Assigned to</span>
                    <div className="font-medium truncate" title={r.assignedTo}>
                      {r.assignedTo || '—'}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Due date</span>
                    <div
                      className={`font-medium ${
                        overdue ? 'text-rose-600' : ''
                      }`}
                    >
                      {r.dueDate || '—'}
                      {overdue && ' ⚠'}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500">Location</span>
                    <div className="font-medium truncate" title={r.location}>
                      {r.location || '—'}
                    </div>
                  </div>
                </div>

                {/* Action button at bottom */}
                <div className="px-3 pb-3">
                  <button
                    className="btn-secondary text-sm w-full sm:w-auto"
                    onClick={() => startProjectFromWO(r)}
                    disabled={!r.number}
                    title="Open the workboard for this work order. Reuses an existing workboard if you already have one (active or archived) for this FWKD — won't create a duplicate."
                  >
                    Open Workboard →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="text-center text-sm text-slate-500 py-6">
            No rows match your filters.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Multi-select dropdown for the Assigned filter.
 *
 * Surface: a compact button that mirrors the look of the State and
 * Created <select>s ("Anyone" / "<name>" / "N selected"). Click opens
 * an absolute-positioned popover with one checkbox per unique
 * assignee found in the import, plus a Clear button when anything's
 * ticked. Click outside (or anywhere on the page) closes it.
 *
 * Why a popover rather than a native <select multiple>:
 *   - Native multi-select on mobile is awful — Android renders a full-
 *     screen modal that's hard to dismiss; iOS is even worse. The
 *     button + popover pattern works the same on every device.
 *   - The button label can summarize the selection ("3 selected"),
 *     which a native <select> can't.
 *   - Each row shows a real checkbox, so the multi-select intent is
 *     obvious without the user having to discover Cmd/Ctrl-click.
 *
 * The component is intentionally local to DashboardPage — it's not
 * worth a shared abstraction yet, and inlining keeps the related
 * filter logic in one file.
 */
function AssigneeMultiSelect({
  assignees,
  selected,
  onChange,
}: {
  assignees: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click. mousedown/touchstart cover desktop and
  // touch; we listen on capture-phase document so the close fires
  // before any other handler that might re-open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  const buttonText =
    selected.size === 0
      ? 'Anyone'
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} selected`;

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  }

  return (
    <div ref={wrapRef} className="relative">
      <span className="flex items-center gap-1.5 text-xs text-slate-600">
        Assigned:
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="input py-1 text-sm flex items-center gap-1.5 max-w-[14rem]"
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Pick one or more assignees"
        >
          <span className="truncate">{buttonText}</span>
          <span aria-hidden className="text-[10px] text-slate-400">
            ▾
          </span>
        </button>
      </span>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 w-64 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg p-2 right-0 sm:left-0 sm:right-auto"
        >
          <div className="flex items-center justify-between mb-1 pb-1 border-b border-slate-100">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              Pick one or more
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="text-[11px] text-brand-600 hover:underline"
                title="Clear all selected assignees"
              >
                Clear ({selected.size})
              </button>
            )}
          </div>
          {assignees.map((a) => (
            <label
              key={a}
              className="flex items-center gap-2 px-1.5 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={selected.has(a)}
                onChange={() => toggle(a)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="truncate">{a}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
