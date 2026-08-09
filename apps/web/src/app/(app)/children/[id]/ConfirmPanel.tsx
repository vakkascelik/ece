'use client';

import { useActionState } from 'react';
import { confirmChildDetails, type Result } from '../actions';

/**
 * "Are these details still right?" — the question a licensing reviewer asks, and until
 * 0055 nothing in this product could answer it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT SAYS WHAT IT CANNOT TELL YOU
 *
 * A confirmation records **when a family last said the details were right**. It does not
 * record what they looked at, so the product cannot say "and nothing has changed since" —
 * 0055 refuses to store a snapshot, because a frozen copy of a family's contact details on
 * an append-only table lives under a different retention rule from the original and cannot
 * be corrected or purged.
 *
 * The date is therefore shown plainly and without a verdict. A green tick reading
 * "confirmed" over a phone number changed last week would be worse than no tick at all —
 * the same reasoning the sleep register uses when no interval is stated, and the same
 * reason the binder says what the data shows rather than whether the centre is compliant.
 */
export function ConfirmPanel({
  childId,
  ownGuardianId,
  lastConfirmed,
  isParent,
}: {
  childId: string;
  /** The caller's own guardian record, when they have one. */
  ownGuardianId: string | null;
  /** Formatted in the centre's timezone by the server, or null if never. */
  lastConfirmed: string | null;
  isParent: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(
    confirmChildDetails,
    null,
  );

  return (
    <>
      <p style={{ margin: 0 }}>
        {lastConfirmed ? (
          <>
            Last confirmed by a parent or caregiver on <strong>{lastConfirmed}</strong>.
          </>
        ) : (
          <em>No parent or caregiver has confirmed these details.</em>
        )}
      </p>

      <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
        This is the date somebody said the details were right. It does not mean nothing has
        changed since — if a phone number was edited afterwards, this date does not move.
      </p>

      {state && 'error' in state && (
        <p className="error" role="alert" style={{ margin: '0.5rem 0 0' }}>
          {state.error}
        </p>
      )}

      {state && 'ok' in state && (
        <p role="status" style={{ margin: '0.5rem 0 0' }}>
          Thank you — we have recorded that today.
        </p>
      )}

      {/*
        Only a guardian sees the button, and only one with a guardian record of their own.

        A manager confirming on a family's behalf would record an assurance the family
        never gave — which is exactly what 0055's insert policy refuses in the database.
        The button is absent rather than disabled for the same reason as the absence
        control: an enabled control that answers "you cannot do that" teaches people to
        distrust every button on the page.
      */}
      {isParent && ownGuardianId && (
        <form action={action} style={{ marginTop: '0.75rem' }}>
          <input type="hidden" name="childId" value={childId} />
          <input type="hidden" name="guardianId" value={ownGuardianId} />
          <button className="small secondary" type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'These details are correct'}
          </button>
        </form>
      )}
    </>
  );
}
