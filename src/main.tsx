import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { registerControllerChangeReload } from './lib/appUpdate';

// Reload the page automatically when a freshly-deployed service worker
// takes over (autoUpdate fires `controllerchange`). Without this, the
// new SW activates silently but the user keeps seeing the old bundle
// until they manually hard-refresh.
registerControllerChangeReload();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
