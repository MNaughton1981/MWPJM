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

/**
 * Workboard mark — header version.
 *
 * Identical artwork to the home-screen icon at public/icon.svg, just
 * inlined here so React doesn't have to do an extra fetch on every
 * page render and the colors stay theme-coordinated with the slate-900
 * header bar. If the public/icon.svg file changes, this should change
 * to match (and vice versa).
 *
 * Concept:
 *   • Slate rounded-square tile (workshop pegboard hanging on the wall)
 *   • Pegboard hole pattern as the back layer
 *   • Bold sky-blue checkmark in the foreground (tracked / done)
 *   • The upper stem of the check terminates in a crescent-wrench head
 *     in amber — turns the generic "check" into a facilities mark
 */
function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 512 512"
      aria-label="Workboard"
    >
      <defs>
        <pattern
          id="hdr-pegboard"
          x="16"
          y="16"
          width="80"
          height="80"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="40" cy="40" r="9" fill="#020617" />
        </pattern>
      </defs>
      <rect width="512" height="512" rx="96" fill="#0f172a" />
      <rect x="48" y="48" width="416" height="416" rx="56" fill="#1e293b" />
      <rect
        x="48"
        y="48"
        width="416"
        height="416"
        rx="56"
        fill="url(#hdr-pegboard)"
      />
      {/* checkmark */}
      <path
        d="M132 282 L220 374 L342 198"
        fill="none"
        stroke="#0ea5e9"
        strokeWidth="48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* crescent wrench head at the top of the up-stroke */}
      <g transform="translate(370 170) rotate(-55)">
        <rect
          x="-30"
          y="-46"
          width="64"
          height="92"
          rx="14"
          fill="#facc15"
          stroke="#0f172a"
          strokeWidth="5"
        />
        <path
          d="M -10 -46 L 18 -46 L 18 -14 L 4 -28 L -10 -14 Z"
          fill="#0f172a"
        />
        <circle
          cx="-30"
          cy="6"
          r="11"
          fill="#facc15"
          stroke="#0f172a"
          strokeWidth="5"
        />
      </g>
    </svg>
  );
}
