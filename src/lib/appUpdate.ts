/**
 * Service worker / PWA update plumbing.
 *
 * The Vite PWA config uses `registerType: 'autoUpdate'`, which means
 * `skipWaiting` + `clientsClaim` are baked into the generated SW. When a
 * new build deploys, the browser quietly installs the new SW in the
 * background and immediately makes it the active controller. The currently
 * rendered page, however, still references assets from the *old* bundle
 * — so without an explicit reload the user keeps seeing the old UI.
 *
 * `registerControllerChangeReload()` listens for `controllerchange` (fires
 * when the new SW takes over) and reloads the page once. This is what
 * actually delivers new builds to existing PWA installs without the user
 * having to manually clear caches.
 *
 * `forceAppUpdate()` is the escape hatch when something goes wrong: it
 * unregisters every SW, deletes every Cache Storage entry, and reloads.
 * Wired to a button in Settings so the user always has a way out.
 */

let reloading = false;

export function registerControllerChangeReload(): void {
  if (typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    // Defer slightly so any in-flight click handler that triggered the
    // SW takeover (e.g. Settings → Force update) finishes first.
    window.setTimeout(() => window.location.reload(), 50);
  });
}

export async function forceAppUpdate(): Promise<void> {
  reloading = true;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } finally {
    // Force the browser to bypass its own HTTP cache too.
    // `location.reload(true)` is non-standard / removed in modern specs,
    // so do a cache-busting reload via location.replace.
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
  }
}

/**
 * Build timestamp injected by Vite's `define` config — used in the
 * Layout footer so the user can confirm at a glance which deploy
 * they're looking at. Format: 2026-05-22T12:30:00.000Z.
 */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'dev';
