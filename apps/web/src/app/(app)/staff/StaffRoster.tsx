'use client';

import { useActionState, useEffect, useState } from 'react';
import type { StaffMember } from '@ece/core';
import { addStaffMember, endEmployment, signStaff, type Result } from './actions';

export interface RosterRow {
  member: StaffMember;
  present: boolean;
  /** When they last signed in or out, formatted in the centre's zone. */
  lastLabel: string | null;
  /** True when they hold a current practising certificate linked to them. */
  certificated: boolean;
  /** Their practising certificate expires within the warning window. */
  lapsingOn: string | null;
}

/**
 * The roster, present first.
 *
 * Present first because the list is read at two moments and both want the same
 * order: signing somebody out at the end of a shift, and counting the room against
 * the ratio. Alphabetical would serve neither.
 */
export function StaffRoster({
  rows,
  canManage,
  today,
}: {
  rows: RosterRow[];
  canManage: boolean;
  today: string;
}) {
  const [adding, setAdding] = useState(false);

  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.present) - Number(a.present) || a.member.fullName.localeCompare(b.member.fullName),
  );

  return (
    <div className="card">
      {rows.length === 0 ? (
        <p className="empty">
          Nobody on the roster yet. Add the people who work here before switching the ratio to
          staff sign-in.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Here now</th>
              <th>Practising certificate</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.member.id} row={r} canManage={canManage} today={today} />
            ))}
          </tbody>
        </table>
      )}

      {canManage && !adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Add somebody
          </button>
        </p>
      )}
      {canManage && adding && <AddForm onDone={() => setAdding(false)} />}
    </div>
  );
}

function Row({
  row,
  canManage,
  today,
}: {
  row: RosterRow;
  canManage: boolean;
  today: string;
}) {
  const { member: m } = row;
  const [ending, setEnding] = useState(false);
  const [signState, signAction, signing] = useActionState<Result | null, FormData>(signStaff, null);
  const [endState, endAction, endingNow] = useActionState<Result | null, FormData>(
    endEmployment,
    null,
  );

  /*
    A fresh key per submission, as everywhere. `ON CONFLICT DO NOTHING` reports a
    repeated key as success, so a key fixed at mount would swallow the afternoon
    sign-out as a duplicate of the morning sign-in — and in a derived centre that is
    an adult counted who has gone home.
  */
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(crypto.randomUUID()), []);
  useEffect(() => {
    if (signState && 'ok' in signState) setKey(crypto.randomUUID());
  }, [signState]);
  useEffect(() => {
    if (endState && 'ok' in endState) setEnding(false);
  }, [endState]);

  const error =
    (signState && 'error' in signState ? signState.error : null) ??
    (endState && 'error' in endState ? endState.error : null);

  const finished = m.finishedOn !== null && m.finishedOn < today;

  return (
    <tr>
      <td>
        <strong>{m.fullName}</strong>
        {m.roleNote && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {m.roleNote}
          </div>
        )}
        {m.userId === null && (
          // Said plainly rather than left blank. A person with no login is normal —
          // relievers, contractors, the cook — and the roster has to show that it
          // knows, or somebody will assume the row is broken.
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            No app account
          </div>
        )}
        {finished && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            Left {m.finishedOn}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </td>

      <td>
        {row.present ? (
          <span className="flag flag-ok">{'✓'} Signed in{row.lastLabel ? ` ${row.lastLabel}` : ''}</span>
        ) : (
          <span className="flag flag-quiet">
            Not signed in{row.lastLabel ? ` · last ${row.lastLabel}` : ''}
          </span>
        )}
      </td>

      <td>
        {row.certificated ? (
          row.lapsingOn ? (
            <span className="flag flag-warn">{'●'} Expires {row.lapsingOn}</span>
          ) : (
            <span className="flag flag-ok">{'✓'} Current</span>
          )
        ) : (
          // Not styled as a failure. Plenty of people on a roster hold no practising
          // certificate and are not required to — and an unlinked certificate looks
          // identical to an absent one, which the page says above the table.
          <span className="empty">none linked</span>
        )}
      </td>

      <td>
        {!finished && (
          <form action={signAction}>
            <input type="hidden" name="staffMemberId" value={m.id} />
            <input type="hidden" name="kind" value={row.present ? 'out' : 'in'} />
            <input type="hidden" name="clientUuid" value={key ?? ''} />
            <button className="small" type="submit" disabled={signing || key === null}>
              {signing ? 'Recording…' : row.present ? 'Sign out' : 'Sign in'}
            </button>
          </form>
        )}

        {canManage && !finished && !ending && (
          <p style={{ margin: '0.35rem 0 0' }}>
            <button className="small secondary" type="button" onClick={() => setEnding(true)}>
              They have left
            </button>
          </p>
        )}

        {canManage && ending && (
          <form action={endAction} style={{ marginTop: '0.5rem' }}>
            <input type="hidden" name="id" value={m.id} />
            <div className="field">
              <label htmlFor={`finished-${m.id}`}>Last day</label>
              <input id={`finished-${m.id}`} name="finishedOn" type="date" required defaultValue={today} />
              <p className="sub" style={{ fontSize: '0.8125rem' }}>
                They stay on the record. Their shifts, sign-ins and ratio history all point at
                this person, so the row is kept and marked rather than removed.
              </p>
            </div>
            <div className="inline">
              <button type="submit" disabled={endingNow}>
                {endingNow ? 'Saving…' : 'Record last day'}
              </button>
              <button className="secondary" type="button" onClick={() => setEnding(false)}>
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
  const [state, action, pending] = useActionState<Result | null, FormData>(addStaffMember, null);

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
        <label htmlFor="fullName">Name</label>
        <input id="fullName" name="fullName" type="text" required />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Relievers and contractors belong here too. Somebody does not need a login to be counted
          in the ratio &mdash; that is the point of this list.
        </p>
      </div>

      <div className="field">
        <label htmlFor="roleNote">Role (optional)</label>
        <input id="roleNote" name="roleNote" type="text" placeholder="Head teacher, over-2s" />
      </div>

      <div className="field">
        <label htmlFor="startedOn">Started (optional)</label>
        <input id="startedOn" name="startedOn" type="date" />
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add to roster'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
