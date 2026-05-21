import type { ActivityEntry } from '../types';
import { useStore } from '../state/store';
import { formatDateTime } from '../lib/format';

interface Props {
  projectId: string;
  activity: ActivityEntry[];
}

export default function ActivityLogSection({ projectId, activity }: Props) {
  const remove = useStore((s) => s.removeActivity);

  if (activity.length === 0) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold mb-1">Activity log</h2>
        <p className="text-sm text-slate-500">No updates yet.</p>
      </section>
    );
  }

  return (
    <section className="card p-4 space-y-3">
      <h2 className="font-semibold">Activity log</h2>
      <ul className="space-y-2">
        {activity.map((a) => (
          <li
            key={a.id}
            className="border-l-2 border-brand-500 pl-3 py-1 group"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs text-slate-500">
                {formatDateTime(a.timestamp)}
                {a.author && <span> · {a.author}</span>}
                {a.postedToNuvolo ? (
                  <span className="pill bg-emerald-100 text-emerald-800 ml-2">
                    Nuvolo
                  </span>
                ) : (
                  <span className="pill bg-slate-100 text-slate-700 ml-2">
                    Local
                  </span>
                )}
              </div>
              <button
                className="text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 text-xs"
                onClick={() => remove(projectId, a.id)}
                aria-label="Remove entry"
              >
                Remove
              </button>
            </div>
            <p className="text-sm whitespace-pre-wrap mt-1">{a.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
