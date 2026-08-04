'use client';

import { useActionState, useState } from 'react';
import { archive, type Result } from '../actions';

/**
 * Marking that a child has left.
 *
 * Archive, never delete. The Ministry requires the record to be retained, and any
 * later question about who was present when something happened needs it — a deleted
 * child takes the answer with them. So this closes the record rather than removing
 * it, and the child stops appearing on the roll.
 *
 * Two steps, because the button sits at the bottom of a long form-heavy page and a
 * single click there is too easy. Not a modal: a confirmation that steals focus and
 * traps the keyboard is worse than one that does not.
 */
export function ArchivePanel({ childId, name }: { childId: string; name: string }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(archive, null);
  const [confirming, setConfirming] = useState(false);
  const error = state && 'error' in state ? state.error : null;

  return (
    <div className="card">
      <p className="sub" style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem' }}>
        Marks {name} as having left. The record is kept — enrolment history, consents
        and the audit trail all stay, and nothing is deleted. They come off the roll.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {confirming ? (
        <form action={action} className="inline">
          <input type="hidden" name="childId" value={childId} />
          <span>Mark {name} as having left the centre?</span>
          <button className="danger" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Yes, they have left'}
          </button>
          <button className="secondary" type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="secondary" type="button" onClick={() => setConfirming(true)}>
          {name} has left the centre
        </button>
      )}
    </div>
  );
}
