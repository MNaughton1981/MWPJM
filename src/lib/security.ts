import type { Vendor } from '../types';
import { formatDate } from './format';

export interface SecurityNotificationArgs {
  vendor: Vendor;
  project: { name: string; workOrderId?: string; location?: string };
  securityEmail: string;
  ccEmail?: string;
  preamble?: string;
  technicianName?: string;
  /**
   * When true AND project.workOrderId is a valid FWKD ID, the
   * notification email also routes to Nuvolo:
   *   - To: becomes "securityEmail; nuvoloEmail" (both as primary
   *     recipients, satisfying ServiceNow's inbound-action condition).
   *   - Subject gets prefixed with "RE: FWKD####### — " so the
   *     inbound action matches it to the work order and posts the
   *     body as a WO note.
   * This lets a single email serve double duty: security gets their
   * badge-prep notice AND the work order gets a timestamped record
   * that the vendor was notified. Opt-out (unchecked) when the user
   * is sending a notification unrelated to their own work order.
   */
  alsoPostToNuvolo?: boolean;
  nuvoloEmail?: string;
}

export interface SecurityMail {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  href: string;
}

export const DEFAULT_SECURITY_PREAMBLE =
  'Hi Security team — please prepare a visitor badge for the following vendor visit. Let me know if you need anything else from me.';

/**
 * Build a structured "vendor visit" notification email targeting the
 * facility security team. Uses the same lean pattern as Nuvolo updates:
 * builds a mailto: URL and hands off to the user's default mail client.
 *
 * Body formatting:
 *   - Section headings (Vendor / Visit / Notes) are wrapped in en-dash
 *     decorators so they read as visually distinct in plain-text mail
 *     clients. mailto: URLs do not support HTML bodies (every desktop
 *     and mobile client treats the body as text/plain regardless of
 *     headers we'd try to set), so this is the closest we can get to
 *     "bold" without making the user round-trip through copy/paste.
 *   - Field rows are flush-left under each section, no two-space
 *     indent, matching how the user requested the layout.
 *   - No app signature line. Earlier the body was tagged with
 *     "[Sent <timestamp> via MWPJM]" so the user could spot their own
 *     security notifications in Sent Items; the user dropped that
 *     ask along with the matching tag on Nuvolo posts because the
 *     emails should read as normal technician correspondence.
 */
export function buildSecurityNotification(
  args: SecurityNotificationArgs,
): SecurityMail {
  const visitDate = args.vendor.visitDate
    ? formatDate(args.vendor.visitDate)
    : 'TBD';

  const companySuffix = args.vendor.company ? ` (${args.vendor.company})` : '';

  // When routing to Nuvolo, prefix subject with "RE: FWKD#######" so
  // ServiceNow's inbound action matches the email to the work order.
  const woId = args.project.workOrderId?.trim().toUpperCase() ?? '';
  const postToNuvolo =
    args.alsoPostToNuvolo && /^FWKD\d+$/i.test(woId);

  const subject = postToNuvolo
    ? `RE: ${woId} — Vendor visit notice: ${args.vendor.name}${companySuffix} — ${visitDate}`
    : `Vendor visit notice: ${args.vendor.name}${companySuffix} — ${visitDate}`;

  /** Plain-text "bold-ish" section heading. Three en-dashes either side
   *  reads as a clear visual break in any mail client and survives
   *  word-wrap better than ASCII underlines. */
  const heading = (label: string): string => `─── ${label} ───`;

  const lines: string[] = [];
  if (args.preamble) {
    lines.push(args.preamble);
    lines.push('');
  }

  lines.push(heading('Vendor'));
  lines.push(`Name: ${args.vendor.name}`);
  if (args.vendor.company) lines.push(`Company: ${args.vendor.company}`);
  if (args.vendor.role) lines.push(`Role: ${args.vendor.role}`);
  if (args.vendor.phone) lines.push(`Phone: ${args.vendor.phone}`);
  if (args.vendor.email) lines.push(`Email: ${args.vendor.email}`);

  lines.push('');
  lines.push(heading('Visit'));
  lines.push(`Date: ${visitDate}`);
  if (args.vendor.visitTime) lines.push(`Time: ${args.vendor.visitTime}`);
  if (args.project.location) lines.push(`Location: ${args.project.location}`);
  if (args.project.workOrderId)
    lines.push(`Work Order: ${args.project.workOrderId}`);
  lines.push(`Project: ${args.project.name}`);

  if (args.vendor.notes) {
    lines.push('');
    lines.push(heading('Notes'));
    lines.push(args.vendor.notes);
  }

  if (args.technicianName) {
    lines.push('');
    lines.push(`Requested by: ${args.technicianName}`);
  }

  const body = lines.join('\n');

  // Build To: field — security team is always primary recipient.
  // When also posting to Nuvolo, mathworks@service-now.com joins the
  // To: line (NOT CC:) so ServiceNow's inbound action processes it.
  const securityTo = (args.securityEmail ?? '').trim();
  const nuvoloTo =
    postToNuvolo && args.nuvoloEmail ? args.nuvoloEmail.trim() : '';
  const to = nuvoloTo
    ? `${securityTo}, ${nuvoloTo}`
    : securityTo;

  const cc = args.ccEmail?.trim();

  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', subject);
  params.set('body', body);
  // URLSearchParams encodes spaces as + which most mail clients accept,
  // but mailto: convention is %20 — replace to be safe.
  const query = params.toString().replace(/\+/g, '%20');
  const href = `mailto:${encodeURIComponent(to)}?${query}`;

  return { to, cc, subject, body, href };
}
