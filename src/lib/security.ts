import type { Vendor } from '../types';
import { formatDate, formatStamp } from './format';

export interface SecurityNotificationArgs {
  vendor: Vendor;
  project: { name: string; workOrderId?: string; location?: string };
  securityEmail: string;
  ccEmail?: string;
  preamble?: string;
  technicianName?: string;
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
 */
export function buildSecurityNotification(
  args: SecurityNotificationArgs,
): SecurityMail {
  const visitDate = args.vendor.visitDate
    ? formatDate(args.vendor.visitDate)
    : 'TBD';
  const ts = formatStamp();

  const companySuffix = args.vendor.company ? ` (${args.vendor.company})` : '';
  const subject = `Vendor visit notice: ${args.vendor.name}${companySuffix} — ${visitDate}`;

  const lines: string[] = [];
  if (args.preamble) {
    lines.push(args.preamble);
    lines.push('');
  }

  lines.push('Vendor');
  lines.push(`  Name: ${args.vendor.name}`);
  if (args.vendor.company) lines.push(`  Company: ${args.vendor.company}`);
  if (args.vendor.role) lines.push(`  Role: ${args.vendor.role}`);
  if (args.vendor.phone) lines.push(`  Phone: ${args.vendor.phone}`);
  if (args.vendor.email) lines.push(`  Email: ${args.vendor.email}`);

  lines.push('');
  lines.push('Visit');
  lines.push(`  Date: ${visitDate}`);
  if (args.project.location) lines.push(`  Location: ${args.project.location}`);
  if (args.project.workOrderId)
    lines.push(`  Work Order: ${args.project.workOrderId}`);
  lines.push(`  Project: ${args.project.name}`);

  if (args.vendor.notes) {
    lines.push('');
    lines.push('Notes');
    lines.push(`  ${args.vendor.notes}`);
  }

  if (args.technicianName) {
    lines.push('');
    lines.push(`Requested by: ${args.technicianName}`);
  }

  lines.push('');
  lines.push(`[Sent ${ts} via MWPJM]`);

  const body = lines.join('\n');
  // Defensive trims — these arguments may have been undefined in older
  // persisted state before the persist `merge` backfilled defaults.
  const to = (args.securityEmail ?? '').trim();
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
