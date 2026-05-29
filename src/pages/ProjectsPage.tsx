import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import { PROJECT_STATUS_LABELS } from '../types';
import { formatDateTime, workboardNumber } from '../lib/format';
import SyncQuickActions from '../components/SyncQuickActions';
import VendorEventsModal from '../components/VendorEventsModal';

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
  const addProject = useStore((s) => s.addProject);
  const unarchiveProject = useStore((s) => s.unarchiveProject);
  const savedVendorEvents = useStore((s) => s.savedVendorEvents);
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [showArchived, setShowArchived] = useState(false);
  // Vendor events modal — opens via the "📅 Vendor events" button.
  // Modal manages its own list / fire / edit modes internally; this
  // page just controls whether it's mounted.
  const [eventsOpen, setEventsOpen] = useState(false);

  const archivedCount = useMemo(
    () => projects.filter((p) => !!p.archivedAt).length,
    [projects],
  );

  // Filter to either active (default) or archived (toggle) before
  // sorting, so the rest of the render code is identical for both
  // modes — just the button row at the top of each row differs.
  const sorted = useMemo(() => {
    const filtered = projects.filter((p) =>
      showArchived ? !!p.archivedAt : !p.archivedAt,
    );
    return filtered.sort(
      (a, b) =>
        // Archived list sorts by archive time (most recently archived
        // first); active list sorts by updatedAt as before.
        showArchived
          ? (b.archivedAt ?? 0) - (a.archivedAt ?? 0)
          : new Date(b.updatedAt).getTime() -
            new Date(a.updatedAt).getTime(),
    );
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
          <button
            className="btn-ghost text-sm"
            onClick={() => setEventsOpen(true)}
            title={
              savedVendorEvents.length > 0
                ? `Pick a saved recurring service event (${savedVendorEvents.length}) to fire a security notification`
                : 'Save recurring services (quarterly drain, annual fire alarm, etc.) so you can fire the next notification with one tap'
            }
          >
            📅 Vendor events
            {savedVendorEvents.length > 0 && (
              <span className="ml-1 text-xs text-slate-500">
                ({savedVendorEvents.length})
              </span>
            )}
          </button>
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
          {sorted.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className={`block card p-4 hover:border-brand-500 hover:shadow transition ${
                  showArchived ? 'opacity-80' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
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
          ))}
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

      {/* Vendor events modal — mounted only when open so it doesn't
          eat any keyboard / focus when the user isn't using it. */}
      {eventsOpen && (
        <VendorEventsModal onClose={() => setEventsOpen(false)} />
      )}
    </div>
  );
}
