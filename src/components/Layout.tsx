import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="safe-top bg-slate-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <NavLink to="/projects" className="flex items-center gap-2">
            <Logo />
            <div>
              <div className="font-semibold leading-none">MWPJM</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                Facilities Project Manager
              </div>
            </div>
          </NavLink>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink
              to="/projects"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md ${
                  isActive ? 'bg-white/10' : 'hover:bg-white/5'
                }`
              }
            >
              Projects
            </NavLink>
            <NavLink
              to="/dashboard"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md ${
                  isActive ? 'bg-white/10' : 'hover:bg-white/5'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md ${
                  isActive ? 'bg-white/10' : 'hover:bg-white/5'
                }`
              }
            >
              Settings
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5 safe-bottom">
        <Outlet />
      </main>

      <footer className="text-center text-xs text-slate-400 py-4 safe-bottom">
        MWPJM · Local-first · Posts to Nuvolo via your email client
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
