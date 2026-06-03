/**
 * Excel-based data storage layer.
 *
 * Provides read/write operations for the MWPJM-Data.xlsx workbook stored
 * in the connected OneDrive folder. See docs/EXCEL_SCHEMA.md for the
 * complete schema definition.
 *
 * Architecture:
 *   - Each table = one Excel sheet (Projects, Activity, etc.)
 *   - Primary keys are TEXT (e.g., "proj-abc123", "act-001")
 *   - Foreign keys reference parent IDs
 *   - Complex types (Settings values, WorkOrder extras) stored as JSON strings
 *
 * Migration path:
 *   Phase 1: Dual-write (JSON + Excel) for safety
 *   Phase 2: Excel-only reads/writes
 *   Phase 3: Remove JSON persistence
 */

import type ExcelJS from 'exceljs';
import type {
  Project,
  ActivityEntry,
  Milestone,
  Trade,
  Vendor,
  ProjectPhoto,
  Settings,
  SavedVendor,
  SavedVendorEvent,
} from '../types';
import type { ImportedWorkOrders } from './workOrderCsv';
import {
  readFileFromFolder,
  writeFileToFolder,
} from './folderConnection';

export const EXCEL_FILENAME = 'MWPJM-Data.xlsx';

/**
 * Lazy-load the ExcelJS library. It's ~950 KB minified, so we keep it
 * out of the main app bundle and only fetch it the first time the user
 * actually touches Excel (migration, read, or write). Subsequent calls
 * reuse the already-loaded module via the dynamic import cache.
 */
async function getExcelJS(): Promise<typeof ExcelJS> {
  const mod = await import('exceljs');
  // Some bundler/interop combos nest the default export; handle both.
  return (mod as unknown as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS);
}

// ========== Workbook Management ==========

/**
 * Load the Excel workbook from the connected OneDrive folder.
 * Returns null if the file doesn't exist yet (first run).
 */
export async function loadWorkbook(): Promise<ExcelJS.Workbook | null> {
  try {
    const file = await readFileFromFolder(EXCEL_FILENAME);
    if (!file) return null;
    const buffer = await file.arrayBuffer();
    const ExcelJSLib = await getExcelJS();
    const workbook = new ExcelJSLib.Workbook();
    await workbook.xlsx.load(buffer);
    return workbook;
  } catch (e) {
    console.error('Failed to load Excel workbook:', e);
    throw new Error(`Failed to load ${EXCEL_FILENAME}: ${(e as Error).message}`);
  }
}

/**
 * Save the workbook back to the connected OneDrive folder.
 * Increments the version number in the Meta sheet to detect conflicts.
 */
export async function saveWorkbook(workbook: ExcelJS.Workbook): Promise<void> {
  try {
    // Increment version for conflict detection
    const meta = workbook.getWorksheet('Meta');
    if (meta) {
      const versionRow = meta.getRow(2); // Row 1 is header, row 2 is "version"
      const currentVersion = (versionRow.getCell(2).value as number) || 0;
      versionRow.getCell(2).value = currentVersion + 1;
      versionRow.getCell(3).value = new Date(); // UpdatedAt
      versionRow.commit();
    }

    const buffer = await workbook.xlsx.writeBuffer();
    // Convert ArrayBuffer to Uint8Array for writeFileToFolder
    const uint8Array = new Uint8Array(buffer as ArrayBuffer);
    await writeFileToFolder(EXCEL_FILENAME, uint8Array);
  } catch (e) {
    console.error('Failed to save Excel workbook:', e);
    throw new Error(`Failed to save ${EXCEL_FILENAME}: ${(e as Error).message}`);
  }
}

/**
 * Create a new blank workbook with all sheets initialized.
 * Used on first run when no Excel file exists yet.
 *
 * Async because it lazy-loads ExcelJS — see getExcelJS().
 */
export async function createBlankWorkbook(): Promise<ExcelJS.Workbook> {
  const ExcelJSLib = await getExcelJS();
  const workbook = new ExcelJSLib.Workbook();

  // Meta sheet
  const meta = workbook.addWorksheet('Meta');
  meta.columns = [
    { header: 'Key', key: 'key', width: 20 },
    { header: 'Value', key: 'value', width: 30 },
    { header: 'UpdatedAt', key: 'updatedAt', width: 25 },
  ];
  meta.addRow({ key: 'version', value: 1, updatedAt: new Date() });
  meta.addRow({ key: 'lastSyncDevice', value: 'Desktop', updatedAt: new Date() });

  // Projects sheet
  const projects = workbook.addWorksheet('Projects');
  projects.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'WorkOrderID', key: 'workOrderID', width: 15 },
    { header: 'Location', key: 'location', width: 20 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'CreatedAt', key: 'createdAt', width: 25 },
    { header: 'UpdatedAt', key: 'updatedAt', width: 25 },
    { header: 'ArchivedAt', key: 'archivedAt', width: 15 },
    { header: 'PinnedAt', key: 'pinnedAt', width: 15 },
  ];

  // Activity sheet
  const activity = workbook.addWorksheet('Activity');
  activity.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'ProjectID', key: 'projectID', width: 20 },
    { header: 'Timestamp', key: 'timestamp', width: 25 },
    { header: 'Text', key: 'text', width: 50 },
    { header: 'PostedToNuvolo', key: 'postedToNuvolo', width: 18 },
    { header: 'Author', key: 'author', width: 20 },
  ];

  // Milestones sheet
  const milestones = workbook.addWorksheet('Milestones');
  milestones.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'ProjectID', key: 'projectID', width: 20 },
    { header: 'Title', key: 'title', width: 30 },
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Done', key: 'done', width: 10 },
    { header: 'Trade', key: 'trade', width: 15 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];

  // Trades sheet
  const trades = workbook.addWorksheet('Trades');
  trades.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'ProjectID', key: 'projectID', width: 20 },
    { header: 'Key', key: 'key', width: 15 },
    { header: 'Label', key: 'label', width: 20 },
    { header: 'Contact', key: 'contact', width: 25 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'ScheduledDate', key: 'scheduledDate', width: 15 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];

  // Vendors sheet
  const vendors = workbook.addWorksheet('Vendors');
  vendors.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'ProjectID', key: 'projectID', width: 20 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Company', key: 'company', width: 25 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'VisitDate', key: 'visitDate', width: 15 },
    { header: 'VisitTime', key: 'visitTime', width: 12 },
    { header: 'IsPrimaryContact', key: 'isPrimaryContact', width: 18 },
    { header: 'Notes', key: 'notes', width: 40 },
    { header: 'BadgeOrFOBNeeded', key: 'badgeOrFOBNeeded', width: 18 },
  ];

  // Photos sheet
  const photos = workbook.addWorksheet('Photos');
  photos.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'ProjectID', key: 'projectID', width: 20 },
    { header: 'Filename', key: 'filename', width: 30 },
    { header: 'Path', key: 'path', width: 50 },
    { header: 'Caption', key: 'caption', width: 40 },
    { header: 'CapturedAt', key: 'capturedAt', width: 25 },
  ];

  // Settings sheet
  const settings = workbook.addWorksheet('Settings');
  settings.columns = [
    { header: 'Key', key: 'key', width: 30 },
    { header: 'Value', key: 'value', width: 50 },
  ];

  // WorkOrders sheet
  const workOrders = workbook.addWorksheet('WorkOrders');
  workOrders.columns = [
    { header: 'Number', key: 'number', width: 15 },
    { header: 'ShortDescription', key: 'shortDescription', width: 40 },
    { header: 'State', key: 'state', width: 15 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'AssignedTo', key: 'assignedTo', width: 25 },
    { header: 'OpenedAt', key: 'openedAt', width: 25 },
    { header: 'DueDate', key: 'dueDate', width: 15 },
    { header: 'Location', key: 'location', width: 25 },
    { header: 'AssignmentGroup', key: 'assignmentGroup', width: 25 },
    { header: 'Extra', key: 'extra', width: 50 }, // JSON string
    { header: 'ImportedAt', key: 'importedAt', width: 25 },
  ];

  // MeetingNotesOrders sheet
  const meetingNotesOrders = workbook.addWorksheet('MeetingNotesOrders');
  meetingNotesOrders.columns = workOrders.columns; // Same structure

  // SavedVendors sheet
  const savedVendors = workbook.addWorksheet('SavedVendors');
  savedVendors.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Company', key: 'company', width: 25 },
    { header: 'Role', key: 'role', width: 20 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'GeneralNotes', key: 'generalNotes', width: 40 },
  ];

  // SavedVendorEvents sheet
  const savedVendorEvents = workbook.addWorksheet('SavedVendorEvents');
  savedVendorEvents.columns = [
    { header: 'ID', key: 'id', width: 20 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Cadence', key: 'cadence', width: 15 },
    { header: 'VendorName', key: 'vendorName', width: 25 },
    { header: 'VendorCompany', key: 'vendorCompany', width: 25 },
    { header: 'VendorRole', key: 'vendorRole', width: 20 },
    { header: 'VendorPhone', key: 'vendorPhone', width: 18 },
    { header: 'VendorEmail', key: 'vendorEmail', width: 25 },
    { header: 'ServiceDescription', key: 'serviceDescription', width: 40 },
    { header: 'DefaultVisitNotes', key: 'defaultVisitNotes', width: 40 },
    { header: 'CreatedAt', key: 'createdAt', width: 15 },
    { header: 'UpdatedAt', key: 'updatedAt', width: 15 },
  ];

  return workbook;
}

// ========== Projects ==========

/**
 * Read all projects from the Projects sheet.
 * Returns empty array if the workbook doesn't exist yet.
 */
export async function getProjects(): Promise<Project[]> {
  const workbook = await loadWorkbook();
  if (!workbook) return [];

  const sheet = workbook.getWorksheet('Projects');
  if (!sheet) return [];

  const projects: Project[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    projects.push({
      id: row.getCell(1).value as string,
      name: row.getCell(2).value as string,
      status: row.getCell(3).value as any,
      workOrderId: row.getCell(4).value as string || undefined,
      location: row.getCell(5).value as string || undefined,
      description: row.getCell(6).value as string || undefined,
      createdAt: (row.getCell(7).value as Date)?.toISOString() || new Date().toISOString(),
      updatedAt: (row.getCell(8).value as Date)?.toISOString() || new Date().toISOString(),
      archivedAt: row.getCell(9).value as number || undefined,
      pinnedAt: row.getCell(10).value as number || undefined,
      // Child arrays loaded separately
      activity: [],
      milestones: [],
      trades: [],
      vendors: [],
      photos: [],
    });
  });

  return projects;
}

/**
 * Add a new project to the Projects sheet.
 * Child arrays (activity, milestones, etc.) are written to their own sheets.
 */
export async function addProject(project: Project): Promise<void> {
  const workbook = (await loadWorkbook()) ?? (await createBlankWorkbook());
  const sheet = workbook.getWorksheet('Projects');
  if (!sheet) throw new Error('Projects sheet not found');

  sheet.addRow({
    id: project.id,
    name: project.name,
    status: project.status,
    workOrderID: project.workOrderId || '',
    location: project.location || '',
    description: project.description || '',
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    archivedAt: project.archivedAt || '',
    pinnedAt: project.pinnedAt || '',
  });

  await saveWorkbook(workbook);
}

// ========== Activity ==========

/**
 * Read all activity entries for all projects.
 * Returns a map of projectId → ActivityEntry[].
 */
export async function getActivity(): Promise<Map<string, ActivityEntry[]>> {
  const workbook = await loadWorkbook();
  if (!workbook) return new Map();

  const sheet = workbook.getWorksheet('Activity');
  if (!sheet) return new Map();

  const activityMap = new Map<string, ActivityEntry[]>();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const projectID = row.getCell(2).value as string;
    const entry: ActivityEntry = {
      id: row.getCell(1).value as string,
      timestamp: (row.getCell(3).value as Date)?.toISOString() || new Date().toISOString(),
      text: row.getCell(4).value as string,
      postedToNuvolo: row.getCell(5).value as boolean,
      author: row.getCell(6).value as string || undefined,
    };

    if (!activityMap.has(projectID)) {
      activityMap.set(projectID, []);
    }
    activityMap.get(projectID)!.push(entry);
  });

  return activityMap;
}

// ========== Settings ==========

/**
 * Read all settings from the Settings sheet.
 * Complex values are stored as JSON strings and parsed here.
 */
export async function getSettings(): Promise<Partial<Settings>> {
  const workbook = await loadWorkbook();
  if (!workbook) return {};

  const sheet = workbook.getWorksheet('Settings');
  if (!sheet) return {};

  const settings: Record<string, any> = {};
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    const key = row.getCell(1).value as string;
    let value = row.getCell(2).value as string;

    // Try parsing as JSON for complex types
    try {
      value = JSON.parse(value);
    } catch {
      // Leave as string if not JSON
    }

    settings[key] = value;
  });

  return settings as Partial<Settings>;
}

/**
 * Update a setting in the Settings sheet.
 * Complex values are serialized to JSON strings.
 */
export async function setSetting(key: string, value: any): Promise<void> {
  const workbook = (await loadWorkbook()) ?? (await createBlankWorkbook());
  const sheet = workbook.getWorksheet('Settings');
  if (!sheet) throw new Error('Settings sheet not found');

  // Serialize complex values to JSON
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);

  // Find existing row or add new
  let found = false;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header
    if (row.getCell(1).value === key) {
      row.getCell(2).value = serialized;
      row.commit();
      found = true;
    }
  });

  if (!found) {
    sheet.addRow({ key, value: serialized });
  }

  await saveWorkbook(workbook);
}

// ========== Placeholder stubs for remaining sheets ==========
// TODO: Implement full CRUD for Milestones, Trades, Vendors, Photos, etc.
// For Phase 1, these return empty arrays. Phase 2 will add full support.

export async function getMilestones(): Promise<Map<string, Milestone[]>> {
  return new Map();
}

export async function getTrades(): Promise<Map<string, Trade[]>> {
  return new Map();
}

export async function getVendors(): Promise<Map<string, Vendor[]>> {
  return new Map();
}

export async function getPhotos(): Promise<Map<string, ProjectPhoto[]>> {
  return new Map();
}

export async function getWorkOrders(): Promise<ImportedWorkOrders | null> {
  return null;
}

export async function getMeetingNotesOrders(): Promise<ImportedWorkOrders | null> {
  return null;
}

export async function getSavedVendors(): Promise<SavedVendor[]> {
  return [];
}

export async function getSavedVendorEvents(): Promise<SavedVendorEvent[]> {
  return [];
}
