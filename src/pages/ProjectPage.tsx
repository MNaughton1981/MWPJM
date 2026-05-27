import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../state/store';
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '../types';
import { buildWorkOrderUrl, isValidWorkOrderId } from '../lib/nuvolo';
import { workboardNumber } from '../lib/format';
import TimetableSection from '../components/TimetableSection';
import TradeTrackerSection from '../components/TradeTrackerSection';
import ActivityLogSection from '../components/ActivityLogSection';
import PhotosSection from '../components/PhotosSection';
import UpdateComposer from '../components/UpdateComposer';
import VendorsSection from '../components/VendorsSection';
import {
  downloadText,
  projectToHtml,
  projectToMarkdown,
} from '../lib/exporters';
import { copyRichText } from '../lib/destinations';

export default function ProjectPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const archiveProject = useStore((s) => s.archiveProject);
  const unarchiveProject = useStore((s) => s.unarchiveProject);
  const woUrlPattern = useStore((s) => s.settings.nuvoloWorkOrderUrlPattern);
  const importedWorkOrders = useStore((s) => s.workOrders);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  // Auto-clear the inline "Copied!" feedback after a few seconds so the
  // header doesn't accumulate stale chrome.
  useEffect(() => {
    if (!copyStatus) return;
    const t = window.setTimeout(() => setCopyStatus(null), 3000);
    return () => window.clearTimeout(t);
  }, [copyStatus]);

  if (!project) {
    return (
      <div className="card p-6 text-center text-slate-500">
        <p>Workboard not found.</p>
        <Link to="/projects" className="btn-secondary mt-4">
          ← Back to Workboards
        </Link>
      </div>
    );
  }

  const woValid = isValidWorkOrderId(project.workOrderId);
  const woUrl = woValid
    ? buildWorkOrderUrl(project.workOrderId, woUrlPattern)
    : null;

  // If we have imported Nuvolo CSV data and this project's WO ID matches a
  // row in that import, show the Nuvolo state next to the WO field.
  const importedWo = woValid
    ? importedWorkOrders?.rows.find(
        (r) =>
          r.number?.toUpperCase() === project.workOrderId?.toUpperCase(),
      )
    : undefined;

  const isSimple = project.simple ?? false;

  // Primary export path: write rich HTML + plain-text fallback to the
  // clipboard. User switches to their notes app of choice (OneNote,
  // Word, Outlook compose, Gmail compose, Teams, etc.) and hits Ctrl+V
  // — formatted headings, tables, and lists land directly in the page.
  // No file shuffling, no code editor opening for a markdown file.
  async function exportSummary() {
    const html = projectToHtml(project!);
    const md = projectToMarkdown(project!);
    const ok = await copyRichText(html, md);
    setCopyStatus(
      ok
        ? 'Copied — paste (Ctrl+V) into your notes app.'
        : 'Copy failed — clipboard not available on this browser.',
    );
  }

  // Secondary: keep the .md download for users who want a saved file
  // (e.g. archiving in OneDrive, importing into a markdown-aware tool).
  // Tucked behind a smaller button so it's discoverable but not the
  // primary action.
  function downloadMarkdown() {
    const md = projectToMarkdown(project!);
    const safeName = project!.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadText(`${safeName}-${new Date().toISOString().slice(0, 10)}.md`, md);
  }

  function confirmDelete() {
    // Updated copy now that Archive is the recommended path for "I'm
    // done with this." Delete is the rare destructive action — for
    // genuine mistakes (test workboards, accidental creations).
    if (
      window.confirm(
        `Delete workboard "${project!.name}"?\n\nPhotos, activity log, and FWKD linkage will be permanently removed. This cannot be undone.\n\nIf you just want to clean up your list, tap Cancel and use Archive instead.`,
      )
    ) {
      deleteProject(project!.id);
      navigate('/projects');
    }
  }

  /**
   * Archive: hide from active list, preserve all data. No confirmation
   * — archive is reversible and one-tap. The user navigates back to
   * the active list, where the workboard is gone but recoverable via
   * the "View archived" footer link.
   */
  function handleArchive() {
    archiveProject(project!.id);
    navigate('/projects');
  }

  function handleUnarchive() {
    unarchiveProject(project!.id);
    // Stay on the workboard page after unarchive — user is probably
    // here to re-engage with the work, not to bounce back to the list.
  }

  function toggleSimple() {
    updateProject(project!.id, { simple: !isSimple });
  }

  const isArchived = !!project.archivedAt;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/projects" className="text-sm text-brand-600 hover:underline">
          ← Workboards
        </Link>
      </div>

      {/* Archived banner — visible reminder that this workboard is
          off the active list. One-tap unarchive right here so the user
          doesn't have to scroll down to the bottom of the page. */}
      {isArchived && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-slate-700">
            <span className="font-medium">📦 Archived.</span>{' '}
            <span className="text-slate-500">
              Hidden from the active list. All data preserved.
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={handleUnarchive}
            title="Restore this workboard to your active list"
          >
            ↩ Unarchive
          </button>
        </div>
      )}

      <header className="card p-4 space-y-3">
        {/* WB# — friendly Workboard identifier derived from the
            underlying UUID. Stable across devices via sync, so verbal
            references between the user and a teammate ("WB-A3B4C5")
            unambiguously refer to the same workboard regardless of
            which device they're each on. Shown above the name so the
            user sees it before scrolling into the workboard body. */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className="font-mono text-slate-500"
            title="Workboard ID — stable across desktop and mobile via sync. Reference this when you need to verify two devices are looking at the same workboard."
          >
            {workboardNumber(project.id)}
          </span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <input
            className="input text-lg font-semibold"
            value={project.name}
            onChange={(e) => updateProject(project.id, { name: e.target.value })}
          />
          <select
            className="input w-auto"
            value={project.status}
            onChange={(e) =>
              updateProject(project.id, {
                status: e.target.value as ProjectStatus,
              })
            }
          >
            {Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Nuvolo Work Order ID</label>
            <input
              className={`input ${
                project.workOrderId && !woValid
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                  : ''
              }`}
              placeholder="FWKD0000000"
              value={project.workOrderId ?? ''}
              onChange={(e) =>
                updateProject(project.id, {
                  workOrderId: e.target.value.toUpperCase(),
                })
              }
            />
            {project.workOrderId && !woValid && (
              <p className="text-xs text-rose-600 mt-1">
                Expected format: FWKD followed by digits.
              </p>
            )}
            {!project.workOrderId && (
              // Backfill nudge for the on-call / Quick Workboard flow:
              // user starts documenting before they have a WO #, then
              // pastes the FWKD ID here once they get one. Once a valid
              // ID is entered, "Post to Nuvolo" lights up automatically.
              <p className="text-xs text-amber-700 mt-1">
                📝 No work order linked yet — paste the FWKD # here once you
                have it. <span className="text-slate-500">Post to Nuvolo stays disabled until then.</span>
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {woUrl && (
                <a
                  href={woUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-600 hover:underline"
                  title="Opens in Nuvolo / your default browser. On Android, may offer to open in the Nuvolo app."
                >
                  Open in Nuvolo →
                </a>
              )}
              {importedWo && (
                <>
                  {importedWo.state && (
                    <span
                      className="pill bg-blue-100 text-blue-800"
                      title="State pulled from your most recent imported CSV"
                    >
                      Nuvolo: {importedWo.state}
                    </span>
                  )}
                  {importedWo.priority && (
                    <span className="pill bg-slate-100 text-slate-700">
                      Priority: {importedWo.priority}
                    </span>
                  )}
                  {importedWo.assignedTo && (
                    <span className="pill bg-slate-100 text-slate-700">
                      Assigned: {importedWo.assignedTo}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <div>
            <label className="label">Location</label>
            <input
              className="input"
              placeholder="e.g. Bldg 3 — 2nd floor kitchenette"
              value={project.location ?? ''}
              onChange={(e) =>
                updateProject(project.id, { location: e.target.value })
              }
            />
          </div>
        </div>

        <div>
          <label className="label">Description / scope</label>
          <textarea
            className="input min-h-[60px]"
            placeholder="Scope summary…"
            value={project.description ?? ''}
            onChange={(e) =>
              updateProject(project.id, { description: e.target.value })
            }
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1 items-center">
          <span
            className={`pill ${
              isSimple
                ? 'bg-slate-100 text-slate-700'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isSimple ? 'Quick follow-up' : 'Full project'}
          </span>
          <button
            className="btn-ghost text-xs"
            onClick={toggleSimple}
            title={
              isSimple
                ? 'Show Trade Coordination + Timetable sections'
                : 'Hide Trade Coordination + Timetable sections'
            }
          >
            {isSimple ? '+ Switch to full project' : '− Switch to quick view'}
          </button>
          <span className="grow" />
          {copyStatus && (
            <span
              className="text-[11px] text-slate-600 mr-1 max-w-xs truncate"
              title={copyStatus}
            >
              {copyStatus}
            </span>
          )}
          <button
            className="btn-secondary text-xs"
            onClick={exportSummary}
            title="Copy a formatted snapshot to your clipboard. Paste into OneNote, Word, Outlook, Gmail, Teams, or any rich-text surface — headings and tables stay intact."
          >
            📋 Export Summary
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={downloadMarkdown}
            title="Download the same content as a Markdown file (for archiving or Markdown-aware tools)"
          >
            ↓ .md
          </button>
          {/* Archive is the routine "I'm done with this, off my list"
              action. Light, reversible, one-tap. */}
          {!isArchived && (
            <button
              className="btn-ghost text-xs"
              onClick={handleArchive}
              title="Hide from active list. Photos, activity, vendors, and FWKD linkage are preserved — restore anytime via 'View archived' on the Workboards list."
            >
              📦 Archive
            </button>
          )}
          {/* Delete is now secondary — the rare "this was a test or
              accident, scrub it" path. Tinted red so it doesn't get
              fat-fingered when archive was what the user wanted. */}
          <button
            className="btn-ghost text-xs text-rose-600"
            onClick={confirmDelete}
            title="Permanently remove this workboard, including all photos and activity log. Use Archive instead if you just want it off your list."
          >
            Delete
          </button>
        </div>
      </header>

      <UpdateComposer project={project} />

      <VendorsSection project={project} />

      {!isSimple && (
        <TradeTrackerSection
          projectId={project.id}
          trades={project.trades}
        />
      )}

      {!isSimple && (
        <TimetableSection
          projectId={project.id}
          milestones={project.milestones}
        />
      )}

      <PhotosSection project={project} />

      <ActivityLogSection
        projectId={project.id}
        activity={project.activity}
      />
    </div>
  );
}
