import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { buildNuvoloMail, isValidWorkOrderId } from '../lib/nuvolo';
import { useStore } from '../state/store';

interface Props {
  project: Project;
}

/**
 * Composes a Nuvolo update. On "Open in email" we hand off to the system
 * mail client via mailto:, and we *also* log the update in the activity
 * log so there's a local record even if the email fails to send.
 */
export default function UpdateComposer({ project }: Props) {
  const settings = useStore((s) => s.settings);
  const addActivity = useStore((s) => s.addActivity);
  const [text, setText] = useState('');

  const valid = isValidWorkOrderId(project.workOrderId);

  const mail = useMemo(() => {
    if (!valid || !text.trim()) return null;
    return buildNuvoloMail({
      workOrderId: project.workOrderId!,
      updateText: text,
      technicianName: settings.technicianName,
      to: settings.nuvoloEmail,
    });
  }, [valid, text, project.workOrderId, settings.technicianName, settings.nuvoloEmail]);

  function postAndOpen() {
    if (!mail) return;
    // Log to activity first
    addActivity(project.id, {
      timestamp: new Date().toISOString(),
      text: text.trim(),
      postedToNuvolo: true,
      author: settings.technicianName || undefined,
    });
    // Hand off to system mail client
    window.location.href = mail.href;
    setText('');
  }

  function logOnly() {
    if (!text.trim()) return;
    addActivity(project.id, {
      timestamp: new Date().toISOString(),
      text: text.trim(),
      postedToNuvolo: false,
      author: settings.technicianName || undefined,
    });
    setText('');
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Post update</h2>
        {!valid && (
          <span className="text-xs text-rose-600">
            Add a valid Work Order ID (FWKD…) above to post to Nuvolo
          </span>
        )}
      </div>

      <textarea
        className="input min-h-[100px]"
        placeholder="What happened today? (e.g. Plumber on site, rough-in complete, awaiting electrical inspection.)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {mail && (
        <details className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200">
          <summary className="cursor-pointer font-medium">
            Preview email
          </summary>
          <div className="mt-2 space-y-1">
            <div>
              <span className="text-slate-400">To:</span> {mail.to}
            </div>
            <div>
              <span className="text-slate-400">Subject:</span> {mail.subject}
            </div>
            <pre className="whitespace-pre-wrap font-sans bg-white border border-slate-200 rounded p-2 mt-1">
              {mail.body}
            </pre>
          </div>
        </details>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
        <button
          className="btn-secondary"
          onClick={logOnly}
          disabled={!text.trim()}
          title="Log to activity without emailing"
        >
          Log only
        </button>
        <button
          className="btn-primary"
          onClick={postAndOpen}
          disabled={!mail}
          title={
            !valid
              ? 'Set a valid Work Order ID first'
              : !text.trim()
              ? 'Type your update first'
              : 'Open mail client and log activity'
          }
        >
          Post to Nuvolo →
        </button>
      </div>
    </section>
  );
}
