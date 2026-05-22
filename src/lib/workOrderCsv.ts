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

export function parseCsvFile(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
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

/**
 * Excel (.xlsx) parser. Lazy-loaded so the ~75 KB `read-excel-file`
 * dependency only ships when an Excel file is actually selected.
 *
 * Returns the same `{ headers, rows }` shape as parseCsvFile so the rest
 * of the import pipeline (autoDetectColumns + applyColumnMap) stays
 * format-agnostic. Reads the first sheet only — Excel saves a CSV→XLSX
 * round-trip as a single sheet, which covers the common failure mode
 * (user double-clicks a CSV, Excel auto-converts on save).
 */
export async function parseXlsxFile(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const { readSheet } = await import('read-excel-file/universal');
  const sheet = await readSheet(file);
  if (!sheet || sheet.length === 0) return { headers: [], rows: [] };
  const headerRow = sheet[0];
  const headers = headerRow
    .map((h) => (h === null || h === undefined ? '' : String(h).trim()))
    .filter((h) => h.length > 0);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < sheet.length; i++) {
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const v = sheet[i]?.[j];
      row[headers[j]] =
        v === null || v === undefined
          ? ''
          : v instanceof Date
            ? v.toISOString().slice(0, 10)
            : String(v);
    }
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * JSON parser for ServiceNow / Nuvolo work order exports.
 *
 * Accepts any of these shapes:
 *   1. Top-level array:           [ { number: "FWKD…", … }, … ]
 *   2. ServiceNow REST envelope:  { result: [ { number: "…", … }, … ] }
 *   3. Common alternates:         { records: […] } | { data: […] } | { rows: […] }
 *   4. ServiceNow display values: { number: { display_value: "FWKD…", value: "FWKD…" }, … }
 *      — flattened to the display_value (falling back to value).
 *
 * Headers are computed as the union of keys across the first 50 records,
 * which catches sparse fields without scanning the entire file.
 */
export async function parseJsonFile(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  let records: Record<string, unknown>[];
  if (Array.isArray(parsed)) {
    records = parsed as Record<string, unknown>[];
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const candidate =
      (Array.isArray(obj.result) && (obj.result as unknown[])) ||
      (Array.isArray(obj.records) && (obj.records as unknown[])) ||
      (Array.isArray(obj.data) && (obj.data as unknown[])) ||
      (Array.isArray(obj.rows) && (obj.rows as unknown[])) ||
      null;
    if (!candidate) {
      throw new Error(
        'JSON does not contain a top-level array or a "result" / "records" / "data" / "rows" array.',
      );
    }
    records = candidate as Record<string, unknown>[];
  } else {
    throw new Error('JSON must be an array of records or an object with one.');
  }
  if (records.length === 0) return { headers: [], rows: [] };

  const headerSet = new Set<string>();
  const sampleSize = Math.min(records.length, 50);
  for (let i = 0; i < sampleSize; i++) {
    const r = records[i];
    if (r && typeof r === 'object') {
      for (const k of Object.keys(r)) headerSet.add(k);
    }
  }
  const headers = [...headerSet];
  const rows = records.map((r) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      const v = (r as Record<string, unknown>)[h];
      if (v === null || v === undefined) {
        out[h] = '';
      } else if (typeof v === 'object' && 'display_value' in v) {
        // ServiceNow's REST API returns objects of shape
        // { display_value: "Open", value: "1", link: "…" } when the
        // request asked for display values. Flatten to the human-
        // readable display_value, falling back to value.
        const sn = v as { display_value?: unknown; value?: unknown };
        out[h] = String(sn.display_value ?? sn.value ?? '');
      } else if (Array.isArray(v) || typeof v === 'object') {
        out[h] = JSON.stringify(v);
      } else {
        out[h] = String(v);
      }
    }
    return out;
  });
  return { headers, rows };
}

/**
 * Format-agnostic dispatch — picks the right parser based on file
 * extension (with a MIME-type fallback). Power Automate setups often
 * deposit .xlsx because Excel auto-converts attachments; manual
 * downloads occasionally end up as .json from ServiceNow's REST UI;
 * scheduled exports stay .csv. The dashboard handles all three.
 */
export async function parseWorkOrderFile(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseXlsxFile(file);
  }
  if (name.endsWith('.json')) {
    return parseJsonFile(file);
  }
  if (name.endsWith('.csv')) {
    return parseCsvFile(file);
  }
  // Fall back to MIME type sniffing for files dropped without a
  // useful extension (rare, but Outlook sometimes mangles filenames).
  if (file.type.includes('json')) return parseJsonFile(file);
  if (file.type.includes('spreadsheet') || file.type.includes('excel')) {
    return parseXlsxFile(file);
  }
  // Default to CSV — papaparse will surface a useful error if the
  // content is genuinely something else.
  return parseCsvFile(file);
}

/** File types we'll accept on the Reports page. Used by both the
 *  manual file picker (`accept="…"`) and the folder-scan helper. */
export const SUPPORTED_REPORT_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json'] as const;

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
export function countBy(
  rows: WorkOrder[],
  key: keyof WorkOrder,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (r[key] as string) || '(blank)';
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return new Map([...m.entries()].sort((a, b) => b[1] - a[1]));
}
