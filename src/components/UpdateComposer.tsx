import { useEffect, useMemo, useRef, useState } from 'react';
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
import { loadProjectPhotoFiles } from '../lib/photoStorage';
import { compressPhotos, formatBytes } from '../lib/photoCompress';
import { formatStamp } from '../lib/format';

/** Typical email server attachment cap (Outlook / Gmail). */
const EMAIL_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Open a mailto: link reliably across desktop browsers, installed PWAs,
 * and mobile Chrome. `window.location.href = mailto:` silently fails in
 * some installed-PWA contexts on Android Chrome. A synthesized <a> click
 * is the most portable fallback.
 */
function openMailto(href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  // Cleanup after a short delay — removal is cosmetic, not functional.
  setTimeout(() => document.body.removeChild(a), 200);
}

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
  // Sticky-draft plumbing — read text from / write text back to the
  // store so it survives navigating away from the workboard, the PWA
  // being backgrounded, or the device locking. Component-local
  // useState would have lost everything every time.
  const text = useStore((s) => s.composerDrafts[project.id] ?? '');
  const setComposerDraft = useStore((s) => s.setComposerDraft);
  const clearComposerDraft = useStore((s) => s.clearComposerDraft);

  function setText(next: string) {
    setComposerDraft(project.id, next);
  }
  function clearDraft() {
    clearComposerDraft(project.id);
  }

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
    postToNuvoloAsync();
  }

  // --- Photo batch state (for the "over budget" modal) ---
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [sendingPhotos, setSendingPhotos] = useState(false);
  /** Compression progress: { done, total }. null when not active.
   *  Drives the button label "Compressing 3/12…" so the user can see
   *  work is moving — without this the button just freezes on
   *  "Compressing photos…" for 30+ seconds with 12 photos and looks
   *  hung. */
  const [compressProgress, setCompressProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  /** Estimated raw photo size (sum of original blobs). Updated when
   *  photos change — used for the budget indicator and the batch
   *  decision. Stored as a rough estimate from metadata; the real
   *  compressed size is computed on-demand during send. */
  const photoSizeEstimate = useMemo(() => {
    const photos = project.photos ?? [];
    return photos.reduce((sum, p) => sum + (p.size || 0), 0);
  }, [project.photos]);

  const photoCount = (project.photos ?? []).length;

  async function postToNuvoloAsync() {
    if (!nuvoloMail) return;

    const hasPhotos = photoCount > 0;

    // If photos exist and estimated size exceeds the email cap, show
    // the batch modal instead of trying to send everything at once.
    if (hasPhotos && isMobile && photoSizeEstimate > EMAIL_MAX_BYTES) {
      setShowBatchModal(true);
      return;
    }

    // Normal path — compress + share (mobile) or mailto (desktop).
    await sendWithPhotos('all');
  }

  /**
   * Core send logic. `mode` controls how many photos to attach:
   *   - 'all': compress all photos and share
   *   - 'batch': compress photos up to EMAIL_MAX_BYTES
   *   - 'none': open mailto with a body note about photos
   */
  async function sendWithPhotos(mode: 'all' | 'batch' | 'none') {
    if (!nuvoloMail) return;
    setShowBatchModal(false);
    setSendingPhotos(true);
    setCompressProgress(null);

    const hasPhotos = photoCount > 0;

    // Track whether we successfully attached photos via the share
    // sheet. If anything goes sideways during compression / share, we
    // fall through to the no-attachment mailto path so the user
    // ALWAYS gets a mail client open — never a silent failure or
    // (worse) a white-screen crash with their note still in limbo.
    let shareSucceeded = false;

    try {
      // On mobile with photos: compress + share via system sheet.
      if (isMobile && hasPhotos && mode !== 'none') {
        let rawFiles: File[] = [];
        let compressed: File[] = [];

        try {
          rawFiles = await loadProjectPhotoFiles(
            project.id,
            project.photos ?? [],
          );
        } catch (e) {
          // IndexedDB read failed — fall through to mailto.
          console.error('loadProjectPhotoFiles failed:', e);
          setToast({
            kind: 'err',
            text: "Couldn't load photos from local storage — sending email without attachments.",
          });
        }

        if (rawFiles.length > 0) {
          try {
            // Sequential compression with progress callback. Wrapped
            // in its own try so an OOM / decode failure on photo N
            // doesn't lose photos 1..N-1 — we just send what we have.
            compressed = await compressPhotos(
              rawFiles,
              {},
              (done, total) => setCompressProgress({ done, total }),
            );
          } catch (e) {
            console.error('compressPhotos failed:', e);
            setToast({
              kind: 'err',
              text: 'Photo compression failed — sending email without attachments.',
            });
            compressed = [];
          } finally {
            setCompressProgress(null);
          }
        }

        // If mode is 'batch', pick the first N that fit under the cap.
        let filesToSend = compressed;
        if (mode === 'batch' && compressed.length > 0) {
          filesToSend = [];
          let running = 0;
          for (const f of compressed) {
            if (running + f.size > EMAIL_MAX_BYTES) break;
            filesToSend.push(f);
            running += f.size;
          }
          // Always send at least one photo even if it alone exceeds cap.
          if (filesToSend.length === 0 && compressed.length > 0) {
            filesToSend = [compressed[0]];
          }
        }

        if (filesToSend.length > 0) {
          const nav = navigator as Navigator & {
            canShare?: (data: { files?: File[] }) => boolean;
            share?: (data: {
              files?: File[];
              title?: string;
              text?: string;
            }) => Promise<void>;
          };
          if (
            nav.share &&
            nav.canShare &&
            nav.canShare({ files: filesToSend })
          ) {
            const shareText =
              `To: ${nuvoloMail.to}\n` +
              `Subject: ${nuvoloMail.subject}\n\n` +
              nuvoloMail.body;
            try {
              await nav.share({
                files: filesToSend,
                title: nuvoloMail.subject,
                text: shareText,
              });
              logActivity({ postedToNuvolo: true });
              clearDraft();
              const remaining = photoCount - filesToSend.length;
              const suffix =
                remaining > 0
                  ? ` (${remaining} more photo(s) not included — send in a follow-up)`
                  : '';
              setToast({
                kind: 'ok',
                text: `Shared ${filesToSend.length} photo(s) — send from your mail app.${suffix}`,
              });
              shareSucceeded = true;
              return;
            } catch (e) {
              if ((e as { name?: string }).name === 'AbortError') {
                setToast({ kind: 'err', text: 'Share cancelled — not posted.' });
                return;
              }
              // Fall through to mailto: on any other share error.
              console.error('navigator.share failed:', e);
            }
          }
        }
        // If share API couldn't handle it, fall through to mailto.
      }

      // Desktop path (or mobile share unavailable / mode = 'none' /
      // anything threw on the way down): open mailto with a note
      // about photos in the body.
      if (shareSucceeded) return; // belt + suspenders
      logActivity({ postedToNuvolo: true });
      if (hasPhotos) {
        const photoNote = `\n\n[${photoCount} photo(s) captured in Workboard — attach via Nuvolo or download from the app]`;
        const enhancedBody = nuvoloMail.body + photoNote;
        const href =
          `mailto:${encodeURIComponent(nuvoloMail.to)}` +
          `?subject=${encodeURIComponent(nuvoloMail.subject)}` +
          `&body=${encodeURIComponent(enhancedBody)}`;
        openMailto(href);
      } else {
        openMailto(nuvoloMail.href);
      }
      clearDraft();
    } catch (e) {
      // Outermost guard. Should never fire (every async step above
      // has its own try/catch), but if something does throw out here
      // we still want a toast and a usable UI rather than a white
      // screen. Don't clear the draft — let the user retry.
      console.error('sendWithPhotos failed:', e);
      setToast({
        kind: 'err',
        text: `Send failed: ${(e as Error).message || 'unknown error'}. Your draft is preserved — try again or use Copy.`,
      });
    } finally {
      setSendingPhotos(false);
      setCompressProgress(null);
    }
  }

  function logOnly() {
    if (!text.trim()) return;
    logActivity({ postedToNuvolo: false });
    clearDraft();
    setToast({ kind: 'ok', text: 'Logged to activity.' });
  }

  function sendToToDo() {
    if (!text.trim()) return;
    if (!settings.userEmail.trim()) {
      // Without a configured user email the mailto: opens a blank
      // To: field in the mail client and the whole flow looks broken.
      // Hard-stop here with an explicit hint instead of letting the
      // user think the button is just buggy.
      setToast({
        kind: 'err',
        text: 'Set "Your email" in Settings → Technician to use the To Do flow.',
      });
      return;
    }
    const mail = buildToDoMail({
      text,
      userEmail: settings.userEmail,
      technicianName: settings.technicianName,
    });
    logActivity({ postedToNuvolo: false });
    openMailto(mail.href);
    clearDraft();
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
      clearDraft();
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
    // Append to whatever's already in the draft. We can't pass a
    // function to setText anymore (it now writes to the store, not
    // local state), so read the current draft directly.
    const sep = !text || text.endsWith('\n') ? '' : '\n';
    setText(text ? `${text}${sep}${clip}` : clip);
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
        clearDraft();
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
    clearDraft();
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
        {/* Dictation hint, mobile only.
            We can't programmatically open the keyboard's microphone —
            that's an OS-level UI element on iOS Safari and Android
            Gboard, sandboxed from web pages. The Web Speech API is the
            other option, but we shipped a 🎙️ button backed by it once
            and it had echo / duplicate-token issues on Pixel Chrome
            we couldn't fix from outside the engine. So this is now a
            plain notice rather than a button — it doesn't lie about
            what one tap can do, and it points the user at the keyboard
            mic which is dramatically better quality anyway. */}
        {isMobile && (
          <div
            role="note"
            className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-2 flex items-start gap-2"
          >
            <span aria-hidden className="text-base leading-none">
              🎙️
            </span>
            <span>
              <strong>To dictate:</strong> tap the textarea below to open
              your keyboard, then use the microphone button on the keyboard
              itself.
            </span>
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="input min-h-[110px]"
          placeholder={
            isMobile
              ? 'Tap here to open the keyboard, then use the keyboard mic to dictate — or just type.'
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

      {/* Photo size budget indicator — shows when photos exist so the
          user has a visual sense of whether their payload will fit in
          one email. Hidden when there are no photos. */}
      {photoCount > 0 && (
        <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
          <span>
            📷 {photoCount} photo{photoCount !== 1 ? 's' : ''} ·{' '}
            <span
              className={
                photoSizeEstimate > EMAIL_MAX_BYTES
                  ? 'text-amber-700 font-medium'
                  : ''
              }
            >
              ~{formatBytes(photoSizeEstimate)} raw
            </span>
            {photoSizeEstimate > EMAIL_MAX_BYTES && (
              <span className="text-amber-700">
                {' '}
                (over ~25 MB email cap — will auto-compress or batch)
              </span>
            )}
          </span>
        </div>
      )}

      {/* Batch modal — shown when user hits Post with too many photos */}
      {showBatchModal && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="font-semibold text-sm text-amber-900">
            Photos exceed email limit (~25 MB)
          </div>
          <p className="text-xs text-amber-800">
            You have {photoCount} photos (~{formatBytes(photoSizeEstimate)} raw).
            After compression they'll be smaller, but may still exceed the cap.
            Choose how to proceed:
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => sendWithPhotos('batch')}
              disabled={sendingPhotos}
            >
              {sendingPhotos
                ? compressProgress
                  ? `Compressing ${compressProgress.done}/${compressProgress.total}…`
                  : 'Preparing…'
                : `Send first batch that fits (~25 MB) →`}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => sendWithPhotos('none')}
              disabled={sendingPhotos}
            >
              Send email without attachments (note photo count in body)
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setShowBatchModal(false)}
              disabled={sendingPhotos}
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-amber-700">
            Tip: you can always send remaining photos in a follow-up post
            — each one adds another note to the same FWKD work order.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="border-t pt-3 space-y-2">
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            className="btn-primary"
            onClick={postToNuvolo}
            disabled={!nuvoloMail || sendingPhotos}
            title={
              !woValid
                ? 'Set a valid Work Order ID first'
                : !hasText
                ? 'Type your update first'
                : isMobile && photoCount > 0
                ? `Share update + ${photoCount} photo(s) via mail app`
                : 'Open mail client and log activity'
            }
          >
            {sendingPhotos
              ? compressProgress
                ? `Compressing ${compressProgress.done}/${compressProgress.total}…`
                : 'Preparing photos…'
              : isMobile && photoCount > 0
                ? `Post to Nuvolo + ${photoCount} photo(s) →`
                : 'Post to Nuvolo →'}
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
