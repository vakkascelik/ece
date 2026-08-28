'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  CONSEQUENCE_LABELS,
  HAZARD_RISKS,
  LIKELIHOOD_LABELS,
  compareHazardUrgency,
  type Hazard,
} from '@ece/core';
import { addHazard, closeHazard, setHazardControl, type Result } from './actions';

export interface RoomOption {
  id: string;
  name: string;
}

export interface HazardRow {
  hazard: Hazard;
  identifiedLabel: string;
  resolvedLabel: string | null;
  /** Whole days open, computed on the server. Null once resolved. */
  daysOpen: number | null;
  roomName: string | null;
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
export function HazardList({ rows, rooms }: { rows: HazardRow[]; rooms: RoomOption[] }) {
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
        <AddForm rooms={rooms} onDone={() => setAdding(false)} />
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
        {(row.roomName || h.area) && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {[row.roomName, h.area].filter(Boolean).join(' · ')}
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
        {/*
          The score sits BESIDE the risk, never replacing it. `risk` is what a person
          decided; the score is arithmetic over two other judgements. Nothing in this
          product maps one onto the other, because no banding of 1-25 onto
          low/medium/high is sourced anywhere in this repo — see 0069 and
          unverified-claims. A disagreement between the two is information.
        */}
        {h.riskScore !== null && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            Score {h.riskScore}/25
          </div>
        )}
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

function AddForm({ rooms, onDone }: { rooms: RoomOption[]; onDone: () => void }) {
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

      {rooms.length > 0 && (
        <div className="field">
          <label htmlFor="roomId">Which room (optional)</label>
          <select id="roomId" name="roomId" defaultValue="">
            <option value="">Not recorded</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="area">Where else (optional)</label>
        <input id="area" name="area" type="text" placeholder="By the front path" />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          For anywhere a room does not cover. Both can be used.
        </p>
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

      {/*
        Optional, and staying optional. A hazard spotted in a playground is recorded in
        thirty seconds, and demanding a two-part assessment before the row exists is how
        a register stops being used.
      */}
      <div className="field">
        <label htmlFor="likelihood">How likely (optional)</label>
        <select id="likelihood" name="likelihood" defaultValue="">
          <option value="">Not assessed</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} — {LIKELIHOOD_LABELS[n]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="consequence">How bad if it happened (optional)</label>
        <select id="consequence" name="consequence" defaultValue="">
          <option value="">Not assessed</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} — {CONSEQUENCE_LABELS[n]}
            </option>
          ))}
        </select>
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          If you set both, a score out of 25 is shown beside the risk. It is your centre’s own
          arithmetic — this product does not turn a score into low, medium or high, because no
          such scale is set out in the regulations we can cite.
        </p>
      </div>

      <div className="field">
        <label htmlFor="reviewIntervalDays">Review every, in days (optional)</label>
        <input id="reviewIntervalDays" name="reviewIntervalDays" type="number" min={1} max={730} />
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
