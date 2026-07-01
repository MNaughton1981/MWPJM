import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initPwaUpdates } from './lib/pwaUpdate';
import { getMsal } from './lib/graphAuth';

// PWA: subscribe to vite-plugin-pwa's update lifecycle. When a new
// service worker has installed and is waiting, our UpdatePrompt
// component (mounted in Layout) shows a "Reload to update" banner
// instead of silently swapping bundles under the user's feet. The
// previous registerControllerChangeReload wired auto-reload, which
// worked but never told the user *why* the page suddenly refreshed.
initPwaUpdates();

function mount() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  );
}

// Initialize MSAL (which also consumes any returning sign-in redirect
// via handleRedirectPromise) BEFORE mounting the router. This stops the
// HashRouter from treating the `#code=...` auth response in the return
// URL as an app route. We mount regardless of success/failure so a
// Graph/auth hiccup can never block the whole app from loading.
getMsal()
  .catch(() => undefined)
  .finally(mount);
