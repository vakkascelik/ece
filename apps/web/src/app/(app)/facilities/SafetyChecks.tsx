'use client';

import { useActionState, useEffect, useState } from 'react';
import { SAFETY_AREAS, SAFETY_AREA_LABELS, type SafetyArea } from '@ece/core';
import { logSafetyCheck, type Result } from './actions';

export interface SafetyRow {
  area: SafetyArea;
  /** Null when this area has not been checked in the window shown. */
  lastLabel: string | null;
  lastPassed: boolean | null;
  lastNote: string | null;
}

/**
 * One row per area, checked or not.
 *
 * Same reasoning as the drill log: a list of checks that happened cannot show the one
 * that did not. The sandpit nobody looked at this morning is the row worth seeing,
 * and it only exists if every area is listed.
 */
export function SafetyChecks({ rows }: { rows: SafetyRow[] }) {
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>Last check</th>
            <th style={{ width: '1%' }}>
              <span className="visually-hidden">Record a check</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.area} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: SafetyRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<Result | null, FormData>(logSafetyCheck, null);

  /*
    A fresh key per submission, as everywhere else: `ON CONFLICT DO NOTHING` reports a
    repeated key as success, so a key fixed at mount would silently discard this
    afternoon's check as a duplicate of this morning's. Minted in an effect because
    this server-renders first.
  */
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(crypto.randomUUID()), []);
  useEffect(() => {
    if (state && 'ok' in state) {
      setKey(crypto.randomUUID());
      setOpen(false);
    }
  }, [state]);

  const [passed, setPassed] = useState<'yes' | 'no' | ''>('');

  return (
    <tr>
      <td>
        <strong>{SAFETY_AREA_LABELS[row.area]}</strong>
        {state && 'error' in state && (
          <div className="error" role="alert">
            {state.error}
          </div>
        )}
      </td>
      <td>
        {row.lastLabel === null ? (
          <span className="flag flag-warn">{'●'} Not checked</span>
        ) : row.lastPassed ? (
          <span className="flag flag-ok">{'✓'} Passed {row.lastLabel}</span>
        ) : (
          <>
            <span className="flag flag-critical">{'▲'} Failed {row.lastLabel}</span>
            {row.lastNote && (
              <div className="sub" style={{ fontSize: '0.8125rem' }}>
                {row.lastNote}
              </div>
            )}
          </>
        )}
      </td>
      <td>
        {!open ? (
          <button className="small" type="button" onClick={() => setOpen(true)}>
            Record a check
          </button>
        ) : (
          <form action={action}>
            <input type="hidden" name="area" value={row.area} />
            <input type="hidden" name="clientUuid" value={key ?? ''} />

            <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 0.75rem' }}>
              {/* Required with no preselected answer, so the browser refuses a blank
                  submission. A default of "passed" would mean the common case is
                  recorded by nobody answering. */}
              <legend style={{ fontSize: '0.8125rem' }}>Did it pass?</legend>
              <label className="inline" style={{ gap: '0.35rem' }}>
                <input
                  type="radio"
                  name="passed"
                  value="yes"
                  required
                  onChange={() => setPassed('yes')}
                />
                <span>Yes</span>
              </label>
              <label className="inline" style={{ gap: '0.35rem', marginLeft: '1rem' }}>
                <input type="radio" name="passed" value="no" onChange={() => setPassed('no')} />
                <span>No</span>
              </label>
            </fieldset>

            <div className="field">
              <label htmlFor={`note-${row.area}`}>
                {passed === 'no' ? 'What was wrong' : 'Note (optional)'}
              </label>
              {/*
                `required` only when the check failed. Also a CHECK in 0034 and a guard
                in the action — three layers, because a failed check with no note is a
                row that tells the next person nothing, which is the whole value of
                the register.
              */}
              <input id={`note-${row.area}`} name="note" type="text" required={passed === 'no'} />
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

export { SAFETY_AREAS };
