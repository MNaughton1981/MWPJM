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
  notes?: string;
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
   * Filename used for the cross-device state sync file inside the
   * connected folder. Defaults to `mwpjm-state.json`. Lives next to
   * the user's CSV exports — OneDrive doesn't care.
   */
  syncFilename: string;
}

export interface AppData {
  version: 1;
  exportedAt: string;
  projects: Project[];
  settings: Settings;
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
  complete: 'Complete',
};
