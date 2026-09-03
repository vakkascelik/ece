'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  ENROLMENT_TYPES,
  ENROLMENT_TYPE_LABELS,
  formatDays,
  isEnrolmentCurrent,
  WEEKDAY_LABELS,
  type Enrolment,
} from '@ece/core';
import { endEnrolment, fileEnrolment, type Result } from '../actions';

/**
 * Enrolment history, newest first.
 *
 * Enrolments are never edited into each other or deleted — a child who leaves and
 * comes back has two rows, and the roll return for last March has to still be
 * answerable from what is here. The database refuses overlapping rows outright,
 * because two overlapping enrolments double-count funded hours and the error only
 * surfaces months later as a discrepancy nobody can trace.
 */
export function EnrolmentPanel({
  childId,
  enrolments,
  canEdit,
  today,
}: {
  childId: string;
  enrolments: Enrolment[];
  canEdit: boolean;
  /** The date at the centre. Passed in rather than computed — see the child page. */
  today: string;
}) {
  const [filing, setFiling] = useState(false);
  const hasOpen = enrolments.some((e) => e.endDate === null);

  return (
    <div className="card">
      {enrolments.length === 0 ? (
        <p className="empty">No enrolment on file.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Funded hours</th>
              <th>Status</th>
              {canEdit && <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>}
            </tr>
          </thead>
          <tbody>
            {enrolments.map((e) => (
              <EnrolmentRow key={e.id} childId={childId} enrolment={e} canEdit={canEdit} today={today} />
            ))}
          </tbody>
        </table>
      )}

      {canEdit && !filing && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setFiling(true)}>
            File an enrolment
          </button>
          {hasOpen && (
            <span className="sub" style={{ marginLeft: '0.6rem', fontSize: '0.8125rem' }}>
              There is an open enrolment — end it first, or the dates will overlap.
            </span>
          )}
        </p>
      )}
      {canEdit && filing && <EnrolmentForm childId={childId} onDone={() => setFiling(false)} />}
    </div>
  );
}

function EnrolmentRow({
  childId,
  enrolment,
  canEdit,
  today,
}: {
  childId: string;
  enrolment: Enrolment;
  canEdit: boolean;
  today: string;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(endEnrolment, null);
  const [ending, setEnding] = useState(false);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) setEnding(false);
  }, [state]);

  const current = isEnrolmentCurrent(enrolment, today);

  return (
    <tr>
      <td>{enrolment.startDate}</td>
      <td>{enrolment.endDate ?? <span className="empty">open</span>}</td>
      <td>{formatDays(enrolment.days)}</td>
      <td>
        {enrolment.fundedHoursPerWeek}
        {enrolment.twentyHoursEce && (
          <>
            {' '}
            <span className="flag flag-quiet">20 Hours ECE</span>
          </>
        )}
        {/*
          Shown only when stated. An absent flag reads as "nobody has said", which is the
          truth for every enrolment filed before 0084 — a flag saying "permanent" by default
          would be this product asserting the thing that decides whether absences may be
          claimed.
        */}
        {enrolment.enrolmentType && (
          <>
            {' '}
            <span className="flag flag-quiet">
              {ENROLMENT_TYPE_LABELS[enrolment.enrolmentType]}
            </span>
          </>
        )}
      </td>
      <td>
        {current ? (
          <span className="flag flag-ok">✓ current</span>
        ) : (
          <span className="flag flag-quiet">ended</span>
        )}
        {error && <div className="error" role="alert">{error}</div>}
      </td>
      {canEdit && (
        <td>
          {enrolment.endDate === null ? (
            ending ? (
              <form action={action} className="inline">
                <input type="hidden" name="enrolmentId" value={enrolment.id} />
                <input type="hidden" name="childId" value={childId} />
                <input
                  className="narrow"
                  name="endDate"
                  type="date"
                  required
                  defaultValue={today}
                  aria-label="Last day"
                />
                <button className="small" type="submit" disabled={pending}>
                  End
                </button>
                <button className="secondary small" type="button" onClick={() => setEnding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button className="secondary small" type="button" onClick={() => setEnding(true)}>
                End
              </button>
            )
          ) : null}
        </td>
      )}
    </tr>
  );
}

function EnrolmentForm({ childId, onDone }: { childId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(fileEnrolment, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <input type="hidden" name="childId" value={childId} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="startDate">First day</label>
            <input className="narrow" id="startDate" name="startDate" type="date" required />
          </div>
          <div>
            <label htmlFor="endDate">Last day</label>
            <input className="narrow" id="endDate" name="endDate" type="date" />
          </div>
          <div>
            <label htmlFor="fundedHoursPerWeek">Funded hours a week</label>
            <input
              className="narrow"
              id="fundedHoursPerWeek"
              name="fundedHoursPerWeek"
              type="number"
              min={0}
              max={50}
              step="0.5"
              defaultValue={0}
            />
          </div>
        </div>

        <div>
          <label>Days attending</label>
          <div className="days">
            {WEEKDAY_LABELS.map((label, i) => (
              <label key={label}>
                <input type="checkbox" name="days" value={i + 1} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="days">
          <label>
            {/*
              An attestation the parent signs, not something derived from the hours —
              so it is recorded separately from them.
            */}
            <input type="checkbox" name="twentyHoursEce" /> 20 Hours ECE attestation signed
          </label>
        </div>

        {/*
          Permanent, casual or conditional — and "Not stated" is the default because
          nothing here guesses.

          This is the axis the Funding Handbook's absence rules turn on (§6-4): funding may
          be claimed for days a *permanently* enrolled child was booked and absent, while a
          casual or conditional child is funded on attendance only. Defaulting an unknown to
          permanent would over-claim, which is the one direction this product's funding
          figures promise they never go.
        */}
        <div>
          <label htmlFor="enrolmentType">Enrolment type</label>
          <select id="enrolmentType" name="enrolmentType" defaultValue="">
            <option value="">Not stated</option>
            {ENROLMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ENROLMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="sub">
            From the enrolment agreement. A permanently enrolled child can be claimed for some
            booked absences; a casual or conditional child cannot. Leave it blank if you are
            not sure &mdash; this system does not yet calculate absence funding either way, and
            a wrong answer here would be worse than none.
          </p>
        </div>

        <div>
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} />
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Filing…' : 'File enrolment'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
