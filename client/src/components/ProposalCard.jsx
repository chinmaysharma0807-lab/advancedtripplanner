import { useState } from 'react';
import { itineraryApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { formatTime } from '../utils/format';
import { InlineError } from './ui';

const ACTION_STYLE = {
  shift: ['Move', 'bg-sky-100 text-sky-800'],
  skip: ['Skip', 'bg-rose-100 text-rose-800'],
  keep: ['Keep', 'bg-violet-100 text-violet-800'],
};

/** A pending reschedule proposal the traveller can review, partly accept, apply or reject. */
export default function ProposalCard({ proposal, trip, canEdit, onResolved }) {
  const [excluded, setExcluded] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onResolved?.();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card border-amber-300 bg-amber-50/60 p-4" role="region" aria-label="Proposed schedule change">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-amber-900">⏱ Running about {proposal.delayMinutes} min late — proposed changes for day {proposal.day}</h3>
        <span className="chip bg-white text-ink-500">
          {proposal.source === 'gps' ? 'From live location' : proposal.source === 'user' ? 'Reported delay' : 'Schedule check'}
          {proposal.dataSource ? ` · ${proposal.dataSource}` : ''}
          {proposal.isEstimate ? ' (estimate)' : ''}
        </span>
      </div>
      <p className="mt-1 text-sm text-amber-900">{proposal.explanation}</p>
      <ul className="mt-3 space-y-2">
        {proposal.changes.map((c) => {
          const [label, cls] = ACTION_STYLE[c.action];
          const optional = c.action !== 'keep';
          return (
            <li key={c.itemId} className="rounded-xl bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`chip mr-2 ${cls}`}>{label}</span>
                  <strong>{c.title}</strong>
                  <div className="mt-1 text-xs text-ink-500">
                    {formatTime(c.previousStart, trip.timezone)}–{formatTime(c.previousEnd, trip.timezone)}
                    {c.action === 'shift' && (
                      <>
                        {' '}
                        → <span className="font-semibold text-ink-900">{formatTime(c.proposedStart, trip.timezone)}–{formatTime(c.proposedEnd, trip.timezone)}</span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-ink-500">{c.reason}</div>
                  {c.alternatives?.length > 0 && (
                    <div className="mt-1 text-xs">
                      Alternatives nearby:{' '}
                      {c.alternatives.map((a) => `${a.name} (${a.distance} m${a.isDemo ? ', demo' : ''})`).join(' · ')}
                    </div>
                  )}
                </div>
                {optional && canEdit && proposal.status === 'pending' && (
                  <label className="flex flex-none items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={!excluded.has(c.itemId)}
                      onChange={(e) =>
                        setExcluded((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.delete(c.itemId);
                          else n.add(c.itemId);
                          return n;
                        })
                      }
                    />
                    Apply
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {proposal.warnings?.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-rose-800">
          {proposal.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <InlineError error={error} />
      {canEdit && proposal.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => act(() => itineraryApi.applyProposal(trip._id, proposal._id, { excludeItemIds: [...excluded] }))}>
            Apply changes
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => act(() => itineraryApi.rejectProposal(trip._id, proposal._id))}>
            Keep original schedule
          </button>
        </div>
      )}
    </div>
  );
}
