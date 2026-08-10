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
      <div className="card adults">
        <div className="adults-eyebrow">Adults present</div>
        {/*
          No live region on the number, deliberately. `RatioBanner` is already a
          `role="status"` and it says "{n} kaiako" — a second one here would announce every
          change twice, and the ratio is the announcement that matters.
        */}
        <div className="adults-value">{current}</div>
        <p className="adults-note sub">
          {current === 0
            ? 'Nothing recorded today, so the ratio is being calculated against zero adults.'
            : `${current === 1 ? 'adult' : 'adults'} counting toward the ratio.`}
        </p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {canEdit && (
          <>
            {/*
              One form, two submit buttons. A submitter's own name and value go into the
              FormData, so each button posts the count it means and the action needs no
              new shape — `setAdults` still receives an absolute number, which is what
              makes it an event rather than an increment. Two events arriving out of order
              would otherwise resolve to whichever "+1" landed last.

              The labels state the resulting count rather than the direction: "One more
              adult" is the gesture, "3 adults present" is what will be true, and a
              recorded compliance figure should be announced as the figure.
            */}
            <form action={action} className="adults-steps">
              <button
                className="secondary"
                type="submit"
                name="adults"
                value={Math.max(0, current - 1)}
                disabled={pending || current === 0}
                aria-label={`Record ${Math.max(0, current - 1)} adults present`}
              >
                <span aria-hidden="true">−</span>
              </button>
              <button
                className="secondary"
                type="submit"
                name="adults"
                value={current + 1}
                disabled={pending}
                aria-label={`Record ${current + 1} adults present`}
              >
                <span aria-hidden="true">+</span>
              </button>
            </form>
            {/*
              The typed form stays. A stepper is right for "somebody just walked in" and
              wrong for "we opened with four and two are on lunch" — and the note is the
              only place the reason for a count is ever written down.
            */}
            <button className="secondary small" type="button" onClick={() => setEditing(true)}>
              {current === 0 ? 'Record the count' : 'Set a number, with a note'}
            </button>
          </>
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
