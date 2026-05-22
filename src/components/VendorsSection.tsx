import { useState } from 'react';
import type { Project, Vendor } from '../types';
import { useStore } from '../state/store';
import {
  buildSecurityNotification,
  type SecurityNotificationArgs,
} from '../lib/security';

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
 */
export default function VendorsSection({ project }: Props) {
  const settings = useStore((s) => s.settings);
  const addVendor = useStore((s) => s.addVendor);
  const updateVendor = useStore((s) => s.updateVendor);
  const removeVendor = useStore((s) => s.removeVendor);
  const [showAdd, setShowAdd] = useState(false);

  const vendors = project.vendors ?? [];
  // Optional chaining + fallback — settings.securityEmail may be undefined
  // for users whose localStorage was persisted before this field existed
  // (the persist `merge` in store.ts now backfills it, but stay defensive).
  const securityConfigured = !!settings.securityEmail?.trim();

  function add() {
    addVendor(project.id, {
      name: '',
      company: '',
      role: '',
      phone: '',
      email: '',
      visitDate: '',
      notes: '',
    });
    setShowAdd(false);
  }

  function notifySecurity(vendor: Vendor) {
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
    };
    const mail = buildSecurityNotification(args);
    window.location.href = mail.href;
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Vendors / contacts</h2>
        <button
          className="btn-ghost text-xs"
          onClick={() => (showAdd ? setShowAdd(false) : add())}
        >
          + Add vendor
        </button>
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
              onNotifySecurity={() => notifySecurity(v)}
              securityConfigured={securityConfigured}
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

function VendorCard({
  vendor,
  onChange,
  onRemove,
  onNotifySecurity,
  securityConfigured,
}: {
  vendor: Vendor;
  onChange: (patch: Partial<Vendor>) => void;
  onRemove: () => void;
  onNotifySecurity: () => void;
  securityConfigured: boolean;
}) {
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

      <div className="flex justify-end pt-1">
        <button
          className="btn-secondary text-xs"
          onClick={onNotifySecurity}
          disabled={!securityConfigured || !vendor.name.trim()}
          title={
            !securityConfigured
              ? 'Set the security team email in Settings first.'
              : !vendor.name.trim()
              ? 'Add the vendor name first.'
              : 'Open mail with a structured visit notice for the security team'
          }
        >
          🛡️ Notify security →
        </button>
      </div>
    </li>
  );
}
