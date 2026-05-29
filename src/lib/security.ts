import type { Vendor } from '../types';
import { formatDate } from './format';

export interface SecurityNotificationArgs {
  vendor: Vendor;
  project: { name: string; workOrderId?: string; location?: string };
  securityEmail: string;
  /**
   * Legacy single-string CC (kept for backwards-compat with any caller
   * that hasn't moved to the array form yet). Both this and `ccEmails`
   * are merged + de-duped into the final CC line. Either may be
   * undefined / empty.
   */
  ccEmail?: string;
  /**
   * Newer array form for callers that need to CC multiple addresses
   * (e.g. user email AND the workboard's point-of-contact email).
   * Empty / falsy entries are dropped automatically. De-duplication
   * is case-insensitive — the same address will never appear twice
   * on the CC line even if it shows up in both `ccEmail` and
   * `ccEmails`, or as both the user's own email and the POC email.
   */
  ccEmails?: ReadonlyArray<string | undefined>;
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

/**
 * Args for the section-level "Notify security (all vendors)" button.
 * Sends a single email covering every vendor on the workboard rather
 * than one mailto: per vendor.
 *
 * Project context (location, work order) is shared and rendered
 * once at the top under "Visit context"; each vendor gets its own
 * labeled section block below. The point-of-contact (if any) is
 * listed first and tagged with a ★ marker so the security team can
 * see at a glance who they should contact for any of the visiting
 * vendors.
 *
 * CC behavior:
 *   - user's own email if `ccSelf` is true and `userEmail` is set
 *   - point-of-contact email if a POC vendor exists and has email
 *   - de-duped case-insensitively so neither shows twice
 */
export interface MultiVendorSecurityNotificationArgs {
  vendors: Vendor[];
  project: { name: string; workOrderId?: string; location?: string };
  securityEmail: string;
  ccSelf?: boolean;
  userEmail?: string;
  preamble?: string;
  technicianName?: string;
  /** Same opt-in as the single-vendor flow; routes to Nuvolo too when set. */
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

// ─── Plain-text formatting helpers ───────────────────────────────────
//
// mailto: bodies are forced to plain text by every mail client (Outlook,
// Gmail, Apple Mail) regardless of headers we'd try to set. There's no
// way to land a rendered HTML table in the body. The closest we can get
// to "table" is labeled section blocks with a fixed-width label column,
// so the colon-aligned values read as a tidy two-column layout in the
// proportional font most clients render plain text in. Outlook's
// plain-text view uses a true monospace face, so the alignment is
// exact there.

/** Section heading wrapped in en-dash decorators. Survives word-wrap
 *  better than ASCII underlines and reads as a clear visual break. */
function heading(label: string): string {
  return `─── ${label} ───`;
}

/** Pad a label so the colon column lines up across rows.
 *
 *  Width 10 chosen to fit every label we use:
 *  Name / Company / Role / Phone / Email / Visit / Notes / Project /
 *  Location / Work Order / Vendors. "Work Order" is the longest at
 *  10 chars, so the rest get padded out to match.
 */
function pad(label: string): string {
  return label.padEnd(10, ' ');
}

/**
 * Render a single vendor's contact + visit details as a labeled
 * block. Used by both the single-vendor flow and the multi-vendor
 * flow — only the heading label and the POC marker change between
 * them.
 *
 * Project / Location / Work Order are NOT included here — those are
 * workboard-level context rendered once at the top of the email
 * under a "Visit context" heading, not repeated per vendor.
 */
function renderVendorBlock(
  vendor: Vendor,
  opts: { headingLabel: string; markPrimary?: boolean },
): string[] {
  const lines: string[] = [];
  lines.push(heading(opts.headingLabel));

  // Tag the POC with a ★ marker on the Name line so the security
  // team can see at a glance who to contact for arrival logistics.
  const nameLine = opts.markPrimary
    ? `${pad('Name')}: ${vendor.name} ★ (point of contact)`
    : `${pad('Name')}: ${vendor.name}`;
  lines.push(nameLine);
  if (vendor.company) lines.push(`${pad('Company')}: ${vendor.company}`);
  if (vendor.role) lines.push(`${pad('Role')}: ${vendor.role}`);
  if (vendor.phone) lines.push(`${pad('Phone')}: ${vendor.phone}`);
  if (vendor.email) lines.push(`${pad('Email')}: ${vendor.email}`);

  // Visit line: combines date + (optional) free-form time. "TBD"
  // when the user hasn't picked a date yet — better than omitting
  // the line entirely, which would leave the recipient guessing.
  const visitParts: string[] = [];
  visitParts.push(vendor.visitDate ? formatDate(vendor.visitDate) : 'TBD');
  if (vendor.visitTime) visitParts.push(vendor.visitTime);
  lines.push(`${pad('Visit')}: ${visitParts.join(', ')}`);

  if (vendor.notes) lines.push(`${pad('Notes')}: ${vendor.notes}`);

  return lines;
}

/**
 * Render the workboard-level "Visit context" block — project name,
 * location, work order. Shared by both flows, so the value of
 * factoring it out is consistency: single-vendor emails get the
 * same layout as multi-vendor emails, only the vendor count differs.
 */
function renderVisitContextBlock(
  project: { name: string; workOrderId?: string; location?: string },
  vendorCount?: number,
): string[] {
  const lines: string[] = [];
  lines.push(heading('Visit context'));
  lines.push(`${pad('Project')}: ${project.name}`);
  if (project.location) lines.push(`${pad('Location')}: ${project.location}`);
  if (project.workOrderId)
    lines.push(`${pad('Work Order')}: ${project.workOrderId}`);
  if (typeof vendorCount === 'number')
    lines.push(`${pad('Vendors')}: ${vendorCount}`);
  return lines;
}

/**
 * Combine the legacy `ccEmail` + new `ccEmails` array into a single
 * deduped, case-insensitive CC string. Empty / whitespace entries
 * are dropped. Returns `undefined` when there's nothing to CC, so
 * the URLSearchParams builder can omit the `cc` parameter entirely
 * rather than emitting an empty `cc=` (which some mail clients
 * still surface as a blank CC field).
 */
function joinCcEmails(
  legacy: string | undefined,
  extras: ReadonlyArray<string | undefined> | undefined,
): string | undefined {
  const all = [legacy, ...(extras ?? [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of all) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.length > 0 ? out.join(', ') : undefined;
}

/**
 * Build a structured "vendor visit" notification email targeting the
 * facility security team. Single vendor flow.
 *
 * Body layout:
 *
 *   [optional preamble]
 *
 *   ─── Visit context ───
 *   Project   : <name>
 *   Location  : <where>
 *   Work Order: <FWKD>
 *
 *   ─── Vendor ───
 *   Name      : <name> [★ (point of contact)]
 *   Company   : <co>
 *   Phone     : <phone>
 *   Email     : <email>
 *   Visit     : <date>, <time>
 *   Notes     : <notes>
 *
 *   Requested by: <technician>
 *
 * The ★ POC marker only appears when the vendor's `isPrimaryContact`
 * flag is set. The CC line includes the user's own email (when
 * `ccEmail` is set) plus any extras passed via `ccEmails` — typically
 * the workboard's POC email (which may be this same vendor or a
 * different one if the user is firing off an individual notification
 * for a non-POC vendor).
 *
 * Earlier the body was tagged with "[Sent <timestamp> via MWPJM]" so
 * the user could spot their own security notifications in Sent Items;
 * dropped per the user's PR #23 ask — emails should read as normal
 * technician correspondence.
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

  const lines: string[] = [];
  if (args.preamble) {
    lines.push(args.preamble);
    lines.push('');
  }

  // Visit context first so the recipient sees what the visit is FOR
  // before they read who's coming.
  lines.push(...renderVisitContextBlock(args.project));

  lines.push('');
  lines.push(
    ...renderVendorBlock(args.vendor, {
      headingLabel: 'Vendor',
      markPrimary: !!args.vendor.isPrimaryContact,
    }),
  );

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

  const cc = joinCcEmails(args.ccEmail, args.ccEmails);

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

/**
 * Build a single notification email covering every vendor on the
 * workboard. Used by the section-level "🛡️ Notify security (all
 * vendors)" button on `VendorsSection`.
 *
 * Same body layout as the single-vendor flow plus N per-vendor
 * blocks below the shared "Visit context" header. The point-of-
 * contact is listed first and tagged with a ★ marker.
 *
 * CC list:
 *   - user's own email if `ccSelf` is set
 *   - POC's email if the workboard has a POC and they have email set
 *   - de-duped case-insensitively
 */
export function buildMultiVendorSecurityNotification(
  args: MultiVendorSecurityNotificationArgs,
): SecurityMail {
  // Filter out vendors without names — they're empty cards the user
  // hasn't filled in yet. Also drop any duplicates by id (defensive,
  // shouldn't happen in practice).
  const namedVendors = args.vendors
    .filter((v) => v.name.trim())
    .filter((v, i, arr) => arr.findIndex((w) => w.id === v.id) === i);

  // Order: POC first, then everyone else in their original order.
  const poc = namedVendors.find((v) => v.isPrimaryContact);
  const orderedVendors = poc
    ? [poc, ...namedVendors.filter((v) => v.id !== poc.id)]
    : namedVendors;

  // Subject summarizes vendor count without blowing past mail client
  // length limits. 1 vendor: name. 2: "A + B". 3+: "A + N others".
  const subjectVendors = (() => {
    if (orderedVendors.length === 0) return 'visit';
    if (orderedVendors.length === 1) return orderedVendors[0].name;
    if (orderedVendors.length === 2)
      return `${orderedVendors[0].name} + ${orderedVendors[1].name}`;
    return `${orderedVendors[0].name} + ${orderedVendors.length - 1} others`;
  })();

  const woId = args.project.workOrderId?.trim().toUpperCase() ?? '';
  const postToNuvolo = args.alsoPostToNuvolo && /^FWKD\d+$/i.test(woId);

  const vendorWord =
    orderedVendors.length === 1 ? '1 vendor' : `${orderedVendors.length} vendors`;
  const subject = postToNuvolo
    ? `RE: ${woId} — Vendor visit notice: ${subjectVendors} (${vendorWord})`
    : `Vendor visit notice: ${subjectVendors} (${vendorWord})`;

  const lines: string[] = [];
  if (args.preamble) {
    lines.push(args.preamble);
    lines.push('');
  }

  lines.push(...renderVisitContextBlock(args.project, orderedVendors.length));

  orderedVendors.forEach((v, i) => {
    lines.push('');
    lines.push(
      ...renderVendorBlock(v, {
        headingLabel:
          orderedVendors.length === 1 ? 'Vendor' : `Vendor ${i + 1}`,
        markPrimary: !!v.isPrimaryContact,
      }),
    );
  });

  if (args.technicianName) {
    lines.push('');
    lines.push(`Requested by: ${args.technicianName}`);
  }

  const body = lines.join('\n');

  // To: security + optionally Nuvolo (same routing rules as single).
  const securityTo = (args.securityEmail ?? '').trim();
  const nuvoloTo =
    postToNuvolo && args.nuvoloEmail ? args.nuvoloEmail.trim() : '';
  const to = nuvoloTo ? `${securityTo}, ${nuvoloTo}` : securityTo;

  // CC: user's own email (if ccSelf) + POC email (if POC has one).
  // De-duped against itself in case the user IS the POC.
  const cc = joinCcEmails(undefined, [
    args.ccSelf ? args.userEmail : undefined,
    poc?.email,
  ]);

  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', subject);
  params.set('body', body);
  const query = params.toString().replace(/\+/g, '%20');
  const href = `mailto:${encodeURIComponent(to)}?${query}`;

  return { to, cc, subject, body, href };
}
