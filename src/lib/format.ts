import { format, parseISO } from 'date-fns';

/** Friendly timestamp used in email subjects. Sortable + readable. */
export function formatStamp(d: Date = new Date()): string {
  return format(d, 'yyyy-MM-dd HH:mm');
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'EEE, MMM d');
  } catch {
    return iso;
  }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'MMM d, yyyy h:mm a');
  } catch {
    return iso;
  }
}

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}
