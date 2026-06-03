/**
 * Migration script: Export current JSON state to Excel workbook.
 *
 * This is a ONE-TIME operation that creates MWPJM-Data.xlsx from the
 * current localStorage/zustand state. Run this from the Settings page
 * via the "Export to Excel" button.
 *
 * Safety:
 *   - Current JSON storage keeps working (no data loss)
 *   - Excel file is created as a new file
 *   - You can verify the Excel file manually before switching over
 *   - Rollback: just delete the Excel file and keep using JSON
 */

import { useStore } from '../state/store';
import {
  createBlankWorkbook,
  saveWorkbook,
  EXCEL_FILENAME,
} from './excelStorage';
import { readFileFromFolder } from './folderConnection';

export interface MigrationResult {
  success: boolean;
  message: string;
  projectsCount: number;
  activityCount: number;
  photosCount: number;
  error?: string;
}

/**
 * Export the current state to a new Excel workbook.
 * Returns a result object with counts and status.
 */
export async function migrateToExcel(): Promise<MigrationResult> {
  try {
    const state = useStore.getState();
    const workbook = await createBlankWorkbook();

    // ========== Projects ==========
    const projectsSheet = workbook.getWorksheet('Projects');
    if (!projectsSheet) throw new Error('Projects sheet not found');

    let activityCount = 0;
    let milestonesCount = 0;
    let tradesCount = 0;
    let vendorsCount = 0;
    let photosCount = 0;

    for (const project of state.projects) {
      projectsSheet.addRow({
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

      // ========== Activity ==========
      const activitySheet = workbook.getWorksheet('Activity');
      if (activitySheet) {
        for (const entry of project.activity) {
          activitySheet.addRow({
            id: entry.id,
            projectID: project.id,
            timestamp: new Date(entry.timestamp),
            text: entry.text,
            postedToNuvolo: entry.postedToNuvolo,
            author: entry.author || '',
          });
          activityCount++;
        }
      }

      // ========== Milestones ==========
      const milestonesSheet = workbook.getWorksheet('Milestones');
      if (milestonesSheet) {
        for (const milestone of project.milestones) {
          milestonesSheet.addRow({
            id: milestone.id,
            projectID: project.id,
            title: milestone.title,
            date: milestone.date || '',
            done: milestone.done,
            trade: milestone.trade || '',
            notes: milestone.notes || '',
          });
          milestonesCount++;
        }
      }

      // ========== Trades ==========
      const tradesSheet = workbook.getWorksheet('Trades');
      if (tradesSheet) {
        for (const trade of project.trades) {
          tradesSheet.addRow({
            id: trade.id,
            projectID: project.id,
            key: trade.key,
            label: trade.label,
            contact: trade.contact || '',
            phone: trade.phone || '',
            status: trade.status,
            scheduledDate: trade.scheduledDate || '',
            notes: trade.notes || '',
          });
          tradesCount++;
        }
      }

      // ========== Vendors ==========
      const vendorsSheet = workbook.getWorksheet('Vendors');
      if (vendorsSheet) {
        for (const vendor of project.vendors || []) {
          vendorsSheet.addRow({
            id: vendor.id,
            projectID: project.id,
            name: vendor.name,
            company: vendor.company || '',
            role: vendor.role || '',
            phone: vendor.phone || '',
            email: vendor.email || '',
            visitDate: vendor.visitDate || '',
            visitTime: vendor.visitTime || '',
            isPrimaryContact: vendor.isPrimaryContact || false,
            notes: vendor.notes || '',
            badgeOrFOBNeeded: false, // Field doesn't exist yet in type
          });
          vendorsCount++;
        }
      }

      // ========== Photos ==========
      const photosSheet = workbook.getWorksheet('Photos');
      if (photosSheet) {
        for (const photo of project.photos || []) {
          photosSheet.addRow({
            id: photo.id,
            projectID: project.id,
            filename: `photo-${photo.id}`, // Generate filename from ID
            path: '', // Photos not migrated yet - placeholder
            caption: photo.caption || '',
            capturedAt: new Date(photo.capturedAt),
          });
          photosCount++;
        }
      }
    }

    // ========== Settings ==========
    const settingsSheet = workbook.getWorksheet('Settings');
    if (settingsSheet) {
      const settings = state.settings;
      for (const [key, value] of Object.entries(settings)) {
        const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
        settingsSheet.addRow({ key, value: serialized });
      }
    }

    // ========== WorkOrders ==========
    if (state.workOrders) {
      const workOrdersSheet = workbook.getWorksheet('WorkOrders');
      if (workOrdersSheet) {
        for (const wo of state.workOrders.rows) {
          workOrdersSheet.addRow({
            number: wo.number,
            shortDescription: wo.shortDescription,
            state: wo.state,
            priority: wo.priority,
            assignedTo: wo.assignedTo,
            openedAt: wo.openedAt ? new Date(wo.openedAt) : '',
            dueDate: wo.dueDate || '',
            location: wo.location,
            assignmentGroup: wo.assignmentGroup,
            extra: JSON.stringify(wo.extra),
            importedAt: new Date(state.workOrders.importedAt),
          });
        }
      }
    }

    // ========== MeetingNotesOrders ==========
    if (state.meetingNotesOrders) {
      const meetingNotesSheet = workbook.getWorksheet('MeetingNotesOrders');
      if (meetingNotesSheet) {
        for (const wo of state.meetingNotesOrders.rows) {
          meetingNotesSheet.addRow({
            number: wo.number,
            shortDescription: wo.shortDescription,
            state: wo.state,
            priority: wo.priority,
            assignedTo: wo.assignedTo,
            openedAt: wo.openedAt ? new Date(wo.openedAt) : '',
            dueDate: wo.dueDate || '',
            location: wo.location,
            assignmentGroup: wo.assignmentGroup,
            extra: JSON.stringify(wo.extra),
            importedAt: new Date(state.meetingNotesOrders.importedAt),
          });
        }
      }
    }

    // ========== SavedVendors ==========
    const savedVendorsSheet = workbook.getWorksheet('SavedVendors');
    if (savedVendorsSheet) {
      for (const vendor of state.savedVendors) {
        savedVendorsSheet.addRow({
          id: vendor.id,
          name: vendor.name,
          company: vendor.company || '',
          role: vendor.role || '',
          phone: vendor.phone || '',
          email: vendor.email || '',
          generalNotes: vendor.generalNotes || '',
        });
      }
    }

    // ========== SavedVendorEvents ==========
    const savedVendorEventsSheet = workbook.getWorksheet('SavedVendorEvents');
    if (savedVendorEventsSheet) {
      for (const event of state.savedVendorEvents) {
        savedVendorEventsSheet.addRow({
          id: event.id,
          name: event.name,
          cadence: event.cadence || '',
          vendorName: event.vendorName || '',
          vendorCompany: event.vendorCompany || '',
          vendorRole: event.vendorRole || '',
          vendorPhone: event.vendorPhone || '',
          vendorEmail: event.vendorEmail || '',
          serviceDescription: event.serviceDescription || '',
          defaultVisitNotes: event.defaultVisitNotes || '',
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
        });
      }
    }

    // ========== Save workbook ==========
    await saveWorkbook(workbook);

    return {
      success: true,
      message: `Successfully exported to ${EXCEL_FILENAME}`,
      projectsCount: state.projects.length,
      activityCount,
      photosCount,
    };
  } catch (e) {
    console.error('Migration failed:', e);
    return {
      success: false,
      message: 'Migration failed',
      projectsCount: 0,
      activityCount: 0,
      photosCount: 0,
      error: (e as Error).message,
    };
  }
}

/**
 * Verify the Excel file exists. Lightweight on purpose: it only checks
 * for the file's presence in the connected folder and does NOT parse it
 * with ExcelJS — so opening the Settings page never pulls the heavy
 * ExcelJS chunk just to render the status line. The precise project
 * count is surfaced right after a migration runs (from MigrationResult).
 */
export async function verifyExcelFile(): Promise<{
  exists: boolean;
  error?: string;
}> {
  try {
    const file = await readFileFromFolder(EXCEL_FILENAME);
    return { exists: !!file };
  } catch (e) {
    return { exists: false, error: (e as Error).message };
  }
}
