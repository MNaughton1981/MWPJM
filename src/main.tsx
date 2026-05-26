import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initPwaUpdates } from './lib/pwaUpdate';

// PWA: subscribe to vite-plugin-pwa's update lifecycle. When a new
// service worker has installed and is waiting, our UpdatePrompt
// component (mounted in Layout) shows a "Reload to update" banner
// instead of silently swapping bundles under the user's feet. The
// previous registerControllerChangeReload wired auto-reload, which
// worked but never told the user *why* the page suddenly refreshed.
initPwaUpdates();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
