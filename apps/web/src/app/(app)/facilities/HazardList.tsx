'use client';

import { useActionState, useEffect, useState } from 'react';
import { HAZARD_RISKS, compareHazardUrgency, type Hazard } from '@ece/core';
import { addHazard, closeHazard, setHazardControl, type Result } from './actions';

export interface HazardRow {
  hazard: Hazard;
  identifiedLabel: string;
  resolvedLabel: string | null;
  /** Whole days open, computed on the server. Null once resolved. */
  daysOpen: number | null;
}

const RISK_LABELS: Record<(typeof HAZARD_RISKS)[number], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * The hazard register, open first and oldest-worst at the top.
 *
 * Closed hazards stay on the list. A register that hides what was fixed cannot show a
 * reviewer that anything ever gets fixed, which is most of what a hazard register is
 * evidence of.
 */
export function HazardList({ rows }: { rows: HazardRow[] }) {
  const [adding, setAdding] = useState(false);
  const sorted = [...rows].sort((a, b) => compareHazardUrgency(a.hazard, b.hazard));

  return (
    <div className="card">
      {rows.length === 0 ? (
        <p className="empty">Nothing recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Hazard</th>
              <th>Risk</th>
              <th>What is being done</th>
              <th>State</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.hazard.id} row={r} />
            ))}
          </tbody>
        </table>
      )}

      {!adding ? (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Record a hazard
          </button>
        </p>
      ) : (
        <AddForm onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function Row({ row }: { row: HazardRow }) {
  const { hazard: h } = row;
  const [editing, setEditing] = useState<'control' | 'close' | null>(null);
  const [controlState, controlAction, savingControl] = useActionState<Result | null, FormData>(
    setHazardControl,
    null,
  );
  const [closeState, closeAction, closing] = useActionState<Result | null, FormData>(
    closeHazard,
    null,
  );

  useEffect(() => {
    if (controlState && 'ok' in controlState) setEditing(null);
  }, [controlState]);
  useEffect(() => {
    if (closeState && 'ok' in closeState) setEditing(null);
  }, [closeState]);

  const error =
    (controlState && 'error' in controlState ? controlState.error : null) ??
    (closeState && 'error' in closeState ? closeState.error : null);

  return (
    <tr>
      <td>
        <strong>{h.description}</strong>
        {h.area && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {h.area}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>
        {/*
          Risk is shown as a word, never as a colour alone. The state chips in this
          product do not meet WCAG 1.4.11 and do not need to — the text inside carries
          the meaning, which is the correction already recorded in the README.
        */}
        <span
          className={`flag ${h.risk === 'high' ? 'flag-critical' : h.risk === 'medium' ? 'flag-warn' : 'flag-quiet'}`}
        >
          {RISK_LABELS[h.risk]}
        </span>
      </td>
      <td>
        {h.control ? (
          h.control
        ) : h.resolvedAt ? (
          <span className="empty">—</span>
        ) : (
          // The gap worth showing: open, and nobody has written down what is being
          // done about it.
          <span className="flag flag-warn">Nothing recorded</span>
        )}
      </td>
      <td>
        {h.resolvedAt ? (
          <>
            <span className="flag flag-ok">{'✓'} Closed {row.resolvedLabel}</span>
            {h.resolution && (
              <div className="sub" style={{ fontSize: '0.8125rem' }}>
                {h.resolution}
              </div>
            )}
          </>
        ) : (
          <span className="flag flag-quiet">
            Open {row.daysOpen === 0 ? 'today' : `${row.daysOpen} days`}
          </span>
        )}
        <div className="sub" style={{ fontSize: '0.8125rem' }}>
          Found {row.identifiedLabel}
        </div>
      </td>
      <td>
        {!h.resolvedAt && editing === null && (
          <span className="inline">
            <button className="small secondary" type="button" onClick={() => setEditing('control')}>
              {h.control ? 'Update control' : 'Add control'}
            </button>
            <button className="small" type="button" onClick={() => setEditing('close')}>
              Close
            </button>
          </span>
        )}

        {editing === 'control' && (
          <form action={controlAction}>
            <input type="hidden" name="id" value={h.id} />
            <div className="field">
              <label htmlFor={`control-${h.id}`}>What is being done</label>
              <input id={`control-${h.id}`} name="control" type="text" required defaultValue={h.control ?? ''} />
            </div>
            <div className="inline">
              <button type="submit" disabled={savingControl}>
                {savingControl ? 'Saving…' : 'Save'}
              </button>
              <button className="secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {editing === 'close' && (
          <form action={closeAction}>
            <input type="hidden" name="id" value={h.id} />
            <div className="field">
              <label htmlFor={`resolution-${h.id}`}>How it was resolved</label>
              <input id={`resolution-${h.id}`} name="resolution" type="text" required />
              <p className="sub" style={{ fontSize: '0.8125rem' }}>
                Required. A closing date on its own is not a record.
              </p>
            </div>
            <div className="inline">
              <button type="submit" disabled={closing}>
                {closing ? 'Closing…' : 'Close hazard'}
              </button>
              <button className="secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </td>
    </tr>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addHazard, null);

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
        <label htmlFor="description">What is the hazard</label>
        <input id="description" name="description" type="text" required />
      </div>

      <div className="field">
        <label htmlFor="area">Where (optional)</label>
        <input id="area" name="area" type="text" />
      </div>

      <div className="field">
        <label htmlFor="risk">How serious</label>
        <select id="risk" name="risk" required defaultValue="medium">
          {HAZARD_RISKS.map((r) => (
            <option key={r} value={r}>
              {RISK_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="control">What is being done about it (optional)</label>
        <input id="control" name="control" type="text" />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Can be added later — a hazard recorded at 9am is often controlled at 11.
        </p>
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Record hazard'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
