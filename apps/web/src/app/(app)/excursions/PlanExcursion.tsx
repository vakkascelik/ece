'use client';

import { useActionState, useEffect, useState } from 'react';
import { planExcursion, type Result } from './actions';

/** Collapsed behind a button: this page is read far more often than an outing is planned. */
export function PlanExcursion({ defaultWallClock }: { defaultWallClock: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<Result | null, FormData>(planExcursion, null);

  useEffect(() => {
    if (state && 'ok' in state) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <p style={{ margin: '0 0 1rem' }}>
        <button className="secondary" type="button" onClick={() => setOpen(true)}>
          Plan an outing
        </button>
      </p>
    );
  }

  return (
    <form action={action} className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Plan an outing</h2>

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="destination">Where to</label>
        <input id="destination" name="destination" type="text" required />
      </div>

      <div className="field">
        <label htmlFor="purpose">Why (optional)</label>
        <input id="purpose" name="purpose" type="text" />
      </div>

      <div className="field">
        <label htmlFor="departsAt">Leaves</label>
        <input id="departsAt" name="departsAt" type="datetime-local" required defaultValue={defaultWallClock} />
      </div>

      <div className="field">
        <label htmlFor="returnsAt">Back by (optional)</label>
        <input id="returnsAt" name="returnsAt" type="datetime-local" />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          So somebody in the building knows when to start worrying.
        </p>
      </div>

      <div className="field">
        <label htmlFor="transport">How you are getting there (optional)</label>
        <input id="transport" name="transport" type="text" />
      </div>

      <div className="field">
        <label htmlFor="adultsAttending">Adults going (optional)</label>
        <input id="adultsAttending" name="adultsAttending" type="number" min={0} inputMode="numeric" />
      </div>

      <div className="field">
        <label htmlFor="plan">The plan (optional)</label>
        <textarea id="plan" name="plan" rows={3} />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Route, hazards, what happens if it rains. Free text on purpose — a form with invented
          categories produces a document that looks official and is not.
        </p>
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Plan outing'}
        </button>
        <button className="secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
