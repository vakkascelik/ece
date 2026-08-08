'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  IMMUNISATION_STATUSES,
  IMMUNISATION_STATUS_LABELS,
  type ImmunisationRecord,
} from '@ece/core';
import { saveImmunisation, type Result } from '../actions';

export interface ImmunisationRow {
  record: ImmunisationRecord;
  recordedLabel: string;
  sightedLabel: string | null;
}

/**
 * What the centre was shown about a child's immunisation.
 *
 * WHAT THIS SCREEN DOES NOT DO
 *
 * Judge. No status is styled as a problem, nothing is flagged non-compliant, and
 * nothing is computed from `nextDueOn`. This product holds no immunisation schedule
 * — 0036 sets out why at length — and what follows from any particular status is a
 * regulatory question nobody here has answered. A family who decline and a family
 * who have not brought the certificate in are shown as what they are and nothing
 * more.
 *
 * The consequence for the UI is that every status gets the same quiet chip. The
 * temptation to red-flag `not_up_to_date` is exactly the assertion the schema
 * refuses to make.
 */
export function ImmunisationPanel({
  childId,
  rows,
  canRecord,
  isParent,
}: {
  childId: string;
  rows: ImmunisationRow[];
  canRecord: boolean;
  isParent: boolean;
}) {
  const [recording, setRecording] = useState(false);

  const current = rows.find((r) => r.record.supersededAt === null) ?? null;
  const history = rows.filter((r) => r.record.supersededAt !== null);

  return (
    <section className="card">
      <h2>Immunisation</h2>

      {current === null ? (
        <p className="empty">
          {isParent
            ? 'Nothing recorded yet.'
            : 'Nothing recorded. Ask the whānau for the child’s immunisation record.'}
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 0.25rem' }}>
            <span className="flag flag-quiet">
              {IMMUNISATION_STATUS_LABELS[current.record.status]}
            </span>{' '}
            {current.sightedLabel ? (
              // Sighting is the claim that survives a review, so it is stated
              // separately rather than folded into the status.
              <span className="flag flag-ok">{'✓'} Document seen {current.sightedLabel}</span>
            ) : (
              <span className="flag flag-warn">{'●'} Not sighted — recorded from what we were told</span>
            )}
          </p>
          {current.record.reference && (
            <p className="sub" style={{ margin: '0.25rem 0' }}>
              {current.record.reference}
            </p>
          )}
          {current.record.nextDueOn && (
            <p className="sub" style={{ margin: '0.25rem 0' }}>
              Next due {current.record.nextDueOn} — as printed on the document. This product does
              not work out due dates.
            </p>
          )}
          {current.record.note && (
            <p className="sub" style={{ margin: '0.25rem 0' }}>
              {current.record.note}
            </p>
          )}
          <p className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
            Recorded {current.recordedLabel}
          </p>
        </>
      )}

      {history.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.9375rem', margin: '1rem 0 0.5rem' }}>Earlier records</h3>
          {/*
            Superseded records are kept and shown. "Were they up to date at enrolment"
            is a different question from "are they now", and an update in place would
            answer only the second — see 0036.
          */}
          <ul className="plain" style={{ margin: 0 }}>
            {history.map((r) => (
              <li key={r.record.id} style={{ fontSize: '0.875rem' }}>
                {IMMUNISATION_STATUS_LABELS[r.record.status]} · recorded {r.recordedLabel}
                {r.record.reference && <span className="sub"> · {r.record.reference}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {canRecord && !recording && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setRecording(true)}>
            {current === null ? 'Record what we were shown' : 'Record an update'}
          </button>
        </p>
      )}
      {canRecord && recording && (
        <Form childId={childId} onDone={() => setRecording(false)} />
      )}
    </section>
  );
}

function Form({ childId, onDone }: { childId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(saveImmunisation, null);

  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      <input type="hidden" name="childId" value={childId} />

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="status">What you were shown</label>
        <select id="status" name="status" required defaultValue="">
          <option value="" disabled>
            Choose
          </option>
          {IMMUNISATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {IMMUNISATION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="sighted" className="inline" style={{ gap: '0.5rem' }}>
          <input id="sighted" name="sighted" type="checkbox" />
          <span>I looked at the document myself</span>
        </label>
        <p className="sub" style={{ fontSize: '0.8125rem', margin: '0.25rem 0 0' }}>
          Leave unticked if the whānau told you and you have not seen the record. The two are
          different claims and only the first survives a review.
        </p>
      </div>

      <div className="field">
        <label htmlFor="reference">What you saw (optional)</label>
        <input
          id="reference"
          name="reference"
          type="text"
          placeholder="Well Child book, AIR printout, GP letter"
        />
      </div>

      <div className="field">
        <label htmlFor="nextDueOn">Next due, if the document says (optional)</label>
        <input id="nextDueOn" name="nextDueOn" type="date" />
        <p className="sub" style={{ fontSize: '0.8125rem', margin: '0.25rem 0 0' }}>
          Copy what is printed. This product holds no immunisation schedule and will not work a
          date out for you.
        </p>
      </div>

      <div className="field">
        <label htmlFor="immunisation-note">Note (optional)</label>
        <input id="immunisation-note" name="note" type="text" />
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Record'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
