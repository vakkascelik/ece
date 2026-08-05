'use client';

import { useActionState } from 'react';
import { changePassword, type ChangePasswordResult } from './actions';

export function ChangePasswordForm() {
  const [state, action, busy] = useActionState(changePassword, null as ChangePasswordResult);

  return (
    <form action={action} className="card">
      <div style={{ marginBottom: '0.9rem' }}>
        <label htmlFor="current">Current password</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div style={{ marginBottom: '0.9rem' }}>
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required />
      </div>
      <div style={{ marginBottom: '1.1rem' }}>
        <label htmlFor="confirm">New password again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>

      {state?.error && <p className="error" style={{ marginTop: 0 }} role="alert">{state.error}</p>}
      {state?.ok && (
        <p className="sub" style={{ marginTop: 0 }} role="status">
          Password changed. Anywhere else you were signed in has been signed out.
        </p>
      )}

      <button type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
    </form>
  );
}
