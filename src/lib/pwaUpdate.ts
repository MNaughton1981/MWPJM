/**
 * PWA update plumbing.
 *
 * Wires the vite-plugin-pwa "prompt" registration into a tiny
 * subscribable store so any component can render a banner, toast, or
 * Settings status when a fresh deploy is sitting in `waiting`.
 *
 * Why a custom store instead of useRegisterSW from the plugin's React
 * helper: the React helper pulls in extra runtime that we don't need,
 * and we already have zustand handy. A 30-line subscribable is enough.
 *
 * Lifecycle:
 *   1. registerSW() runs once at app startup (called from main.tsx).
 *   2. The browser checks for an updated SW on every page load AND on
 *      every visibilityState transition we trigger via update().
 *   3. When the new SW finishes installing it sits in `waiting` —
 *      onNeedRefresh fires; we flip needRefresh -> true.
 *   4. The user sees the banner and clicks Reload -> we call
 *      updateSW(true) -> SW skipWaiting() + clientsClaim(), the new
 *      SW takes over, the page reloads with fresh assets.
 *
 * If the user dismisses the banner ("Later"), needRefresh goes back
 * to false but the SW is still waiting — we'll prompt again on the
 * next visibility flip / next checkForUpdate() call.
 */
import { registerSW } from 'virtual:pwa-register';

type Listener = () => void;

interface PwaUpdateState {
  needRefresh: boolean;
  offlineReady: boolean;
}

let state: PwaUpdateState = {
  needRefresh: false,
  offlineReady: false,
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<PwaUpdateState>) {
  const next = { ...state, ...patch };
  // Skip the emit when nothing changed — avoids re-rendering every
  // subscriber on no-op updates.
  if (
    next.needRefresh === state.needRefresh &&
    next.offlineReady === state.offlineReady
  ) {
    return;
  }
  state = next;
  emit();
}

/**
 * Subscribe to update-state changes. Returns an unsubscribe function.
 * Designed to plug straight into React's `useSyncExternalStore`.
 */
export function subscribePwaUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaUpdateState(): PwaUpdateState {
  return state;
}

/**
 * Apply the waiting service worker and reload. No-op if there isn't
 * one waiting — safe to wire up to a button that's always rendered.
 *
 * The `true` argument tells vite-plugin-pwa to also call reload() on
 * the page once the new SW has claimed the client. Without it the
 * user would have to manually refresh to actually load the new bundle.
 */
let updateSWImpl: ((reload?: boolean) => Promise<void>) | null = null;

export async function applyPwaUpdate(): Promise<void> {
  if (!updateSWImpl) return;
  await updateSWImpl(true);
}

/**
 * Dismiss the banner without applying. The waiting SW stays put;
 * onNeedRefresh will fire again on the next page visit if it's still
 * pending. Kept separate from applyPwaUpdate so the user can choose
 * to defer (mid-typing, on a flaky connection, etc.).
 */
export function dismissPwaUpdate(): void {
  setState({ needRefresh: false });
}

/**
 * Boot the SW lifecycle wiring. Call once at app startup. Safe to
 * call multiple times — registerSW itself is idempotent and the
 * subscribable store guards against duplicate emits.
 */
export function initPwaUpdates(): void {
  if (typeof window === 'undefined') return;
  // registerSW returns a function that, when called, applies the
  // waiting SW. Stash it so applyPwaUpdate() can use it later.
  updateSWImpl = registerSW({
    onNeedRefresh() {
      setState({ needRefresh: true });
    },
    onOfflineReady() {
      setState({ offlineReady: true });
    },
    onRegisterError(error: unknown) {
      // Don't blow up the app on SW registration failure — log and
      // keep going. Common causes: served over plain HTTP in dev,
      // browser doesn't support service workers, ad blockers.
      // eslint-disable-next-line no-console
      console.warn('[pwa] service worker registration failed', error);
    },
  });
}
