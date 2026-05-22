import type { AppData, Project, Settings } from '../types';
import {
  PROJECT_STATUS_LABELS,
  STATUS_LABELS,
  TRADE_LABELS,
} from '../types';
import { formatDate, formatDateTime } from './format';

export function buildAppData(
  projects: Project[],
  settings: Settings,
): AppData {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects,
    settings,
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
