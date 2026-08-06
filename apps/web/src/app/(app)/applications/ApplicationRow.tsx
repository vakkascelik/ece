'use client';

import { useActionState, useState } from 'react';
import type { JobApplication } from '@ece/api';
import {
  APPLICATION_SOURCE_LABELS,
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
} from '@ece/core';
import { changeStatus, remove, type ActionResult } from './actions';

/**
 * One application.
 *
 * A client component for two reasons that a server-rendered form could not cover: the guard
 * messages have to be visible, and Delete has to take two presses.
 */
export function ApplicationRow({
  application,
  received,
}: {
  application: JobApplication;
  received: string;
}) {
  const {
    id,
    applicantName,
    email,
    phone,
    positionSought,
    holdsPractisingCertificate,
    availableFrom,
    message,
    source,
    status,
    statusNote,
  } = application;

  const [statusState, statusAction, statusBusy] = useActionState(changeStatus, null as ActionResult);
  const [removeState, removeAction, removeBusy] = useActionState(remove, null as ActionResult);
  const [armed, setArmed] = useState(false);

  const error =
    (statusState && 'error' in statusState ? statusState.error : null) ??
    (removeState && 'error' in removeState ? removeState.error : null);

  /*
   * Every control carries the applicant's name in its accessible name.
   *
   * The same finding as the roster screen, which the axe audit produced rather than a reading: a
   * screen reader user tabbing through a table of applications heard "combo box, New", "Save,
   * button", "Delete, button", repeated per person, with nothing saying whose row it was. On a
   * screen where one of those buttons destroys somebody's application, that is not a rough edge.
   *
   * `aria-label` rather than a visible label, and rather than a `visually-hidden` span inside the
   * button — that put the name in the DOM twice per row and tripped Playwright's strict mode.
   */
  return (
    <li className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>{applicantName}</h2>
        <span className="pill">{APPLICATION_SOURCE_LABELS[source]}</span>
      </div>

      <p className="sub" style={{ margin: '0.25rem 0 0.75rem' }}>
        <a href={`mailto:${email}`}>{email}</a>
        {phone && <> · {phone}</>} · received {received}
      </p>

      <dl className="facts">
        {positionSought && (
          <>
            <dt>Role</dt>
            <dd>{positionSought}</dd>
          </>
        )}
        <dt>Practising certificate</dt>
        <dd>
          {/*
           * Three outcomes, and the third is not "no". The applicant said so or did not say —
           * either way this is their statement and not evidence, which is why it says so here
           * rather than only in the schema comment. Evidence is a sighted document in Compliance.
           */}
          {holdsPractisingCertificate === true
            ? 'They say they hold a current one — not yet sighted'
            : holdsPractisingCertificate === false
              ? 'They say they do not hold one'
              : 'Not answered'}
        </dd>
        {availableFrom && (
          <>
            <dt>Available from</dt>
            <dd>{availableFrom}</dd>
          </>
        )}
        {message && (
          <>
            <dt>What they wrote</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{message}</dd>
          </>
        )}
      </dl>

      {error && <p className="error">{error}</p>}

      <form action={statusAction} className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
        <input type="hidden" name="applicationId" value={id} />
        <select
          name="status"
          defaultValue={status}
          aria-label={`Stage for ${applicantName}`}
          style={{ maxWidth: '12rem' }}
        >
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {APPLICATION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input
          name="note"
          defaultValue={statusNote ?? ''}
          placeholder="Note (optional)"
          maxLength={1000}
          aria-label={`Note about ${applicantName}`}
          style={{ flex: '1 1 12rem' }}
        />
        <button
          className="secondary"
          type="submit"
          disabled={statusBusy}
          aria-label={`Save the stage for ${applicantName}`}
        >
          {statusBusy ? 'Saving…' : 'Save'}
        </button>
      </form>

      {/*
       * Delete takes two presses.
       *
       * Not a `window.confirm` — that cannot guard a server action, and a browser dialogue is not
       * something this app uses anywhere. The armed state says what will happen in words, because
       * "Delete" and "Confirm delete" differing only in colour would fail 1.4.1 and would not tell
       * anybody it is permanent.
       */}
      <form
        action={removeAction}
        style={{ marginTop: '0.5rem' }}
        onSubmit={(event) => {
          if (!armed) {
            event.preventDefault();
            setArmed(true);
          }
        }}
      >
        <input type="hidden" name="applicationId" value={id} />
        <button
          className="danger"
          type="submit"
          disabled={removeBusy}
          aria-label={
            armed
              ? `Confirm: permanently delete the application from ${applicantName}`
              : `Delete the application from ${applicantName}`
          }
        >
          {removeBusy ? 'Deleting…' : armed ? 'Press again to delete permanently' : 'Delete'}
        </button>
        {armed && !removeBusy && (
          <button
            className="secondary"
            type="button"
            onClick={() => setArmed(false)}
            style={{ marginLeft: '0.4rem' }}
          >
            Keep it
          </button>
        )}
      </form>
    </li>
  );
}
