import { useState } from 'react';

/**
 * Reminder-style time picker for vendor visit times.
 *
 * Renders a native `<select>` populated with time-of-day options at
 * 15-minute increments across the full day — the same kind of "pick a
 * time" dropdown you'd use when setting a reminder. On mobile the native
 * select surfaces as a scrollable wheel; on desktop it's a standard
 * dropdown.
 *
 * The dropdown also offers a **"Custom…"** escape hatch: choosing it
 * swaps the select for a free-text field, so the user can still enter a
 * time window ("8:00 AM – 10:00 AM") or any other non-standard value.
 *
 * The selected value is stored as a display string (e.g. "7:00 AM"),
 * which is what the security-notification email expects — so this is a
 * drop-in replacement for the old free-form text input and keeps
 * backward compatibility with previously saved values. Any pre-existing
 * value that isn't one of the generated options is treated as a custom
 * value and opens straight into the free-text field, so editing a vendor
 * never silently drops what was already there.
 */

/** Build 15-minute time options for a full 24-hour day, formatted as "h:mm AM/PM". */
function buildTimeOptions(): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const period = hour24 < 12 ? 'AM' : 'PM';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    options.push(`${hour12}:${minute.toString().padStart(2, '0')} ${period}`);
  }
  return options;
}

const TIME_OPTIONS = buildTimeOptions();

// Sentinel value for the "Custom…" dropdown entry — distinct from any
// real time string and from '' (No time set).
const CUSTOM = '__custom__';

interface VisitTimeSelectProps {
  /** Current value — a display string like "7:00 AM", or '' for none. */
  value: string;
  /** Called with the new value, or '' when "No time set" is chosen. */
  onChange: (value: string) => void;
  className?: string;
  title?: string;
}

export default function VisitTimeSelect({
  value,
  onChange,
  className = 'input',
  title,
}: VisitTimeSelectProps) {
  // A non-empty value that isn't one of the standard options is a custom
  // value (e.g. an imported time window) — open the free-text field for it.
  const valueIsCustom = !!value && !TIME_OPTIONS.includes(value);

  // Track whether the user explicitly chose "Custom…" even before they've
  // typed anything (at which point the value is still '').
  const [customMode, setCustomMode] = useState(false);

  const showCustom = customMode || valueIsCustom;

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next === CUSTOM) {
      setCustomMode(true);
      return; // keep any current value as the starting point for editing
    }
    setCustomMode(false);
    onChange(next);
  }

  if (showCustom) {
    return (
      <div className="flex gap-1">
        <input
          type="text"
          className={`${className} flex-1`}
          placeholder="e.g. 8:00 AM – 10:00 AM"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title={title ?? 'Custom visit time — type a fixed time or a window.'}
          autoFocus
        />
        <button
          type="button"
          className="btn-ghost px-2 text-sm shrink-0"
          onClick={() => {
            setCustomMode(false);
            onChange('');
          }}
          title="Back to the time list"
          aria-label="Back to the time list"
        >
          ↩
        </button>
      </div>
    );
  }

  return (
    <select
      className={className}
      value={value}
      onChange={handleSelect}
      title={title}
    >
      <option value="">No time set</option>
      {TIME_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      <option value={CUSTOM}>Custom…</option>
    </select>
  );
}
