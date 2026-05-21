import { useState } from 'react';
import type { Trade, TradeKey, TradeStatus } from '../types';
import { STATUS_COLORS, STATUS_LABELS, TRADE_LABELS } from '../types';
import { useStore } from '../state/store';

interface Props {
  projectId: string;
  trades: Trade[];
}

export default function TradeTrackerSection({ projectId, trades }: Props) {
  const addTrade = useStore((s) => s.addTrade);
  const removeTrade = useStore((s) => s.removeTrade);
  const updateTrade = useStore((s) => s.updateTrade);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState<TradeKey>('plumbing');

  function add() {
    addTrade(projectId, {
      key: newKey,
      label: TRADE_LABELS[newKey],
      status: 'not_scheduled',
    });
    setShowAdd(false);
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Trade Coordination</h2>
        <button className="btn-ghost text-xs" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add trade'}
        </button>
      </div>

      {showAdd && (
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value as TradeKey)}
          >
            {Object.entries(TRADE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={add}>
            Add
          </button>
        </div>
      )}

      {trades.length === 0 ? (
        <p className="text-sm text-slate-500">No trades assigned yet.</p>
      ) : (
        <ul className="space-y-3">
          {trades.map((t) => (
            <TradeCard
              key={t.id}
              trade={t}
              onChange={(patch) => updateTrade(projectId, t.id, patch)}
              onRemove={() => removeTrade(projectId, t.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TradeCard({
  trade,
  onChange,
  onRemove,
}: {
  trade: Trade;
  onChange: (patch: Partial<Trade>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{TRADE_LABELS[trade.key] ?? trade.label}</div>
        <div className="flex items-center gap-2">
          <span className={`pill ${STATUS_COLORS[trade.status]}`}>
            {STATUS_LABELS[trade.status]}
          </span>
          <button
            className="text-slate-400 hover:text-rose-600 px-1"
            onClick={onRemove}
            aria-label="Remove trade"
          >
            ×
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={trade.status}
            onChange={(e) =>
              onChange({ status: e.target.value as TradeStatus })
            }
          >
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Scheduled date</label>
          <input
            type="date"
            className="input"
            value={trade.scheduledDate ?? ''}
            onChange={(e) =>
              onChange({ scheduledDate: e.target.value || undefined })
            }
          />
        </div>
        <div>
          <label className="label">Contact</label>
          <input
            className="input"
            placeholder="Name"
            value={trade.contact ?? ''}
            onChange={(e) => onChange({ contact: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            placeholder="555-555-1234"
            value={trade.phone ?? ''}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea
          className="input min-h-[60px]"
          placeholder="Scope / rough-in notes / coordination concerns…"
          value={trade.notes ?? ''}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>
    </li>
  );
}
