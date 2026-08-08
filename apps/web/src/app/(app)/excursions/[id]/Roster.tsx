'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ExcursionStatus } from '@ece/core';
import { recordConsent, setChildren, type Result } from './../actions';

export interface RosterRow {
  childId: string;
  childName: string;
  /** `null` means nobody has answered — which is not a refusal, and renders as a chase. */
  consent: boolean | null;
  guardians: { id: string; name: string }[];
}

/**
 * The roster, with each child's consent state for THIS outing.
 *
 * Unanswered sorts above refused and both above granted: the list is a to-do, and
 * "phone this family" is the to-do. A refusal is not chased — it is answered, and the
 * child comes off the list before departure.
 */
export function Roster({
  excursionId,
  status,
  rows,
  addable,
}: {
  excursionId: string;
  status: ExcursionStatus;
  rows: RosterRow[];
  addable: { id: string; name: string }[];
}) {
  const editable = status === 'planned';
  const rank = (r: RosterRow) => (r.consent === null ? 0 : r.consent === false ? 1 : 2);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.childName.localeCompare(b.childName));

  return (
    <div className="card">
      {rows.length === 0 ? (
        <p className="empty">Nobody is on this outing yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Child</th>
              <th>Consent for this outing</th>
              {editable && (
                <th style={{ width: '1%' }}>
                  <span className="visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.childId} excursionId={excursionId} row={r} editable={editable} />
            ))}
          </tbody>
        </table>
      )}

      {editable && addable.length > 0 && <AddChild excursionId={excursionId} addable={addable} />}
    </div>
  );
}

function Row({
  excursionId,
  row,
  editable,
}: {
  excursionId: string;
  row: RosterRow;
  editable: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [consentState, consentAction, savingConsent] = useActionState<Result | null, FormData>(
    recordConsent,
    null,
  );
  const [removeState, removeAction, removing] = useActionState<Result | null, FormData>(
    setChildren,
    null,
  );

  useEffect(() => {
    if (consentState && 'ok' in consentState) setRecording(false);
  }, [consentState]);

  const error =
    (consentState && 'error' in consentState ? consentState.error : null) ??
    (removeState && 'error' in removeState ? removeState.error : null);

  return (
    <tr>
      <td>
        <strong>{row.childName}</strong>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>
      <td>
        {/*
          Three states, and the wording keeps them apart. "Not asked yet" is a chase;
          "declined" is an answer. A single "no consent" label would send somebody to
          phone a family who already said no.
        */}
        {row.consent === null && <span className="flag flag-warn">{'●'} Not answered — chase</span>}
        {row.consent === false && <span className="flag flag-critical">Declined — comes off the list</span>}
        {row.consent === true && <span className="flag flag-ok">{'✓'} Consent given</span>}

        {editable && !recording && (
          <p style={{ margin: '0.35rem 0 0' }}>
            <button className="small secondary" type="button" onClick={() => setRecording(true)}>
              {row.consent === null ? 'Record their answer' : 'Record a new answer'}
            </button>
          </p>
        )}

        {editable && recording && (
          <form action={consentAction} style={{ marginTop: '0.5rem' }}>
            <input type="hidden" name="excursionId" value={excursionId} />
            <input type="hidden" name="childId" value={row.childId} />

            <div className="field">
              <label htmlFor={`givenBy-${row.childId}`}>Whose decision</label>
              {/*
                Only this child's guardians. The whole centre's list would invite
                attributing a decision to the wrong family, and 0037's staff path
                does not re-check the link.
              */}
              <select id={`givenBy-${row.childId}`} name="givenBy" required defaultValue="">
                <option value="" disabled>
                  Choose a guardian
                </option>
                {row.guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 0.75rem' }}>
              <legend style={{ fontSize: '0.8125rem' }}>What they said</legend>
              <label className="inline" style={{ gap: '0.35rem' }}>
                <input type="radio" name="decision" value="granted" required />
                <span>Yes</span>
              </label>
              <label className="inline" style={{ gap: '0.35rem', marginLeft: '1rem' }}>
                <input type="radio" name="decision" value="refused" />
                <span>No</span>
              </label>
            </fieldset>

            <div className="field">
              <label htmlFor={`note-${row.childId}`}>Note (optional)</label>
              <input id={`note-${row.childId}`} name="note" type="text" placeholder="Paper form returned Tuesday" />
            </div>

            <div className="inline">
              <button type="submit" disabled={savingConsent}>
                {savingConsent ? 'Recording…' : 'Record'}
              </button>
              <button className="secondary" type="button" onClick={() => setRecording(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </td>
      {editable && (
        <td>
          <form action={removeAction}>
            <input type="hidden" name="excursionId" value={excursionId} />
            <input type="hidden" name="childId" value={row.childId} />
            <input type="hidden" name="op" value="remove" />
            <button className="small secondary" type="submit" disabled={removing}>
              {removing ? 'Removing…' : 'Remove'}
            </button>
          </form>
        </td>
      )}
    </tr>
  );
}

function AddChild({
  excursionId,
  addable,
}: {
  excursionId: string;
  addable: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(setChildren, null);

  return (
    <form action={action} className="inline" style={{ marginTop: '0.75rem' }}>
      <input type="hidden" name="excursionId" value={excursionId} />
      <label htmlFor="add-child" className="visually-hidden">
        Add a child
      </label>
      <select id="add-child" name="childId" required defaultValue="">
        <option value="" disabled>
          Add a child…
        </option>
        {addable.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button className="small" type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add'}
      </button>
      {state && 'error' in state && (
        <span className="error" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
