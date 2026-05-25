import { useMemo, useState } from 'react';
import { format } from 'date-fns';
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Workboards</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick sync controls so the user doesn't have to hop into
              Settings just to pull the latest state from the desktop or
              push from the desktop on demand. The component adapts to
              the device — only renders the buttons that can actually
              do something there. */}
          <SyncQuickActions />
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
          <p className="mb-2">Nothing tracked yet.</p>
          <p className="text-sm">
            Tap <strong>📝 Quick Workboard</strong> to drop straight into a
            blank one (great for on-call), or{' '}
            <strong>+ New Workboard</strong> to start from a template. You can
            also jump to the{' '}
            <Link to="/dashboard" className="text-brand-600 hover:underline">
              Dashboard
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
                      {p.workOrderId ? (
                        <span>WO: {p.workOrderId}</span>
                      ) : (
                        <span className="text-amber-700">WO: not linked</span>
                      )}
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
