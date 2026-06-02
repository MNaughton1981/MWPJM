import type { AppData, Project, SavedVendor, SavedVendorEvent, Settings } from '../types';
import {
  PROJECT_STATUS_LABELS,
  STATUS_LABELS,
  TRADE_LABELS,
} from '../types';
import { formatDate, formatDateTime, workboardNumber } from './format';

export function buildAppData(
  projects: Project[],
  settings: Settings,
  savedVendors: SavedVendor[] = [],
  savedVendorEvents: SavedVendorEvent[] = [],
): AppData {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    settings,
    savedVendors,
    savedVendorEvents,
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, filename);
}

export function downloadText(filename: string, text: string, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Parse an uploaded JSON backup file. Throws on invalid shape. */
export async function parseAppDataFile(file: File): Promise<AppData> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid file');
  if (!Array.isArray(parsed.projects)) throw new Error('Missing projects array');
  return parsed as AppData;
}

/** Markdown summary suitable for pasting into OneNote. */
export function projectToMarkdown(project: Project): string {
  const lines: string[] = [];
  lines.push(`# ${project.name}`);
  lines.push('');
  // WB# is rendered first in the header — it's the most reliable
  // cross-device identifier (FWKD may not exist yet for Quick
  // Workboards, but every workboard has a WB#). FWKD remains the
  // primary tie to Nuvolo when present.
  lines.push(`**Workboard:** ${workboardNumber(project.id)}`);
  if (project.workOrderId) lines.push(`**Work Order:** ${project.workOrderId}`);
  if (project.location) lines.push(`**Location:** ${project.location}`);
  lines.push(`**Status:** ${PROJECT_STATUS_LABELS[project.status]}`);
  lines.push(`**Last updated:** ${formatDateTime(project.updatedAt)}`);
  lines.push('');
  if (project.description) {
    lines.push('## Description');
    lines.push(project.description);
    lines.push('');
  }

  lines.push('## Trades');
  if (project.trades.length === 0) {
    lines.push('_No trades assigned._');
  } else {
    for (const t of project.trades) {
      lines.push(`- **${TRADE_LABELS[t.key] ?? t.label}** — ${STATUS_LABELS[t.status]}`);
      if (t.contact) lines.push(`  - Contact: ${t.contact}${t.phone ? ` (${t.phone})` : ''}`);
      if (t.scheduledDate) lines.push(`  - Scheduled: ${formatDate(t.scheduledDate)}`);
      if (t.notes) lines.push(`  - Notes: ${t.notes}`);
    }
  }
  lines.push('');

  lines.push('## Timetable');
  if (project.milestones.length === 0) {
    lines.push('_No milestones._');
  } else {
    for (const m of project.milestones) {
      const check = m.done ? '[x]' : '[ ]';
      const date = m.date ? ` — ${formatDate(m.date)}` : '';
      const trade = m.trade ? ` _(${TRADE_LABELS[m.trade]})_` : '';
      lines.push(`- ${check} ${m.title}${date}${trade}`);
      if (m.notes) lines.push(`  - ${m.notes}`);
    }
  }
  lines.push('');

  lines.push('## Activity Log');
  if (project.activity.length === 0) {
    lines.push('_No activity yet._');
  } else {
    for (const a of project.activity) {
      const tag = a.postedToNuvolo ? ' _(posted to Nuvolo)_' : '';
      lines.push(`- **${formatDateTime(a.timestamp)}**${tag}`);
      lines.push(`  ${a.text.replace(/\n/g, '\n  ')}`);
    }
  }
  lines.push('');

  const vendors = project.vendors ?? [];
  if (vendors.length > 0) {
    lines.push('## Vendors / contacts');
    for (const v of vendors) {
      const company = v.company ? ` — ${v.company}` : '';
      const role = v.role ? ` (${v.role})` : '';
      lines.push(`- **${v.name || '(unnamed)'}**${company}${role}`);
      if (v.phone) lines.push(`  - Phone: ${v.phone}`);
      if (v.email) lines.push(`  - Email: ${v.email}`);
      if (v.visitDate) lines.push(`  - Visit: ${formatDate(v.visitDate)}`);
      if (v.notes) lines.push(`  - Notes: ${v.notes}`);
    }
    lines.push('');
  }

  const photos = project.photos ?? [];
  if (photos.length > 0) {
    lines.push('## Photos');
    lines.push(`${photos.length} photo(s) on file in MWPJM:`);
    for (const ph of photos) {
      const cap = ph.caption || '_(no caption)_';
      lines.push(`- ${cap} — ${formatDateTime(ph.capturedAt)}`);
    }
    lines.push('');
    lines.push(
      '_Photos themselves stay on the device — download from MWPJM to upload to Nuvolo._',
    );
    lines.push('');
  }

  return lines.join('\n');
}

// HTML escape for safe interpolation into the rich-text export below.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

/**
 * Rich-HTML summary of a project, designed to paste cleanly into
 * OneNote, Word, Outlook compose, or any rich-text surface that
 * accepts HTML on the clipboard.
 *
 * Why both this and `projectToMarkdown`: the markdown is great for
 * code editors / Markdown-aware tools but pastes as raw `#` and `**`
 * characters into OneNote. This HTML version, when written to the
 * clipboard via the `text/html` MIME type, is rendered with proper
 * headings, tables, and lists when the user hits Ctrl+V.
 *
 * Style is kept minimal and inline-only — no external stylesheet, no
 * classes — so the receiving app's own styles take over and it looks
 * like a native note.
 */
export function projectToHtml(project: Project): string {
  const parts: string[] = [];

  parts.push(`<h1>${esc(project.name)}</h1>`);

  // Header table — at-a-glance project metadata. WB# first so it's
  // the most prominent identifier in the OneNote paste; FWKD second.
  const headerRows: string[] = [];
  headerRows.push(
    `<tr><td><b>Workboard</b></td><td>${esc(workboardNumber(project.id))}</td></tr>`,
  );
  if (project.workOrderId)
    headerRows.push(`<tr><td><b>Work Order</b></td><td>${esc(project.workOrderId)}</td></tr>`);
  if (project.location)
    headerRows.push(`<tr><td><b>Location</b></td><td>${esc(project.location)}</td></tr>`);
  headerRows.push(
    `<tr><td><b>Status</b></td><td>${esc(PROJECT_STATUS_LABELS[project.status])}</td></tr>`,
  );
  headerRows.push(
    `<tr><td><b>Last updated</b></td><td>${esc(formatDateTime(project.updatedAt))}</td></tr>`,
  );
  parts.push(
    `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">${headerRows.join('')}</table>`,
  );

  if (project.description) {
    parts.push('<h2>Description</h2>');
    parts.push(`<p>${nl2br(project.description)}</p>`);
  }

  // Trades — table form so it pastes cleanly into OneNote / Word
  parts.push('<h2>Trades</h2>');
  if (project.trades.length === 0) {
    parts.push('<p><i>No trades assigned.</i></p>');
  } else {
    const rows = project.trades.map((t) => {
      const contact = t.contact
        ? `${esc(t.contact)}${t.phone ? ` (${esc(t.phone)})` : ''}`
        : '';
      const sched = t.scheduledDate ? esc(formatDate(t.scheduledDate)) : '';
      const notes = t.notes ? nl2br(t.notes) : '';
      return `<tr>
        <td><b>${esc(TRADE_LABELS[t.key] ?? t.label)}</b></td>
        <td>${esc(STATUS_LABELS[t.status])}</td>
        <td>${contact}</td>
        <td>${sched}</td>
        <td>${notes}</td>
      </tr>`;
    });
    parts.push(
      `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <thead><tr><th>Trade</th><th>Status</th><th>Contact</th><th>Scheduled</th><th>Notes</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>`,
    );
  }

  // Timetable — checkbox-style list
  parts.push('<h2>Timetable</h2>');
  if (project.milestones.length === 0) {
    parts.push('<p><i>No milestones.</i></p>');
  } else {
    const items = project.milestones.map((m) => {
      const check = m.done ? '☑' : '☐';
      const date = m.date ? ` — ${esc(formatDate(m.date))}` : '';
      const trade = m.trade ? ` <i>(${esc(TRADE_LABELS[m.trade])})</i>` : '';
      const notes = m.notes ? `<br><i>${nl2br(m.notes)}</i>` : '';
      return `<li>${check} ${esc(m.title)}${date}${trade}${notes}</li>`;
    });
    parts.push(`<ul>${items.join('')}</ul>`);
  }

  // Activity log — chronological list with timestamps
  parts.push('<h2>Activity Log</h2>');
  if (project.activity.length === 0) {
    parts.push('<p><i>No activity yet.</i></p>');
  } else {
    const items = project.activity.map((a) => {
      const tag = a.postedToNuvolo ? ' <i>(posted to Nuvolo)</i>' : '';
      return `<li><b>${esc(formatDateTime(a.timestamp))}</b>${tag}<br>${nl2br(a.text)}</li>`;
    });
    parts.push(`<ul>${items.join('')}</ul>`);
  }

  // Vendors / contacts
  const vendors = project.vendors ?? [];
  if (vendors.length > 0) {
    parts.push('<h2>Vendors / contacts</h2>');
    const rows = vendors.map((v) => {
      const company = v.company ? esc(v.company) : '';
      const role = v.role ? esc(v.role) : '';
      const phone = v.phone ? esc(v.phone) : '';
      const email = v.email
        ? `<a href="mailto:${esc(v.email)}">${esc(v.email)}</a>`
        : '';
      const visit = v.visitDate ? esc(formatDate(v.visitDate)) : '';
      const notes = v.notes ? nl2br(v.notes) : '';
      return `<tr>
        <td><b>${esc(v.name || '(unnamed)')}</b></td>
        <td>${company}</td>
        <td>${role}</td>
        <td>${phone}</td>
        <td>${email}</td>
        <td>${visit}</td>
        <td>${notes}</td>
      </tr>`;
    });
    parts.push(
      `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
        <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Phone</th><th>Email</th><th>Visit</th><th>Notes</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>`,
    );
  }

  // Photos — metadata only (binaries don't fit on the clipboard)
  const photos = project.photos ?? [];
  if (photos.length > 0) {
    parts.push('<h2>Photos</h2>');
    parts.push(`<p>${photos.length} photo(s) on file in MWPJM:</p>`);
    const items = photos.map((ph) => {
      const cap = ph.caption ? esc(ph.caption) : '<i>(no caption)</i>';
      return `<li>${cap} — ${esc(formatDateTime(ph.capturedAt))}</li>`;
    });
    parts.push(`<ul>${items.join('')}</ul>`);
    parts.push(
      '<p><i>Photos themselves stay on the device — download from MWPJM to upload to Nuvolo.</i></p>',
    );
  }

  // Wrap in a single root <div> with a base font so the receiving app
  // has a coherent block to render. Nothing fancy — we want to inherit
  // OneNote / Word's own typography, not impose our own.
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${parts.join('\n')}</div>`;
}

/**
 * Concise summary formatted for copy/paste into one-on-one meeting notes.
 * 
 * Designed to fit under a location bullet in the "Repair/Project status by location"
 * section. Format mirrors the user's existing template:
 * 
 * - FWKD0012345 - Short description - Status tag
 *   - Summary text
 *   - Recent activity / next steps
 *   - Vendor info if applicable
 */
export function projectToOneOnOneSummary(project: Project): string {
  const lines: string[] = [];
  
  // Header: FWKD - Description - Status tag (New/No Change/Done)
  const fwkd = project.workOrderId || 'No FWKD';
  const desc = project.name;
  
  // Infer status tag based on project status and recent activity
  let statusTag = '';
  const daysSinceUpdate = (Date.now() - new Date(project.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (project.status === 'complete') {
    statusTag = ' - Done';
  } else if (daysSinceUpdate < 3) {
    statusTag = ' - New';
  } else if (daysSinceUpdate > 7) {
    // No recent activity
    statusTag = ' - No Change';
  }
  // If recent activity but not new/done, leave blank (implies active work)
  
  lines.push(`○ ${fwkd} - ${desc}${statusTag}`);
  
  // Description / summary
  if (project.description) {
    const summaryLines = project.description.split('\n').filter(l => l.trim());
    summaryLines.forEach(line => {
      lines.push(`\t§ ${line.trim()}`);
    });
  }
  
  // Recent activity (most recent 3 entries)
  const recentActivity = [...project.activity]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 3);
  
  if (recentActivity.length > 0) {
    recentActivity.forEach(a => {
      const dateStr = formatDate(a.timestamp);
      const activityLines = a.text.split('\n').filter(l => l.trim());
      activityLines.forEach((line, idx) => {
        const prefix = idx === 0 ? `\t§ ${dateStr}: ` : '\t\t';
        lines.push(`${prefix}${line.trim()}`);
      });
    });
  }
  
  // Vendors on-site (if any with visit dates)
  const vendors = project.vendors ?? [];
  const visitedVendors = vendors.filter(v => v.name && v.visitDate);
  if (visitedVendors.length > 0) {
    visitedVendors.forEach(v => {
      const company = v.company ? ` (${v.company})` : '';
      const visitDate = v.visitDate ? formatDate(v.visitDate) : '';
      const visitTime = v.visitTime ? ` at ${v.visitTime}` : '';
      lines.push(`\t§ ${v.name}${company} on-site ${visitDate}${visitTime}`);
    });
  }
  
  // Upcoming milestones (incomplete only, max 2)
  const upcomingMilestones = project.milestones
    .filter(m => !m.done)
    .slice(0, 2);
  if (upcomingMilestones.length > 0) {
    lines.push(`\t§ Next steps:`);
    upcomingMilestones.forEach(m => {
      const date = m.date ? ` (${formatDate(m.date)})` : '';
      lines.push(`\t\t• ${m.title}${date}`);
    });
  }
  
  // Photos note if any exist
  const photos = project.photos ?? [];
  if (photos.length > 0) {
    lines.push(`\t§ ${photos.length} photo${photos.length !== 1 ? 's' : ''} attached to workboard`);
  }
  
  lines.push(''); // Blank line for spacing
  return lines.join('\n');
}
