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

/**
 * Friendly, human-readable Workboard number derived from the project's
 * underlying UUID. Stable across devices because the UUID is — sync
 * carries the same `id`, so the same WB# appears on desktop and
 * mobile for the same workboard.
 *
 * Format: `WB-XXXXXX` where XXXXXX is the first six alphanumeric
 * characters of the project id, uppercased. Six chars gives ~16M
 * unique values from a 36-character alphabet — collision risk on a
 * realistic Workboard scale (dozens to low hundreds of workboards
 * per user) is effectively zero.
 *
 * Used in:
 *   - Workboard page header next to the FWKD field, so the user can
 *     verbally reference a specific workboard ("WB-A3B4C5") without
 *     reading out a UUID.
 *   - Workboards list rows so the user can scan and verify which
 *     workboard is which.
 *   - Export Summary (rich-text + markdown) so OneNote captures both
 *     the FWKD and the WB# alongside it. If the same FWKD ever ends
 *     up on two devices as separate workboards (race window between
 *     creation and sync), the differing WB#s make the dup obvious.
 *
 * No new field on Project — derived from `project.id` at display time.
 */
export function workboardNumber(projectId: string): string {
  const clean = projectId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `WB-${clean.slice(0, 6).padEnd(6, '0')}`;
}
