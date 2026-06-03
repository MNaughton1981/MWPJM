/**
 * Excel dual-write — the short-lived bridge during the JSON→Excel
 * migration.
 *
 * While `settings.dualWriteExcel` is on (desktop only), every change to
 * the data model also writes the full Excel workbook (MWPJM-Data.xlsx)
 * into the connected folder, debounced. The app's primary store is still
 * zustand + localStorage (and the JSON sync file via lib/sync.ts); this
 * just keeps the workbook a *live mirror* so it can be trusted before we
 * cut over to Excel-only (Phase 3) and retire this module.
 *
 * Design notes:
 *   - We reuse migrateToExcel() as the snapshot writer: it rebuilds the
 *     whole workbook from current store state and saves it. Rebuilding
 *     everything on each (debounced) change is heavier than incremental
 *     row updates, but it's dead simple and correct — appropriate for a
 *     bridge that's meant to live for a weekend, not forever.
 *   - An in-flight guard serializes writes so two debounced flushes can
 *     never write the same file concurrently (which could corrupt it).
 *     A trailing re-write captures the latest state if changes arrive
 *     mid-write.
 *   - All failures are recorded in store.excelWriteError (surfaced in
 *     Settings) rather than thrown. The most common cause is the user
 *     having the workbook open in Excel — Windows locks it and the write
 *     fails until they close it.
 */

import { useStore } from '../state/store';
import { isFolderApiSupported } from './folderConnection';
import { migrateToExcel } from './migrateToExcel';

let writing = false;
let rewriteQueued = false;

/**
 * Write the current store state to MWPJM-Data.xlsx now. Serialized via
 * an in-flight guard: if a write is already running, the request is
 * coalesced into a single trailing re-write so the file ends up
 * reflecting the latest state without overlapping writes.
 */
export async function writeExcelNow(): Promise<void> {
  if (writing) {
    rewriteQueued = true;
    return;
  }
  writing = true;
  try {
    do {
      rewriteQueued = false;
      const result = await migrateToExcel();
      if (result.success) {
        useStore.setState({
          lastExcelWriteAt: new Date().toISOString(),
          excelWriteError: null,
        });
      } else {
        useStore.setState({
          excelWriteError: result.error ?? result.message,
        });
      }
    } while (rewriteQueued);
  } finally {
    writing = false;
  }
}

// ---------- Auto dual-write subscription ----------

let stopFn: (() => void) | null = null;

/**
 * Subscribe to the store and write the Excel workbook whenever the data
 * model changes, debounced. Mirrors lib/sync.ts's startAutoSync. Writes
 * once immediately on start so the file exists/refreshes even if the
 * user makes no further edits this session.
 *
 * Throws if the File System Access API isn't available (mobile / Safari)
 * — callers should feature-detect first (App.tsx does).
 */
export function startExcelDualWrite(debounceMs = 3000): () => void {
  if (!isFolderApiSupported()) {
    throw new Error(
      'Dual-write requires a Chromium-based browser on desktop (Chrome / Edge).',
    );
  }

  // Replace any existing subscription if start is called again.
  stopExcelDualWrite();

  let timer: number | null = null;

  // Immediate write so the workbook reflects current state right away.
  writeExcelNow().catch(() => {
    // Error already recorded in store.excelWriteError.
  });

  const unsubscribe = useStore.subscribe((state, prev) => {
    // Only the persisted data slices should trigger a re-write. Ignore
    // our own lastExcelWriteAt / excelWriteError updates (and sync's
    // lastSyncedAt / syncError) so we don't loop.
    const dataUnchanged =
      state.projects === prev.projects &&
      state.settings === prev.settings &&
      state.workOrders === prev.workOrders &&
      state.meetingNotesOrders === prev.meetingNotesOrders &&
      state.savedVendors === prev.savedVendors &&
      state.savedVendorEvents === prev.savedVendorEvents;
    if (dataUnchanged) return;

    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      writeExcelNow().catch(() => {
        // Error already recorded; nothing else to do.
      });
    }, debounceMs);
  });

  stopFn = () => {
    unsubscribe();
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  return stopFn;
}

export function stopExcelDualWrite(): void {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
}
