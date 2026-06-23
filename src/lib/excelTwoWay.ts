/**
 * Phase B — two-way Excel sync.
 *
 * Reads MWPJM-Data.xlsx back from the connected folder, RECONCILES it
 * with the current store (per-record last-write-wins, union by id, never
 * destructive), applies the merged result to the store, then writes the
 * merged state back to the workbook.
 *
 * Safety model:
 *   - Reconcile is merge, never replace: a record present on only one
 *     side is always kept; matching records take the newer copy.
 *   - The local JSON store remains the always-on working copy + backup.
 *   - Photos are NOT reconciled through Excel (the Photos sheet is lossy
 *     metadata only) — a matched project keeps its LOCAL photos array;
 *     photo binaries travel via the existing photo-sync path.
 *   - Settings + imported work orders are device-specific and are left
 *     untouched by reconcile (same policy as the JSON sync).
 *   - A best-effort signature re-check (Meta version + timestamp) catches
 *     a concurrent write between our read and write-back and re-merges
 *     once. Even if that misses, the union/LWW merge can't lose data.
 *
 * Desktop-auto / mobile-assisted: the File System Access API is desktop
 * only, so the automatic loop runs on desktop; mobile uses the existing
 * "Send to desktop" / "Load from file" assist.
 */

import type ExcelJS from 'exceljs';
import type {
  Project,
  ActivityEntry,
  Milestone,
  Trade,
  Vendor,
  VendorVisit,
  SavedVendor,
  SavedVendorEvent,
  SavedHost,
  TradeKey,
  TradeStatus,
  ProjectStatus,
} from '../types';
import { useStore } from '../state/store';
import { loadWorkbook } from './excelStorage';
import { migrateToExcel } from './migrateToExcel';

// ── Cell coercion helpers ────────────────────────────────────────────
// ExcelJS cell values can be string | number | boolean | Date | null |
// rich-text / formula objects. Coerce defensively.

type Cell = ExcelJS.CellValue;

function cstr(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  const o = v as unknown as Record<string, unknown>;
  if (typeof o.text === 'string') return o.text;
  if (Array.isArray(o.richText))
    return (o.richText as Array<{ text: string }>).map((r) => r.text).join('');
  if (o.result != null) return String(o.result);
  if (typeof o.hyperlink === 'string') return cstr(o.text as Cell);
  return '';
}

function cnum(v: Cell): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const n = Number(cstr(v));
  return Number.isFinite(n) ? n : undefined;
}

function cbool(v: Cell): boolean {
  if (typeof v === 'boolean') return v;
  const s = cstr(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function cIso(v: Cell): string | undefined {
  if (v == null || v === '') return undefined;
  if (v instanceof Date) return v.toISOString();
  const s = cstr(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : s;
}

// ── Header-mapped row reading ────────────────────────────────────────
// A loaded workbook doesn't restore the column `key`s we set when
// building it, so we map by the header row (row 1) instead.

type Row = Record<string, Cell>;

function readRows(
  workbook: ExcelJS.Workbook,
  sheetName: string,
): Row[] {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const headers: Record<number, string> = {};
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, col) => {
    const h = cstr(cell.value).trim();
    if (h) headers[col] = h;
  });
  const rows: Row[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Row = {};
    let any = false;
    row.eachCell((cell, col) => {
      const h = headers[col];
      if (h) {
        obj[h] = cell.value;
        if (cell.value != null && cell.value !== '') any = true;
      }
    });
    if (any) rows.push(obj);
  });
  return rows;
}

export interface ParsedExcelState {
  /** Meta signature used for the concurrent-write re-check. */
  signature: string;
  projects: Project[];
  savedVendors: SavedVendor[];
  savedVendorEvents: SavedVendorEvent[];
  savedHosts: SavedHost[];
}

function metaSignature(workbook: ExcelJS.Workbook): string {
  const meta = readRows(workbook, 'Meta');
  const ver = meta.find((r) => cstr(r['Key']) === 'version');
  const version = ver ? cnum(ver['Value']) ?? 0 : 0;
  const updatedAt = ver ? cstr(ver['UpdatedAt']) : '';
  return `${version}:${updatedAt}`;
}

/** Parse the whole workbook into reconcilable state (photos excluded). */
export function parseWorkbook(workbook: ExcelJS.Workbook): ParsedExcelState {
  // Group child rows by their parent id for O(1) attach.
  const activityByProject = new Map<string, ActivityEntry[]>();
  for (const r of readRows(workbook, 'Activity')) {
    const pid = cstr(r['ProjectID']);
    if (!pid) continue;
    const list = activityByProject.get(pid) ?? [];
    list.push({
      id: cstr(r['ID']),
      timestamp: cIso(r['Timestamp']) ?? new Date().toISOString(),
      text: cstr(r['Text']),
      postedToNuvolo: cbool(r['PostedToNuvolo']),
      author: cstr(r['Author']) || undefined,
    });
    activityByProject.set(pid, list);
  }

  const milestonesByProject = new Map<string, Milestone[]>();
  for (const r of readRows(workbook, 'Milestones')) {
    const pid = cstr(r['ProjectID']);
    if (!pid) continue;
    const list = milestonesByProject.get(pid) ?? [];
    list.push({
      id: cstr(r['ID']),
      title: cstr(r['Title']),
      date: cstr(r['Date']) || undefined,
      done: cbool(r['Done']),
      trade: (cstr(r['Trade']) as TradeKey) || undefined,
      notes: cstr(r['Notes']) || undefined,
    });
    milestonesByProject.set(pid, list);
  }

  const tradesByProject = new Map<string, Trade[]>();
  for (const r of readRows(workbook, 'Trades')) {
    const pid = cstr(r['ProjectID']);
    if (!pid) continue;
    const list = tradesByProject.get(pid) ?? [];
    list.push({
      id: cstr(r['ID']),
      key: (cstr(r['Key']) as TradeKey) || 'other',
      label: cstr(r['Label']),
      contact: cstr(r['Contact']) || undefined,
      phone: cstr(r['Phone']) || undefined,
      status: (cstr(r['Status']) as TradeStatus) || 'not_scheduled',
      scheduledDate: cstr(r['ScheduledDate']) || undefined,
      notes: cstr(r['Notes']) || undefined,
    });
    tradesByProject.set(pid, list);
  }

  // Visits grouped by vendor id (relational VendorVisits sheet).
  const visitsByVendor = new Map<string, VendorVisit[]>();
  for (const r of readRows(workbook, 'VendorVisits')) {
    const vid = cstr(r['VendorID']);
    if (!vid) continue;
    const list = visitsByVendor.get(vid) ?? [];
    list.push({
      id: cstr(r['ID']) || `${vid}-v${list.length + 1}`,
      date: cstr(r['Date']) || undefined,
      endDate: cstr(r['EndDate']) || undefined,
      time: cstr(r['Time']) || undefined,
    });
    visitsByVendor.set(vid, list);
  }

  const vendorsByProject = new Map<string, Vendor[]>();
  for (const r of readRows(workbook, 'Vendors')) {
    const pid = cstr(r['ProjectID']);
    if (!pid) continue;
    const id = cstr(r['ID']);
    const visits = visitsByVendor.get(id);
    const list = vendorsByProject.get(pid) ?? [];
    list.push({
      id,
      name: cstr(r['Name']),
      company: cstr(r['Vendor'] ?? r['Company']) || undefined,
      role: cstr(r['Role']) || undefined,
      purpose: cstr(r['Purpose']) || undefined,
      phone: cstr(r['Phone']) || undefined,
      email: cstr(r['Email']) || undefined,
      host: cstr(r['Host']) || undefined,
      hostEmail: cstr(r['HostEmail']) || undefined,
      visitDate: cstr(r['VisitDate']) || undefined,
      visitTime: cstr(r['VisitTime']) || undefined,
      isPrimaryContact: cbool(r['IsPrimaryContact']) || undefined,
      notes: cstr(r['Notes']) || undefined,
      ...(visits && visits.length ? { visits } : {}),
    });
    vendorsByProject.set(pid, list);
  }

  const projects: Project[] = readRows(workbook, 'Projects').map((r) => {
    const id = cstr(r['ID']);
    return {
      id,
      name: cstr(r['Name']),
      status: (cstr(r['Status']) as ProjectStatus) || 'in_progress',
      workOrderId: cstr(r['WorkOrderID']) || undefined,
      location: cstr(r['Location']) || undefined,
      description: cstr(r['Description']) || undefined,
      createdAt: cIso(r['CreatedAt']) ?? new Date().toISOString(),
      updatedAt: cIso(r['UpdatedAt']) ?? new Date().toISOString(),
      archivedAt: cnum(r['ArchivedAt']),
      pinnedAt: cnum(r['PinnedAt']),
      trades: tradesByProject.get(id) ?? [],
      milestones: milestonesByProject.get(id) ?? [],
      activity: activityByProject.get(id) ?? [],
      vendors: vendorsByProject.get(id) ?? [],
      // Photos are intentionally not parsed from Excel (lossy); a matched
      // project keeps its local photos, an Excel-only project starts with
      // none and receives them via the photo-sync path.
      photos: [],
    };
  });

  const savedVendors: SavedVendor[] = readRows(workbook, 'SavedVendors').map(
    (r) => {
      const purposesRaw = cstr(r['Purposes']);
      const purposes = purposesRaw
        ? purposesRaw
            .split(';')
            .map((p) => p.trim())
            .filter(Boolean)
        : [];
      return {
        id: cstr(r['ID']),
        name: cstr(r['Name']),
        company: cstr(r['Company']) || undefined,
        role: cstr(r['Role']) || undefined,
        phone: cstr(r['Phone']) || undefined,
        email: cstr(r['Email']) || undefined,
        generalNotes: cstr(r['GeneralNotes']) || undefined,
        ...(purposes.length ? { purposes } : {}),
        updatedAt: cnum(r['UpdatedAt']),
      };
    },
  );

  const savedHosts: SavedHost[] = readRows(workbook, 'SavedHosts').map((r) => ({
    id: cstr(r['ID']),
    name: cstr(r['Name']),
    email: cstr(r['Email']) || undefined,
    updatedAt: cnum(r['UpdatedAt']),
  }));

  const savedVendorEvents: SavedVendorEvent[] = readRows(
    workbook,
    'SavedVendorEvents',
  ).map((r) => ({
    id: cstr(r['ID']),
    name: cstr(r['Name']),
    cadence: cstr(r['Cadence']) || undefined,
    vendorName: cstr(r['VendorName']) || undefined,
    vendorCompany: cstr(r['VendorCompany']) || undefined,
    vendorRole: cstr(r['VendorRole']) || undefined,
    vendorPhone: cstr(r['VendorPhone']) || undefined,
    vendorEmail: cstr(r['VendorEmail']) || undefined,
    serviceDescription: cstr(r['ServiceDescription']) || undefined,
    defaultVisitNotes: cstr(r['DefaultVisitNotes']) || undefined,
    createdAt: cnum(r['CreatedAt']) ?? Date.now(),
    updatedAt: cnum(r['UpdatedAt']) ?? Date.now(),
  }));

  return {
    signature: metaSignature(workbook),
    projects,
    savedVendors,
    savedVendorEvents,
    savedHosts,
  };
}

// ── Reconcile ────────────────────────────────────────────────────────

export interface ReconcileResult {
  projects: Project[];
  savedVendors: SavedVendor[];
  savedVendorEvents: SavedVendorEvent[];
  savedHosts: SavedHost[];
  summary: {
    projectsAdded: number;
    projectsUpdated: number;
    vendorsAdded: number;
    vendorsUpdated: number;
    hostsAdded: number;
    hostsUpdated: number;
    eventsAdded: number;
    eventsUpdated: number;
  };
}

/** Per-record last-write-wins union for the global book lists. */
function mergeBooks<T extends { id: string; updatedAt?: number }>(
  local: T[],
  incoming: T[],
): { merged: T[]; added: number; updated: number } {
  const byId = new Map(local.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, inc);
      added++;
    } else if ((inc.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
      byId.set(inc.id, inc);
      updated++;
    }
  }
  return { merged: [...byId.values()], added, updated };
}

/**
 * Merge the parsed Excel state into the local store state. Projects
 * reconcile at the board level by `updatedAt` (the whole board incl.
 * vendors/visits is the unit); a matched project keeps its LOCAL photos.
 * The global books reconcile per record.
 */
export function reconcile(
  local: {
    projects: Project[];
    savedVendors: SavedVendor[];
    savedVendorEvents: SavedVendorEvent[];
    savedHosts: SavedHost[];
  },
  parsed: ParsedExcelState,
): ReconcileResult {
  const byId = new Map(local.projects.map((p) => [p.id, p]));
  let projectsAdded = 0;
  let projectsUpdated = 0;
  for (const ep of parsed.projects) {
    const lp = byId.get(ep.id);
    if (!lp) {
      byId.set(ep.id, ep);
      projectsAdded++;
      continue;
    }
    const eNewer = (Date.parse(ep.updatedAt) || 0) > (Date.parse(lp.updatedAt) || 0);
    if (eNewer) {
      // Excel wins on the board fields, but keep local photos (Excel's
      // photo data is lossy/empty).
      byId.set(ep.id, { ...ep, photos: lp.photos ?? [] });
      projectsUpdated++;
    }
    // else local is newer/equal — keep local as-is.
  }

  const v = mergeBooks(local.savedVendors, parsed.savedVendors);
  const h = mergeBooks(local.savedHosts, parsed.savedHosts);
  const e = mergeBooks(local.savedVendorEvents, parsed.savedVendorEvents);

  return {
    projects: [...byId.values()],
    savedVendors: v.merged,
    savedVendorEvents: e.merged,
    savedHosts: h.merged,
    summary: {
      projectsAdded,
      projectsUpdated,
      vendorsAdded: v.added,
      vendorsUpdated: v.updated,
      hostsAdded: h.added,
      hostsUpdated: h.updated,
      eventsAdded: e.added,
      eventsUpdated: e.updated,
    },
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────

export interface TwoWaySyncResult {
  status: 'created' | 'synced' | 'no-folder' | 'error';
  message: string;
  summary?: ReconcileResult['summary'];
}

function summarize(s: ReconcileResult['summary']): string {
  const parts: string[] = [];
  const board = s.projectsAdded + s.projectsUpdated;
  if (board)
    parts.push(`${s.projectsAdded} new / ${s.projectsUpdated} updated workboard(s)`);
  const books =
    s.vendorsAdded +
    s.vendorsUpdated +
    s.hostsAdded +
    s.hostsUpdated +
    s.eventsAdded +
    s.eventsUpdated;
  if (books) parts.push(`${books} book entr(ies) merged in`);
  return parts.length ? `Pulled ${parts.join(', ')}.` : 'Already in sync.';
}

/**
 * Two-way sync against the workbook in the connected folder:
 * read → reconcile → apply → write back. On first run (no file) it
 * writes the current state out. Best-effort one-shot re-merge if the
 * file changed between our read and write-back.
 */
export async function syncWithExcel(): Promise<TwoWaySyncResult> {
  try {
    const workbook = await loadWorkbook();
    if (!workbook) {
      // First run on this folder — write the current state out.
      const res = await migrateToExcel();
      return res.success
        ? { status: 'created', message: 'Created MWPJM-Data.xlsx from this device.' }
        : { status: 'error', message: res.message };
    }

    const parsed = parseWorkbook(workbook);
    const store = useStore.getState();
    const reconciled = reconcile(
      {
        projects: store.projects,
        savedVendors: store.savedVendors,
        savedVendorEvents: store.savedVendorEvents,
        savedHosts: store.savedHosts,
      },
      parsed,
    );
    store.applyReconciledState({
      projects: reconciled.projects,
      savedVendors: reconciled.savedVendors,
      savedVendorEvents: reconciled.savedVendorEvents,
      savedHosts: reconciled.savedHosts,
    });

    // Concurrent-write re-check: if the file changed since we read it,
    // re-merge the newer copy once before writing (union/LWW keeps this
    // safe even on the rare miss).
    const recheck = await loadWorkbook();
    if (recheck && metaSignature(recheck) !== parsed.signature) {
      const parsed2 = parseWorkbook(recheck);
      const s2 = useStore.getState();
      const reconciled2 = reconcile(
        {
          projects: s2.projects,
          savedVendors: s2.savedVendors,
          savedVendorEvents: s2.savedVendorEvents,
          savedHosts: s2.savedHosts,
        },
        parsed2,
      );
      s2.applyReconciledState({
        projects: reconciled2.projects,
        savedVendors: reconciled2.savedVendors,
        savedVendorEvents: reconciled2.savedVendorEvents,
        savedHosts: reconciled2.savedHosts,
      });
    }

    // Write the merged store state back to the workbook.
    const writeRes = await migrateToExcel();
    if (!writeRes.success) {
      return { status: 'error', message: writeRes.message };
    }

    return {
      status: 'synced',
      message: summarize(reconciled.summary),
      summary: reconciled.summary,
    };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}
