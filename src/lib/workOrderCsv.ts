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
 * Wrapper keys we recognize at the top level of a JSON file as
 * "the array of records lives here". Order matters — earlier keys
 * win when multiple are present.
 *
 *   - result:                ServiceNow REST table API
 *   - records / data / rows: common bespoke exports
 *   - value:                 OData / Microsoft Graph / SharePoint REST / Power Automate "Get items"
 *   - items / entries:       further common alternates
 */
const JSON_RECORD_WRAPPER_KEYS = [
  'result',
  'records',
  'data',
  'rows',
  'value',
  'items',
  'entries',
] as const;

/**
 * Heuristic: does this object look like a *single* work order record
 * (rather than a wrapper around one)? Used to handle one-row exports
 * that show up as a top-level object instead of a one-element array.
 */
function looksLikeWorkOrderRecord(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj).map((k) =>
    k.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
  const hints = [
    'number',
    'shortdescription',
    'description',
    'state',
    'priority',
    'fwkd',
    'workorder',
  ];
  return hints.some((h) => keys.includes(h));
}

/**
 * Try to parse the file as NDJSON (newline-delimited JSON — one JSON
 * value per line). Returns null if the content doesn't fit that shape.
 * Used as a fallback when the file isn't a single valid JSON document
 * but each line is — ServiceNow's bulk-export option does this, as do
 * many command-line tools (jq, etc.).
 */
function tryParseNdjson(text: string): unknown[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const out: unknown[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * JSON parser for ServiceNow / Nuvolo work order exports.
 *
 * Supports a wide range of shapes because Power Automate and other
 * routing tools sometimes nest the array in unexpected places:
 *
 *   1. Top-level array:           [ { number: "FWKD…", … }, … ]
 *   2. Wrapped under a known key: { result | records | data | rows | value | items | entries: [...] }
 *   3. NDJSON (one per line):     {"number":"FWKD…",…}\n{"number":"…",…}\n…
 *   4. ServiceNow display values: { number: { display_value: "FWKD…", value: "FWKD…" }, … }
 *      — flattened to display_value (falling back to value).
 *   5. First nested array of objects, anywhere at the top level —
 *      catches generic wrappers like { meta: …, queryResults: [...] }.
 *   6. Single record at the top level (wrapped to a one-element array).
 *   7. Object map keyed by record ID:
 *      { "FWKD0001": { number: "FWKD0001", … }, "FWKD0002": { … } }
 *      — sometimes produced by Power Automate "Create file" actions.
 *
 * Headers are computed as the union of keys across the first 50
 * records, which catches sparse fields without scanning the whole
 * file. If everything fails, the error message lists the actual
 * top-level keys so the user can paste them back and the parser can
 * be extended in seconds.
 */
export async function parseJsonFile(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Fall back to NDJSON — common for streamed / line-based exports.
    const ndjson = tryParseNdjson(text);
    if (ndjson) {
      parsed = ndjson;
    } else {
      throw new Error(
        'File is not valid JSON (and not newline-delimited JSON either).',
      );
    }
  }

  let records: Record<string, unknown>[] | null = null;

  if (Array.isArray(parsed)) {
    records = parsed as Record<string, unknown>[];
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    // 1. Known wrapper keys (priority order)
    for (const key of JSON_RECORD_WRAPPER_KEYS) {
      if (Array.isArray(obj[key])) {
        records = obj[key] as Record<string, unknown>[];
        break;
      }
    }

    // 2. Generic fallback: any top-level array-of-objects we haven't
    //    matched yet. Catches wrappers like { meta:{…}, results:[…] }
    //    where the array key isn't one we already special-case.
    if (!records) {
      for (const v of Object.values(obj)) {
        if (
          Array.isArray(v) &&
          v.length > 0 &&
          typeof v[0] === 'object' &&
          v[0] !== null &&
          !Array.isArray(v[0])
        ) {
          records = v as Record<string, unknown>[];
          break;
        }
      }
    }

    // 3. Single record at top level → wrap to a one-element array.
    //    Only if the object's keys look work-order-shaped, so we don't
    //    mistakenly treat a metadata wrapper as a record.
    if (!records && looksLikeWorkOrderRecord(obj)) {
      records = [obj];
    }

    // 4. Object map keyed by ID: every value is a record-shaped object.
    if (!records) {
      const values = Object.values(obj);
      if (
        values.length > 0 &&
        values.every(
          (v) =>
            v !== null &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            looksLikeWorkOrderRecord(v as Record<string, unknown>),
        )
      ) {
        records = values as Record<string, unknown>[];
      }
    }

    if (!records) {
      const keys = Object.keys(obj).slice(0, 12);
      const keysList = keys.length ? keys.join(', ') : '(no top-level keys)';
      throw new Error(
        `JSON has top-level keys [${keysList}] but no recognizable records array. ` +
          `Expected one of: ${JSON_RECORD_WRAPPER_KEYS.join(', ')} — ` +
          `or a top-level array of records.`,
      );
    }
  } else {
    throw new Error(
      'JSON must be an array of records, an object containing one, or NDJSON.',
    );
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
