import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { TEMPLATES } from '../data/templates';
import { PROJECT_STATUS_LABELS } from '../types';
import { formatDateTime } from '../lib/format';
import SyncQuickActions from '../components/SyncQuickActions';

export default function ProjectsPage() {
  const projects = useStore((s) => s.projects);
  const addProject = useStore((s) => s.addProject);
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);

  const sorted = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [projects],
  );

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick sync controls so the user doesn't have to hop into
              Settings just to pull the latest state from the desktop or
              push from the desktop on demand. The component adapts to
              the device — only renders the buttons that can actually
              do something there. */}
          <SyncQuickActions />
          <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Cancel' : '+ New project'}
          </button>
        </div>
      </div>

      {showNew && (
        <div className="card p-4 space-y-3">
          <div>
            <label className="label">Project name</label>
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
          <p className="mb-2">Nothing tracked yet.</p>
          <p className="text-sm">
            Click <strong>+ New project</strong> above to start from a template,
            or jump to{' '}
            <Link to="/dashboard" className="text-brand-600 hover:underline">
              Work Orders
            </Link>{' '}
            and pick a row to spin up a quick follow-up.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((p) => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.id}`}
                className="block card p-4 hover:border-brand-500 hover:shadow transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {p.workOrderId && <span>WO: {p.workOrderId}</span>}
                      {p.location && <span>{p.location}</span>}
                      <span>Updated {formatDateTime(p.updatedAt)}</span>
                    </div>
                  </div>
                  <span className="pill bg-slate-100 text-slate-700 shrink-0">
                    {PROJECT_STATUS_LABELS[p.status]}
                  </span>
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
    </div>
  );
}
