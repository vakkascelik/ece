'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  STAFF_RECORD_KINDS,
  STAFF_RECORD_LABELS,
  WARNING_DAYS,
  type AssessedRecord,
} from '@ece/core';
import { recordStaffDocument, retireStaffRecord, sight, type Result } from './actions';

/**
 * Certificates, vetting and training, worst first.
 *
 * Two flags per row, because expiry and sighting are separate facts. A current
 * certificate nobody has looked at is a different problem from a lapsed one somebody
 * verified, and collapsing them into a single status loses the distinction that matters
 * in a review.
 */
export function StaffRecords({ assessed }: { assessed: AssessedRecord[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      {assessed.length === 0 ? (
        <p className="empty">Nothing recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Record</th>
              <th>Expires</th>
              <th>Status</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {assessed.map((a) => (
              <Row key={a.record.id} assessed={a} />
            ))}
          </tbody>
        </table>
      )}

      {!adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Record a certificate or vetting
          </button>
        </p>
      )}
      {adding && <Form onDone={() => setAdding(false)} />}
    </div>
  );
}

function Row({ assessed }: { assessed: AssessedRecord }) {
  const { record, expiry } = assessed;
  const [sightState, sightAction, sighting] = useActionState<Result | null, FormData>(sight, null);
  const [retireState, retireAction, retiring] = useActionState<Result | null, FormData>(
    retireStaffRecord,
    null,
  );
  const error =
    (sightState && 'error' in sightState ? sightState.error : null) ??
    (retireState && 'error' in retireState ? retireState.error : null);

  return (
    <tr>
      <td>
        <strong>{record.personName}</strong>
        {record.roleNote && <div className="sub" style={{ fontSize: '0.8125rem' }}>{record.roleNote}</div>}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>
        {STAFF_RECORD_LABELS[record.kind]}
        {record.reference && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>{record.reference}</div>
        )}
      </td>
      <td>{record.expiresOn ?? <span className="empty">none recorded</span>}</td>
      <td>
        <span className="inline">
          {expiry.status === 'expired' && (
            <span className="flag flag-critical">
              {'▲'} Expired {Math.abs(expiry.daysRemaining ?? 0)}d ago
            </span>
          )}
          {expiry.status === 'due-soon' && (
            <span className="flag flag-warn">
              {'●'} {expiry.daysRemaining}d left
            </span>
          )}
          {expiry.status === 'current' && (
            <span className="flag flag-ok">
              {'✓'} {expiry.daysRemaining}d left
            </span>
          )}
          {expiry.status === 'no-expiry' && <span className="flag flag-quiet">no expiry</span>}
          {/*
            A separate flag, not a worse expiry status. "We have a certificate number"
            and "somebody looked at the document" are different claims.
          */}
          {expiry.unsighted && <span className="flag flag-warn">{'●'} not sighted</span>}
        </span>
      </td>
      <td>
        <span className="inline">
          {expiry.unsighted && (
            <form action={sightAction}>
              <input type="hidden" name="recordId" value={record.id} />
              <button className="secondary small" type="submit" disabled={sighting}>
                I have seen it
              </button>
            </form>
          )}
          <form action={retireAction}>
            <input type="hidden" name="recordId" value={record.id} />
            <button className="secondary small" type="submit" disabled={retiring}>
              Retire
            </button>
          </form>
        </span>
      </td>
    </tr>
  );
}

function Form({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    recordStaffDocument,
    null,
  );
  const [kind, setKind] = useState<string>('first_aid');
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="personName">Person</label>
            <input id="personName" name="personName" required autoComplete="off" />
          </div>
          <div>
            <label htmlFor="roleNote">Role</label>
            <input id="roleNote" name="roleNote" placeholder="reliever" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="kind">Record</label>
            <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {STAFF_RECORD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {STAFF_RECORD_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="reference">Reference</label>
            <input id="reference" name="reference" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="issuedOn">Issued</label>
            <input className="narrow" id="issuedOn" name="issuedOn" type="date" />
          </div>
          <div>
            <label htmlFor="expiresOn">Expires</label>
            <input className="narrow" id="expiresOn" name="expiresOn" type="date" />
          </div>
        </div>

        <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
          {/*
            The lead time is per kind because renewal takes different amounts of time,
            not because the certificates last different amounts of time. Vetting goes to
            NZ Police and takes weeks.
          */}
          Put the expiry date printed on the document — nothing here assumes a validity
          period. This kind is flagged {WARNING_DAYS[kind as keyof typeof WARNING_DAYS]} days
          before it lapses.
        </p>

        <div className="days">
          <label>
            <input type="checkbox" name="sighted" /> I have seen the original document
          </label>
        </div>

        <div>
          <label htmlFor="note">Note</label>
          <input className="wide" id="note" name="note" />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
