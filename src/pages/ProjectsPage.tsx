import { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import { PROJECT_STATUS_LABELS } from '../types';
import { formatDateTime, workboardNumber } from '../lib/format';
import { allProjectsToOneOnOneSummary } from '../lib/exporters';
import SyncQuickActions from '../components/SyncQuickActions';

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
  const workOrders = useStore((s) => s.workOrders);
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

  // Filter to either active (default) or archived (toggle) before
  // sorting, so the rest of the render code is identical for both
  // modes — just the button row at the top of each row differs.
  //
  // Active list sort order:
  //   1. Pinned workboards first, most recently pinned at the top.
  //   2. Then unpinned, by updatedAt desc as before.
  // The pinned section gets a subtle visual treatment (📌 icon and a
  // light amber tint on the card border) so the user can tell at a
  // glance that those rows are stuck at the top by intent.
  //
  // Archived list ignores pin state — pin/unpin is for keeping things
  // visible at the top of the *active* working list, not for re-
  // ranking historical archived items.
  const sorted = useMemo(() => {
    const filtered = projects.filter((p) =>
      showArchived ? !!p.archivedAt : !p.archivedAt,
    );
    if (showArchived) {
      return filtered.sort(
        (a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0),
      );
    }
    return filtered.sort((a, b) => {
      const aPinned = a.pinnedAt ?? 0;
      const bPinned = b.pinnedAt ?? 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });
  }, [projects, showArchived]);

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
   * Bulk export: all active workboards merged with Nuvolo CSV data.
   * Copies the combined summary to clipboard ready for pasting into
   * meeting notes or sending to Copilot for executive summary generation.
   */
  async function exportAll1on1Summaries() {
    const summary = allProjectsToOneOnOneSummary(projects, workOrders);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">
          Workboards
          {showArchived && (
            <span className="ml-2 text-sm font-normal text-slate-500">
              · Archived
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick sync controls so the user doesn't have to hop into
              Settings just to pull the latest state from the desktop or
              push from the desktop on demand. The component adapts to
              the device — only renders the buttons that can actually
              do something there. */}
          <SyncQuickActions />
          {!showArchived && sorted.length > 0 && (
            <button
              className="btn-secondary text-xs"
              onClick={exportAll1on1Summaries}
              title="Export all active workboards merged with Nuvolo CSV data — ready for meeting notes or Copilot summary"
            >
              📄 Export All 1:1
            </button>
          )}
          <button
            className="btn-primary"
            onClick={createQuickWorkboard}
            title="One-tap blank workboard for on-call / drop-in work — name + WO# can be filled in later"
          >
            📝 Quick Workboard
          </button>
          <button
            className="btn-secondary"
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

      {sorted.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          {showArchived ? (
            <>
              <p className="mb-2">No archived workboards.</p>
              <p className="text-sm">
                Archive a finished workboard from its page to clean up
                your active list without losing the documentation.
              </p>
            </>
          ) : (
            <>
              <p className="mb-2">Nothing tracked yet.</p>
              <p className="text-sm">
                Tap <strong>📝 Quick Workboard</strong> to drop straight into
                a blank one (great for on-call), or{' '}
                <strong>+ New Workboard</strong> to start from a template. You
                can also jump to the{' '}
                <Link to="/dashboard" className="text-brand-600 hover:underline">
                  Dashboard
                </Link>{' '}
                and pick a row to spin up a quick follow-up.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((p) => {
            const isPinned = !!p.pinnedAt;
            return (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className={`block card p-4 hover:border-brand-500 hover:shadow transition ${
                  showArchived ? 'opacity-80' : ''
                } ${
                  // Subtle amber border on pinned rows so the user can
                  // see at a glance that this row is stuck at the top
                  // by intent, not just because it's the most recently
                  // updated.
                  !showArchived && isPinned
                    ? 'border-amber-300 bg-amber-50/40'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate flex items-center gap-1.5">
                      {!showArchived && isPinned && (
                        <span
                          className="text-amber-600 shrink-0"
                          title="Pinned to top"
                          aria-label="Pinned to top"
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
                            ? 'Unpin — return to normal sort order'
                            : 'Pin to top of Workboards list'
                        }
                        aria-label={isPinned ? 'Unpin workboard' : 'Pin workboard'}
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
          })}
        </ul>
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
