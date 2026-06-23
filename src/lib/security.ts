import type { Vendor } from '../types';
import { formatDate } from './format';
import { meaningfulVisits, formatVisitLabel } from './visits';

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

// ─── Rich-HTML table formatting ──────────────────────────────────────
//
// mailto: bodies can only ever be plain text, so colored / shaded tables
// can't ride along in the auto-filled email body. The app's established
// pattern (see exporters.ts + destinations.copyRichText) is to write
// rich HTML to the clipboard so the user pastes a real, rendered table
// into their Outlook compose window. `buildVendorTableHtml` produces
// that table: a header row, one row per vendor, zebra striping for
// readability, and an amber-highlighted point-of-contact row. Styles
// are inline-only so Outlook / Word render them without a stylesheet.

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2brHtml(s: string): string {
  return escHtml(s).replace(/\r?\n/g, '<br>');
}

/**
 * Build a shaded, rendered HTML table covering every named vendor on
 * the workboard — designed to be written to the clipboard and pasted
 * into an Outlook / Word / OneNote compose surface. Fields mirror what
 * a security desk cares about (name, company, role/trade, purpose,
 * phone, email, host, visit date+time).
 *
 * Orientation adapts to keep the table narrow enough for email / mobile:
 *   - Normal case (a handful of vendors): TRANSPOSED — field names run
 *     down the left as row headers and each vendor is a column (their
 *     name is the column header, POC tinted amber). With more fields
 *     than vendors this is far narrower than a wide table.
 *   - Many-vendors case (vendors + 1 > field count): falls back to the
 *     wide layout (one row per vendor, fields across the top).
 *
 * Empty fields no vendor fills in are dropped. Cells are zebra-shaded
 * and the POC is tagged with a ★.
 *
 * Returns an HTML fragment (preamble paragraph + visit-context block +
 * table). Pair it with the plain-text body from
 * `buildMultiVendorSecurityNotification` as the clipboard fallback.
 */
export function buildVendorTableHtml(
  args: MultiVendorSecurityNotificationArgs,
): string {
  const namedVendors = args.vendors
    .filter((v) => v.name.trim())
    .filter((v, i, arr) => arr.findIndex((w) => w.id === v.id) === i);

  const poc = namedVendors.find((v) => v.isPrimaryContact);
  const ordered = poc
    ? [poc, ...namedVendors.filter((v) => v.id !== poc.id)]
    : namedVendors;

  const parts: string[] = [];
  const baseFont = 'font-family:Arial,Helvetica,sans-serif;font-size:13px';

  if (args.preamble) {
    parts.push(`<p style="${baseFont}">${nl2brHtml(args.preamble)}</p>`);
  }

  // Visit context — shown once above the table.
  const ctx: string[] = [];
  ctx.push(`<b>Project:</b> ${escHtml(args.project.name)}`);
  if (args.project.location)
    ctx.push(`<b>Location:</b> ${escHtml(args.project.location)}`);
  if (args.project.workOrderId)
    ctx.push(`<b>Work Order:</b> ${escHtml(args.project.workOrderId)}`);
  parts.push(`<p style="${baseFont}">${ctx.join('<br>')}</p>`);

  // Cell / header styling (inline only, so Outlook & Word render it
  // without a stylesheet).
  const headStyle =
    'background:#1f4e79;color:#ffffff;text-align:left;padding:8px;border:1px solid #b9c6d6;font-size:12px';
  const rowHeadStyle =
    'background:#dce6f1;color:#1f3551;text-align:left;padding:8px;border:1px solid #b9c6d6;font-size:12px;font-weight:bold;white-space:nowrap';
  const cellStyle =
    'padding:8px;border:1px solid #d4dde8;font-size:13px;vertical-align:top';

  // Per-vendor derived bits.
  const nameHtml = (v: Vendor) =>
    v.isPrimaryContact
      ? `${escHtml(v.name)} &#9733; <span style="color:#8a6d00">(point of contact)</span>`
      : escHtml(v.name);
  const hostOf = (v: Vendor) => v.host?.trim() || args.technicianName || '';
  const emailHtml = (v: Vendor) =>
    v.email ? `<a href="mailto:${escHtml(v.email)}">${escHtml(v.email)}</a>` : '';
  const visitHtmlOf = (v: Vendor) => {
    const visits = meaningfulVisits(v);
    return visits.length === 0
      ? 'TBD'
      : visits.map((vis) => escHtml(formatVisitLabel(vis))).join('<br>');
  };

  // Field definitions. `raw` is used only to prune fields that no vendor
  // fills in; `html` is what actually renders. Name and Visit always show.
  type FieldDef = {
    label: string;
    always?: boolean;
    raw: (v: Vendor) => string;
    html: (v: Vendor) => string;
  };
  const allFields: FieldDef[] = [
    { label: 'Name', always: true, raw: (v) => v.name, html: (v) => `<b>${nameHtml(v)}</b>` },
    { label: 'Company', raw: (v) => v.company ?? '', html: (v) => escHtml(v.company ?? '') },
    { label: 'Role / trade', raw: (v) => v.role ?? '', html: (v) => escHtml(v.role ?? '') },
    { label: 'Purpose', raw: (v) => v.purpose ?? '', html: (v) => escHtml(v.purpose ?? '') },
    { label: 'Phone', raw: (v) => v.phone ?? '', html: (v) => escHtml(v.phone ?? '') },
    { label: 'Email', raw: (v) => v.email ?? '', html: (v) => emailHtml(v) },
    { label: 'Host', raw: (v) => hostOf(v), html: (v) => escHtml(hostOf(v)) },
    { label: 'Visit', always: true, raw: () => '', html: (v) => visitHtmlOf(v) },
  ];
  const fields = allFields.filter(
    (f) => f.always || ordered.some((v) => f.raw(v).trim() !== ''),
  );

  const tableOpen = `<table border="1" cellspacing="0" cellpadding="8" style="border-collapse:collapse;${baseFont}">`;

  if (ordered.length === 0) {
    parts.push(`<p style="${baseFont}"><i>No vendors with a name yet.</i></p>`);
    return parts.join('\n');
  }

  // Orientation: when the wide layout would have "too many columns"
  // (more field columns than vendors), transpose so the field names
  // become row headers down the left and each vendor is a column. With
  // the usual handful of vendors this is far narrower and reads cleanly
  // in email and on mobile. Fall back to the wide layout only when there
  // are so many vendors that vendor-columns would be wider than fields.
  const transpose = ordered.length + 1 <= fields.length;

  if (transpose) {
    // Field names run down the left as row headers; each vendor is a
    // column. "Name" is the FIRST ROW (its left header literally reads
    // "Name"), styled light-blue + bold so it acts as the identifier
    // row with good contrast — no dark text on a dark-blue header.
    const bodyFields = fields.filter((f) => f.label !== 'Name');
    const nameRowCell =
      'background:#cfe0f3;color:#13243a;font-weight:bold;padding:8px;border:1px solid #b9c6d6;vertical-align:top';
    const nameRowPoc =
      'background:#fff4d6;color:#7a5c00;font-weight:bold;padding:8px;border:1px solid #b9c6d6;vertical-align:top';
    const nameCells = ordered
      .map(
        (v) =>
          `<td style="${v.isPrimaryContact ? nameRowPoc : nameRowCell}">${nameHtml(v)}</td>`,
      )
      .join('');
    const nameRow = `<tr><th style="${rowHeadStyle}">Name</th>${nameCells}</tr>`;
    const bodyRows = bodyFields
      .map((f, i) => {
        const zebra = i % 2 === 0 ? '#ffffff' : '#f3f7fb';
        const cells = ordered
          .map(
            (v) => `<td style="${cellStyle};background:${zebra}">${f.html(v)}</td>`,
          )
          .join('');
        return `<tr><th style="${rowHeadStyle}">${escHtml(f.label)}</th>${cells}</tr>`;
      })
      .join('');
    parts.push(`${tableOpen}<tbody>${nameRow}${bodyRows}</tbody></table>`);
  } else {
    // Wide layout: one row per vendor, fields across the top.
    const headerCells = fields
      .map((f) => `<th style="${headStyle}">${escHtml(f.label)}</th>`)
      .join('');
    const bodyRows = ordered
      .map((v, i) => {
        const bg = v.isPrimaryContact
          ? '#fff4d6'
          : i % 2 === 0
          ? '#eef3f8'
          : '#ffffff';
        const cells = fields
          .map((f) => `<td style="${cellStyle}">${f.html(v)}</td>`)
          .join('');
        return `<tr style="background:${bg}">${cells}</tr>`;
      })
      .join('');
    parts.push(
      `${tableOpen}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`,
    );
  }

  return parts.join('\n');
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
  opts: { headingLabel: string; markPrimary?: boolean; host?: string },
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
  if (vendor.purpose) lines.push(`${pad('Purpose')}: ${vendor.purpose}`);
  if (vendor.phone) lines.push(`${pad('Phone')}: ${vendor.phone}`);
  if (vendor.email) lines.push(`${pad('Email')}: ${vendor.email}`);

  // Host — who the vendor is here to see / who security preps the badge
  // under. Resolved (vendor.host || technicianName) by the caller.
  if (opts.host) lines.push(`${pad('Host')}: ${opts.host}`);

  // Visit schedule. A vendor may come on more than one date, or across
  // a run of consecutive days. One date → a single "Visit:" line. Two
  // or more → a "Schedule:" header followed by one indented line per
  // visit, so the security team can see exactly who's coming when.
  const visits = meaningfulVisits(vendor);
  if (visits.length <= 1) {
    const only = visits[0];
    lines.push(`${pad('Visit')}: ${only ? formatVisitLabel(only) : 'TBD'}`);
  } else {
    lines.push(`${pad('Schedule')}:`);
    for (const v of visits) {
      lines.push(`  • ${formatVisitLabel(v)}`);
    }
  }

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
 * Split a recipient field on commas / semicolons into trimmed, de-duped
 * addresses. This lets the user put several security-team addresses in
 * the single "Security team email" settings field (e.g. three people on
 * the notify list) without us needing a dynamic multi-field UI, and
 * without them having to create an Outlook distribution group.
 */
function parseRecipients(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[,;]+/)) {
    const v = part.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Build the mailto: recipient string: each address percent-encoded
 * individually, joined with literal commas (per RFC 6068). Encoding the
 * whole comma-joined string instead would turn the separators into
 * %2C, which some mail clients mishandle as a single malformed address.
 */
function encodeMailtoTo(addresses: string[]): string {
  return addresses.map((a) => encodeURIComponent(a)).join(',');
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
 *   Host      : <host or technician>
 *   Visit     : <date>, <time>
 *   Notes     : <notes>
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
      host: args.vendor.host?.trim() || args.technicianName,
    }),
  );

  const body = lines.join('\n');

  // Build To: field — security team is always primary recipient.
  // When also posting to Nuvolo, mathworks@service-now.com joins the
  // To: line (NOT CC:) so ServiceNow's inbound action processes it.
  const securityAddrs = parseRecipients(args.securityEmail);
  const nuvoloTo =
    postToNuvolo && args.nuvoloEmail ? args.nuvoloEmail.trim() : '';
  const toAddrs = nuvoloTo ? [...securityAddrs, nuvoloTo] : securityAddrs;
  // Human-readable form (also returned for display). The mailto path
  // encodes each address individually and joins them with commas.
  const to = toAddrs.join(', ');

  const cc = joinCcEmails(args.ccEmail, args.ccEmails);

  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', subject);
  params.set('body', body);
  // URLSearchParams encodes spaces as + which most mail clients accept,
  // but mailto: convention is %20 — replace to be safe.
  const query = params.toString().replace(/\+/g, '%20');
  const href = `mailto:${encodeMailtoTo(toAddrs)}?${query}`;

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
        host: v.host?.trim() || args.technicianName,
      }),
    );
  });

  const body = lines.join('\n');

  // To: security + optionally Nuvolo (same routing rules as single).
  const securityAddrs = parseRecipients(args.securityEmail);
  const nuvoloTo =
    postToNuvolo && args.nuvoloEmail ? args.nuvoloEmail.trim() : '';
  const toAddrs = nuvoloTo ? [...securityAddrs, nuvoloTo] : securityAddrs;
  const to = toAddrs.join(', ');

  // CC: user's own email (if ccSelf) + POC email (if POC has one) +
  // each vendor's host email when the host isn't the sender. De-duped
  // case-insensitively in case the user IS the POC or a host.
  const userEmailLc = (args.userEmail ?? '').trim().toLowerCase();
  const hostCcs = orderedVendors
    .map((v) => v.hostEmail?.trim())
    .filter((e): e is string => !!e && e.toLowerCase() !== userEmailLc);
  const cc = joinCcEmails(undefined, [
    args.ccSelf ? args.userEmail : undefined,
    poc?.email,
    ...hostCcs,
  ]);

  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', subject);
  params.set('body', body);
  const query = params.toString().replace(/\+/g, '%20');
  const href = `mailto:${encodeMailtoTo(toAddrs)}?${query}`;

  return { to, cc, subject, body, href };
}
