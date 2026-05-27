import { useMemo, useState } from 'react';
import type { Project, SavedVendor, Vendor } from '../types';
import { useStore } from '../state/store';
import {
  buildSecurityNotification,
  type SecurityNotificationArgs,
} from '../lib/security';
import { isValidWorkOrderId } from '../lib/nuvolo';

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
 * As of the vendor-book update: if the user has previously saved
 * vendors via the "💾 Save to book" button on any workboard, a
 * "From book" picker appears next to "+ Add vendor" so they can
 * one-tap insert a known vendor's name/company/phone/email instead
 * of retyping it. Visit-specific fields (date, time, notes) are
 * left blank for the user to fill in for this particular visit.
 */
export default function VendorsSection({ project }: Props) {
  const settings = useStore((s) => s.settings);
  const addVendor = useStore((s) => s.addVendor);
  const updateVendor = useStore((s) => s.updateVendor);
  const removeVendor = useStore((s) => s.removeVendor);
  const savedVendors = useStore((s) => s.savedVendors);
  const addOrUpdateSavedVendor = useStore((s) => s.addOrUpdateSavedVendor);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState('');

  const vendors = project.vendors ?? [];
  // Optional chaining + fallback — settings.securityEmail may be undefined
  // for users whose localStorage was persisted before this field existed
  // (the persist `merge` in store.ts now backfills it, but stay defensive).
  const securityConfigured = !!settings.securityEmail?.trim();
  const woValid = isValidWorkOrderId(project.workOrderId);

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

  function notifySecurity(vendor: Vendor, alsoPostToNuvolo: boolean) {
    if (!securityConfigured) return;
    if (!vendor.name.trim()) {
      window.alert('Add the vendor name first.');
      return;
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
      preamble: settings.securityPreamble,
      technicianName: settings.technicianName,
      alsoPostToNuvolo,
      nuvoloEmail: settings.nuvoloEmail,
    };
    const mail = buildSecurityNotification(args);
    window.location.href = mail.href;
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold">Vendors / contacts</h2>
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
          {vendors.map((v) => (
            <VendorCard
              key={v.id}
              vendor={v}
              onChange={(patch) => updateVendor(project.id, v.id, patch)}
              onRemove={() => removeVendor(project.id, v.id)}
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
  onNotifySecurity: (alsoPostToNuvolo: boolean) => void;
  onSaveToBook: () => void;
  isInBook: boolean;
  securityConfigured: boolean;
  hasValidWorkOrder: boolean;
  workOrderId?: string;
}) {
  // Per-card state: defaults to ON when a valid WO ID exists.
  const [alsoNuvolo, setAlsoNuvolo] = useState(hasValidWorkOrder);

  return (
    <li className="border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <input
          className="input font-medium flex-1"
          placeholder="Vendor name (e.g. Joe Warren)"
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
          <label className="label">Email</label>
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
          <input
            type="text"
            className="input"
            placeholder="7:00 AM, or 8:00 AM – 10:00 AM"
            value={vendor.visitTime ?? ''}
            onChange={(e) =>
              onChange({ visitTime: e.target.value || undefined })
            }
            title="Free-form — type a fixed time or a window. Goes verbatim into the security notification email."
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
