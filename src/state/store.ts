import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActivityEntry,
  Milestone,
  Project,
  ProjectPhoto,
  ProjectStatus,
  SavedVendor,
  SavedVendorEvent,
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
   * Separate import for meeting notes / closed work orders.
   * Kept distinct from `workOrders` so the user can load a filtered
   * CSV (closed tickets over a date range) for 1:1 meeting prep
   * without overwriting the Dashboard's active-WO list.
   */
  meetingNotesOrders: ImportedWorkOrders | null;

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
   * The user's persistent vendor "book" — independent of any specific
   * workboard. Auto-populated when the user saves a vendor on a
   * workboard via the "💾 Save to book" button, and surfaced as a
   * "From book" picker the next time they add a vendor on any
   * workboard. Synced across devices alongside projects/settings so
   * saving on desktop = available on mobile.
   */
  savedVendors: SavedVendor[];

  /**
   * Saved recurring service / vendor event templates — quarterly
   * drain service, annual fire alarm test, etc. See the
   * SavedVendorEvent doc on `types.ts` for the full design.
   *
   * Surfaced two ways:
   *   - Workboards page: "📅 Vendor events" entry point opens a
   *     modal where the user picks an event, fills in the visit
   *     date/time, and fires a security notification.
   *   - Settings page: "Vendor events" section to manage templates
   *     (add / edit / remove).
   *
   * Synced cross-device alongside everything else.
   */
  savedVendorEvents: SavedVendorEvent[];

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
  /**
   * Mark a workboard as archived. Hides it from the default Workboards
   * list but preserves all data (photos, activity, vendors, FWKD
   * linkage). Archive does NOT bump `updatedAt` on purpose — when the
   * user later unarchives, the workboard's "real" last-touched time
   * is still meaningful and the sort order isn't artificially
   * jostled by the archive event itself.
   */
  archiveProject: (id: string) => void;
  /** Undo `archiveProject` — clears `archivedAt`, restores to active list. */
  unarchiveProject: (id: string) => void;

  /**
   * Pin or unpin a workboard. Toggling pin sets / clears
   * `pinnedAt = Date.now()`. Pinned workboards sort above unpinned
   * ones in the Workboards list, with the most recently pinned at
   * the top.
   *
   * Like archive/unarchive, pinning does NOT bump `updatedAt`. The
   * workboard's "real" last-touched time is preserved so when the
   * user later unpins, the row falls back to its natural place in
   * the by-updatedAt sort instead of being artificially promoted.
   */
  togglePinProject: (id: string) => void;

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
  /**
   * Mark a vendor as the workboard's point of contact (radio-button
   * semantics — at most one POC per workboard). Pass the vendor's id
   * to set it as POC and automatically clear `isPrimaryContact` on
   * every other vendor in the same workboard. Pass `null` to clear
   * the POC entirely (no vendor flagged).
   *
   * Why a dedicated action rather than letting the caller toggle
   * `isPrimaryContact` via `updateVendor`: enforcing the single-POC
   * invariant in one place means the per-vendor card UI doesn't
   * have to care about iterating-and-clearing siblings, and a
   * future "Save as event" flow can call this safely without
   * leaking the radio logic into the call site.
   */
  setPrimaryVendorContact: (
    projectId: string,
    vendorId: string | null,
  ) => void;

  // Saved vendor "book" — global, shared across all workboards.
  /**
   * Insert or update a saved vendor by `(name, company)` key. If a
   * matching entry already exists, non-empty fields from `template`
   * are merged into it (so you don't blow away an existing phone by
   * saving the same vendor without one). Returns the resulting
   * SavedVendor's id so the caller can stash it on the workboard
   * Vendor that prompted the save (currently unused, reserved for
   * future "this workboard vendor came from book entry X" linking).
   */
  addOrUpdateSavedVendor: (template: Omit<SavedVendor, 'id'>) => string;
  /** Delete a saved vendor from the book by id. */
  removeSavedVendor: (id: string) => void;

  // Saved vendor events (recurring service / notification templates).
  /**
   * Insert a new saved vendor event template. Always creates a fresh
   * row with a new id (no name-based dedupe — the user explicitly
   * asked for the ability to rename an event without it spawning a
   * duplicate). Returns the new id so the caller can navigate to the
   * edit form right after creation if they want.
   *
   * `createdAt` and `updatedAt` are stamped at insert time.
   */
  addSavedVendorEvent: (
    template: Omit<SavedVendorEvent, 'id' | 'createdAt' | 'updatedAt'>,
  ) => string;
  /**
   * Edit an existing saved event in place. Found by id, no name-based
   * dedupe, so renaming is safe (won't merge or duplicate). Bumps
   * `updatedAt` on every edit; `createdAt` is preserved.
   */
  updateSavedVendorEvent: (
    id: string,
    patch: Partial<Omit<SavedVendorEvent, 'id' | 'createdAt'>>,
  ) => void;
  /** Delete a saved event by id. */
  removeSavedVendorEvent: (id: string) => void;

  // Settings
  setSettings: (patch: Partial<Settings>) => void;

  // Composer drafts (sticky textarea text per workboard)
  setComposerDraft: (projectId: string, text: string) => void;
  clearComposerDraft: (projectId: string) => void;

  // Work orders (imported from Nuvolo CSV)
  setWorkOrders: (data: ImportedWorkOrders | null) => void;
  
  // Meeting notes work orders (separate import for closed/historical tickets)
  setMeetingNotesOrders: (data: ImportedWorkOrders | null) => void;

  // Bulk import/export
  replaceAll: (data: {
    projects: Project[];
    settings: Settings;
    savedVendors?: SavedVendor[];
    savedVendorEvents?: SavedVendorEvent[];
  }) => void;

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
    savedVendors?: SavedVendor[];
    savedVendorEvents?: SavedVendorEvent[];
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
  calendarProvider: 'outlook', // Default to Outlook Calendar (.ics download)
  photosSubfolder: 'photos',
  reportsSubfolder: 'reports',
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
      meetingNotesOrders: null,
      lastSyncedAt: null,
      syncError: null,
      savedVendors: [],
      savedVendorEvents: [],
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

      archiveProject: (id) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, archivedAt: Date.now() } : p,
          ),
        })),

      unarchiveProject: (id) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, archivedAt: undefined } : p,
          ),
        })),

      togglePinProject: (id) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? { ...p, pinnedAt: p.pinnedAt ? undefined : Date.now() }
              : p,
          ),
        })),

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

      setPrimaryVendorContact: (projectId, vendorId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? touch({
                  ...p,
                  // Radio semantics: every vendor's isPrimaryContact is
                  // recomputed in one pass so the invariant "at most one
                  // POC per workboard" can never drift, even if the
                  // store gets called twice in quick succession.
                  vendors: (p.vendors ?? []).map((v) => ({
                    ...v,
                    isPrimaryContact: v.id === vendorId,
                  })),
                })
              : p,
          ),
        })),

      addOrUpdateSavedVendor: (template) => {
        // Dedupe by (name, company) — case-insensitive trim. Same name
        // at different companies = different entry, on the assumption
        // that "Mike at SullyMac" is genuinely a different person from
        // "Mike at City Point" (or even if same person, the workboard
        // contact context is different).
        //
        // When merging into an existing entry, only non-empty incoming
        // fields overwrite existing ones — so saving the same vendor
        // without filling in their phone doesn't blow away the phone
        // number you already had on file.
        const key = (n: string, c: string | undefined): string =>
          `${(n || '').trim().toLowerCase()}|${(c || '').trim().toLowerCase()}`;
        const incomingKey = key(template.name, template.company);
        let resultId = '';
        set((s) => {
          const existingIdx = s.savedVendors.findIndex(
            (sv) => key(sv.name, sv.company) === incomingKey,
          );
          if (existingIdx >= 0) {
            const existing = s.savedVendors[existingIdx];
            const merged: SavedVendor = {
              ...existing,
              // Take incoming non-empty fields; preserve existing otherwise.
              ...(template.role?.trim() ? { role: template.role } : {}),
              ...(template.phone?.trim() ? { phone: template.phone } : {}),
              ...(template.email?.trim() ? { email: template.email } : {}),
              ...(template.generalNotes?.trim()
                ? { generalNotes: template.generalNotes }
                : {}),
              // name + company already match by key (modulo case/trim) —
              // re-canonicalize to whatever the user just typed so updates
              // to capitalization or whitespace flow through.
              name: template.name.trim() || existing.name,
              company: template.company?.trim() || existing.company,
            };
            resultId = existing.id;
            const next = s.savedVendors.slice();
            next[existingIdx] = merged;
            return { savedVendors: next };
          }
          const created: SavedVendor = {
            id: uid(),
            name: template.name.trim(),
            company: template.company?.trim() || undefined,
            role: template.role?.trim() || undefined,
            phone: template.phone?.trim() || undefined,
            email: template.email?.trim() || undefined,
            generalNotes: template.generalNotes?.trim() || undefined,
          };
          resultId = created.id;
          return {
            savedVendors: [...s.savedVendors, created].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          };
        });
        return resultId;
      },

      removeSavedVendor: (id) =>
        set((s) => ({
          savedVendors: s.savedVendors.filter((sv) => sv.id !== id),
        })),

      addSavedVendorEvent: (template) => {
        const now = Date.now();
        const created: SavedVendorEvent = {
          id: uid(),
          name: template.name.trim() || 'Untitled event',
          cadence: template.cadence?.trim() || undefined,
          vendorName: template.vendorName?.trim() || undefined,
          vendorCompany: template.vendorCompany?.trim() || undefined,
          vendorRole: template.vendorRole?.trim() || undefined,
          vendorPhone: template.vendorPhone?.trim() || undefined,
          vendorEmail: template.vendorEmail?.trim() || undefined,
          serviceDescription: template.serviceDescription?.trim() || undefined,
          defaultVisitNotes: template.defaultVisitNotes?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          savedVendorEvents: [created, ...s.savedVendorEvents],
        }));
        return created.id;
      },

      updateSavedVendorEvent: (id, patch) =>
        set((s) => ({
          savedVendorEvents: s.savedVendorEvents.map((ev) =>
            ev.id === id
              ? {
                  ...ev,
                  ...patch,
                  updatedAt: Date.now(),
                }
              : ev,
          ),
        })),

      removeSavedVendorEvent: (id) =>
        set((s) => ({
          savedVendorEvents: s.savedVendorEvents.filter((ev) => ev.id !== id),
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

      setMeetingNotesOrders: (data) => set(() => ({ meetingNotesOrders: data })),

      replaceAll: (data) =>
        set(() => ({
          projects: data.projects,
          settings: { ...defaultSettings, ...data.settings },
          savedVendors: data.savedVendors ?? [],
          savedVendorEvents: data.savedVendorEvents ?? [],
        })),

      applySyncedState: (data) =>
        set(() => ({
          projects: data.projects,
          settings: { ...defaultSettings, ...data.settings },
          workOrders: data.workOrders,
          savedVendors: data.savedVendors ?? [],
          savedVendorEvents: data.savedVendorEvents ?? [],
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
          // Same defensive backfill for savedVendors — older persisted
          // states don't have this key. Calling addOrUpdateSavedVendor
          // before it's seeded would crash on `s.savedVendors.findIndex`.
          savedVendors: p.savedVendors ?? current.savedVendors,
          // Same defensive backfill for savedVendorEvents — older
          // persisted states predate this field, so without this
          // backfill addSavedVendorEvent would spread into undefined.
          savedVendorEvents:
            p.savedVendorEvents ?? current.savedVendorEvents,
        };
      },
    },
  ),
);

export function setProjectStatus(id: string, status: ProjectStatus) {
  useStore.getState().updateProject(id, { status });
}
