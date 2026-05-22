import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../state/store';
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '../types';
import { buildWorkOrderUrl, isValidWorkOrderId } from '../lib/nuvolo';
import TimetableSection from '../components/TimetableSection';
import TradeTrackerSection from '../components/TradeTrackerSection';
import ActivityLogSection from '../components/ActivityLogSection';
import PhotosSection from '../components/PhotosSection';
import UpdateComposer from '../components/UpdateComposer';
import VendorsSection from '../components/VendorsSection';
import { downloadText, projectToMarkdown } from '../lib/exporters';

export default function ProjectPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const woUrlPattern = useStore((s) => s.settings.nuvoloWorkOrderUrlPattern);
  const importedWorkOrders = useStore((s) => s.workOrders);

  if (!project) {
    return (
      <div className="card p-6 text-center text-slate-500">
        <p>Project not found.</p>
        <Link to="/projects" className="btn-secondary mt-4">
          ← Back to projects
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

  function exportMarkdown() {
    const md = projectToMarkdown(project!);
    const safeName = project!.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadText(`${safeName}-${new Date().toISOString().slice(0, 10)}.md`, md);
  }

  function confirmDelete() {
    if (window.confirm(`Delete project "${project!.name}"? This cannot be undone.`)) {
      deleteProject(project!.id);
      navigate('/projects');
    }
  }

  function toggleSimple() {
    updateProject(project!.id, { simple: !isSimple });
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/projects" className="text-sm text-brand-600 hover:underline">
          ← All projects
        </Link>
      </div>

      <header className="card p-4 space-y-3">
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
          <button className="btn-secondary text-xs" onClick={exportMarkdown}>
            Export to OneNote (.md)
          </button>
          <button className="btn-ghost text-xs text-rose-600" onClick={confirmDelete}>
            Delete project
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
