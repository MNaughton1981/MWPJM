import { useEffect, useMemo, useState } from 'react';
import type { SavedVendorEvent, Vendor } from '../types';
import { useStore } from '../state/store';
import { buildSecurityNotification } from '../lib/security';
import { formatDate } from '../lib/format';
import VisitTimeSelect from './VisitTimeSelect';

/**
 * Vendor Events modal — opened from the Workboards page "📅 Vendor
 * events" button. Three modes within the same overlay:
 *
 *   1. List mode (default): shows every saved event with vendor +
 *      cadence preview. Tap an event → fire mode. Tap "+ New event"
 *      → edit mode with a fresh template.
 *
 *   2. Fire mode: pick the visit date / time / one-time addendum,
 *      then "📧 Send security notification" opens the user's mail
 *      client with a pre-built mailto: covering the event's vendor
 *      and service description. No workboard is created — events are
 *      pure coordination triggers, not the kind of project that needs
 *      photo documentation.
 *
 *   3. Edit mode: in-place editing of the event's name, cadence,
 *      vendor info, service description, default visit notes.
 *      Renaming an event in-place updates the same row by id (no
 *      name-based dedupe, no duplicate spawn).
 *
 * Modal closes on backdrop click / Escape / explicit Close button.
 * The picker filter survives mode switches so the user can come
 * back from edit mode without re-typing their search.
 */

interface Props {
  onClose: () => void;
}

type Mode =
  | { kind: 'list' }
  | { kind: 'fire'; eventId: string }
  | { kind: 'edit'; eventId: string | null }; // null = new event

export default function VendorEventsModal({ onClose }: Props) {
  const events = useStore((s) => s.savedVendorEvents);
  const settings = useStore((s) => s.settings);
  const addEvent = useStore((s) => s.addSavedVendorEvent);
  const updateEvent = useStore((s) => s.updateSavedVendorEvent);
  const removeEvent = useStore((s) => s.removeSavedVendorEvent);

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [filter, setFilter] = useState('');

  // Close on Escape — standard modal behavior so the user can dismiss
  // without hunting for the close button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filteredEvents = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = events
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (ev) =>
        ev.name.toLowerCase().includes(q) ||
        (ev.vendorName ?? '').toLowerCase().includes(q) ||
        (ev.vendorCompany ?? '').toLowerCase().includes(q) ||
        (ev.cadence ?? '').toLowerCase().includes(q),
    );
  }, [events, filter]);

  const activeEvent = useMemo(() => {
    if (mode.kind === 'fire') {
      return events.find((ev) => ev.id === mode.eventId) ?? null;
    }
    if (mode.kind === 'edit' && mode.eventId) {
      return events.find((ev) => ev.id === mode.eventId) ?? null;
    }
    return null;
  }, [mode, events]);

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/40 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
          <h2 className="font-semibold">
            {mode.kind === 'list' && 'Vendor events'}
            {mode.kind === 'fire' &&
              `Send notification: ${activeEvent?.name ?? ''}`}
            {mode.kind === 'edit' &&
              (mode.eventId ? 'Edit event' : 'New event')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 max-h-[80vh] overflow-y-auto">
          {mode.kind === 'list' && (
            <ListMode
              events={filteredEvents}
              filter={filter}
              onFilterChange={setFilter}
              onPick={(id) => setMode({ kind: 'fire', eventId: id })}
              onEdit={(id) => setMode({ kind: 'edit', eventId: id })}
              onCreate={() => setMode({ kind: 'edit', eventId: null })}
              totalCount={events.length}
            />
          )}
          {mode.kind === 'fire' && activeEvent && (
            <FireMode
              event={activeEvent}
              technicianName={settings.technicianName}
              securityEmail={settings.securityEmail}
              securityPreamble={settings.securityPreamble}
              securityCcSelf={settings.securityCcSelf}
              userEmail={settings.userEmail}
              onBack={() => setMode({ kind: 'list' })}
              onEdit={() => setMode({ kind: 'edit', eventId: activeEvent.id })}
              onDelete={() => {
                const ok = window.confirm(
                  `Delete the saved event "${activeEvent.name}"?\n\nThis only removes the template — no security emails are recalled.`,
                );
                if (!ok) return;
                removeEvent(activeEvent.id);
                setMode({ kind: 'list' });
              }}
            />
          )}
          {mode.kind === 'edit' && (
            <EditMode
              event={activeEvent}
              onCancel={() =>
                mode.eventId
                  ? setMode({ kind: 'fire', eventId: mode.eventId })
                  : setMode({ kind: 'list' })
              }
              onSave={(values) => {
                if (mode.eventId) {
                  updateEvent(mode.eventId, values);
                  setMode({ kind: 'fire', eventId: mode.eventId });
                } else {
                  const newId = addEvent(values);
                  setMode({ kind: 'fire', eventId: newId });
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── List mode ───────────────────────────────────────────────────────

function ListMode({
  events,
  filter,
  onFilterChange,
  onPick,
  onEdit,
  onCreate,
  totalCount,
}: {
  events: SavedVendorEvent[];
  filter: string;
  onFilterChange: (v: string) => void;
  onPick: (id: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
  totalCount: number;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Saved templates for recurring services (quarterly drain cleaning,
        annual fire alarm test, etc.). Pick one to fill in the visit date
        and fire a security notification. Editing the name or vendor info
        of an event updates the same row — it never spawns a duplicate.
      </p>
      <div className="flex items-center gap-2">
        <input
          className="input text-sm flex-1"
          placeholder={
            totalCount > 0
              ? 'Filter by event name, vendor, or cadence…'
              : 'No saved events yet. Tap + New event to create one.'
          }
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          disabled={totalCount === 0}
        />
        <button
          type="button"
          className="btn-primary text-sm whitespace-nowrap"
          onClick={onCreate}
        >
          + New event
        </button>
      </div>
      {events.length === 0 ? (
        <div className="text-sm text-slate-500 py-6 text-center">
          {totalCount === 0
            ? 'No saved events yet. Tap "+ New event" above to create your first one.'
            : 'No events match your filter.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-200">
          {events.map((ev) => (
            <li key={ev.id} className="py-2 flex items-start gap-2">
              <button
                type="button"
                onClick={() => onPick(ev.id)}
                className="flex-1 text-left rounded p-2 -mx-2 hover:bg-slate-50 min-w-0"
                title="Send a security notification using this event's saved vendor + service info"
              >
                <div className="font-medium truncate flex items-center gap-2">
                  📅 {ev.name}
                  {ev.cadence && (
                    <span className="pill bg-slate-100 text-slate-700 text-[10px] font-normal">
                      {ev.cadence}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {ev.vendorName ? (
                    <>
                      {ev.vendorName}
                      {ev.vendorCompany && ` — ${ev.vendorCompany}`}
                      {ev.vendorPhone && ` · ${ev.vendorPhone}`}
                    </>
                  ) : (
                    <span className="italic">No vendor set</span>
                  )}
                </div>
                {ev.serviceDescription && (
                  <div className="text-xs text-slate-600 mt-0.5 truncate">
                    {ev.serviceDescription}
                  </div>
                )}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs shrink-0"
                onClick={() => onEdit(ev.id)}
                title="Edit this event in place — does not create a duplicate"
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Fire mode ───────────────────────────────────────────────────────

function FireMode({
  event,
  technicianName,
  securityEmail,
  securityPreamble,
  securityCcSelf,
  userEmail,
  onBack,
  onEdit,
  onDelete,
}: {
  event: SavedVendorEvent;
  technicianName: string;
  securityEmail: string;
  securityPreamble: string;
  securityCcSelf: boolean;
  userEmail: string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // Default visit date = today in YYYY-MM-DD. The user can change it
  // before firing — that's the whole point of the fire-mode form.
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState<string>(today);
  const [visitTime, setVisitTime] = useState<string>('');
  const [addendum, setAddendum] = useState<string>('');

  const securityConfigured = !!securityEmail.trim();
  const vendorReady = !!event.vendorName?.trim();

  function fire() {
    if (!securityConfigured) {
      window.alert(
        'Set the security team email in Settings → Security team notifications first.',
      );
      return;
    }
    if (!vendorReady) {
      window.alert(
        'This event has no vendor name yet. Tap Edit and add at least the vendor name before firing.',
      );
      return;
    }
    // Synthesize a Vendor + Project from the event + user-input
    // visit details, then reuse the existing single-vendor builder.
    // The "project" name is the event name — that's what shows up
    // under "Project: ..." in the email body. Standalone events don't
    // have a workboard or FWKD, so we pass none.
    const combinedNotes = [
      event.serviceDescription?.trim(),
      event.defaultVisitNotes?.trim(),
      addendum.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');

    const synthesizedVendor: Vendor = {
      id: 'event-fire',
      name: event.vendorName ?? '',
      company: event.vendorCompany,
      role: event.vendorRole,
      phone: event.vendorPhone,
      email: event.vendorEmail,
      visitDate: visitDate || undefined,
      visitTime: visitTime.trim() || undefined,
      notes: combinedNotes || undefined,
    };

    const mail = buildSecurityNotification({
      vendor: synthesizedVendor,
      project: { name: event.name },
      securityEmail,
      ccEmail: securityCcSelf ? userEmail : undefined,
      preamble: securityPreamble,
      technicianName,
      // No FWKD on standalone events, so alsoPostToNuvolo is moot;
      // the builder already gates Nuvolo routing on a valid FWKD.
      alsoPostToNuvolo: false,
    });

    window.location.href = mail.href;
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-brand-600 hover:underline"
      >
        ← All events
      </button>

      <div className="card p-3 bg-slate-50 border-slate-200 space-y-1.5">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Event template
        </div>
        <div className="font-medium">
          {event.name}
          {event.cadence && (
            <span className="ml-2 pill bg-slate-200 text-slate-700 text-[10px] font-normal">
              {event.cadence}
            </span>
          )}
        </div>
        {event.vendorName && (
          <div className="text-sm text-slate-700">
            {event.vendorName}
            {event.vendorCompany && ` — ${event.vendorCompany}`}
            {event.vendorRole && ` (${event.vendorRole})`}
          </div>
        )}
        {(event.vendorPhone || event.vendorEmail) && (
          <div className="text-xs text-slate-500">
            {[event.vendorPhone, event.vendorEmail]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
        {event.serviceDescription && (
          <div className="text-xs text-slate-600 italic mt-1">
            {event.serviceDescription}
          </div>
        )}
        <div className="pt-1 flex gap-3 text-xs">
          <button
            type="button"
            onClick={onEdit}
            className="text-brand-600 hover:underline"
          >
            ✎ Edit template
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-rose-600 hover:underline"
          >
            🗑 Delete event
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold text-sm">This visit</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="label">Visit date</label>
            <input
              type="date"
              className="input"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
            {visitDate && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                Reads as: {formatDate(visitDate)}
              </p>
            )}
          </div>
          <div>
            <label className="label">Visit time</label>
            <VisitTimeSelect
              value={visitTime}
              onChange={setVisitTime}
              title="Pick the on-site time. Goes into the security notification email."
            />
          </div>
        </div>
        <div>
          <label className="label">
            Addendum to default notes (optional)
          </label>
          <textarea
            className="input min-h-[60px]"
            placeholder="One-time notes for this specific fire — appended to the event's default notes."
            value={addendum}
            onChange={(e) => setAddendum(e.target.value)}
          />
          {(event.defaultVisitNotes || event.serviceDescription) && (
            <p className="text-[11px] text-slate-500 mt-0.5">
              Email body will include: service description, default visit
              notes from the template, then your addendum.
            </p>
          )}
        </div>
      </div>

      {!securityConfigured && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          Set <strong>Security team email</strong> in Settings →
          Security team notifications first. Without it, the
          notification button is disabled.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1 border-t">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={fire}
          disabled={!securityConfigured || !vendorReady}
          title={
            !securityConfigured
              ? 'Set the security team email in Settings first.'
              : !vendorReady
              ? 'Edit this event and add at least the vendor name first.'
              : 'Open mail with the structured visit notice — sends to the security team'
          }
        >
          📧 Send security notification
        </button>
      </div>
    </div>
  );
}

// ─── Edit mode ───────────────────────────────────────────────────────

function EditMode({
  event,
  onCancel,
  onSave,
}: {
  event: SavedVendorEvent | null;
  onCancel: () => void;
  onSave: (
    values: Omit<SavedVendorEvent, 'id' | 'createdAt' | 'updatedAt'>,
  ) => void;
}) {
  // Form state seeded from the event being edited, or empty for new.
  const [name, setName] = useState(event?.name ?? '');
  const [cadence, setCadence] = useState(event?.cadence ?? '');
  const [vendorName, setVendorName] = useState(event?.vendorName ?? '');
  const [vendorCompany, setVendorCompany] = useState(event?.vendorCompany ?? '');
  const [vendorRole, setVendorRole] = useState(event?.vendorRole ?? '');
  const [vendorPhone, setVendorPhone] = useState(event?.vendorPhone ?? '');
  const [vendorEmail, setVendorEmail] = useState(event?.vendorEmail ?? '');
  const [serviceDescription, setServiceDescription] = useState(
    event?.serviceDescription ?? '',
  );
  const [defaultVisitNotes, setDefaultVisitNotes] = useState(
    event?.defaultVisitNotes ?? '',
  );

  const canSave = !!name.trim();

  function save() {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      cadence: cadence.trim() || undefined,
      vendorName: vendorName.trim() || undefined,
      vendorCompany: vendorCompany.trim() || undefined,
      vendorRole: vendorRole.trim() || undefined,
      vendorPhone: vendorPhone.trim() || undefined,
      vendorEmail: vendorEmail.trim() || undefined,
      serviceDescription: serviceDescription.trim() || undefined,
      defaultVisitNotes: defaultVisitNotes.trim() || undefined,
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Event name *</label>
        <input
          className="input"
          placeholder="e.g. Fitness center floor drain service"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <p className="text-[11px] text-slate-500 mt-0.5">
          You can rename this later — it'll update the same event, not
          create a duplicate.
        </p>
      </div>
      <div>
        <label className="label">Cadence (optional)</label>
        <input
          className="input"
          placeholder="e.g. Quarterly, Annual, As needed"
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
        />
      </div>

      <div className="border-t pt-3">
        <h3 className="font-medium text-sm mb-2">Vendor</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="label">Vendor name</label>
            <input
              className="input"
              placeholder="Joe Warren"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Company</label>
            <input
              className="input"
              placeholder="Joe Warren & Sons"
              value={vendorCompany}
              onChange={(e) => setVendorCompany(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Role / trade</label>
            <input
              className="input"
              placeholder="Plumber"
              value={vendorRole}
              onChange={(e) => setVendorRole(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              placeholder="555-555-1234"
              value={vendorPhone}
              onChange={(e) => setVendorPhone(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="joe@example.com"
              value={vendorEmail}
              onChange={(e) => setVendorEmail(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="border-t pt-3 space-y-2">
        <h3 className="font-medium text-sm">Service details</h3>
        <div>
          <label className="label">Service description</label>
          <textarea
            className="input min-h-[60px]"
            placeholder="What's being done — quarterly drain cleaning on 4th floor"
            value={serviceDescription}
            onChange={(e) => setServiceDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Default visit notes</label>
          <textarea
            className="input min-h-[60px]"
            placeholder="Standing notes that don't change between visits — access instructions, contacts, FOB / badge info"
            value={defaultVisitNotes}
            onChange={(e) => setDefaultVisitNotes(e.target.value)}
          />
          <p className="text-[11px] text-slate-500 mt-0.5">
            Combined with the service description and any per-fire
            addendum into the security notification body.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={save}
          disabled={!canSave}
          title={
            !canSave ? 'Event name is required.' : event ? 'Save changes' : 'Create event'
          }
        >
          {event ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </div>
  );
}
