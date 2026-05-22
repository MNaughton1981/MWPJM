import { NavLink, Outlet } from 'react-router-dom';
import { BUILD_TIME } from '../lib/appUpdate';

const NAV_ITEMS = [
  { to: '/projects', label: 'Projects' },
  { to: '/dashboard', label: 'Dashboard' },
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
              <div className="font-semibold leading-none">MWPJM</div>
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
        <div>MWPJM · Local-first · Posts to Nuvolo via your email client</div>
        <div className="font-mono text-[10px] text-slate-300">
          Build {BUILD_TIME}
        </div>
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 512 512" aria-hidden>
      <rect width="512" height="512" rx="96" fill="#0f172a" />
      <rect
        x="112"
        y="128"
        width="288"
        height="256"
        rx="16"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="22"
      />
      <line
        x1="112"
        y1="192"
        x2="400"
        y2="192"
        stroke="#38bdf8"
        strokeWidth="22"
      />
      <path
        d="M180 250 l40 50 l112 -120"
        fill="none"
        stroke="#facc15"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
