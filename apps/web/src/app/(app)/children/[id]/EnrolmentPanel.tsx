'use client';

import { useActionState, useEffect, useState } from 'react';
import { formatDays, isEnrolmentCurrent, WEEKDAY_LABELS, type Enrolment } from '@ece/core';
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
              {canEdit && <th style={{ width: '1%' }} />}
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
