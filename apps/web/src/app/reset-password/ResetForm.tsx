'use client';

import { useActionState, useEffect, useRef } from 'react';
import { resetPassword, type ResetResult } from './actions';

export function ResetForm() {
  const [state, action, busy] = useActionState(resetPassword, null as ResetResult);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state?.error) alert.current?.focus();
  }, [state]);

  const failed = Boolean(state?.error);

  return (
    <form action={action}>
      {failed && (
        <p className="auth-alert" role="alert" tabIndex={-1} ref={alert}>
          <span aria-hidden="true">▲</span>
          <span>{state?.error}</span>
        </p>
      )}

      <label className="auth-field" htmlFor="password">
        <span>New password</span>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={failed || undefined}
          required
        />
      </label>

      <label className="auth-field" htmlFor="confirm">
        <span>New password again</span>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={failed || undefined}
          required
        />
      </label>

      {/* Stated up front rather than as a rejection after the fact. */}
      <p className="auth-note">At least 10 characters. Length beats punctuation.</p>

      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set the password'}</button>
    </form>
  );
}
