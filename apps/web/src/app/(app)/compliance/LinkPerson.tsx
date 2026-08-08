'use client';

import { useActionState } from 'react';
import { linkRecordToPerson, type Result } from './actions';

export interface PersonOption {
  id: string;
  name: string;
}

/**
 * Attach a staff record to the person it is about.
 *
 * The human act 0038 exists to require. No migration does this: matching on
 * `person_name` would merge two relievers who share a first name, and a police
 * vetting result attached to the wrong person is the worst row this schema could
 * hold — and it would look entirely normal.
 *
 * So the control is a select somebody chooses from, with the name on the certificate
 * shown beside it, and nothing preselected. A default of "the closest name" would be
 * the same guess wearing a different hat.
 */
export function LinkPerson({
  recordId,
  personName,
  linkedTo,
  people,
}: {
  recordId: string;
  personName: string;
  linkedTo: string | null;
  people: PersonOption[];
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    linkRecordToPerson,
    null,
  );

  if (people.length === 0) {
    return (
      <span className="sub" style={{ fontSize: '0.8125rem' }}>
        No staff on the roster to link to yet.
      </span>
    );
  }

  return (
    <form action={action} className="inline">
      <input type="hidden" name="recordId" value={recordId} />
      <label htmlFor={`link-${recordId}`} className="visually-hidden">
        Link {personName} to a person on the roster
      </label>
      <select
        id={`link-${recordId}`}
        name="staffMemberId"
        defaultValue={linkedTo ?? ''}
        style={{ maxWidth: '12rem' }}
      >
        {/* Empty is a real option, not a placeholder: it unlinks, which is the escape
            hatch for having linked the wrong person. */}
        <option value="">Not linked</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="small secondary" type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Link'}
      </button>
      {state && 'error' in state && (
        <span className="error" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
