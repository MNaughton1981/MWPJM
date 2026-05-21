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
