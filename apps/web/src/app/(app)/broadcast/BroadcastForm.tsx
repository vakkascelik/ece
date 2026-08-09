'use client';

import { useActionState, useEffect, useState } from 'react';
import { send, type Result } from './actions';

/**
 * The confirmation checkbox is deliberate friction, not decoration.
 *
 * This is the one form in the app that reaches every family and every member of staff the
 * instant it is submitted, bypassing quiet hours on purpose — there is no "undo" once
 * `broadcast_emergency` has run. A single required tick that names what pressing Send
 * actually does is cheap insurance against a fat-fingered draft going out mid-sentence.
 */
export function BroadcastForm({ recipientCount }: { recipientCount: number }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(send, null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state && 'ok' in state) setFormKey((k) => k + 1);
  }, [state]);

  return (
    <form key={formKey} action={action} className="card">
      <h2 style={{ marginTop: 0 }}>Send an emergency broadcast</h2>
      <p className="sub" style={{ fontSize: '0.8125rem' }}>
        Reaches every current staff member and family at {recipientCount === 1 ? 'this centre — 1 person' : `this centre — ${recipientCount} people`} right now, ignoring quiet hours.
        Today that means: an entry each of them can read on their own{' '}
        <a href="/notifications">Notifications</a> page. It does not yet send a push
        notification or an email — neither is wired up to this product yet.
      </p>

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state && 'ok' in state && (
        <p role="status" className="flag flag-ok">
          Sent to {state.recipientCount} {state.recipientCount === 1 ? 'person' : 'people'}.
        </p>
      )}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" name="title" type="text" required autoComplete="off" maxLength={200} />
      </div>

      <div className="field">
        <label htmlFor="body">Message</label>
        <textarea id="body" name="body" required rows={4} maxLength={2000} />
      </div>

      <div className="field">
        <label htmlFor="confirm" style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <input id="confirm" name="confirm" type="checkbox" value="yes" required />
          <span>
            I understand this notifies everyone at this centre immediately and cannot be
            recalled.
          </span>
        </label>
      </div>

      <button type="submit" disabled={pending} className="danger">
        {pending ? 'Sending…' : 'Send emergency broadcast'}
      </button>
    </form>
  );
}
