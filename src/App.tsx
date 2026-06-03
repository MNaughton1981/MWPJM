import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import { useStore } from './state/store';
import { isFolderApiSupported } from './lib/folderConnection';
import {
  DEFAULT_SYNC_FILENAME,
  startAutoSync,
  stopAutoSync,
} from './lib/sync';
import { startExcelDualWrite, stopExcelDualWrite } from './lib/excelSync';

export default function App() {
  // Wire up cross-device state sync. When the user has flipped
  // settings.syncEnabled on AND the browser supports the File System
  // Access API (Chrome / Edge desktop), every change to projects /
  // settings / workOrders writes a JSON snapshot to the connected
  // folder, debounced. Mobile browsers and Safari fall through quietly
  // — the Settings page surfaces the same "Pull from file" path there.
  const syncEnabled = useStore((s) => s.settings.syncEnabled);
  const syncFilename = useStore((s) => s.settings.syncFilename);
  // Dual-write bridge: also mirror every data change into the Excel
  // workbook (MWPJM-Data.xlsx) while the JSON→Excel migration is in
  // progress. Desktop-only; independent of the JSON sync above.
  const dualWriteExcel = useStore((s) => s.settings.dualWriteExcel);

  useEffect(() => {
    if (!syncEnabled) return;
    if (!isFolderApiSupported()) return;
    try {
      startAutoSync(syncFilename || DEFAULT_SYNC_FILENAME);
    } catch (e) {
      // startAutoSync already records the error in store.syncError;
      // the Settings page surfaces it. Nothing to do here.
      void e;
    }
    return () => stopAutoSync();
  }, [syncEnabled, syncFilename]);

  useEffect(() => {
    if (!dualWriteExcel) return;
    if (!isFolderApiSupported()) return;
    try {
      startExcelDualWrite();
    } catch (e) {
      // startExcelDualWrite throws only when the folder API is missing,
      // which we already guarded above; any write error is recorded in
      // store.excelWriteError and surfaced in Settings.
      void e;
    }
    return () => stopExcelDualWrite();
  }, [dualWriteExcel]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
