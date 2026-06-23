import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Resolve the short git commit the bundle is built from. This is the
// definitive "which code am I running?" marker — the user can compare
// it against the latest commit on `main` in GitHub to confirm a device
// is on the newest deploy (a stale cached PWA will show an older hash).
//
// Falls back to the CI-provided commit SHA, then to 'dev', so the build
// never fails just because git isn't available in the build sandbox.
function resolveBuildCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    const ci = process.env.GITHUB_SHA;
    return ci ? ci.slice(0, 7) : 'dev';
  }
}

// GitHub Pages deploys at https://<user>.github.io/MWPJM/
export default defineConfig({
  base: '/MWPJM/',
  // Surface the build timestamp + commit in the bundle so the Layout
  // footer can show them. Lets the user verify at a glance whether
  // they're on the latest deploy or a stale cached one.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify(resolveBuildCommit()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (was 'autoUpdate'): when a new build is available the
      // browser still installs the updated SW in the background, but
      // doesn't auto-claim and reload. The app surfaces the "new
      // version available" banner from src/components/UpdatePrompt.tsx
      // and the user clicks Reload when it's safe (i.e. they aren't
      // mid-typing into a form). Trades the "always silently up to
      // date" property for "users notice + control when an update
      // happens", which the user explicitly asked for.
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Workboard — Facilities Project Manager',
        short_name: 'Workboard',
        description:
          'Lean project manager for facilities technicians and engineers, with Nuvolo work order email integration.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/MWPJM/',
        scope: '/MWPJM/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/MWPJM/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Keep the heavy ExcelJS chunk (~940 KB) OUT of the install-time
        // precache so mobile installs stay lean. It's only needed when
        // the user runs the Excel migration / sync. The runtimeCaching
        // rule below caches it on first use so offline still works after.
        globIgnores: ['**/exceljs*.js'],
        runtimeCaching: [
          {
            urlPattern: /exceljs.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'exceljs-lib',
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 60 * 60 * 24 * 90, // 90 days
              },
            },
          },
        ],
      },
    }),
  ],
});
