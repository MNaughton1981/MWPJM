import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages deploys at https://<user>.github.io/MWPJM/
export default defineConfig({
  base: '/MWPJM/',
  // Surface the build timestamp in the bundle so the Layout footer can
  // show it. Lets the user verify at a glance whether they're on the
  // latest deploy or a stale cached one.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'MWPJM — Facilities Project Manager',
        short_name: 'MWPJM',
        description:
          'Lean project manager for facilities technicians with Nuvolo work order email integration.',
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
      },
    }),
  ],
});
