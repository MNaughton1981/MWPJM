import { formatStamp } from './format';

/**
 * Destination helpers for sending a composed note somewhere other than
 * Nuvolo. All of these stay within the lean "no API, no OAuth" model:
 *
 *  - To Do: mailto: to user's own email with a "TODO:" subject prefix.
 *    Outlook + Microsoft To Do flag-sync surfaces the message in the
 *    "Flagged email" list automatically when the user flags it. Or set
 *    an Outlook rule to auto-flag based on subject prefix.
 *  - Calendar: build an .ics file inline and download it. Outlook
 *    associates with .ics, opens with the event filled in, alarm set.
 *  - Copy: writes formatted text to the clipboard. User pastes into
 *    OneNote / wherever (the previous me@onenote.com email path was
 *    deprecated by Microsoft in March 2025).
 *  - Share: navigator.share() — only on mobile. Opens the system share
 *    sheet so the user can pick the OneNote app, Teams, etc.
 */

export function buildToDoMail(args: {
  text: string;
  userEmail?: string;
  technicianName?: string;
}): { href: string; subject: string; body: string } {
  const ts = formatStamp();
  const firstLine = (args.text.split('\n')[0] || '').trim().slice(0, 80);
  const subject = `TODO: ${firstLine || 'Follow up'}`;
  const sig = args.technicianName ? `\n\n— ${args.technicianName}` : '';
  const body = `${args.text.trim()}${sig}\n\n[Captured ${ts} via MWPJM]`;
  const to = (args.userEmail ?? '').trim();
  const href =
    `mailto:${encodeURIComponent(to)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;
  return { href, subject, body };
}

/** Build a clipboard-friendly representation of a note. */
export function buildClipboardNote(args: {
  text: string;
  workOrderId?: string;
  projectName?: string;
  technicianName?: string;
}): string {
  const ts = formatStamp();
  const header: string[] = [];
  if (args.projectName) header.push(`Project: ${args.projectName}`);
  if (args.workOrderId) header.push(`Work Order: ${args.workOrderId}`);
  header.push(`Logged: ${ts}`);
  if (args.technicianName) header.push(`By: ${args.technicianName}`);
  return `${header.join('\n')}\n\n${args.text.trim()}\n`;
}

export interface IcsArgs {
  title: string;
  description: string;
  start: Date;
  durationMinutes?: number;
  alarmMinutesBefore?: number;
}

/** Generate an .ics file body for a single VEVENT with a display alarm. */
export function buildIcs(args: IcsArgs): string {
  const dur = args.durationMinutes ?? 15;
  const end = new Date(args.start.getTime() + dur * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}@mwpjm`;
  const escape = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  const alarm = args.alarmMinutesBefore ?? 15;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MWPJM//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(args.start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${escape(args.title)}`,
    `DESCRIPTION:${escape(args.description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    `TRIGGER:-PT${alarm}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Trigger an .ics download with a given filename. */
export function downloadIcs(filename: string, ics: string): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write rich text to the clipboard with both HTML and plain-text
 * variants. When the user pastes:
 *
 *   - Into OneNote / Word / Outlook compose / Gmail → the HTML view
 *     is used, so headings, tables, and lists render with formatting.
 *   - Into Notepad / a code editor / a Markdown app → the plain-text
 *     fallback is used.
 *
 * Falls back to plain-text-only if the browser doesn't expose
 * ClipboardItem (older Safari, Firefox), so the action always does
 * something useful even if the formatting is lost.
 */
export async function copyRichText(
  html: string,
  plainText: string,
): Promise<boolean> {
  const win = window as unknown as {
    ClipboardItem?: new (items: Record<string, Blob>) => unknown;
  };
  try {
    if (
      typeof win.ClipboardItem === 'function' &&
      navigator.clipboard &&
      'write' in navigator.clipboard
    ) {
      const item = new win.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      // navigator.clipboard.write expects an array of ClipboardItem;
      // the type isn't standardized across libs so we cast.
      await (navigator.clipboard as unknown as {
        write: (items: unknown[]) => Promise<void>;
      }).write([item]);
      return true;
    }
  } catch {
    // Fall through to plain-text fallback
  }
  // Plain-text fallback
  try {
    await navigator.clipboard.writeText(plainText);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the current clipboard contents. Used by the "Paste" action on
 * the Compose Note surface so the user can dictate into Google Docs /
 * iOS Notes (where OS-level dictation is much higher quality than the
 * Web Speech API ever was) and then drop that text in with one tap.
 *
 * Returns null on failure — typically when the user denies the
 * permission prompt, the page isn't on HTTPS, or the browser doesn't
 * implement clipboard.readText() (older Safari). Callers should
 * surface a friendly message and fall back to the textarea's
 * built-in long-press → Paste path.
 */
export async function readFromClipboard(): Promise<string | null> {
  const clip = (navigator as Navigator & {
    clipboard?: { readText?: () => Promise<string> };
  }).clipboard;
  if (!clip || typeof clip.readText !== 'function') return null;
  try {
    return await clip.readText();
  } catch {
    return null;
  }
}

interface NavigatorMaybeShare {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
}

export function isShareSupported(): boolean {
  return typeof (navigator as unknown as NavigatorMaybeShare).share === 'function';
}

export async function shareNote(args: {
  title: string;
  text: string;
}): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const nav = navigator as unknown as NavigatorMaybeShare;
  if (!nav.share) return 'unsupported';
  try {
    await nav.share({ title: args.title, text: args.text });
    return 'shared';
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
    throw e;
  }
}

/** Default reminder time = next workday morning at 9:00 local. */
export function defaultReminderDate(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  // If tomorrow is Sunday, push to Monday; if Saturday, push to Monday.
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() + 1);
  else if (day === 6) d.setDate(d.getDate() + 2);
  d.setHours(9, 0, 0, 0);
  return d;
}
