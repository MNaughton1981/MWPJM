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
  SavedHost,
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

/**
 * Merge two purpose lists into one, deduped case-insensitively while
 * preserving the original casing and first-seen order. Used to build up
 * a vendor's saved purposes without creating "PM" / "pm" duplicates.
 */
function unionPurposes(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...(existing ?? []), ...(incoming ?? [])]) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

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
   * Graph (OneDrive for Business) sync status — transient runtime
   * state, not meaningfully persisted. `graphAccount` is the signed-in
   * account's display label (reconciled from MSAL on app start),
   * `graphLastSyncedAt` is the last successful Graph sync, and
   * `graphSyncError` holds the most recent Graph sync failure message.
   */
  graphAccount: string | null;
  graphLastSyncedAt: string | null;
  graphSyncError: string | null;

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
   * The user's persistent host "book" — co-workers they name as the
   * on-site visit host on a vendor. Auto-populated via "Save host to
   * book" on a vendor card, and surfaced as a dropdown on the Host
   * field so their name + email can be pulled in without re-typing.
   * Synced across devices alongside everything else.
   */
  savedHosts: SavedHost[];

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
  /**
   * Add or update a saved host in the host book, keyed by lowercased,
   * trimmed name. A non-empty incoming email overwrites the stored one;
   * a blank email leaves the existing value intact. Returns the entry id.
   */
  addOrUpdateSavedHost: (template: Omit<SavedHost, 'id'>) => string;
  /** Delete a saved host from the host book by id. */
  removeSavedHost: (id: string) => void;
  /**
   * Append an on-site purpose to a vendor's book entry, finding it by
   * (name, company) or creating the entry from the supplied contact
   * info if it doesn't exist yet. Deduped case-insensitively. No-op for
   * a blank purpose.
   */
  addSavedVendorPurpose: (
    contact: {
      name: string;
      company?: string;
      role?: string;
      phone?: string;
      email?: string;
    },
    purpose: string,
  ) => void;
  /** Remove a saved purpose from a vendor's book entry (by name+company). */
  removeSavedVendorPurpose: (
    name: string,
    company: string | undefined,
    purpose: string,
  ) => void;

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
    savedHosts?: SavedHost[];
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
    savedHosts?: SavedHost[];
    syncedAt: string;
  }) => void;

  /**
   * Safe alternative to `applySyncedState`: MERGE a pulled payload into
   * local state instead of replacing it. Projects are unioned by id —
   * an incoming project not present locally is added; one that exists
   * is overwritten only when its `updatedAt` is newer. Local-only
   * projects are ALWAYS preserved, so a pull can never clobber work
   * created on this device but not yet in the file (the data-loss trap
   * from importing a desktop snapshot onto a phone). Saved vendors
   * union by id (incoming wins); saved events union by id (newer
   * `updatedAt` wins); workOrders takes whichever import is newer.
   *
   * Settings are intentionally NOT touched — they're device-specific
   * (e.g. the desktop's Windows `reportFolderPath`), so merging must
   * never overwrite them. `lastSyncedAt` is stamped with the source's
   * timestamp so freshness/direction logic keeps working.
   */
  mergeSyncedState: (data: {
    projects: Project[];
    workOrders: ImportedWorkOrders | null;
    savedVendors?: SavedVendor[];
    savedVendorEvents?: SavedVendorEvent[];
    savedHosts?: SavedHost[];
    syncedAt: string;
  }) => void;
  /**
   * Apply the result of a two-way Excel reconcile. Replaces only the
   * reconciled slices (projects + the global books) with the already-
   * merged arrays; settings, workOrders, and composer drafts are left
   * untouched (device-specific / not reconciled via Excel).
   */
  applyReconciledState: (data: {
    projects: Project[];
    savedVendors: SavedVendor[];
    savedVendorEvents: SavedVendorEvent[];
    savedHosts: SavedHost[];
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
  graphSyncEnabled: false,
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
      graphAccount: null,
      graphLastSyncedAt: null,
      graphSyncError: null,
      savedVendors: [],
      savedVendorEvents: [],
      savedHosts: [],
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
            // Union any incoming purposes with existing ones (case-
            // insensitive dedupe, original casing preserved).
            const mergedPurposes = unionPurposes(
              existing.purposes,
              template.purposes,
            );
            const merged: SavedVendor = {
              ...existing,
              // Take incoming non-empty fields; preserve existing otherwise.
              ...(template.role?.trim() ? { role: template.role } : {}),
              ...(template.phone?.trim() ? { phone: template.phone } : {}),
              ...(template.email?.trim() ? { email: template.email } : {}),
              ...(template.generalNotes?.trim()
                ? { generalNotes: template.generalNotes }
                : {}),
              ...(mergedPurposes.length ? { purposes: mergedPurposes } : {}),
              // name + company already match by key (modulo case/trim) —
              // re-canonicalize to whatever the user just typed so updates
              // to capitalization or whitespace flow through.
              name: template.name.trim() || existing.name,
              company: template.company?.trim() || existing.company,
              updatedAt: Date.now(),
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
            ...(template.purposes && template.purposes.length
              ? { purposes: unionPurposes([], template.purposes) }
              : {}),
            updatedAt: Date.now(),
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

      addOrUpdateSavedHost: (template) => {
        const name = template.name.trim();
        let resultId = '';
        if (!name) return resultId;
        const nameKey = name.toLowerCase();
        set((s) => {
          const idx = s.savedHosts.findIndex(
            (h) => h.name.trim().toLowerCase() === nameKey,
          );
          if (idx >= 0) {
            const existing = s.savedHosts[idx];
            const merged: SavedHost = {
              ...existing,
              name, // re-canonicalize casing/whitespace
              // Non-empty incoming email overwrites; blank keeps existing.
              ...(template.email?.trim()
                ? { email: template.email.trim() }
                : {}),
              updatedAt: Date.now(),
            };
            resultId = existing.id;
            const next = s.savedHosts.slice();
            next[idx] = merged;
            return { savedHosts: next };
          }
          const created: SavedHost = {
            id: uid(),
            name,
            email: template.email?.trim() || undefined,
            updatedAt: Date.now(),
          };
          resultId = created.id;
          return {
            savedHosts: [...s.savedHosts, created].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          };
        });
        return resultId;
      },

      removeSavedHost: (id) =>
        set((s) => ({
          savedHosts: s.savedHosts.filter((h) => h.id !== id),
        })),

      addSavedVendorPurpose: (contact, purpose) => {
        const p = purpose.trim();
        if (!p) return;
        const key = (n: string, c: string | undefined): string =>
          `${(n || '').trim().toLowerCase()}|${(c || '').trim().toLowerCase()}`;
        const incomingKey = key(contact.name, contact.company);
        set((s) => {
          const idx = s.savedVendors.findIndex(
            (sv) => key(sv.name, sv.company) === incomingKey,
          );
          if (idx >= 0) {
            // Append to the existing book entry's purpose list.
            const existing = s.savedVendors[idx];
            const next = s.savedVendors.slice();
            next[idx] = {
              ...existing,
              purposes: unionPurposes(existing.purposes, [p]),
              updatedAt: Date.now(),
            };
            return { savedVendors: next };
          }
          // No book entry yet — create one (contact info + this purpose)
          // so checking "Save purpose to book" works even for a vendor
          // the user hasn't explicitly saved to the book.
          const created: SavedVendor = {
            id: uid(),
            name: contact.name.trim(),
            company: contact.company?.trim() || undefined,
            role: contact.role?.trim() || undefined,
            phone: contact.phone?.trim() || undefined,
            email: contact.email?.trim() || undefined,
            purposes: [p],
            updatedAt: Date.now(),
          };
          return {
            savedVendors: [...s.savedVendors, created].sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          };
        });
      },

      removeSavedVendorPurpose: (name, company, purpose) => {
        const target = purpose.trim().toLowerCase();
        const key = (n: string, c: string | undefined): string =>
          `${(n || '').trim().toLowerCase()}|${(c || '').trim().toLowerCase()}`;
        const incomingKey = key(name, company);
        set((s) => {
          const idx = s.savedVendors.findIndex(
            (sv) => key(sv.name, sv.company) === incomingKey,
          );
          if (idx < 0) return {};
          const existing = s.savedVendors[idx];
          const remaining = (existing.purposes ?? []).filter(
            (p) => p.trim().toLowerCase() !== target,
          );
          const next = s.savedVendors.slice();
          next[idx] = {
            ...existing,
            purposes: remaining.length ? remaining : undefined,
            updatedAt: Date.now(),
          };
          return { savedVendors: next };
        });
      },

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
          savedHosts: data.savedHosts ?? [],
        })),

      applySyncedState: (data) =>
        set(() => ({
          projects: data.projects,
          settings: { ...defaultSettings, ...data.settings },
          workOrders: data.workOrders,
          savedVendors: data.savedVendors ?? [],
          savedVendorEvents: data.savedVendorEvents ?? [],
          savedHosts: data.savedHosts ?? [],
          lastSyncedAt: data.syncedAt,
          syncError: null,
        })),

      applyReconciledState: (data) =>
        set(() => ({
          projects: data.projects,
          savedVendors: data.savedVendors,
          savedVendorEvents: data.savedVendorEvents,
          savedHosts: data.savedHosts,
        })),

      mergeSyncedState: (data) =>
        set((s) => {
          // Projects: union by id. Replace a local project only when the
          // incoming copy is strictly newer; otherwise keep local. Then
          // prepend any incoming projects we don't have locally. Local-
          // only projects are never dropped.
          const localIds = new Set(s.projects.map((p) => p.id));
          const merged = s.projects.map((p) => {
            const inc = data.projects.find((q) => q.id === p.id);
            if (
              inc &&
              new Date(inc.updatedAt).getTime() >
                new Date(p.updatedAt).getTime()
            ) {
              return inc;
            }
            return p;
          });
          const incomingOnly = data.projects.filter(
            (q) => !localIds.has(q.id),
          );

          // Saved vendors: union by id (incoming wins on conflict).
          const vendorById = new Map(s.savedVendors.map((v) => [v.id, v]));
          for (const v of data.savedVendors ?? []) vendorById.set(v.id, v);

          // Saved hosts: union by id (incoming wins on conflict).
          const hostById = new Map(s.savedHosts.map((h) => [h.id, h]));
          for (const h of data.savedHosts ?? []) hostById.set(h.id, h);

          // Saved events: union by id, newer updatedAt wins.
          const eventById = new Map(
            s.savedVendorEvents.map((e) => [e.id, e]),
          );
          for (const e of data.savedVendorEvents ?? []) {
            const cur = eventById.get(e.id);
            if (!cur || e.updatedAt > cur.updatedAt) eventById.set(e.id, e);
          }

          // Work orders: take whichever import snapshot is newer.
          let workOrders = s.workOrders;
          if (data.workOrders) {
            const incMs = new Date(data.workOrders.importedAt).getTime();
            const curMs = s.workOrders
              ? new Date(s.workOrders.importedAt).getTime()
              : 0;
            if (incMs >= curMs) workOrders = data.workOrders;
          }

          return {
            // Newly-arrived boards first so they're easy to spot.
            projects: [...incomingOnly, ...merged],
            savedVendors: Array.from(vendorById.values()),
            savedVendorEvents: Array.from(eventById.values()),
            savedHosts: Array.from(hostById.values()),
            workOrders,
            lastSyncedAt: data.syncedAt,
            syncError: null,
          };
        }),
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
          // Same defensive backfill for savedHosts (host book) — older
          // persisted states predate it, so without this addOrUpdate-
          // SavedHost would crash on `s.savedHosts.findIndex`.
          savedHosts: p.savedHosts ?? current.savedHosts,
        };
      },
    },
  ),
);

export function setProjectStatus(id: string, status: ProjectStatus) {
  useStore.getState().updateProject(id, { status });
}
