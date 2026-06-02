import { useStore } from '../state/store';
import { Link } from 'react-router-dom';

/**
 * Home page — customizable launcher dashboard with quick-access buttons
 * organized into user-editable sections.
 *
 * Default sections:
 *   - Workboard navigation (Dashboard, Workboards, Reports)
 *   - Capture (Quick Workboard, New Workboard, Vendor Events)
 *   - Communication (OneNote, Gmail, Google Drive, OneDrive)
 *
 * Users can customize section names and toggle buttons on/off via
 * Settings → Customize Home (coming in follow-up).
 */
export default function HomePage() {
  const projects = useStore((s) => s.projects);
  const workOrders = useStore((s) => s.workOrders);

  const activeCount = projects.filter((p) => !p.archivedAt).length;
  const woCount = workOrders?.rows.length ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Workboard</h1>
        <p className="text-sm text-slate-600 mt-1">
          Facilities project manager — local-first, syncs via OneDrive
        </p>
      </header>

      {/* === Section: Workboard navigation === */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">
          Workboard navigation
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LauncherButton
            to="/dashboard"
            icon="📊"
            label="Dashboard"
            description={`${woCount} work order${woCount === 1 ? '' : 's'} imported`}
          />
          <LauncherButton
            to="/projects"
            icon="📋"
            label="Workboards"
            description={`${activeCount} active workboard${activeCount === 1 ? '' : 's'}`}
          />
          <LauncherButton
            to="/reports"
            icon="📁"
            label="Reports"
            description="Import latest Nuvolo CSV"
          />
        </div>
      </section>

      {/* === Section: Capture === */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">
          Capture
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LauncherButton
            to="/projects"
            icon="📝"
            label="Quick Workboard"
            description="One-tap blank workboard for on-call work"
            state={{ action: 'quick' }}
          />
          <LauncherButton
            to="/projects"
            icon="➕"
            label="New Workboard"
            description="Pick a template for full projects"
            state={{ action: 'new' }}
          />
          <LauncherButton
            to="/projects"
            icon="📅"
            label="Vendor Events"
            description="Fire recurring service notifications"
            state={{ action: 'events' }}
          />
        </div>
      </section>

      {/* === Section: Meeting Prep === */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">
          Meeting Prep
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LauncherButton
            to="/projects"
            icon="👥"
            label="1:1 Manager"
            description={`Export all ${activeCount} workboard${activeCount === 1 ? '' : 's'} merged with Nuvolo data`}
            state={{ action: 'export1on1' }}
          />
        </div>
      </section>

      {/* === Section: Communication === */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-3">
          Communication
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ExternalLauncherButton
            href="onenote:"
            icon="📓"
            label="OneNote"
            description="Open OneNote app"
          />
          <ExternalLauncherButton
            href="https://mail.google.com"
            icon="📧"
            label="Gmail"
            description="Open Gmail"
          />
          <ExternalLauncherButton
            href="https://drive.google.com"
            icon="💾"
            label="Google Drive"
            description="Open Google Drive"
          />
          <ExternalLauncherButton
            href="https://onedrive.live.com"
            icon="☁️"
            label="OneDrive"
            description="Open OneDrive"
          />
        </div>
      </section>
    </div>
  );
}

function LauncherButton({
  to,
  icon,
  label,
  description,
  state,
}: {
  to: string;
  icon: string;
  label: string;
  description?: string;
  state?: any;
}) {
  return (
    <Link
      to={to}
      state={state}
      className="card p-4 hover:border-brand-500 hover:shadow-md transition flex items-start gap-3"
    >
      <span className="text-3xl shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="font-semibold">{label}</div>
        {description && (
          <div className="text-xs text-slate-500 mt-0.5">{description}</div>
        )}
      </div>
    </Link>
  );
}

function ExternalLauncherButton({
  href,
  icon,
  label,
  description,
}: {
  href: string;
  icon: string;
  label: string;
  description?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-4 hover:border-brand-500 hover:shadow-md transition flex items-start gap-3"
    >
      <span className="text-3xl shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="font-semibold flex items-center gap-1.5">
          {label}
          <span className="text-xs text-slate-400">↗</span>
        </div>
        {description && (
          <div className="text-xs text-slate-500 mt-0.5">{description}</div>
        )}
      </div>
    </a>
  );
}
