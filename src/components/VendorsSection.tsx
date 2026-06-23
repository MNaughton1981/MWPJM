import { useMemo, useState } from 'react';
import type { Project, SavedVendor, Vendor } from '../types';
import { useStore } from '../state/store';
import {
  buildMultiVendorSecurityNotification,
  buildSecurityNotification,
  buildVendorTableHtml,
  type MultiVendorSecurityNotificationArgs,
  type SecurityNotificationArgs,
} from '../lib/security';
import { isValidWorkOrderId } from '../lib/nuvolo';
import { copyRichText } from '../lib/destinations';
import VisitTimeSelect from './VisitTimeSelect';

interface Props {
  project: Project;
}

/**
 * Vendor / contractor contact list for the project. Distinct from the
 * Trade Coordination tracker — vendors here are individual people,
 * intended for security-notification + access-FOB workflows.
 *
 * Per-vendor "Notify security →" button builds a structured mailto:
 * to the configured security team email so they can pre-stage badges /
 * access without you having to type the same details every time.
 *
 * Section-level "Notify security (all vendors)" button (shown when
 * there are 2+ named vendors) sends a single email covering every
 * vendor in one mailto: instead of N separate emails — same
 * structured layout extended with one block per vendor.
 *
 * Point of contact: each card has a ★ toggle to designate that vendor
 * as the workboard's POC. Single POC per workboard (radio semantics);
 * the POC is sorted to the top of the list, marked with a ★ in
 * security notification emails, and CC'd on every notification email
 * (when they have a non-empty email address) — so they stay in the
 * loop on badge prep regardless of which vendor's button was tapped.
 *
 * Vendor book: if the user has previously saved vendors via the
 * "💾 Save to book" button on any workboard, a "From book" picker
 * appears next to "+ Add vendor" so they can one-tap insert a known
 * vendor's name/company/phone/email instead of retyping it.
 */
export default function VendorsSection({ project }: Props) {
  const settings = useStore((s) => s.settings);
  const addVendor = useStore((s) => s.addVendor);
  const updateVendor = useStore((s) => s.updateVendor);
  const removeVendor = useStore((s) => s.removeVendor);
  const setPrimaryVendorContact = useStore((s) => s.setPrimaryVendorContact);
  const savedVendors = useStore((s) => s.savedVendors);
  const addOrUpdateSavedVendor = useStore((s) => s.addOrUpdateSavedVendor);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');
  /**
   * Section-level "Also post to Nuvolo" toggle for the multi-vendor
   * email button. Mirrors the per-card checkbox: defaults to ON when
   * the workboard has a valid FWKD, so the common case (tied to a
   * work order) sends one combined email to security + Nuvolo. Off
   * for the "covering for someone else" case.
   */
  const [multiAlsoNuvolo, setMultiAlsoNuvolo] = useState(true);

  /**
   * "Group all vendors into one notification" — checked by default
   * because the common case is multiple vendors arriving for the same
   * job on the same day (even from different companies), which security
   * would rather receive as a single notice than N separate emails.
   * When on, tapping ANY vendor's individual "Notify security" sends
   * the combined notice. When off, individual buttons send per-vendor
   * emails — but `notifySecurity` still ASKS whether to combine, so the
   * grouping never gets silently skipped when it was probably intended.
   */
  const [groupVendors, setGroupVendors] = useState(true);

  /** Transient confirmation message for the "Copy as table" action. */
  const [copyMsg, setCopyMsg] = useState('');

  const vendors = project.vendors ?? [];
  // Optional chaining + fallback — settings.securityEmail may be undefined
  // for users whose localStorage was persisted before this field existed
  // (the persist `merge` in store.ts now backfills it, but stay defensive).
  const securityConfigured = !!settings.securityEmail?.trim();
  const woValid = isValidWorkOrderId(project.workOrderId);

  // POC sorts to the top of the list. Insertion order is preserved
  // for everyone else. Sorting via useMemo to avoid re-sorting on
  // every render — the array reference stays stable while the
  // vendors array is unchanged.
  const orderedVendors = useMemo(() => {
    const pocIdx = vendors.findIndex((v) => v.isPrimaryContact);
    if (pocIdx <= 0) return vendors; // No POC, or POC already first
    const out = vendors.slice();
    const [poc] = out.splice(pocIdx, 1);
    out.unshift(poc);
    return out;
  }, [vendors]);

  const namedVendorCount = useMemo(
    () => vendors.filter((v) => v.name.trim()).length,
    [vendors],
  );
  const poc = useMemo(
    () => vendors.find((v) => v.isPrimaryContact) ?? null,
    [vendors],
  );

  // Filtered + sorted picker list — case-insensitive match across
  // name and company so "city" matches "City Point" and "warren"
  // matches "Joe Warren & Sons" without the user having to remember
  // exactly how they entered the name.
  const filteredSavedVendors = useMemo(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return savedVendors;
    return savedVendors.filter(
      (sv) =>
        sv.name.toLowerCase().includes(q) ||
        (sv.company ?? '').toLowerCase().includes(q),
    );
  }, [savedVendors, pickerFilter]);

  function add() {
    addVendor(project.id, {
      name: '',
      company: '',
      role: '',
      phone: '',
      email: '',
      visitDate: '',
      visitTime: '',
      notes: '',
    });
  }

  /**
   * Insert a workboard vendor pre-filled from a saved book entry.
   * Visit fields (visitDate, visitTime, notes) are left blank — those
   * are visit-specific and should be filled in for this particular
   * visit. The book entry's `generalNotes` get pre-filled into the
   * workboard vendor's `notes` so they're visible on the card; the
   * user can then append visit-specific text on top.
   */
  function addFromSaved(sv: SavedVendor) {
    addVendor(project.id, {
      name: sv.name,
      company: sv.company ?? '',
      role: sv.role ?? '',
      phone: sv.phone ?? '',
      email: sv.email ?? '',
      visitDate: '',
      visitTime: '',
      notes: sv.generalNotes ?? '',
    });
    setPickerOpen(false);
    setPickerFilter('');
  }

  /**
   * Per-vendor security notification. POC's email (if set) is added
   * to the CC list alongside the user's own email — so even when
   * the user fires off "Notify security" on a non-POC vendor, the
   * POC stays in the loop on the badge prep / arrival logistics.
   */
  function notifySecurity(vendor: Vendor, alsoPostToNuvolo: boolean) {
    if (!securityConfigured) return;
    if (!vendor.name.trim()) {
      window.alert('Add the vendor name first.');
      return;
    }

    // When there are 2+ named vendors, the common intent is one combined
    // notice for the whole crew. If the "Group all vendors" box is checked
    // we just do that. If it's unchecked we ASK — so grouping is never
    // silently skipped when it was probably what the user wanted.
    if (namedVendorCount >= 2) {
      if (groupVendors) {
        notifySecurityAllVendors(alsoPostToNuvolo);
        return;
      }
      const combine = window.confirm(
        `There are ${namedVendorCount} vendors on this workboard.\n\n` +
          `If they're coming for the same job, you can send ONE combined ` +
          `notification instead of separate emails.\n\n` +
          `OK  →  send one combined notification for all ${namedVendorCount} vendors\n` +
          `Cancel  →  notify only ${vendor.name}`,
      );
      if (combine) {
        notifySecurityAllVendors(alsoPostToNuvolo);
        return;
      }
    }

    const args: SecurityNotificationArgs = {
      vendor,
      project: {
        name: project.name,
        workOrderId: project.workOrderId,
        location: project.location,
      },
      securityEmail: settings.securityEmail ?? '',
      ccEmail: settings.securityCcSelf ? settings.userEmail : undefined,
      // Add POC email (when set + non-empty) to the CC list. Dedupe
      // is handled inside buildSecurityNotification — if the POC is
      // the same vendor we're notifying about, or has the same
      // email as the user, the address won't appear twice.
      ccEmails: [poc?.email],
      preamble: settings.securityPreamble,
      technicianName: settings.technicianName,
      alsoPostToNuvolo,
      nuvoloEmail: settings.nuvoloEmail,
    };
    const mail = buildSecurityNotification(args);
    window.location.href = mail.href;
  }

  /**
   * Section-level multi-vendor security notification. One mailto:
   * covering every named vendor on the workboard. Same CC logic as
   * the per-vendor flow (user email + POC email, deduped).
   */
  function notifySecurityAllVendors(alsoPostToNuvolo: boolean) {
    if (!securityConfigured) return;
    if (namedVendorCount === 0) {
      window.alert('Add at least one vendor with a name first.');
      return;
    }
    const args: MultiVendorSecurityNotificationArgs = {
      vendors,
      project: {
        name: project.name,
        workOrderId: project.workOrderId,
        location: project.location,
      },
      securityEmail: settings.securityEmail ?? '',
      ccSelf: settings.securityCcSelf,
      userEmail: settings.userEmail,
      preamble: settings.securityPreamble,
      technicianName: settings.technicianName,
      alsoPostToNuvolo,
      nuvoloEmail: settings.nuvoloEmail,
    };
    const mail = buildMultiVendorSecurityNotification(args);
    window.location.href = mail.href;
  }

  /**
   * Copy a shaded, rendered HTML table of all named vendors to the
   * clipboard so the user can paste it into the Outlook compose window
   * (Ctrl+V) for a real, easy-to-scan table. mailto: bodies are plain
   * text only, so this clipboard route is the way to land actual row
   * shading / color in the email — same pattern the project export uses.
   * The plain-text multi-vendor body is written as the fallback so the
   * paste still does something useful in clients without HTML clipboard.
   */
  async function copyVendorTable() {
    if (namedVendorCount === 0) {
      window.alert('Add at least one vendor with a name first.');
      return;
    }
    const args: MultiVendorSecurityNotificationArgs = {
      vendors,
      project: {
        name: project.name,
        workOrderId: project.workOrderId,
        location: project.location,
      },
      securityEmail: settings.securityEmail ?? '',
      preamble: settings.securityPreamble,
      technicianName: settings.technicianName,
    };
    const html = buildVendorTableHtml(args);
    const plain = buildMultiVendorSecurityNotification(args).body;
    const ok = await copyRichText(html, plain);
    setCopyMsg(
      ok
        ? 'Formatted table copied — paste (Ctrl+V) into the email body.'
        : 'Copy failed — clipboard not available on this browser.',
    );
    window.setTimeout(() => setCopyMsg(''), 6000);
  }

  /**
   * Toggle a vendor's POC flag. Sending the vendor's id calls the
   * store action with radio semantics (auto-clears any other POC).
   * If the vendor is already POC, send `null` to clear it entirely.
   */
  function togglePoc(vendorId: string) {
    const current = vendors.find((v) => v.id === vendorId);
    if (current?.isPrimaryContact) {
      setPrimaryVendorContact(project.id, null);
    } else {
      setPrimaryVendorContact(project.id, vendorId);
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold">
          Vendors / contacts
          {poc && poc.name.trim() && (
            <span className="ml-2 text-xs font-normal text-amber-700">
              ★ POC: {poc.name}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 relative">
          {savedVendors.length > 0 && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setPickerOpen((v) => !v)}
              title="Pick from your saved vendor book — pre-fills name, company, phone, email"
            >
              📒 From book ▾
            </button>
          )}
          <button
            className="btn-ghost text-xs"
            onClick={add}
            title="Add a blank vendor card to fill in from scratch"
          >
            + Add vendor
          </button>
          {pickerOpen && (
            <div
              role="listbox"
              className="absolute z-30 right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg p-2"
              // Tap outside doesn't auto-close on this minimal popover —
              // the user closes via picking, the toggle button, or the
              // explicit Cancel inside. Keeps the implementation small;
              // can revisit if it becomes annoying.
            >
              <input
                className="input text-sm"
                placeholder="Filter by name or company…"
                value={pickerFilter}
                onChange={(e) => setPickerFilter(e.target.value)}
                autoFocus
              />
              <div className="mt-2 space-y-0.5">
                {filteredSavedVendors.length === 0 ? (
                  <p className="text-xs text-slate-500 px-1.5 py-1">
                    No saved vendors match.
                  </p>
                ) : (
                  filteredSavedVendors.map((sv) => (
                    <button
                      key={sv.id}
                      type="button"
                      onClick={() => addFromSaved(sv)}
                      className="block w-full text-left px-1.5 py-1.5 rounded hover:bg-slate-50 text-sm"
                      title={`Add ${sv.name}${
                        sv.company ? ' — ' + sv.company : ''
                      } to this workboard. Visit date / time are left blank for you to fill in.`}
                    >
                      <div className="font-medium truncate">
                        {sv.name}
                        {sv.company && (
                          <span className="text-slate-500 font-normal">
                            {' '}
                            — {sv.company}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {[sv.role, sv.phone, sv.email]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="border-t mt-2 pt-1.5 flex justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setPickerOpen(false);
                    setPickerFilter('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {vendors.length === 0 ? (
        <p className="text-sm text-slate-500">
          No vendors yet. Add a vendor to capture their contact info and
          notify security when they're coming on site.
        </p>
      ) : (
        <ul className="space-y-3">
          {orderedVendors.map((v) => (
            <VendorCard
              key={v.id}
              vendor={v}
              onChange={(patch) => updateVendor(project.id, v.id, patch)}
              onRemove={() => removeVendor(project.id, v.id)}
              onTogglePoc={() => togglePoc(v.id)}
              onNotifySecurity={(alsoNuvolo) => notifySecurity(v, alsoNuvolo)}
              onSaveToBook={() =>
                addOrUpdateSavedVendor({
                  name: v.name,
                  company: v.company,
                  role: v.role,
                  phone: v.phone,
                  email: v.email,
                  // The workboard `notes` field is visit-specific in
                  // intent, but we use it as the seed for the book
                  // entry's generalNotes when saving. The user can
                  // edit the book entry afterwards via Settings →
                  // Vendor Book if they want different general notes.
                  generalNotes: v.notes,
                })
              }
              isInBook={isVendorInBook(v, savedVendors)}
              securityConfigured={securityConfigured}
              hasValidWorkOrder={woValid}
              workOrderId={project.workOrderId}
            />
          ))}
        </ul>
      )}

      {/* Section-level multi-vendor notify button. Hidden when there's
          0 named vendors (nothing to send) or only 1 (per-vendor button
          handles that case). The point of this is "one email for the
          whole crew" — so showing it for a single vendor would be
          redundant and confusing. */}
      {securityConfigured && namedVendorCount >= 2 && (
        <div className="border-t pt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label
              className="flex items-center gap-2 text-xs text-slate-700"
              title="On (recommended for same-day visits): tapping any vendor's Notify Security sends ONE combined email covering everyone. Off: individual emails — but you'll be asked whether to combine."
            >
              <input
                type="checkbox"
                checked={groupVendors}
                onChange={(e) => setGroupVendors(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Group all vendors into one notification
            </label>
            {woValid && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={multiAlsoNuvolo}
                  onChange={(e) => setMultiAlsoNuvolo(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Also post to Nuvolo ({project.workOrderId})
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={copyVendorTable}
              title="Copy a formatted, shaded table of all vendors. Paste it (Ctrl+V) into the email body — Outlook renders it as a real table with colored rows."
            >
              📋 Copy as table
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() =>
                notifySecurityAllVendors(multiAlsoNuvolo && woValid)
              }
              title={
                multiAlsoNuvolo && woValid
                  ? `Open mail to security + Nuvolo (${project.workOrderId}) with one combined notice covering all ${namedVendorCount} vendors`
                  : `Open mail with one combined notice covering all ${namedVendorCount} vendors`
              }
            >
              🛡️ Notify security (all {namedVendorCount} vendors) →
            </button>
          </div>
          {copyMsg && (
            <p className="text-xs text-emerald-700 text-right">{copyMsg}</p>
          )}
        </div>
      )}

      {!securityConfigured && vendors.length > 0 && (
        <p className="text-xs text-slate-500">
          Set a security team email in Settings to enable the Notify Security
          button.
        </p>
      )}
    </section>
  );
}

/**
 * Same dedupe key the store uses — case-insensitive trim of name and
 * company. Returns true if the workboard vendor's name+company pair
 * already exists in the saved book, so the "💾 Save to book" button
 * can render as "✓ In book" for visual confirmation (a tap still
 * re-saves with the latest field values, which is fine).
 */
function isVendorInBook(v: Vendor, book: SavedVendor[]): boolean {
  if (!v.name.trim()) return false; // No name yet — never matches.
  const key = (n: string | undefined, c: string | undefined): string =>
    `${(n || '').trim().toLowerCase()}|${(c || '').trim().toLowerCase()}`;
  const k = key(v.name, v.company);
  return book.some((sv) => key(sv.name, sv.company) === k);
}

function VendorCard({
  vendor,
  onChange,
  onRemove,
  onTogglePoc,
  onNotifySecurity,
  onSaveToBook,
  isInBook,
  securityConfigured,
  hasValidWorkOrder,
  workOrderId,
}: {
  vendor: Vendor;
  onChange: (patch: Partial<Vendor>) => void;
  onRemove: () => void;
  onTogglePoc: () => void;
  onNotifySecurity: (alsoPostToNuvolo: boolean) => void;
  onSaveToBook: () => void;
  isInBook: boolean;
  securityConfigured: boolean;
  hasValidWorkOrder: boolean;
  workOrderId?: string;
}) {
  // Per-card state: defaults to ON when a valid WO ID exists.
  const [alsoNuvolo, setAlsoNuvolo] = useState(hasValidWorkOrder);
  const isPoc = !!vendor.isPrimaryContact;

  return (
    <li
      className={`border rounded-lg p-3 space-y-2 ${
        isPoc
          ? 'border-amber-300 bg-amber-50/40'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onTogglePoc}
          className={`text-lg leading-none w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition ${
            isPoc
              ? 'text-amber-500 hover:bg-amber-100'
              : 'text-slate-300 hover:text-amber-500 hover:bg-slate-100'
          }`}
          title={
            isPoc
              ? 'This vendor is the workboard point of contact. Tap to clear.'
              : 'Mark this vendor as the workboard point of contact (CC\'d on every security notification when they have email set)'
          }
          aria-label={isPoc ? 'Unset point of contact' : 'Set as point of contact'}
          aria-pressed={isPoc}
        >
          {isPoc ? '★' : '☆'}
        </button>
        <input
          className="input font-medium flex-1"
          placeholder="Vendor Name (e.g. John Q. Sample)"
          value={vendor.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <button
          className="text-slate-400 hover:text-rose-600 px-1 text-lg"
          onClick={onRemove}
          aria-label="Remove vendor"
          title="Remove vendor"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="label">Company</label>
          <input
            className="input"
            placeholder="e.g. Acme Plumbing"
            value={vendor.company ?? ''}
            onChange={(e) => onChange({ company: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Role / trade</label>
          <input
            className="input"
            placeholder="e.g. Plumber"
            value={vendor.role ?? ''}
            onChange={(e) => onChange({ role: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            placeholder="555-555-1234"
            value={vendor.phone ?? ''}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </div>
        <div>
          <label className="label">
            Email
            {isPoc && (
              <span
                className="ml-1.5 text-[10px] font-normal text-amber-700"
                title="This vendor is the POC — when set, this email is CC'd on every security notification from this workboard."
              >
                CC'd on security emails
              </span>
            )}
          </label>
          <input
            type="email"
            className="input"
            placeholder="joe@acme.com"
            value={vendor.email ?? ''}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Visit date</label>
          <input
            type="date"
            className="input"
            value={vendor.visitDate ?? ''}
            onChange={(e) =>
              onChange({ visitDate: e.target.value || undefined })
            }
          />
        </div>
        <div>
          <label className="label">Visit time</label>
          <VisitTimeSelect
            value={vendor.visitTime ?? ''}
            onChange={(v) => onChange({ visitTime: v || undefined })}
            title="Pick the on-site time. Goes into the security notification email."
          />
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          className="input min-h-[50px]"
          placeholder="Access requirements / scope of visit / special instructions"
          value={vendor.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
        {/* "Also post to Nuvolo" opt-in — only shown when the workboard
            has a valid FWKD ID. Checked by default so the common case
            (tied to a work order) works in one tap. Uncheck for the
            "covering for Dave on a landscape ticket I don't own" case. */}
        {hasValidWorkOrder && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={alsoNuvolo}
              onChange={(e) => setAlsoNuvolo(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Also post to Nuvolo ({workOrderId})
          </label>
        )}
        {/* "Save to book" — manually persists this vendor's identity
            (name, company, role, phone, email, notes) into the global
            vendor book. Manual rather than automatic so the user is in
            control of what enters their book — typos and one-off
            visitors don't pollute the picker dropdown. After save the
            button label flips to "✓ In book"; tapping again re-saves
            with the latest field values (useful for updating phone /
            email when they change). */}
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={onSaveToBook}
          disabled={!vendor.name.trim()}
          title={
            !vendor.name.trim()
              ? 'Enter the vendor name first.'
              : isInBook
              ? 'This vendor is in your book. Tap to update with the current field values.'
              : 'Save name, company, role, phone, email and any general notes to your vendor book for one-tap reuse on future workboards.'
          }
        >
          {isInBook ? '✓ In book' : '💾 Save to book'}
        </button>
        <button
          className="btn-secondary text-xs ml-auto"
          onClick={() => onNotifySecurity(alsoNuvolo && hasValidWorkOrder)}
          disabled={!securityConfigured || !vendor.name.trim()}
          title={
            !securityConfigured
              ? 'Set the security team email in Settings first.'
              : !vendor.name.trim()
              ? 'Add the vendor name first.'
              : alsoNuvolo && hasValidWorkOrder
              ? `Open mail to security + Nuvolo (${workOrderId}) with visit details`
              : 'Open mail with a structured visit notice for the security team'
          }
        >
          🛡️ Notify security →
        </button>
      </div>
    </li>
  );
}
