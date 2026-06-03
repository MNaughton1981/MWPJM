import { useState } from 'react';
import type { Milestone, TradeKey } from '../types';
import { TRADE_LABELS } from '../types';
import { useStore } from '../state/store';
import { formatDate } from '../lib/format';

interface Props {
  projectId: string;
  milestones: Milestone[];
  /** Section heading. Defaults to "Timetable"; simple/quick workboards
   *  pass "Follow-up Tasks" so the same checklist reads as a task list. */
  heading?: string;
  /** Placeholder for the add-row input. */
  addPlaceholder?: string;
}

export default function TimetableSection({
  projectId,
  milestones,
  heading = 'Timetable',
  addPlaceholder = 'Add milestone…',
}: Props) {
  const addMilestone = useStore((s) => s.addMilestone);
  const updateMilestone = useStore((s) => s.updateMilestone);
  const removeMilestone = useStore((s) => s.removeMilestone);

  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');

  const sorted = [...milestones].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  function add() {
    if (!newTitle.trim()) return;
    addMilestone(projectId, {
      title: newTitle.trim(),
      date: newDate || undefined,
      done: false,
    });
    setNewTitle('');
    setNewDate('');
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{heading}</h2>
        <span className="text-xs text-slate-500">
          {milestones.filter((m) => m.done).length}/{milestones.length} done
        </span>
      </div>

      <ul className="space-y-1.5">
        {sorted.map((m) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            onToggle={() =>
              updateMilestone(projectId, m.id, { done: !m.done })
            }
            onDateChange={(date) =>
              updateMilestone(projectId, m.id, { date: date || undefined })
            }
            onTradeChange={(trade) =>
              updateMilestone(projectId, m.id, { trade })
            }
            onRemove={() => removeMilestone(projectId, m.id)}
            onTitleChange={(title) =>
              updateMilestone(projectId, m.id, { title })
            }
          />
        ))}
      </ul>

      <div className="border-t pt-3 flex flex-col sm:flex-row gap-2">
        <input
          className="input flex-1"
          placeholder={addPlaceholder}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          type="date"
          className="input sm:w-44"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
        />
        <button className="btn-secondary" onClick={add} disabled={!newTitle.trim()}>
          Add
        </button>
      </div>
    </section>
  );
}

function MilestoneRow({
  milestone,
  onToggle,
  onDateChange,
  onTradeChange,
  onTitleChange,
  onRemove,
}: {
  milestone: Milestone;
  onToggle: () => void;
  onDateChange: (date: string) => void;
  onTradeChange: (trade: TradeKey | undefined) => void;
  onTitleChange: (title: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(milestone.title);

  function commit() {
    const t = draft.trim();
    if (t && t !== milestone.title) onTitleChange(t);
    setEditing(false);
  }

  return (
    <li className="flex items-center gap-2 py-1">
      <input
        type="checkbox"
        className="w-5 h-5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        checked={milestone.done}
        onChange={onToggle}
      />
      {editing ? (
        <input
          autoFocus
          className="input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(milestone.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          className={`flex-1 text-left text-sm ${
            milestone.done ? 'line-through text-slate-400' : ''
          }`}
          onClick={() => {
            setDraft(milestone.title);
            setEditing(true);
          }}
          title="Click to edit"
        >
          {milestone.title}
        </button>
      )}

      <select
        className="text-xs rounded border-slate-300 bg-white py-1 px-1.5"
        value={milestone.trade ?? ''}
        onChange={(e) =>
          onTradeChange((e.target.value as TradeKey) || undefined)
        }
      >
        <option value="">— trade —</option>
        {Object.entries(TRADE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>

      <input
        type="date"
        className="text-xs rounded border-slate-300 bg-white py-1 px-1.5 w-32"
        value={milestone.date ?? ''}
        onChange={(e) => onDateChange(e.target.value)}
        title={milestone.date ? formatDate(milestone.date) : 'No date'}
      />

      <button
        className="text-slate-400 hover:text-rose-600 px-1"
        onClick={onRemove}
        title="Remove"
        aria-label="Remove milestone"
      >
        ×
      </button>
    </li>
  );
}
