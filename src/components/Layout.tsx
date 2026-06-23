import { NavLink, Outlet } from 'react-router-dom';
import { BUILD_TIME, BUILD_COMMIT } from '../lib/appUpdate';
import UpdatePrompt from './UpdatePrompt';

// Primary nav items. Settings moved to gear icon in header.
const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/projects', label: 'Workboards' },
  { to: '/reports', label: 'Reports' },
];

export default function Layout() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="safe-top bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
          <NavLink to="/" className="flex items-center gap-2 shrink-0">
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
          {/* Settings as gear icon */}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `p-2 rounded-md shrink-0 ${
                isActive ? 'bg-white/10' : 'hover:bg-white/5'
              }`
            }
            title="Settings"
            aria-label="Settings"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </NavLink>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5 safe-bottom">
        <Outlet />
      </main>

      <footer className="text-center text-xs text-slate-400 py-4 safe-bottom space-y-1">
        <div>Workboard · Local-first · Posts to Nuvolo via your email client</div>
        <div className="font-mono text-[10px] text-slate-400">
          {formatBuildStamp()}
        </div>
      </footer>

      {/* Floating "new version available" banner. Renders nothing
          when there's no waiting service worker; pinned bottom-right
          (full-width on mobile) when there is. Mounted globally so
          it shows on every route. */}
      <UpdatePrompt />
    </div>
  );
}

/**
 * Build the footer version stamp: short commit hash + a readable UTC
 * build date. The commit is the part that matters for "is this device
 * on the latest code?" — the user compares it to the head commit on
 * `main` in GitHub. The date is a friendlier secondary cue.
 *
 * Renders e.g. "Build 1a2b3c4 · 2026-06-22 14:30 UTC". Falls back
 * gracefully to just the timestamp when the commit is unknown ('dev').
 */
function formatBuildStamp(): string {
  let when = BUILD_TIME;
  const parsed = new Date(BUILD_TIME);
  if (!Number.isNaN(parsed.getTime())) {
    // YYYY-MM-DD HH:MM UTC — compact and unambiguous across devices.
    when = `${parsed.toISOString().slice(0, 10)} ${parsed
      .toISOString()
      .slice(11, 16)} UTC`;
  }
  return BUILD_COMMIT && BUILD_COMMIT !== 'dev'
    ? `Build ${BUILD_COMMIT} · ${when}`
    : `Build ${when}`;
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
 *   • Slate rounded-square tile (the dark home-screen surface)
 *   • Medium-gray inset plate (the workshop pegboard itself)
 *   • Dark holes punched through the plate, in a regular grid
 *   • Bold sky-blue checkmark on top — tracked / done
 *
 * The earlier iteration had a crescent-wrench head terminating the
 * upper stem of the check. It didn't read at small sizes and the
 * darker pegboard plate hid the holes. Both fixed here.
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
          <circle cx="40" cy="40" r="14" fill="#0f172a" />
        </pattern>
      </defs>
      {/* outer dark frame */}
      <rect width="512" height="512" rx="96" fill="#0f172a" />
      {/* medium-gray pegboard plate — slate-500, light enough that the
          dark slate-900 holes have visible contrast */}
      <rect x="48" y="48" width="416" height="416" rx="56" fill="#64748b" />
      {/* perforations */}
      <rect
        x="48"
        y="48"
        width="416"
        height="416"
        rx="56"
        fill="url(#hdr-pegboard)"
      />
      {/* clean checkmark on top */}
      <path
        d="M112 282 L224 388 L408 148"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="60"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
