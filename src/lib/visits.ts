import type { Vendor, VendorVisit } from '../types';
import { formatDate } from './format';

/**
 * Normalize a vendor's visit schedule into an array of `VendorVisit`.
 *
 * Resolution order:
 *   1. If `vendor.visits` exists and is non-empty, return it as-is
 *      (this is the source of truth once the multi-visit editor is used).
 *   2. Otherwise, if the legacy flat `visitDate` / `visitTime` carry
 *      anything, return a single derived visit so older vendors (and
 *      Excel imports that only populate the flat fields) keep showing
 *      their visit.
 *   3. Otherwise, return an empty array (no schedule yet).
 *
 * Note: the returned array may include in-progress / blank rows when it
 * comes straight from `vendor.visits` — the editor UI relies on that.
 * For display and notifications use `meaningfulVisits`, which drops
 * rows that have neither a date nor a time.
 */
export function getVendorVisits(vendor: Vendor): VendorVisit[] {
  if (vendor.visits && vendor.visits.length > 0) return vendor.visits;
  if (vendor.visitDate || vendor.visitTime) {
    return [{ id: 'legacy', date: vendor.visitDate, time: vendor.visitTime }];
  }
  return [];
}

/** Visits that actually carry information — for emails / display. */
export function meaningfulVisits(vendor: Vendor): VendorVisit[] {
  return getVendorVisits(vendor).filter((v) => v.date || v.time);
}

/**
 * Human-readable label for a single visit, e.g.:
 *   - "Fri, Jun 26"                       (single day)
 *   - "Sat, Jun 27 – Sun, Jun 28"         (a run of days)
 *   - "Fri, Jun 26, 7:00 AM"              (with a time)
 *
 * Falls back to "TBD" when there's no date. The end date is only shown
 * when it's set and strictly after the start date (ISO date strings sort
 * lexicographically, so a plain string compare is correct here).
 */
export function formatVisitLabel(v: VendorVisit): string {
  const start = v.date ? formatDate(v.date) : 'TBD';
  const datePart =
    v.endDate && v.date && v.endDate > v.date
      ? `${start} – ${formatDate(v.endDate)}`
      : start;
  return v.time ? `${datePart}, ${v.time}` : datePart;
}
