/**
 * Reminder-style time picker for vendor visit times.
 *
 * Renders a native `<select>` populated with time-of-day options at
 * 15-minute increments across the full day — the same kind of "pick a
 * time" dropdown you'd use when setting a reminder. On mobile the native
 * select surfaces as a scrollable wheel; on desktop it's a standard
 * dropdown.
 *
 * The selected value is stored as a display string (e.g. "7:00 AM"),
 * which is what the security-notification email expects — so this is a
 * drop-in replacement for the old free-form text input and keeps
 * backward compatibility with previously saved values.
 *
 * Any pre-existing value that isn't one of the generated options (for
 * example a legacy time window like "8:00 AM – 10:00 AM") is preserved:
 * it's injected as an extra selected option so editing a vendor never
 * silently drops what was already there.
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
  // Preserve a legacy / free-form value that isn't in the standard list
  // (e.g. an imported time window) so it stays selectable and isn't lost.
  const hasCustomValue = !!value && !TIME_OPTIONS.includes(value);

  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
    >
      <option value="">No time set</option>
      {hasCustomValue && <option value={value}>{value}</option>}
      {TIME_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
