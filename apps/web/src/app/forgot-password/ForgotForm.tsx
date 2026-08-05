'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { requestReset, type ForgotResult } from './actions';

/**
 * Built on the handoff's auth panel (screen 1) even though the handoff has no such
 * screen — see the deviation note in llm-wiki/wiki/password-recovery.md. Same panel,
 * same field anatomy, same single-alert pattern, so it does not read as a bolt-on.
 */
export function ForgotForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState(requestReset, null as ForgotResult);
  const alert = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state?.error) alert.current?.focus();
  }, [state]);

  if (state?.sent) {
    return (
      <main className="auth">
        <div className="auth-head">
          <h1>Check your email</h1>
          <p>
            If that address has an account here, a link to set a new password is on its way. It
            works once, and not for long.
          </p>
        </div>
        <p className="auth-note">
          <Link href="/login">Back to sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-head">
        <h1>Set a new password</h1>
        <p>Enter your email and we will send you a link.</p>
      </div>

      <form action={action}>
        {expired && !state?.error && (
          <p className="auth-alert" role="alert">
            <span aria-hidden="true">▲</span>
            <span>
              That link has expired, or was opened in a different browser from the one that
              asked for it. Ask for another below.
            </span>
          </p>
        )}
        {state?.error && (
          <p className="auth-alert" role="alert" tabIndex={-1} ref={alert}>
            <span aria-hidden="true">▲</span>
            <span>{state.error}</span>
          </p>
        )}

        <label className="auth-field" htmlFor="email">
          <span>Email</span>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </label>

        <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send the link'}</button>
      </form>

      <p className="auth-note">
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
