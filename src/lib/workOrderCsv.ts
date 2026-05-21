import Papa from 'papaparse';

/**
 * Canonical work order fields we try to surface on the dashboard.
 * Everything else from the CSV is preserved in `extra`.
 */
export interface WorkOrder {
  number: string; // e.g. FWKD0001234
  shortDescription: string;
  state: string;
  priority: string;
  assignedTo: string;
  openedAt: string;
  dueDate: string;
  location: string;
  assignmentGroup: string;
  extra: Record<string, string>;
}

export interface ColumnMap {
  number: string | null;
  shortDescription: string | null;
  state: string | null;
  priority: string | null;
  assignedTo: string | null;
  openedAt: string | null;
  dueDate: string | null;
  location: string | null;
  assignmentGroup: string | null;
}

export interface ImportedWorkOrders {
  importedAt: string;
  sourceFilename: string;
  rawHeaders: string[];
  columnMap: ColumnMap;
  rows: WorkOrder[];
}

/**
 * Common header variants exported by ServiceNow / Nuvolo work order lists.
 * Match is case-insensitive and ignores spaces / underscores.
 */
const COLUMN_PATTERNS: Record<keyof ColumnMap, string[]> = {
  number: ['number', 'workorder', 'wonumber', 'wo', 'ticket', 'fwkd'],
  shortDescription: ['shortdescription', 'description', 'subject', 'summary', 'title'],
  state: ['state', 'status'],
  priority: ['priority'],
  assignedTo: ['assignedto', 'assignee', 'technician', 'owner'],
  openedAt: ['openedat', 'opened', 'created', 'syscreatedon', 'createdat', 'createdon'],
  dueDate: ['duedate', 'due', 'expecteddue', 'targetdate'],
  location: ['location', 'building', 'site', 'room'],
  assignmentGroup: ['assignmentgroup', 'group', 'team'],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function autoDetectColumns(headers: string[]): ColumnMap {
  const normalized = headers.map((h) => ({ original: h, norm: normalize(h) }));
  const result: ColumnMap = {
    number: null,
    shortDescription: null,
    state: null,
    priority: null,
    assignedTo: null,
    openedAt: null,
    dueDate: null,
    location: null,
    assignmentGroup: null,
  };

  for (const key of Object.keys(COLUMN_PATTERNS) as (keyof ColumnMap)[]) {
    const patterns = COLUMN_PATTERNS[key];
    // Prefer exact match first, then "starts with", then "contains"
    let best: { original: string; score: number } | null = null;
    for (const h of normalized) {
      for (const p of patterns) {
        let score = 0;
        if (h.norm === p) score = 3;
        else if (h.norm.startsWith(p)) score = 2;
        else if (h.norm.includes(p)) score = 1;
        if (score > 0 && (!best || score > best.score)) {
          best = { original: h.original, score };
        }
      }
    }
    if (best) result[key] = best.original;
  }

  return result;
}

export function parseCsvFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transform: (v) => (typeof v === 'string' ? v.trim() : v),
      complete: (result) => {
        const headers = result.meta.fields ?? [];
        resolve({ headers, rows: result.data });
      },
      error: (err) => reject(err),
    });
  });
}

export function applyColumnMap(
  rows: Record<string, string>[],
  map: ColumnMap,
): WorkOrder[] {
  return rows.map((row) => {
    const get = (k: string | null) => (k && row[k] ? String(row[k]) : '');
    const extra: Record<string, string> = {};
    const mapped = new Set(Object.values(map).filter(Boolean) as string[]);
    for (const [k, v] of Object.entries(row)) {
      if (!mapped.has(k) && v) extra[k] = String(v);
    }
    return {
      number: get(map.number),
      shortDescription: get(map.shortDescription),
      state: get(map.state),
      priority: get(map.priority),
      assignedTo: get(map.assignedTo),
      openedAt: get(map.openedAt),
      dueDate: get(map.dueDate),
      location: get(map.location),
      assignmentGroup: get(map.assignmentGroup),
      extra,
    };
  });
}

/** Heuristic: is a date string in the past (and non-empty)? */
export function isOverdue(dueDateStr: string): boolean {
  if (!dueDateStr) return false;
  const d = new Date(dueDateStr);
  if (isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/** Group by a field value, returning counts. */
export function countBy(rows: WorkOrder[], key: keyof WorkOrder): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (r[key] as string) || '(blank)';
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return new Map([...m.entries()].sort((a, b) => b[1] - a[1]));
}
