/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected at build time by `define` in vite.config.ts.
// Surfaced via BUILD_TIME in src/lib/appUpdate.ts.
declare const __BUILD_TIME__: string;
