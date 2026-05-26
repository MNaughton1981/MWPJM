import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActivityEntry,
  Milestone,
  Project,
  ProjectPhoto,
  ProjectStatus,
  Settings,
  Trade,
  Vendor,
} from '../types';
import type { ImportedWorkOrders } from '../lib/workOrderCsv';
import { DEFAULT_NUVOLO_EMAIL, DEFAULT_WO_URL_PATTERN, LEGACY_WO_URL_PATTERNS } from '../lib/nuvolo';
import {
  DEFAULT_PHOTO_NAMING_PATTERN,
  deleteProjectPhotos,
} from '../lib/photoStorage';
import { DEFAULT_SECURITY_PREAMBLE } from '../lib/security';
import { uid } from '../lib/format';

interface AppState {
  projects: Project[];
  settings: Settings;
  workOrders: ImportedWorkOrders | null;

  /**
   * ISO timestamp of the last successful state sync (write OR apply).
   * Used by the UI to show "synced X minutes ago" and (in future) to
   * detect when the on-disk file is older than what's local.
   */
  lastSyncedAt: string | null;
  /**
   * Most recent sync error message, or null if the last sync succeeded.
   * Surfaced in Settings so the user knows when auto-sync is silently
   * failing (e.g. browser revoked the folder permission).
   */
  syncError: string | null;

  /**
   * In-progress Compose Note text, keyed by project id. Lets the user
   * walk away from a workboard or background the PWA without losing
   * what they've typed — the textarea reads from this map and writes
   * back on every keystroke instead of holding the value in component-
   * local state. Cleared explicitly when the user fires off the note
   * (Post to Nuvolo, To Do, Reminder, Copy, Share, Log only).
   *
   * Stored outside the project objects so typing into the textarea
   * doesn't bump `updatedAt` and reorder the Workboards list on every
   * keystroke. Persisted via zustand persist alongside everything else.
   */
  composerDrafts: Record<string, string>;

  // Project CRUD
  addProject: (p: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // Trades
  addTrade: (projectId: string, t: Omit<Trade, 'id'>) => void;
  updateTrade: (projectId: string, tradeId: string, patch: Partial<Trade>) => void;
  removeTrade: (projectId: string, tradeId: string) => void;

  // Milestones
  addMilestone: (projectId: string, m: Omit<Milestone, 'id'>) => void;
  updateMilestone: (projectId: string, milestoneId: string, patch: Partial<Milestone>) => void;
  removeMilestone: (projectId: string, milestoneId: string) => void;

  // Activity
  addActivity: (projectId: string, entry: Omit<ActivityEntry, 'id'>) => void;
  removeActivity: (projectId: string, entryId: string) => void;

  // Photos (metadata only — blobs live in IndexedDB)
  addPhotoMeta: (projectId: string, photo: ProjectPhoto) => void;
  updatePhotoMeta: (
    projectId: string,
    photoId: string,
    patch: Partial<ProjectPhoto>,
  ) => void;
  removePhotoMeta: (projectId: string, photoId: string) => void;

  // Vendors
  addVendor: (projectId: string, vendor: Omit<Vendor, 'id'>) => void;
  updateVendor: (
    projectId: string,
    vendorId: string,
    patch: Partial<Vendor>,
  ) => void;
  removeVendor: (projectId: string, vendorId: string) => void;

  // Settings
  setSettings: (patch: Partial<Settings>) => void;

  // Composer drafts (sticky textarea text per workboard)
  setComposerDraft: (projectId: string, text: string) => void;
  clearComposerDraft: (projectId: string) => void;

  // Work orders (imported from Nuvolo CSV)
  setWorkOrders: (data: ImportedWorkOrders | null) => void;

  // Bulk import/export
  replaceAll: (data: { projects: Project[]; settings: Settings }) => void;

  /**
   * Apply a payload pulled from the cross-device sync file (see
   * lib/sync.ts). Replaces projects, settings, and workOrders with the
   * synced values; marks `lastSyncedAt` with the source's timestamp.
   * Intentionally separate from `replaceAll` because it also touches
   * workOrders and lastSyncedAt — exposing both keeps the JSON
   * backup/restore path and the cross-device sync path distinct.
   */
  applySyncedState: (data: {
    projects: Project[];
    settings: Settings;
    workOrders: ImportedWorkOrders | null;
    syncedAt: string;
  }) => void;
}

const defaultSettings: Settings = {
  technicianName: '',
  nuvoloEmail: DEFAULT_NUVOLO_EMAIL,
  // Empty by default so the path each colleague sees on first run isn't
  // pre-filled with someone else's OneDrive path / Windows username.
  // The Settings input has a generic placeholder hint, and the Reports
  // page "Connect folder" flow is what actually grants permission —
  // this string is just a display-only reminder.
  reportFolderPath: '',
  photoNamingPattern: DEFAULT_PHOTO_NAMING_PATTERN,
  userEmail: '',
  nuvoloWorkOrderUrlPattern: DEFAULT_WO_URL_PATTERN,
  securityEmail: '',
  securityPreamble: DEFAULT_SECURITY_PREAMBLE,
  securityCcSelf: true,
  syncEnabled: false,
  syncFilename: 'mwpjm-state.json',
};

function touch(p: Project): Project {
  return { ...p, updatedAt: new Date().toISOString() };
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      projects: [],
      settings: defaultSettings,
      workOrders: null,
      lastSyncedAt: null,
      syncError: null,
      composerDrafts: {},

      addProject: (p) =>
        set((s) => ({ projects: [p, ...s.projects] })),

      updateProject: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? touch({ ...p, ...patch }) : p,
          ),
        })),

      deleteProject: (id) => {
        // Fire-and-forget cleanup of any photos in IndexedDB. We don't
        // block the UI on this; if it fails the orphaned blobs are harmless.
        deleteProjectPhotos(id).catch(() => undefined);
        set((s) => {
          // Drop any composer draft for the deleted project too — no
          // point persisting orphaned text the user can never get back to.
          const { [id]: _drop, ...rest } = s.composerDrafts;
          void _drop;
          return {
            projects: s.projects.filter((p) => p.id !== id),
            composerDrafts: rest,
          };
        });
      },

      addTrade: (projectId, t) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, trades: [...p.trades, { ...t, id: uid() }] })
              : p,
          ),
        })),

      updateTrade: (projectId, tradeId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  trades: p.trades.map((t) =>
                    t.id === tradeId ? { ...t, ...patch } : t,
                  ),
                })
              : p,
          ),
        })),

      removeTrade: (projectId, tradeId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, trades: p.trades.filter((t) => t.id !== tradeId) })
              : p,
          ),
        })),

      addMilestone: (projectId, m) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, milestones: [...p.milestones, { ...m, id: uid() }] })
              : p,
          ),
        })),

      updateMilestone: (projectId, milestoneId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  milestones: p.milestones.map((m) =>
                    m.id === milestoneId ? { ...m, ...patch } : m,
                  ),
                })
              : p,
          ),
        })),

      removeMilestone: (projectId, milestoneId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  milestones: p.milestones.filter((m) => m.id !== milestoneId),
                })
              : p,
          ),
        })),

      addActivity: (projectId, entry) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  activity: [{ ...entry, id: uid() }, ...p.activity],
                })
              : p,
          ),
        })),

      removeActivity: (projectId, entryId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  activity: p.activity.filter((a) => a.id !== entryId),
                })
              : p,
          ),
        })),

      addPhotoMeta: (projectId, photo) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({ ...p, photos: [...(p.photos ?? []), photo] })
              : p,
          ),
        })),

      updatePhotoMeta: (projectId, photoId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  photos: (p.photos ?? []).map((ph) =>
                    ph.id === photoId ? { ...ph, ...patch } : ph,
                  ),
                })
              : p,
          ),
        })),

      removePhotoMeta: (projectId, photoId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  photos: (p.photos ?? []).filter((ph) => ph.id !== photoId),
                })
              : p,
          ),
        })),

      addVendor: (projectId, vendor) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  vendors: [...(p.vendors ?? []), { ...vendor, id: uid() }],
                })
              : p,
          ),
        })),

      updateVendor: (projectId, vendorId, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  vendors: (p.vendors ?? []).map((v) =>
                    v.id === vendorId ? { ...v, ...patch } : v,
                  ),
                })
              : p,
          ),
        })),

      removeVendor: (projectId, vendorId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  vendors: (p.vendors ?? []).filter((v) => v.id !== vendorId),
                })
              : p,
          ),
        })),

      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

      setComposerDraft: (projectId, text) =>
        set((s) => ({
          composerDrafts: { ...s.composerDrafts, [projectId]: text },
        })),

      clearComposerDraft: (projectId) =>
        set((s) => {
          // Skip the work if there's nothing to clear — avoids triggering
          // a no-op store update that would re-render every subscriber.
          if (!(projectId in s.composerDrafts)) return s;
          const { [projectId]: _drop, ...rest } = s.composerDrafts;
          void _drop;
          return { composerDrafts: rest };
        }),

      setWorkOrders: (data) => set(() => ({ workOrders: data })),

      replaceAll: (data) =>
        set(() => ({
          projects: data.projects,
          settings: { ...defaultSettings, ...data.settings },
        })),

      applySyncedState: (data) =>
        set(() => ({
          projects: data.projects,
          settings: { ...defaultSettings, ...data.settings },
          workOrders: data.workOrders,
          lastSyncedAt: data.syncedAt,
          syncError: null,
        })),
    }),
    {
      name: 'mwpjm-store-v1',
      version: 1,
      // Custom merge so newly-added settings fields are backfilled from
      // defaults when an older persisted state is rehydrated. Without
      // this, adding a Settings field (e.g. `securityEmail`) and then
      // calling `.trim()` on it crashed the project page for users
      // whose localStorage predated the field. Top-level state (projects,
      // workOrders) keeps the persisted values; settings are deep-merged.
      //
      // Also auto-upgrades any setting that's still on a previously-
      // shipped default that we've since fixed (e.g. the WO URL pattern
      // moved from the wrong `sow_work_order` table to the correct
      // `x_nuvo_eam_facilities_work_orders` table). User customizations
      // are detected by inequality with every known legacy default and
      // are always preserved.
      merge: (persisted, current) => {
        const p = (persisted as Partial<AppState>) ?? {};
        const mergedSettings: Settings = {
          ...current.settings,
          ...(p.settings ?? {}),
        };
        if (
          LEGACY_WO_URL_PATTERNS.includes(mergedSettings.nuvoloWorkOrderUrlPattern)
        ) {
          mergedSettings.nuvoloWorkOrderUrlPattern = DEFAULT_WO_URL_PATTERN;
        }
        return {
          ...current,
          ...p,
          settings: mergedSettings,
          // Backfill composerDrafts for users whose persisted state
          // predates this field — without this, the field is undefined
          // on rehydrate and the very first setComposerDraft spreads
          // into `undefined`, blowing up.
          composerDrafts: p.composerDrafts ?? current.composerDrafts,
        };
      },
    },
  ),
);

export function setProjectStatus(id: string, status: ProjectStatus) {
  useStore.getState().updateProject(id, { status });
}
