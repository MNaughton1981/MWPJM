import { formatStamp } from './format';

export const DEFAULT_NUVOLO_EMAIL = 'mathworks@service-now.com';

export interface UpdateMail {
  to: string;
  subject: string;
  body: string;
  href: string;
}

/**
 * Build a mailto: link that ServiceNow / Nuvolo will ingest as a work order
 * note. The conditions enforced by the inbound action are:
 *   1. To: must be the Nuvolo inbound address (default: mathworks@service-now.com)
 *   2. Subject must contain the FWKD work order ID
 *
 * We also prefix "RE:" by convention and append a sortable timestamp.
 */
export function buildNuvoloMail(args: {
  workOrderId: string;
  updateText: string;
  technicianName?: string;
  to?: string;
  now?: Date;
}): UpdateMail {
  const to = (args.to || DEFAULT_NUVOLO_EMAIL).trim();
  const wo = args.workOrderId.trim();
  const ts = formatStamp(args.now ?? new Date());
  const subject = `RE: ${wo} — Update ${ts}`;

  const sig = args.technicianName ? `\n\n— ${args.technicianName}` : '';
  // No app-tag on the body — Nuvolo work order notes should look like
  // a normal technician email, not something stamped by a side tool.
  // (To Do and security-notification emails still tag themselves so
  // the user can spot their own outgoing automation in Sent Items.)
  const body = `${args.updateText.trim()}${sig}`;

  const href =
    `mailto:${encodeURIComponent(to)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  return { to, subject, body, href };
}

/** Validate FWKD work order format (lenient — accepts FWKD followed by digits). */
export function isValidWorkOrderId(s: string | undefined): boolean {
  if (!s) return false;
  return /^FWKD\d+$/i.test(s.trim());
}

/**
 * Sensible default URL pattern for navigating to a ServiceNow / Nuvolo
 * work order by its number. The MathWorks instance uses Nuvolo's
 * `x_nuvo_eam_facilities_work_orders` table (verified from a real
 * desktop URL: `.../x_nuvo_eam_facilities_work_orders.do?sys_id=...`).
 *
 * We use the classic `.do?sysparm_query=number=<wo>` form rather than
 * the modern `now/nav/ui/classic/params/target/...` wrapper because:
 *   - We don't have the per-WO sys_id, only the FWKD number, and
 *     ServiceNow auto-redirects the classic form to the matching record
 *     when exactly one row matches the query.
 *   - The classic form is friendlier to mobile / deep-link handlers
 *     (the modern wrapper is a desktop-UI thing).
 *
 * The user can override in Settings if their workflow needs the modern
 * UI specifically.
 */
export const DEFAULT_WO_URL_PATTERN =
  'https://mathworks.service-now.com/x_nuvo_eam_facilities_work_orders.do?sysparm_query=number={wo}';

/**
 * Previously-shipped defaults that should be auto-upgraded to the
 * current `DEFAULT_WO_URL_PATTERN` on rehydrate. Any user value that
 * exactly matches one of these is treated as "still on the default"
 * and migrated; anything else is preserved as a customization.
 */
export const LEGACY_WO_URL_PATTERNS: ReadonlyArray<string> = [
  // Original guess from PR #5 — wrong table name (sow_work_order).
  'https://mathworks.service-now.com/sow_work_order.do?sysparm_query=number={wo}',
];

/**
 * Resolve a configured URL pattern into a real link for a given work
 * order. Returns null if the pattern is empty or doesn't include {wo}.
 */
export function buildWorkOrderUrl(
  workOrderId: string | undefined,
  pattern: string | undefined,
): string | null {
  if (!workOrderId || !pattern) return null;
  if (!pattern.includes('{wo}')) return null;
  return pattern.replace(
    /\{wo\}/g,
    encodeURIComponent(workOrderId.trim().toUpperCase()),
  );
}
