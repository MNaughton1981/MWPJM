export type TradeKey =
  | 'plumbing'
  | 'electrical'
  | 'carpentry'
  | 'hvac'
  | 'general'
  | 'other';

export type TradeStatus =
  | 'not_scheduled'
  | 'scheduled'
  | 'on_site'
  | 'completed'
  | 'blocked';

export interface Trade {
  id: string;
  key: TradeKey;
  label: string;
  contact?: string;
  phone?: string;
  status: TradeStatus;
  scheduledDate?: string; // ISO date (YYYY-MM-DD)
  notes?: string;
}

export interface Milestone {
  id: string;
  title: string;
  date?: string; // ISO date (YYYY-MM-DD)
  done: boolean;
  trade?: TradeKey;
  notes?: string;
}

export interface ActivityEntry {
  id: string;
  timestamp: string; // ISO datetime
  text: string;
  postedToNuvolo: boolean;
  author?: string;
}

/**
 * One scheduled on-site visit for a vendor. A vendor can have several —
 * e.g. a lead tech who comes Friday to prep and is back Saturday–Sunday
 * with the crew. Each entry is either a single day (`date` only) or a
 * "run" of consecutive days (`date` → `endDate`).
 */
export interface VendorVisit {
  id: string;
  /** ISO start date (YYYY-MM-DD). */
  date?: string;
  /**
   * Optional ISO end date (YYYY-MM-DD). When set and after `date`, the
   * visit renders as a run of days ("Sat, Jun 27 – Sun, Jun 28").
   * Leave blank for a single-day visit.
   */
  endDate?: string;
  /**
   * Free-form / dropdown time string for this visit, e.g. "7:00 AM" or
   * a window "8:00 AM – 10:00 AM". Same shape as the legacy `visitTime`.
   */
  time?: string;
}

/**
 * A vendor / contractor / contact person coming on-site for a project.
 * Distinct from the Trade Coordination tracker — vendors are individual
 * people you might need to identify to security, give a visitor badge,
 * etc. Trades are higher-level scheduling buckets (plumbing crew status).
 */
export interface Vendor {
  id: string;
  name: string;
  company?: string;
  role?: string; // free-form, e.g. "Plumber", "Electrician"
  phone?: string;
  email?: string;
  /**
   * On-site host for this vendor's visit — the person security lists as
   * "who are you here to see?", preps the badge under, and notifies when
   * the vendor signs in. Per-vendor (not per-workboard) so a job spanning
   * multiple days / people can name a different point person per vendor —
   * e.g. the coordinator is out on vacation the day of the work, so a
   * covering co-worker is named as the host for that day's vendors.
   *
   * When blank, notifications fall back to the technician's own name
   * (settings.technicianName) — the common case where the coordinator is
   * also the host. Set it explicitly only when someone else is covering.
   */
  host?: string;
  /**
   * Email for the host above. Only needed when the host isn't you (the
   * sender) — e.g. a co-worker covering while you're out. When set and
   * different from the sender's own email, it's added to the CC line of
   * the security notification so the host is looped in. A host name with
   * no email simply isn't CC'd (we can't guess their address).
   */
  hostEmail?: string;
  /**
   * Purpose of this on-site visit — why the vendor is here this time
   * (e.g. "Quarterly PM", "Leak repair", "Install"). Distinct from
   * `role` (their trade, e.g. Plumber). Surfaces in the security
   * notification so the desk knows what the visit is for.
   *
   * Can be pulled from the vendor's saved `purposes` in the book via a
   * dropdown, or typed fresh. Saving it back to the book is opt-in (a
   * checkbox on the vendor card) so the list of recurring purposes
   * builds up per vendor without anything defaulting automatically.
   */
  purpose?: string;
  visitDate?: string; // ISO date (YYYY-MM-DD)
  /**
   * Free-form visit time hint, surfaced in the security notification
   * email under the Visit section. Intentionally a string rather than
   * a structured time-of-day field so the user can express either a
   * fixed time ("7:00 AM") or a window ("8:00 AM – 10:00 AM") without
   * the form forcing one shape over the other. No validation — what
   * the user types here is what the email gets.
   */
  visitTime?: string;
  /**
   * Multiple scheduled visits for this vendor — supports a vendor
   * coming on more than one date, or across a run of consecutive days.
   * When present and non-empty, this supersedes the single
   * `visitDate` / `visitTime` for display and notifications.
   *
   * Backwards compatibility: `visitDate` / `visitTime` are kept in sync
   * with the FIRST visit in this array (mirrored on every edit), so
   * older code paths and Excel exports that read the flat fields keep
   * working. Vendors created before this field default to a single
   * derived visit built from `visitDate` / `visitTime` (see
   * `getVendorVisits` in lib/visits.ts).
   */
  visits?: VendorVisit[];
  notes?: string;
  /**
   * When true, this vendor is the workboard's point of contact —
   * the person you're coordinating with for this visit. Single POC
   * per workboard (radio-button semantics enforced by the
   * `setPrimaryVendorContact` store action: setting one as POC
   * automatically clears the flag on every other vendor in the
   * same workboard).
   *
   * Two effects when set AND `email` is non-empty:
   *   1. Listed first in the vendor list with a ★ marker.
   *   2. CC'd on every security notification email sent from this
   *      workboard (both per-vendor and the multi-vendor "Notify
   *      security (all vendors)" button), so the POC stays in the
   *      loop on badge prep / arrival logistics regardless of which
   *      vendor's button was tapped.
   *
   * Absence (undefined / false) = not the POC. Existing vendors
   * without this field default to non-POC.
   */
  isPrimaryContact?: boolean;
}

/**
 * A vendor template stored in the global "vendor book" — independent
 * of any specific project. Lets users build up a contact list of the
 * vendors / companies they work with repeatedly (City Point, SullyMac,
 * Joe Warren & Sons, etc.) so they're not re-typing names, phones,
 * and emails every time a vendor is added to a workboard.
 *
 * Saved separately from `Vendor` because saved entries don't have
 * visit-specific fields (visitDate, visitTime, notes — those vary
 * per workboard). When a saved vendor is added to a workboard, the
 * template fields (name, company, role, phone, email, generalNotes)
 * are copied; the visit fields are left blank for the user to fill
 * in for that specific visit.
 *
 * Dedupe key when saving from a workboard: `lower(trim(name)) | lower(trim(company))`.
 * Same name with different companies = different entry (e.g. "Mike"
 * at SullyMac vs. "Mike" at City Point). Same name + same company
 * updates the existing entry.
 */
export interface SavedVendor {
  id: string;
  name: string;
  company?: string;
  role?: string;
  phone?: string;
  email?: string;
  /**
   * Persistent notes about working with this vendor — distinct from
   * the per-visit `notes` on a workboard Vendor. Things like "Always
   * call ahead", "Prefers afterhours", "Has master key — no FOB
   * needed". Pre-fills a workboard vendor's notes field when the
   * saved entry is selected, where the user can append visit-specific
   * details on top.
   */
  generalNotes?: string;
  /**
   * Recurring on-site purposes saved for this vendor — e.g.
   * ["Quarterly PM", "Annual inspection", "Leak repair"]. Built up
   * opt-in via the "Save purpose to book" checkbox on a workboard
   * vendor card. When this vendor is added to a workboard, these are
   * offered as a dropdown in the Purpose field so the user can pick a
   * known purpose instead of retyping it. Older book entries predate
   * this field; treat missing as an empty list.
   */
  purposes?: string[];
  /**
   * Epoch ms of the last edit to this book entry. Used by the Phase B
   * two-way Excel sync for per-record last-write-wins reconciliation
   * (the vendor book is a global list, so it needs row-level timestamps
   * rather than relying on a parent's updatedAt). Absent on entries
   * created before this field — treated as oldest during reconcile.
   */
  updatedAt?: number;
}

/**
 * A saved on-site host — typically a co-worker on the facilities team
 * the user names as the visit host on a vendor. Stored in a global
 * "host book" so their name + email can be pulled into future vendor
 * entries via a dropdown instead of being re-typed. Dedupe key when
 * saving is the lowercased, trimmed name.
 */
export interface SavedHost {
  id: string;
  name: string;
  email?: string;
  /**
   * Epoch ms of the last edit. Used by the Phase B two-way Excel sync
   * for per-record last-write-wins reconciliation. Absent on older
   * entries — treated as oldest during reconcile.
   */
  updatedAt?: number;
}

/**
 * A recurring vendor service / event template — quarterly drain
 * service, annual fire alarm test, monthly elevator inspection, etc.
 * Stored at the app level (not per-workboard) so the user can
 * "easily push a new notification" each time the service is on the
 * horizon, without re-typing the vendor + service info.
 *
 * Key design points:
 *   - **Stable id, in-place edit by id.** Renaming "fitness center
 *     drain service" → "fitness center floor drain service" updates
 *     the same row. No name-based dedupe (avoids the bug where editing
 *     a name silently spawns a duplicate event).
 *   - **Snapshot vendor info, not a live link to the Vendor Book.**
 *     Keeps the event self-contained and predictable. If a vendor's
 *     phone changes, the user edits the event template directly.
 *     Simpler than a soft-link with fallback for v1.
 *   - **Standalone notification trigger.** Firing an event opens the
 *     security-team notification mailto: directly with the event's
 *     vendor + service description and the user's just-entered visit
 *     date/time. No workboard is created — this is pure coordination
 *     work, not the kind of project that needs photo documentation.
 *
 * Synced cross-device alongside projects/settings/savedVendors so
 * "save event on desktop" → "fire it on mobile next quarter" works.
 */
export interface SavedVendorEvent {
  id: string;
  /** "Q2 fitness center floor drain service" */
  name: string;
  /**
   * Free-form cadence / frequency hint, e.g. "Quarterly", "Annual",
   * "As needed". Display-only — there's no scheduler tied to this
   * field, the user fires the notification manually when the work
   * is confirmed.
   */
  cadence?: string;
  // Vendor snapshot — flat fields rather than a nested Vendor so the
  // event can be edited / displayed without the visit-specific bits.
  vendorName?: string;
  vendorCompany?: string;
  vendorRole?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  /**
   * Description of the service being performed — surfaces in the
   * security notification so the security team understands what
   * the visit is for. Prepended to the per-fire notes block.
   */
  serviceDescription?: string;
  /**
   * Default visit notes that don't change between fires (access
   * instructions, "go to the loading dock", "Tom has the master
   * key", etc.). Combined with any per-fire addendum the user types
   * at fire time.
   */
  defaultVisitNotes?: string;
  /** Epoch ms — used for sort order in the events list (newest first). */
  createdAt: number;
  updatedAt: number;
}

/**
 * Photo metadata. Binary data is stored separately in IndexedDB
 * (see src/lib/photoStorage.ts) keyed by `${projectId}/${photoId}`.
 */
export interface ProjectPhoto {
  id: string;
  mimeType: string;
  originalName: string;
  caption: string;
  capturedAt: string; // ISO datetime
  addedAt: string; // ISO datetime
  size: number; // bytes
}

export type ProjectStatus =
  | 'planning'
  | 'in_progress'
  | 'on_hold'
  | 'complete';

export interface Project {
  id: string;
  name: string;
  location?: string;
  workOrderId?: string; // FWKD0000000
  description?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  trades: Trade[];
  milestones: Milestone[];
  activity: ActivityEntry[];
  photos: ProjectPhoto[];
  vendors: Vendor[];
  /**
   * When true, the project page hides Trade Coordination and Timetable
   * sections — use for quick WO follow-ups where notes, photos, and
   * vendor info are the whole story. Existing projects without this
   * field default to false (full layout) so we don't break anything.
   */
  simple?: boolean;
  /**
   * Epoch milliseconds the workboard was archived. Absence (undefined
   * / missing field) means the workboard is active and shows on the
   * default Workboards list. When set, the workboard is hidden from
   * the default list but still accessible via the "View archived"
   * toggle, can be opened normally, and is fully recoverable via
   * Unarchive — all photos, activity, vendors, and FWKD linkage are
   * preserved.
   *
   * Archive is intentionally a separate, lighter-weight action than
   * the existing destructive Delete. Field-test feedback was that
   * users were deleting workboards once a job was done in order to
   * keep the list relevant, which threw away the documentation. With
   * archive available, Delete becomes the rare "this was a test /
   * I created it by accident" path, and Archive is the routine
   * "this job is closed, get it off my main list" path.
   */
  archivedAt?: number;
  /**
   * Epoch ms when the workboard was pinned to the top of the
   * Workboards list. Absence (undefined) = unpinned. Pinned
   * workboards sort above unpinned ones, with the most recently
   * pinned at the very top — so the user can promote a few
   * frequently-revisited workboards (recurring kitchenette pilot,
   * the on-call ticket they're still chasing on Monday) to a
   * stable, easy-to-tap location regardless of how recently they
   * were edited.
   *
   * Toggle pin via the 📌 button on each Workboards-list card.
   * Pinning does NOT bump `updatedAt` — the workboard's last-
   * touched time stays meaningful, so unpinning later doesn't
   * leave it artificially at the top of the unpinned section.
   */
  pinnedAt?: number;
}

export interface Settings {
  technicianName: string;
  nuvoloEmail: string; // default mathworks@service-now.com
  /**
   * Display-only string of where Nuvolo reports get exported. Browsers
   * cannot read arbitrary local paths, so this is purely a hint shown
   * in the UI to remind the user where to navigate. Real folder access
   * is via the File System Access API (see folderConnection.ts).
   */
  reportFolderPath: string;
  /**
   * Template used when generating a downloadable filename for a photo.
   * Supported placeholders: {wo} {project} {date} {caption} {seq} {ext}.
   */
  photoNamingPattern: string;
  /**
   * The user's own email — used as the To: for the "Add to To Do"
   * action so flagged messages flow into Microsoft To Do. Optional;
   * if blank the mail client opens with an empty To: field.
   */
  userEmail: string;
  /**
   * URL pattern for opening a Nuvolo / ServiceNow work order by number.
   * `{wo}` is replaced by the FWKD ID at render time. Used to render the
   * Work Order ID as a clickable link from project pages and dashboard
   * rows. Override per-tenant — the easiest way is to copy a real WO
   * URL from your browser and substitute the number with `{wo}`.
   */
  nuvoloWorkOrderUrlPattern: string;
  /** Security team email for vendor-visit notifications. */
  securityEmail: string;
  /** Optional preamble prepended to every security notification. */
  securityPreamble: string;
  /** When true, CC the user (settings.userEmail) on security notifications. */
  securityCcSelf: boolean;
  /**
   * When true (and the File System Access API is available), the app
   * writes a JSON snapshot of state to the connected folder every time
   * something changes — debounced. OneDrive then replicates that file
   * to the user's other devices, where they can pull it on demand.
   * Off by default; only meaningful on Chromium desktop browsers.
   */
  syncEnabled: boolean;
  /**
   * When true, the app syncs its state to the user's OneDrive for
   * Business over Microsoft Graph (requires signing in with the
   * MathWorks account). Unlike the folder-based `syncEnabled`, this
   * works on every device and browser — including mobile — because it
   * goes over the network instead of the desktop-only File System
   * Access API. Off by default until the user signs in and enables it.
   */
  graphSyncEnabled?: boolean;
  /**
   * Filename used for the cross-device state sync file inside the
   * connected folder. Defaults to `mwpjm-state.json`. Lives next to
   * the user's CSV exports — OneDrive doesn't care.
   */
  syncFilename: string;
  /**
   * User's preferred calendar provider for Reminder .ics files.
   * 'google' = Google Calendar (https://calendar.google.com URL),
   * 'outlook' = Outlook Calendar (.ics download).
   * Defaults to 'outlook'.
   */
  calendarProvider: 'google' | 'outlook';
  /**
   * Optional: Last imported meeting notes CSV filename (display only).
   * Used by the 1:1 Manager to show what closed-WO data was loaded.
   * Kept separate from reportFolderPath / daily workOrders import so
   * the user can pull closed tickets over a specific date range for
   * meeting prep without interfering with the Dashboard's active-WO list.
   */
  meetingNotesFilename?: string;
  /**
   * Name of the subfolder (under the connected Data folder) where photo
   * files are stored, e.g. `…/Data/photos/`. Default 'photos'. This is
   * a real, functional name — the app creates/uses the subfolder via the
   * File System Access API; it is NOT a typed absolute path (the browser
   * can't write to one of those). Used by the upcoming photo-sync feature.
   */
  photosSubfolder?: string;
  /**
   * Name of the subfolder (under the connected Data folder) where Nuvolo
   * report exports (CSV/XLSX/JSON) are dropped, e.g. `…/Data/reports/`.
   * Default 'reports'. When set and present, "Refresh from folder" scans
   * it; if the subfolder is missing it gracefully falls back to scanning
   * the connected folder root, so existing setups keep working.
   */
  reportsSubfolder?: string;
}

export interface AppData {
  version: 1;
  exportedAt: string;
  projects: Project[];
  settings: Settings;
  /**
   * Optional in the AppData JSON — older backups predate the vendor
   * book feature. Importers should default to `[]` when missing.
   */
  savedVendors?: SavedVendor[];
  /**
   * Optional in the AppData JSON — older backups predate the saved
   * vendor events feature. Importers should default to `[]` when
   * missing.
   */
  savedVendorEvents?: SavedVendorEvent[];
  /**
   * Optional in the AppData JSON — older backups predate the host book.
   * Importers should default to `[]` when missing.
   */
  savedHosts?: SavedHost[];
}

export const TRADE_LABELS: Record<TradeKey, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  carpentry: 'Carpentry',
  hvac: 'HVAC',
  general: 'General Labor',
  other: 'Other',
};

export const STATUS_LABELS: Record<TradeStatus, string> = {
  not_scheduled: 'Not scheduled',
  scheduled: 'Scheduled',
  on_site: 'On site',
  completed: 'Completed',
  blocked: 'Blocked',
};

export const STATUS_COLORS: Record<TradeStatus, string> = {
  not_scheduled: 'bg-slate-200 text-slate-700',
  scheduled: 'bg-blue-100 text-blue-800',
  on_site: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  blocked: 'bg-rose-100 text-rose-800',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'Planning',
  in_progress: 'In progress',
  on_hold: 'On hold',
  // Labeled "Closed" to mirror Nuvolo's work-order states. The internal
  // value stays 'complete' (no data migration); only the display changes.
  complete: 'Closed',
};
