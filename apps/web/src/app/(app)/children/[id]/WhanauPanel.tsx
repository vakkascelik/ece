'use client';

import { useActionState, useEffect, useState } from 'react';
import type { GuardianOfChild } from '@ece/api';
import { addGuardian, editGuardian, unlinkGuardian, type Result } from '../actions';

/**
 * The child's whānau, and the collection list.
 *
 * A parent viewing this sees only their own row. That is not this component
 * filtering — the policy on `guardians` restricts a parent to their own record,
 * because an app that hands one separated parent the other's current address on
 * request is a safety problem, not a convenience.
 *
 * `canCollect` is deliberately not the same as `isPrimary`. The person the centre
 * rings first and the people allowed to take a child home are different lists, and
 * conflating them is how a child leaves with the wrong adult.
 */
export function WhanauPanel({
  childId,
  whanau,
  canEdit,
  isParent,
}: {
  childId: string;
  whanau: GuardianOfChild[];
  canEdit: boolean;
  isParent: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      {whanau.length === 0 ? (
        <p className="empty">Nobody recorded. A child cannot be collected without someone here.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Relationship</th>
              <th>Contact</th>
              <th>Permissions</th>
              {canEdit && <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>}
            </tr>
          </thead>
          <tbody>
            {whanau.map((g) => (
              <GuardianRow key={g.id} childId={childId} entry={g} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      )}

      {isParent && whanau.length > 0 && (
        <p className="sub" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem' }}>
          You see your own contact details here. Others linked to this child are visible to
          the centre, not to each other.
        </p>
      )}

      {canEdit && !adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Add someone
          </button>
        </p>
      )}
      {canEdit && adding && <GuardianForm childId={childId} onDone={() => setAdding(false)} />}
    </div>
  );
}

function GuardianRow({
  childId,
  entry,
  canEdit,
}: {
  childId: string;
  entry: GuardianOfChild;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(unlinkGuardian, null);
  const [editing, setEditing] = useState(false);
  const error = state && 'error' in state ? state.error : null;

  if (editing) {
    return (
      <tr>
        <td colSpan={canEdit ? 5 : 4}>
          <EditGuardianForm childId={childId} entry={entry} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <strong>{entry.guardian.fullName}</strong>
        {entry.guardian.userId && (
          <>
            {' '}
            <span className="flag flag-quiet">has an account</span>
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
      </td>
      <td>{entry.relationship}</td>
      <td>
        {entry.guardian.phone ?? <span className="empty">No phone</span>}
        {entry.guardian.email && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {entry.guardian.email}
          </div>
        )}
      </td>
      <td>
        <span className="inline">
          {entry.isPrimary && <span className="flag flag-quiet">primary</span>}
          {entry.isEmergencyContact && (
            <span className="flag flag-quiet">emergency #{entry.contactPriority}</span>
          )}
          {entry.canCollect ? (
            <span className="flag flag-ok">✓ may collect</span>
          ) : (
            <span className="flag flag-critical">✗ must NOT collect</span>
          )}
        </span>
      </td>
      {canEdit && (
        <td>
          <span className="inline">
            <button className="secondary small" type="button" onClick={() => setEditing(true)}>
              Edit
            </button>
            <form action={action}>
              <input type="hidden" name="linkId" value={entry.id} />
              <input type="hidden" name="childId" value={childId} />
              <button className="danger small" type="submit" disabled={pending}>
                Remove
              </button>
            </form>
          </span>
        </td>
      )}
    </tr>
  );
}

/**
 * Editing touches both tables at once.
 *
 * The phone number belongs to the person and is shared across their children; the
 * collection permission and ring order belong to this child's link and can differ
 * between siblings. One form, two updates — the distinction is real but it is not
 * the user's problem.
 */
function EditGuardianForm({
  childId,
  entry,
  onDone,
}: {
  childId: string;
  entry: GuardianOfChild;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(editGuardian, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action}>
      <input type="hidden" name="childId" value={childId} />
      <input type="hidden" name="guardianId" value={entry.guardian.id} />
      <input type="hidden" name="linkId" value={entry.id} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor={`name-${entry.id}`}>Name</label>
            <input id={`name-${entry.id}`} name="fullName" defaultValue={entry.guardian.fullName} required />
          </div>
          <div>
            <label htmlFor={`rel-${entry.id}`}>Relationship</label>
            <input id={`rel-${entry.id}`} name="relationship" defaultValue={entry.relationship} required />
          </div>
        </div>
        <div className="row">
          <div>
            <label htmlFor={`phone-${entry.id}`}>Phone</label>
            <input id={`phone-${entry.id}`} name="phone" type="tel" defaultValue={entry.guardian.phone ?? ''} />
          </div>
          <div>
            <label htmlFor={`email-${entry.id}`}>Email</label>
            <input id={`email-${entry.id}`} name="email" type="email" defaultValue={entry.guardian.email ?? ''} />
          </div>
        </div>
        <div>
          <label htmlFor={`addr-${entry.id}`}>Address</label>
          <input className="wide" id={`addr-${entry.id}`} name="address" defaultValue={entry.guardian.address ?? ''} />
        </div>
        <div className="days">
          <label>
            <input type="checkbox" name="canCollect" defaultChecked={entry.canCollect} /> May collect
          </label>
          <label>
            <input type="checkbox" name="isPrimary" defaultChecked={entry.isPrimary} /> Primary contact
          </label>
          <label>
            <input type="checkbox" name="isEmergencyContact" defaultChecked={entry.isEmergencyContact} /> Emergency
            contact
          </label>
          <label>
            Ring order
            <input
              name="contactPriority"
              type="number"
              min={1}
              defaultValue={entry.contactPriority}
              style={{ width: '4.5rem' }}
            />
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function GuardianForm({ childId, onDone }: { childId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addGuardian, null);
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
            <label htmlFor="fullName">Name</label>
            <input id="fullName" name="fullName" required />
          </div>
          <div>
            <label htmlFor="relationship">Relationship</label>
            {/*
              Free text, not a dropdown. "Whāngai caregiver", "aunty", "grandmother
              (primary)" — a fixed list is a list of the family shapes somebody
              thought of, and the families it omits are already used to being told
              their arrangement does not fit the form.
            */}
            <input id="relationship" name="relationship" required placeholder="mother" />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" type="tel" />
          </div>
          <div>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" />
          </div>
        </div>

        <div>
          <label htmlFor="address">Address</label>
          <input className="wide" id="address" name="address" />
        </div>

        <div className="days">
          <label>
            <input type="checkbox" name="canCollect" defaultChecked /> May collect
          </label>
          <label>
            <input type="checkbox" name="isPrimary" /> Primary contact
          </label>
          <label>
            <input type="checkbox" name="isEmergencyContact" /> Emergency contact
          </label>
          <label>
            Ring order
            <input className="narrow" name="contactPriority" type="number" min={1} defaultValue={100} style={{ width: '4.5rem' }} />
          </label>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
