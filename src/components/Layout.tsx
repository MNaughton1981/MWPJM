import { NavLink, Outlet } from 'react-router-dom';
import { BUILD_TIME } from '../lib/appUpdate';

// Nav labels:
//   /dashboard → "Dashboard"  (read-only view of the imported Nuvolo CSV)
//   /projects  → "Workboards" (the list of personal workboards)
// Routes are kept as-is to avoid invalidating bookmarks / PWA shortcuts.
// Order intentionally puts Dashboard first because that's the daily
// "what's open?" pane; Workboards is where you go *after* picking
// something off the dashboard or hitting Quick Workboard.
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/projects', label: 'Workboards' },
  { to: '/reports', label: 'Reports' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="safe-top bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
          <NavLink to="/projects" className="flex items-center gap-2 shrink-0">
            <Logo />
            {/* Hide the wordmark on small screens to give the nav room */}
            <div className="hidden sm:block">
              <div className="font-semibold leading-none tracking-tight">
                Workboard
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Facilities Project Manager
              </div>
            </div>
          </NavLink>
          <nav className="flex items-center gap-0.5 sm:gap-1 text-xs sm:text-sm ml-auto overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-2 sm:px-3 py-1.5 rounded-md whitespace-nowrap ${
                    isActive ? 'bg-white/10' : 'hover:bg-white/5'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5 safe-bottom">
        <Outlet />
      </main>

      <footer className="text-center text-xs text-slate-400 py-4 safe-bottom space-y-1">
        <div>Workboard · Local-first · Posts to Nuvolo via your email client</div>
        <div className="font-mono text-[10px] text-slate-300">
          Build {BUILD_TIME}
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  // Workboard mark: bold sky-blue "W" formed by two upward chevrons
  // inside a slate rounded square, with an amber dot pinned to the
  // central peak. The W reads as "Workboard" and the chevrons read as
  // "checked / done" — meaningful at favicon size and at full app-tile
  // size. Kept on the existing palette (slate / sky / amber) so the
  // header chrome stays cohesive with the rest of the UI.
  return (
    <svg width="28" height="28" viewBox="0 0 512 512" aria-label="Workboard">
      <rect width="512" height="512" rx="96" fill="#0f172a" />
      {/* inner board frame for depth (very subtle) */}
      <rect
        x="64"
        y="64"
        width="384"
        height="384"
        rx="56"
        fill="none"
        stroke="#1e293b"
        strokeWidth="6"
      />
      {/* the W itself — a single stroked path tracing top-left → first
          valley → central peak → second valley → top-right */}
      <path
        d="M112 168 L196 344 L256 232 L316 344 L400 168"
        fill="none"
        stroke="#0ea5e9"
        strokeWidth="44"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* amber accent dot at the central peak */}
      <circle cx="256" cy="232" r="22" fill="#facc15" />
    </svg>
  );
}
