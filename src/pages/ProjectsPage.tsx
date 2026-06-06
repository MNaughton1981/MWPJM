import { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import { PROJECT_STATUS_LABELS, type Project } from '../types';
import { formatDateTime, workboardNumber } from '../lib/format';
import { allProjectsToOneOnOneSummary } from '../lib/exporters';
import { parseWorkOrderFile, applyColumnMap, autoDetectColumns } from '../lib/workOrderCsv';
import SyncQuickActions from '../components/SyncQuickActions';

/**
 * Session-sticky collapse state for the Workboards bucket sections.
 * Keyed by bucket id; true = collapsed. Survives navigating away and
 * back within the session (same idea as the Dashboard filter cache).
 * "Complete" starts collapsed so finished work doesn't crowd out what
 * you're actively touching.
 */
const bucketCollapseCache: Record<string, boolean> = { complete: true };

/**
 * Workboards list page.
 *
 * Default view shows ACTIVE workboards only (anything where
 * `archivedAt` is unset). A small "View archived (N) →" link at the
 * bottom flips the list to archived-only mode so the user can
 * unarchive items if needed without losing their position.
 *
 * The split exists because field-test feedback was that users
 * deleted workboards once a job was done just to keep the list
 * focused on what's currently in front of them — which threw away
 * all the documentation we worked so hard to capture (photos,
 * activity log, vendor coordination, FWKD linkage). Archive gives
 * them the same "get it off my list" outcome without the data loss.
 */

export default function ProjectsPage() {
  const projects = useStore((s) => s.projects);
  const meetingNotesOrders = useStore((s) => s.meetingNotesOrders);
  const setMeetingNotesOrders = useStore((s) => s.setMeetingNotesOrders);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addProject = useStore((s) => s.addProject);
  const unarchiveProject = useStore((s) => s.unarchiveProject);
  const togglePinProject = useStore((s) => s.togglePinProject);
  const navigate = useNavigate();
  const location = useLocation();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [showArchived, setShowArchived] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [showMeetingNotesImport, setShowMeetingNotesImport] = useState(false);

  // Handle navigation state actions from HomePage launchers
  useEffect(() => {
    const state = location.state as { action?: string } | null;
    if (!state?.action) return;
    
    if (state.action === 'export1on1') {
      // Automatically trigger the 1:1 export when navigating from the "1:1 Manager" launcher
      exportAll1on1Summaries();
      // Clear the action from location state so it doesn't re-trigger on refresh
      navigate(location.pathname, { replace: true });
    }
    // Handle other actions (quick, new, events) if they exist...
  }, [location.state]);


  const archivedCount = useMemo(
    () => projects.filter((p) => !!p.archivedAt).length,
    [projects],
  );

  // Active vs archived split. Archived stays a flat, most-recently-
  // archived-first list. Active is grouped into buckets below.
  const activeProjects = useMemo(
    () => projects.filter((p) => !p.archivedAt),
    [projects],
  );
  const archivedList = useMemo(
    () =>
      projects
        .filter((p) => !!p.archivedAt)
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [projects],
  );

  // Focus / Today lane: pinned active workboards, most recently pinned
  // first. Pinning is the "I'm touching this right now" flag — distinct
  // from status, so a board can be In progress AND in Focus. Pinned
  // boards live ONLY here (not duplicated in their status bucket).
  const focusItems = useMemo(
    () =>
      activeProjects
        .filter((p) => !!p.pinnedAt)
        .sort(
          (a, b) =>
            (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) ||
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        ),
    [activeProjects],
  );

  // Unpinned active workboards grouped by status into collapsible
  // buckets ("dropdown dashboards"), each sorted most-recently-updated.
  const buckets = useMemo(() => {
    const unpinned = activeProjects.filter((p) => !p.pinnedAt);
    const byUpdated = (a: Project, b: Project) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    const group = (status: Project['status']) =>
      unpinned.filter((p) => p.status === status).sort(byUpdated);
    return {
      in_progress: group('in_progress'),
      on_hold: group('on_hold'),
      planning: group('planning'),
      complete: group('complete'),
    };
  }, [activeProjects]);

  // Collapse state per bucket, seeded from + written back to the
  // module cache so it survives navigating away and back.
  const [collapsedBuckets, setCollapsedBuckets] = useState<
    Record<string, boolean>
  >(() => ({ ...bucketCollapseCache }));
  function toggleBucket(id: string) {
    setCollapsedBuckets((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      bucketCollapseCache[id] = next[id];
      return next;
    });
  }

  function createProject() {
    const name = newName.trim();
    if (!name) return;
    const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
    const proj = tpl.build(name);
    addProject(proj);
    setShowNew(false);
    setNewName('');
    navigate(`/projects/${proj.id}`);
  }

  /**
   * One-tap path for the on-call / "phone rings, get on site, start
   * documenting now" use case. Creates a blank, simple-mode workboard
   * with no Work Order ID, names it from the current timestamp, and
   * navigates straight in. The user backfills the FWKD # later from
   * the workboard page itself — once they do, "Post to Nuvolo" lights
   * up automatically.
   */
  function createQuickWorkboard() {
    const tpl =
      TEMPLATES.find((t) => t.id === 'work-order-followup') ?? TEMPLATES[0];
    const stamp = format(new Date(), 'MMM d, h:mm a');
    const proj = tpl.build(`Quick Workboard — ${stamp}`);
    addProject(proj);
    navigate(`/projects/${proj.id}`);
  }

  /**
   * Bulk export: all active workboards merged with meeting notes CSV data.
   * Copies the combined summary to clipboard ready for pasting into
   * meeting notes or sending to Copilot for executive summary generation.
   * 
   * Uses meetingNotesOrders (closed/historical tickets) instead of workOrders
   * (daily active tickets) so the user can load a filtered export without
   * interfering with the Dashboard.
   */
  async function exportAll1on1Summaries() {
    const summary = allProjectsToOneOnOneSummary(projects, meetingNotesOrders);
    try {
      await navigator.clipboard.writeText(summary);
      const activeCount = projects.filter(p => !p.archivedAt).length;
      setExportStatus(`✓ Copied ${activeCount} workboard${activeCount !== 1 ? 's' : ''} to clipboard`);
      setTimeout(() => setExportStatus(''), 4000);
    } catch {
      setExportStatus('✗ Clipboard not available');
      setTimeout(() => setExportStatus(''), 4000);
    }
  }

  /**
   * Import a meeting notes CSV (closed/historical work orders).
   * Stored separately from the daily active work orders so the user
   * can filter to closed tickets over a specific date range for
   * meeting prep without overwriting the Dashboard.
   */
  async function handleMeetingNotesFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { headers, rows } = await parseWorkOrderFile(file);
      if (rows.length === 0) {
        setExportStatus('✗ No rows found in file');
        setTimeout(() => setExportStatus(''), 4000);
        return;
      }
      const columnMap = autoDetectColumns(headers);
      const workOrderRows = applyColumnMap(rows, columnMap);
      setMeetingNotesOrders({
        importedAt: new Date().toISOString(),
        sourceFilename: file.name,
        rawHeaders: headers,
        columnMap,
        rows: workOrderRows,
      });
      setSettings({ meetingNotesFilename: file.name });
      setShowMeetingNotesImport(false);
      setExportStatus(`✓ Loaded ${workOrderRows.length} work order${workOrderRows.length !== 1 ? 's' : ''} from ${file.name}`);
      setTimeout(() => setExportStatus(''), 6000);
    } catch (err) {
      setExportStatus(`✗ Import failed: ${(err as Error).message}`);
      setTimeout(() => setExportStatus(''), 6000);
    }
    // Reset the file input so the user can re-select the same file if needed
    e.target.value = '';
  }

  /**
   * One-tap unarchive from the archived list. Doesn't navigate —
   * the row just disappears from the archived view (since it's no
   * longer archived). User can flip back to active to see it.
   */
  function handleUnarchive(e: React.MouseEvent, projectId: string) {
    // The row is a <Link>, so stop the click from also navigating
    // into the workboard page when the unarchive button is tapped.
    e.preventDefault();
    e.stopPropagation();
    unarchiveProject(projectId);
  }

  /**
   * Pin / unpin toggle from the workboards list. Same defensive
   * preventDefault as unarchive — the row is a navigable link, so
   * tapping the pin icon shouldn't punch through into the workboard.
   */
  function handleTogglePin(e: React.MouseEvent, projectId: string) {
    e.preventDefault();
    e.stopPropagation();
    togglePinProject(projectId);
  }

  // A single workboard row. Shared by every bucket section and the
  // archived list so the card markup lives in exactly one place.
  const renderRow = (p: Project) => {
    const isPinned = !!p.pinnedAt;
    return (
      <li key={p.id}>
        <Link
          to={`/projects/${p.id}`}
          className={`block card p-4 hover:border-brand-500 hover:shadow transition ${
            showArchived ? 'opacity-80' : ''
          } ${
            !showArchived && isPinned ? 'border-amber-300 bg-amber-50/40' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate flex items-center gap-1.5">
                {!showArchived && isPinned && (
                  <span
                    className="text-amber-600 shrink-0"
                    title="In Focus / Today"
                    aria-label="In Focus"
                  >
                    📌
                  </span>
                )}
                <span className="truncate">{p.name}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span
                  className="font-mono text-slate-600"
                  title="Workboard ID — stable across devices via sync"
                >
                  {workboardNumber(p.id)}
                </span>
                {p.workOrderId ? (
                  <span>WO: {p.workOrderId}</span>
                ) : (
                  <span className="text-amber-700">WO: not linked</span>
                )}
                {p.location && <span>{p.location}</span>}
                <span>
                  {showArchived && p.archivedAt
                    ? `Archived ${formatDateTime(
                        new Date(p.archivedAt).toISOString(),
                      )}`
                    : `Updated ${formatDateTime(p.updatedAt)}`}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="pill bg-slate-100 text-slate-700">
                {PROJECT_STATUS_LABELS[p.status]}
              </span>
              {!showArchived && (
                <button
                  type="button"
                  className={`text-base leading-none w-8 h-8 rounded-md flex items-center justify-center transition ${
                    isPinned
                      ? 'text-amber-600 hover:bg-amber-100'
                      : 'text-slate-400 hover:text-amber-600 hover:bg-slate-100'
                  }`}
                  onClick={(e) => handleTogglePin(e, p.id)}
                  title={
                    isPinned
                      ? 'Remove from Focus / Today'
                      : 'Add to Focus / Today (what you’re touching now)'
                  }
                  aria-label={isPinned ? 'Remove from Focus' : 'Add to Focus'}
                  aria-pressed={isPinned}
                >
                  {isPinned ? '📌' : '📍'}
                </button>
              )}
              {showArchived && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={(e) => handleUnarchive(e, p.id)}
                  title="Restore this workboard to your active list"
                >
                  ↩ Unarchive
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
            <span>
              {p.milestones.filter((m) => m.done).length}/
              {p.milestones.length} milestones
            </span>
            <span>·</span>
            <span>{p.trades.length} trades</span>
            <span>·</span>
            <span>{p.activity.length} updates</span>
          </div>
        </Link>
      </li>
    );
  };

  // A collapsible bucket section ("dropdown dashboard"). Renders nothing
  // when empty so the page only shows buckets that have workboards.
  const renderSection = (
    id: string,
    label: string,
    icon: string,
    items: Project[],
  ) => {
    if (items.length === 0) return null;
    const isCollapsed = !!collapsedBuckets[id];
    return (
      <section key={id} className="space-y-2">
        <button
          type="button"
          onClick={() => toggleBucket(id)}
          className="w-full flex items-center gap-2 text-left py-1"
          aria-expanded={!isCollapsed}
        >
          <span
            aria-hidden
            className="text-slate-400 w-3 inline-block text-xs"
          >
            {isCollapsed ? '▸' : '▾'}
          </span>
          <span className="text-sm font-semibold text-slate-700">
            {icon} {label}
          </span>
          <span className="text-xs font-normal text-slate-400">
            ({items.length})
          </span>
        </button>
        {!isCollapsed && (
          <ul className="space-y-2">{items.map((p) => renderRow(p))}</ul>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">
            Workboards
            {showArchived && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                · Archived
              </span>
            )}
          </h1>
          {/* Sync controls beside the title so they don't crowd the buttons */}
          <SyncQuickActions />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {!showArchived && activeProjects.length > 0 && (
            <>
              <button
                className="btn-secondary text-xs w-full sm:w-auto"
                onClick={() => setShowMeetingNotesImport(v => !v)}
                title="Load a filtered CSV (closed work orders) for meeting prep"
              >
                {meetingNotesOrders ? '✓ CSV Loaded' : '📁 Load Meeting CSV'}
              </button>
              <button
                className="btn-secondary text-xs w-full sm:w-auto"
                onClick={exportAll1on1Summaries}
                title={meetingNotesOrders 
                  ? "Export all active workboards merged with loaded CSV data" 
                  : "Export all active workboards (without Nuvolo cross-reference — load CSV first)"}
              >
                📄 Export All 1:1
              </button>
            </>
          )}
          <button
            className="btn-primary text-xs w-full sm:w-auto"
            onClick={createQuickWorkboard}
            title="One-tap blank workboard for on-call / drop-in work — name + WO# can be filled in later"
          >
            📝 Quick Workboard
          </button>
          <button
            className="btn-secondary text-xs w-full sm:w-auto"
            onClick={() => setShowNew((v) => !v)}
            title="Pick a name and template (use this for full projects like the kitchenette pilot)"
          >
            {showNew ? 'Cancel' : '+ New Workboard'}
          </button>
        </div>
      </div>

      {exportStatus && (
        <div className="card p-3 bg-brand-50 border-brand-200 text-sm text-brand-800">
          {exportStatus}
        </div>
      )}

      {showMeetingNotesImport && (
        <div className="card p-4 space-y-3 bg-blue-50 border-blue-200">
          <div>
            <h3 className="font-semibold text-blue-900 mb-1">Load Meeting Notes CSV</h3>
            <p className="text-sm text-blue-700">
              Load a filtered Nuvolo export (closed work orders over a specific date range) 
              to cross-reference with your workboard activity for 1:1 meetings. This won't 
              overwrite the Dashboard's daily active work orders.
            </p>
          </div>
          <div>
            <label className="btn-secondary text-sm cursor-pointer inline-flex items-center gap-2">
              <span>📁 Choose File...</span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.json"
                onChange={handleMeetingNotesFileSelect}
                className="hidden"
              />
            </label>
            {settings.meetingNotesFilename && (
              <p className="text-xs text-blue-600 mt-2">
                Currently loaded: <span className="font-mono">{settings.meetingNotesFilename}</span>
                {meetingNotesOrders && ` (${meetingNotesOrders.rows.length} rows)`}
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              className="btn-ghost text-xs"
              onClick={() => setShowMeetingNotesImport(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showNew && (
        <div className="card p-4 space-y-3">
          <div>
            <label className="label">Workboard name</label>
            <input
              className="input"
              placeholder="e.g. Bldg 3 Kitchenette — DW Upgrade"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Template</label>
            <select
              className="input"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {TEMPLATES.find((t) => t.id === templateId)?.description}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setShowNew(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={createProject}
              disabled={!newName.trim()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {showArchived ? (
        archivedList.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">
            <p className="mb-2">No archived workboards.</p>
            <p className="text-sm">
              Archive a finished workboard from its page to clean up your
              active list without losing the documentation.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {archivedList.map((p) => renderRow(p))}
          </ul>
        )
      ) : activeProjects.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          <p className="mb-2">Nothing tracked yet.</p>
          <p className="text-sm">
            Tap <strong>📝 Quick Workboard</strong> to drop straight into a
            blank one (great for on-call), or <strong>+ New Workboard</strong>{' '}
            to start from a template. You can also jump to the{' '}
            <Link to="/dashboard" className="text-brand-600 hover:underline">
              Dashboard
            </Link>{' '}
            and pick a row to spin up a quick follow-up.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {renderSection('focus', 'Focus / Today', '📌', focusItems)}
          {renderSection('in_progress', 'In progress', '🔵', buckets.in_progress)}
          {renderSection('on_hold', 'Parked / On hold', '⏸', buckets.on_hold)}
          {renderSection('planning', 'Planning', '🗓', buckets.planning)}
          {renderSection('complete', 'Closed', '✅', buckets.complete)}
        </div>
      )}

      {/* View toggle — small footer link rather than a tab/button row,
          so it doesn't compete visually with the active list. The
          archived-count link only appears when there are archived items
          (and we're not already viewing them). */}
      <div className="pt-2 text-center">
        {!showArchived && archivedCount > 0 && (
          <button
            type="button"
            className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
            onClick={() => setShowArchived(true)}
          >
            📦 View archived ({archivedCount}) →
          </button>
        )}
        {showArchived && (
          <button
            type="button"
            className="text-sm text-brand-600 hover:underline"
            onClick={() => setShowArchived(false)}
          >
            ← Active workboards
          </button>
        )}
      </div>
    </div>
  );
}
