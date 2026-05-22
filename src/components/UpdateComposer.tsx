import { useEffect, useMemo, useState } from 'react';
import type { Project } from '../types';
import { buildNuvoloMail, isValidWorkOrderId } from '../lib/nuvolo';
import { useStore } from '../state/store';
import {
  buildClipboardNote,
  buildIcs,
  buildToDoMail,
  copyToClipboard,
  defaultReminderDate,
  downloadIcs,
  isShareSupported,
  readFromClipboard,
  shareNote,
} from '../lib/destinations';
import { formatStamp } from '../lib/format';

interface Props {
  project: Project;
}

type Toast = { kind: 'ok' | 'err'; text: string } | null;

/**
 * Compose a note about the project and route it to one (or several) of:
 *   - Nuvolo (existing email-to-WO flow)
 *   - Microsoft To Do (mailto: to user's own address with TODO: prefix)
 *   - Outlook calendar (.ics download with built-in alarm)
 *   - Clipboard (paste into OneNote / wherever)
 *   - System share sheet (mobile only — pick OneNote / Teams / etc.)
 *   - Local activity log only
 *
 * Dictation note: we used to ship a 🎙️ Dictate button backed by the
 * Web Speech API. It produced an echo / duplicate-token bug on Pixel
 * Chrome that we couldn't fix from outside the engine. The OS-level
 * dictation in Gboard (Android) and the iOS keyboard is dramatically
 * better quality and writes directly into the textarea without any
 * code on our side, so we removed the in-app button and rely on the
 * keyboard mic instead. The 📋 Paste button below covers the
 * "dictate into Google Docs / Notes, then paste here" workflow.
 */
export default function UpdateComposer({ project }: Props) {
  const settings = useStore((s) => s.settings);
  const addActivity = useStore((s) => s.addActivity);

  const [text, setText] = useState('');
  const [showReminder, setShowReminder] = useState(false);
  const [reminderAt, setReminderAt] = useState<string>(() =>
    isoLocalInput(defaultReminderDate()),
  );
  const [toast, setToast] = useState<Toast>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const shareOk = isShareSupported();
  const woValid = isValidWorkOrderId(project.workOrderId);
  // Show the dictate affordance only on touch devices (mobile/tablet)
  // where the OS keyboard mic is the intended input path.
  const isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

  // Auto-clear toasts after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Helper used by every destination button
  function logActivity(opts: { postedToNuvolo: boolean }) {
    addActivity(project.id, {
      timestamp: new Date().toISOString(),
      text: text.trim(),
      postedToNuvolo: opts.postedToNuvolo,
      author: settings.technicianName || undefined,
    });
  }

  // ---- Destination handlers ----

  const nuvoloMail = useMemo(() => {
    if (!woValid || !text.trim()) return null;
    return buildNuvoloMail({
      workOrderId: project.workOrderId!,
      updateText: text,
      technicianName: settings.technicianName,
      to: settings.nuvoloEmail,
    });
  }, [woValid, text, project.workOrderId, settings.technicianName, settings.nuvoloEmail]);

  function postToNuvolo() {
    if (!nuvoloMail) return;
    logActivity({ postedToNuvolo: true });
    window.location.href = nuvoloMail.href;
    setText('');
  }

  function logOnly() {
    if (!text.trim()) return;
    logActivity({ postedToNuvolo: false });
    setText('');
    setToast({ kind: 'ok', text: 'Logged to activity.' });
  }

  function sendToToDo() {
    if (!text.trim()) return;
    const mail = buildToDoMail({
      text,
      userEmail: settings.userEmail,
      technicianName: settings.technicianName,
    });
    logActivity({ postedToNuvolo: false });
    window.location.href = mail.href;
    setText('');
  }

  async function copy() {
    if (!text.trim()) return;
    const formatted = buildClipboardNote({
      text,
      workOrderId: project.workOrderId,
      projectName: project.name,
      technicianName: settings.technicianName,
    });
    const ok = await copyToClipboard(formatted);
    if (ok) {
      logActivity({ postedToNuvolo: false });
      setToast({ kind: 'ok', text: 'Copied — paste into OneNote / wherever.' });
      setText('');
    } else {
      setToast({ kind: 'err', text: 'Copy failed (clipboard not available).' });
    }
  }

  async function pasteFromClipboard() {
    const clip = await readFromClipboard();
    if (clip === null) {
      setToast({
        kind: 'err',
        text: "Couldn't read clipboard — long-press the textarea and pick Paste instead.",
      });
      return;
    }
    if (!clip.trim()) {
      setToast({ kind: 'err', text: 'Clipboard is empty.' });
      return;
    }
    setText((prev) => {
      if (!prev) return clip;
      const sep = prev.endsWith('\n') ? '' : '\n';
      return `${prev}${sep}${clip}`;
    });
    setToast({ kind: 'ok', text: `Pasted ${clip.length} characters.` });
  }

  async function share() {
    if (!text.trim()) return;
    try {
      const result = await shareNote({
        title: project.workOrderId
          ? `${project.workOrderId} — ${project.name}`
          : project.name,
        text: buildClipboardNote({
          text,
          workOrderId: project.workOrderId,
          projectName: project.name,
          technicianName: settings.technicianName,
        }),
      });
      if (result === 'shared') {
        logActivity({ postedToNuvolo: false });
        setText('');
      }
    } catch (e) {
      setToast({ kind: 'err', text: (e as Error).message });
    }
  }

  function makeReminder() {
    if (!text.trim()) {
      setToast({ kind: 'err', text: 'Type a reminder first.' });
      return;
    }
    setShowReminder(true);
  }

  function confirmReminder() {
    const start = new Date(reminderAt);
    if (isNaN(start.getTime())) {
      setToast({ kind: 'err', text: 'Invalid date/time.' });
      return;
    }
    const firstLine = text.split('\n')[0].slice(0, 80);
    const title = project.workOrderId
      ? `[${project.workOrderId}] ${firstLine}`
      : firstLine;
    const description = buildClipboardNote({
      text,
      workOrderId: project.workOrderId,
      projectName: project.name,
      technicianName: settings.technicianName,
    });
    const ics = buildIcs({ title, description, start });
    const safeName = (firstLine || 'reminder')
      .replace(/[^a-z0-9 -]/gi, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)
      .toLowerCase();
    downloadIcs(`mwpjm-${safeName}.ics`, ics);
    logActivity({ postedToNuvolo: false });
    setShowReminder(false);
    setText('');
    setToast({
      kind: 'ok',
      text: 'Reminder downloaded. Open the .ics file to add to Outlook.',
    });
  }

  const hasText = !!text.trim();

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Compose note</h2>
        <span className="text-xs text-slate-500">{formatStamp()}</span>
      </div>

      <div className="space-y-1.5">
        {/* On mobile, show a prominent Dictate button that focuses the
            textarea (triggering the keyboard to appear with its mic
            button). The OS-level dictation in Gboard / iOS is the
            actual engine — dramatically better than the Web Speech API
            ever was, and zero code to maintain on our side. Hidden on
            desktop where users just type. */}
        {isMobile && (
          <button
            type="button"
            className="btn-secondary text-sm w-full"
            onClick={() => {
              textareaRef.current?.focus();
              setToast({
                kind: 'ok',
                text: 'Keyboard open — tap the 🎙️ mic button on your keyboard to dictate.',
              });
            }}
            title="Focus the text field and open the keyboard so you can tap the mic button to dictate"
          >
            🎙️ Tap to dictate
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="input min-h-[110px]"
          placeholder={
            isMobile
              ? "Tap 🎙️ above or the mic on your keyboard to dictate, or type here…"
              : "What happened today? (e.g. Plumber on site, rough-in complete, awaiting electrical inspection.)"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {/* The paste action covers the "dictate into Google Docs / Notes,
            then drop it in here" workflow. */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-slate-500">
            {isMobile
              ? 'Or dictate into Google Docs / Notes and paste here.'
              : 'Tip: dictate into Google Docs / Notes on your phone, sync, and paste here.'}
          placeholder="What happened today? (e.g. Plumber on site, rough-in complete, awaiting electrical inspection.)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {/* OS-level dictation hint — Gboard's mic and iOS Voice Control
            both write directly into a normal textarea with much better
            quality than anything we could do via Web Speech API. The
            paste action covers the "dictate elsewhere, drop it in here"
            workflow when the hand-off is more convenient. */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-slate-500">
            Tip: tap your keyboard's mic button to dictate (Gboard /
            iOS keyboard), or dictate into Google Docs / Notes and 📋 Paste.
          </p>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={pasteFromClipboard}
            title="Paste from clipboard — handy when you've just dictated into Google Docs or Notes"
          >
            📋 Paste
          </button>
        </div>
      </div>

      {/* Nuvolo email preview, when applicable */}
      {nuvoloMail && (
        <details className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200">
          <summary className="cursor-pointer font-medium">
            Preview Nuvolo email
          </summary>
          <div className="mt-2 space-y-1">
            <div>
              <span className="text-slate-400">To:</span> {nuvoloMail.to}
            </div>
            <div>
              <span className="text-slate-400">Subject:</span> {nuvoloMail.subject}
            </div>
            <pre className="whitespace-pre-wrap font-sans bg-white border border-slate-200 rounded p-2 mt-1">
              {nuvoloMail.body}
            </pre>
          </div>
        </details>
      )}

      {/* Inline reminder picker */}
      {showReminder && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <label className="label">Remind me at</label>
          <input
            type="datetime-local"
            className="input"
            value={reminderAt}
            onChange={(e) => setReminderAt(e.target.value)}
          />
          <p className="text-xs text-slate-500">
            Downloads an .ics file. Open it (or it auto-opens in Outlook) to
            add the event with a 15-min reminder alarm.
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="btn-ghost text-xs"
              onClick={() => setShowReminder(false)}
            >
              Cancel
            </button>
            <button className="btn-primary text-xs" onClick={confirmReminder}>
              Download .ics
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`text-xs rounded-md p-2 border ${
            toast.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Action buttons */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            className="btn-primary"
            onClick={postToNuvolo}
            disabled={!nuvoloMail}
            title={
              !woValid
                ? 'Set a valid Work Order ID first'
                : !hasText
                ? 'Type your update first'
                : 'Open mail client and log activity'
            }
          >
            Post to Nuvolo →
          </button>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            className="btn-secondary text-xs"
            onClick={copy}
            disabled={!hasText}
            title="Copy formatted note for pasting into OneNote / anywhere"
          >
            📋 Copy
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={sendToToDo}
            disabled={!hasText}
            title="Open mail with TODO: prefix → flag in Outlook to surface in To Do"
          >
            ✅ To Do
          </button>
          <button
            className="btn-secondary text-xs"
            onClick={makeReminder}
            disabled={!hasText}
            title="Download an .ics calendar reminder"
          >
            📅 Reminder
          </button>
          {shareOk && (
            <button
              className="btn-secondary text-xs"
              onClick={share}
              disabled={!hasText}
              title="Open the system share sheet (pick OneNote, Teams, etc.)"
            >
              📤 Share…
            </button>
          )}
          <button
            className="btn-ghost text-xs"
            onClick={logOnly}
            disabled={!hasText}
            title="Save to local activity log without sending anywhere"
          >
            📌 Log only
          </button>
        </div>
      </div>
    </section>
  );
}

/** Format a Date for an <input type="datetime-local">. */
function isoLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
