import { useSyncExternalStore } from 'react';
import {
  applyPwaUpdate,
  dismissPwaUpdate,
  getPwaUpdateState,
  subscribePwaUpdate,
} from '../lib/pwaUpdate';

/**
 * Floating "new version available" banner. Renders nothing when there
 * isn't an update waiting; pinned to the bottom-right corner above the
 * safe-area inset when there is. Styled to read as a system notification
 * rather than a button — color-coded (sky-tinted), with a clear primary
 * "Reload" action and a secondary "Later" dismiss.
 *
 * Mounted globally in Layout so it's available on every route. The
 * underlying state is a tiny subscribable store (lib/pwaUpdate.ts) so
 * we don't pull a context provider into the tree just for this.
 *
 * Reload action calls applyPwaUpdate(), which in turn calls
 * updateSW(true) from vite-plugin-pwa: the waiting SW claims the
 * client and the page reloads with fresh assets. Local data
 * (projects, photos, settings, drafts) lives in localStorage /
 * IndexedDB and survives the reload.
 */
export default function UpdatePrompt() {
  // useSyncExternalStore is the right primitive here — we're reading
  // an external mutable value and want React to re-render on change.
  // The third arg (server snapshot) is only used during SSR; we have
  // no SSR but it's required by the API.
  const state = useSyncExternalStore(
    subscribePwaUpdate,
    getPwaUpdateState,
    getPwaUpdateState,
  );

  if (!state.needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-40 bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm
                 rounded-lg border border-brand-300 bg-brand-50 text-brand-900
                 shadow-lg p-3 flex items-start gap-3 safe-bottom"
    >
      <span aria-hidden className="text-lg leading-none">
        ↻
      </span>
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-semibold leading-tight">
          New version of Workboard is ready
        </div>
        <p className="text-xs text-brand-800 mt-0.5">
          Reload to pick up the latest. Your projects, photos, and
          composer drafts will stay intact.
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <button
          type="button"
          onClick={() => {
            // Fire-and-forget — applyPwaUpdate() reloads the page on
            // success, so anything queued after the await never runs.
            void applyPwaUpdate();
          }}
          className="btn-primary text-xs px-3 py-1"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={dismissPwaUpdate}
          className="text-[11px] text-brand-700 hover:underline"
          title="Hide for now — we'll prompt again next time you open the app"
        >
          Later
        </button>
      </div>
    </div>
  );
}
