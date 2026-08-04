'use client';

import { useActionState, useEffect, useState } from 'react';
import { REO } from '@ece/core';
import { start, type Result } from './actions';

export function NewThread({
  childOptions,
  isStaff,
}: {
  childOptions: { id: string; name: string }[];
  isStaff: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(start, null);
  const [open, setOpen] = useState(false);
  const error = state && 'error' in state ? state.error : null;

  useEffect(() => {
    if (state && 'ok' in state) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <p>
        <button type="button" onClick={() => setOpen(true)}>
          {isStaff ? `Message a ${REO.whanau}` : 'Message the centre'}
        </button>
      </p>
    );
  }

  return (
    <form action={action} className="card">
      <div className="stack">
        <div className="row">
          <div style={{ flex: 1, minWidth: '16rem' }}>
            <label htmlFor="subject">About</label>
            <input id="subject" name="subject" required autoComplete="off" placeholder="Nap times" />
          </div>
          <div>
            <label htmlFor="childId">Which child</label>
            <select id="childId" name="childId" defaultValue="">
              <option value="">Not about a specific child</option>
              {childOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="body">Message</label>
          <textarea id="body" name="body" rows={3} required />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send'}
          </button>
          <button className="secondary" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <span className="sub" style={{ fontSize: '0.8125rem' }}>
            A sent message cannot be edited or deleted.
          </span>
        </div>
      </div>
    </form>
  );
}
