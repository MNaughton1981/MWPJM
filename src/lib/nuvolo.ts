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
