'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { DRILL_KINDS, DRILL_KIND_LABELS, type DrillStatus } from '@ece/core';
import { logDrill, type Result } from './actions';

export interface DrillRow {
  status: DrillStatus;
  lastHeldLabel: string | null;
  /** The issues written down at the last drill of this kind, if any. */
  lastIssues: string | null;
}

/**
 * One row per kind of drill, whether or not it has ever been held.
 *
 * A log of drills that happened cannot show the one that never did. Listing every
 * kind means "we have never practised a lockdown" is a row on the screen rather than
 * an absence somebody has to notice — and it is the row most worth seeing.
 */
export function DrillLog({
  rows,
  intervalDays,
  defaultWallClock,
}: {
  rows: DrillRow[];
  intervalDays: number | null;
  defaultWallClock: string;
}) {
  const [logging, setLogging] = useState(false);

  return (
    <div className="card">
      {intervalDays === null && (
        <p className="sub" style={{ marginTop: 0 }}>
          <span className="flag flag-quiet">No interval set</span> This shows how long it has been
          and does not judge whether that is often enough &mdash; nobody has told it what often
          enough means. Your centre can state one in <Link href="/settings">Settings</Link>.
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>Drill</th>
            <th>Last held</th>
            <th>What was found</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.status.kind}>
              <td>
                <strong>{DRILL_KIND_LABELS[r.status.kind]}</strong>
              </td>
              <td>
                {r.status.lastHeldAt === null ? (
                  // Its own state, not an infinite overdue: "never practised" and
                  // "practised too long ago" are different conversations.
                  <span className="flag flag-warn">{'●'} Never recorded</span>
                ) : r.status.overdue === true ? (
                  <span className="flag flag-critical">
                    {'▲'} {r.status.daysSince} days — past your {intervalDays} day interval
                  </span>
                ) : r.status.overdue === false ? (
                  <span className="flag flag-ok">
                    {'✓'} {r.status.daysSince} days ago
                  </span>
                ) : (
                  // No interval stated. Elapsed time, no verdict — deliberately not
                  // the tick above, which would read as approval of a gap nobody has
                  // measured against anything.
                  <span className="flag flag-quiet">{r.status.daysSince} days ago</span>
                )}
                {r.lastHeldLabel && (
                  <div className="sub" style={{ fontSize: '0.8125rem' }}>
                    {r.lastHeldLabel}
                  </div>
                )}
              </td>
              <td>
                {r.lastIssues ? (
                  r.lastIssues
                ) : r.status.lastHeldAt ? (
                  <span className="empty">nothing noted</span>
                ) : (
                  <span className="empty">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!logging ? (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setLogging(true)}>
            Log a drill
          </button>
        </p>
      ) : (
        <LogForm defaultWallClock={defaultWallClock} onDone={() => setLogging(false)} />
      )}
    </div>
  );
}

function LogForm({
  defaultWallClock,
  onDone,
}: {
  defaultWallClock: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(logDrill, null);

  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="kind">Which drill</label>
        <select id="kind" name="kind" required defaultValue="fire">
          {DRILL_KINDS.map((k) => (
            <option key={k} value={k}>
              {DRILL_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="heldAt">When it was held</label>
        <input id="heldAt" name="heldAt" type="datetime-local" required defaultValue={defaultWallClock} />
      </div>

      <div className="field">
        <label htmlFor="adultsPresent">Adults present (optional)</label>
        <input id="adultsPresent" name="adultsPresent" type="number" min={0} inputMode="numeric" />
      </div>

      <div className="field">
        <label htmlFor="childrenPresent">Tamariki present (optional)</label>
        <input id="childrenPresent" name="childrenPresent" type="number" min={0} inputMode="numeric" />
      </div>

      <div className="field">
        <label htmlFor="durationSeconds">How long it took, in seconds (optional)</label>
        <input id="durationSeconds" name="durationSeconds" type="number" min={0} inputMode="numeric" />
      </div>

      <div className="field">
        <label htmlFor="issuesFound">What went wrong</label>
        <input id="issuesFound" name="issuesFound" type="text" />
        {/*
          The field this whole register exists for. A log of drills that all went
          perfectly is a log nobody learned from — the point of practising is to find
          the gate that sticks.
        */}
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          The most useful thing on this form. A drill where nothing went wrong is rare, and a
          register of perfect drills teaches nobody anything.
        </p>
      </div>

      <div className="field">
        <label htmlFor="notes">Anything else (optional)</label>
        <input id="notes" name="notes" type="text" />
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Log drill'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
