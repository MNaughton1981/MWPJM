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
  const body = `${args.updateText.trim()}${sig}\n\n[Posted ${ts} via MWPJM]`;

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
 * work order by its number. The user can override in Settings if their
 * MathWorks instance uses a different domain or table — the easiest way
 * is to open a real WO in the browser, copy the URL, and paste it here
 * with the FWKD number replaced by `{wo}`.
 */
export const DEFAULT_WO_URL_PATTERN =
  'https://mathworks.service-now.com/sow_work_order.do?sysparm_query=number={wo}';

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
