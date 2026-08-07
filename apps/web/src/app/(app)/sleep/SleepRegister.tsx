'use client';

import { useActionState, useEffect, useState } from 'react';
import { SLEEP_POSITIONS, SLEEP_POSITION_LABELS, type SleepStatus } from '@ece/core';
import { recordCheck, type Result } from './actions';

export interface SleepRow {
  status: SleepStatus;
  childName: string;
  /** The last check formatted in the centre's zone, or null if there is none today. */
  lastLabel: string | null;
  /** How the child was found at the last check, for the row summary. */
  lastPosition: string | null;
  lastBreathing: boolean | null;
}

/**
 * The cot room, longest-unchecked first.
 *
 * WHAT THIS SCREEN REFUSES TO SAY
 *
 * "Compliant", and anything that implies it. When the centre has stated no interval,
 * `overdue` is `null` and every row reads as a plain elapsed time with no verdict
 * attached. Rendering `null` the same as `false` — a quiet green tick — would turn
 * "nobody has said what recently enough means" into "this is fine", which is the
 * single failure this whole feature was built to avoid. See `sleep-checks.md`.
 */
export function SleepRegister({
  rows,
  intervalMinutes,
}: {
  rows: SleepRow[];
  intervalMinutes: number | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="empty">Nobody is signed in, so there is nobody to check.</p>
      </div>
    );
  }

  /*
    Longest since a check first, and children never checked today at the very top.

    Sorting by name would be tidier and useless: the person holding the tablet is
    looking for who to check next, and that is the top of this list or it is nowhere.
  */
  const sorted = [...rows].sort((a, b) => {
    const rank = (r: SleepRow) => (r.status.lastCheckedAt === null ? -1 : 0);
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (b.status.minutesSince ?? 0) - (a.status.minutesSince ?? 0);
  });

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Child</th>
            <th>Last check</th>
            <th>How they were</th>
            <th style={{ width: '1%' }}>
              <span className="visually-hidden">Record a check</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <Row key={row.status.childId} row={row} intervalMinutes={intervalMinutes} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, intervalMinutes }: { row: SleepRow; intervalMinutes: number | null }) {
  const { status } = row;
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<Result | null, FormData>(recordCheck, null);

  /*
    A fresh key per submission, exactly as `GiveMedicine` does and for the same
    reason: `ON CONFLICT DO NOTHING` reports a repeated key as success, so a key
    fixed at mount would swallow the 2:10 check as a duplicate of the 2:00 one and
    say it worked. Minted in an effect because this server-renders first.
  */
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(crypto.randomUUID()), []);
  useEffect(() => {
    if (state && 'ok' in state) {
      setKey(crypto.randomUUID());
      setOpen(false);
    }
  }, [state]);

  return (
    <tr>
      <td>
        <strong>{row.childName}</strong>
        {state && 'error' in state && (
          <div className="error" role="alert">
            {state.error}
          </div>
        )}
      </td>

      <td>
        {status.lastCheckedAt === null ? (
          // Not "overdue" — an interval has not started running for this child today.
          // A different sentence, because it is a different situation.
          <span className="flag flag-quiet">No check recorded today</span>
        ) : status.overdue === true ? (
          <span className="flag flag-critical">
            {'▲'} {status.minutesSince} min ago — past your {intervalMinutes} min interval
          </span>
        ) : status.overdue === false ? (
          <span className="flag flag-ok">
            {'✓'} {status.minutesSince} min ago
          </span>
        ) : (
          /*
            The centre has stated no interval. A plain elapsed time and no verdict —
            deliberately not the green tick above, which would read as approval of a
            gap nobody has measured against anything.
          */
          <span className="flag flag-quiet">{status.minutesSince} min ago</span>
        )}
        {row.lastLabel && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            at {row.lastLabel}
          </div>
        )}
      </td>

      <td>
        {row.lastPosition ? (
          <>
            {row.lastPosition}
            {row.lastBreathing === false && (
              <div className="error" style={{ fontSize: '0.8125rem' }}>
                Breathing not observed
              </div>
            )}
          </>
        ) : (
          <span className="empty">—</span>
        )}
      </td>

      <td>
        {!open ? (
          <button className="small" type="button" onClick={() => setOpen(true)}>
            Record a check
          </button>
        ) : (
          <form action={action}>
            <input type="hidden" name="childId" value={status.childId} />
            <input type="hidden" name="clientUuid" value={key ?? ''} />

            <div className="field">
              <label htmlFor={`pos-${status.childId}`}>How you found them</label>
              <select
                id={`pos-${status.childId}`}
                name="observedPosition"
                required
                defaultValue="back"
              >
                {SLEEP_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {SLEEP_POSITION_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 0.75rem' }}>
              {/*
                Required, with no preselected answer. A default of "yes" would mean the
                most consequential claim on this screen gets recorded by nobody
                answering it.
              */}
              <legend style={{ fontSize: '0.8125rem' }}>Did you observe them breathing?</legend>
              <label className="inline" style={{ gap: '0.35rem' }}>
                <input type="radio" name="breathingObserved" value="yes" required />
                <span>Yes</span>
              </label>
              <label className="inline" style={{ gap: '0.35rem', marginLeft: '1rem' }}>
                <input type="radio" name="breathingObserved" value="no" />
                <span>No</span>
              </label>
            </fieldset>

            <div className="field">
              <label htmlFor={`note-${status.childId}`}>Note (optional)</label>
              <input id={`note-${status.childId}`} name="note" type="text" />
            </div>

            <div className="inline">
              <button type="submit" disabled={pending || key === null}>
                {pending ? 'Recording…' : 'Record'}
              </button>
              <button className="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </td>
    </tr>
  );
}
