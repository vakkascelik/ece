'use client';

import { useActionState, useState } from 'react';
import { setAdults, type Result } from './actions';

/**
 * How many adults are here.
 *
 * A recorded event, not a setting — see 0010. The number is half of a compliance
 * figure, so it carries a time and an author and the history stays reconstructible.
 */
export function AdultCount({ current, canEdit }: { current: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(setAdults, null);
  const [editing, setEditing] = useState(false);
  const error = state && 'error' in state ? state.error : null;

  if (!editing) {
    return (
      <div className="card">
        <div className="inline">
          <strong style={{ fontSize: '1.25rem' }}>{current}</strong>
          <span className="sub">
            {current === 0
              ? 'Nothing recorded today, so the ratio is being calculated against zero adults.'
              : `${current === 1 ? 'adult' : 'adults'} counting toward the ratio.`}
          </span>
          {canEdit && (
            <button className="secondary small" type="button" onClick={() => setEditing(true)}>
              {current === 0 ? 'Record the count' : 'Update'}
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="card">
      <div className="row">
        <div>
          <label htmlFor="adults">Adults present</label>
          <input
            className="narrow"
            id="adults"
            name="adults"
            type="number"
            min={0}
            max={200}
            defaultValue={current}
            required
          />
        </div>
        <div style={{ flex: 1, minWidth: '12rem' }}>
          <label htmlFor="adults-note">Note</label>
          <input id="adults-note" name="note" placeholder="two on lunch break" />
        </div>
        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record'}
          </button>
          <button className="secondary" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
        Recorded with a time, so the ratio at any point today can be reconstructed later.
        A correction is a new count, not an edit.
      </p>
    </form>
  );
}
