/**
 * Reusable date/time picker component using native `<input type="datetime-local">`.
 * 
 * Works well on mobile (native picker UI) and degrades gracefully on desktop.
 * Returns ISO 8601 strings in local timezone (e.g., "2026-06-15T14:30").
 */

interface DateTimePickerProps {
  value: string; // ISO datetime string (yyyy-MM-ddTHH:mm)
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  className?: string;
}

export default function DateTimePicker({
  value,
  onChange,
  label,
  required = false,
  className = '',
}: DateTimePickerProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
