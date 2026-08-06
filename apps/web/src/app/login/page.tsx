'use client';


import Link from 'next/link';
import { useActionState, useEffect, useRef } from 'react';
import { signIn } from './actions';

/**
 * Screen 1 of the design handoff.
 *
 * The single error string is load-bearing and is the same for every cause — unknown
 * address, wrong password, disabled account. Distinguishing them would turn this form
 * into a way to find out who works at a named childcare centre.
 *
 * Two deviations from the handoff, both recorded in llm-wiki/wiki/password-recovery.md:
 * the footnote no longer says there is no password reset, and there is a link to one,
 * because the recovery route the handoff pointed at ("ask your centre to re-invite
 * you") cannot set a password for an address that already has an account.
 */
export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null as { error?: string } | null);
  const alert = useRef<HTMLParagraphElement>(null);

  // The handoff asks for focus to move to the alert. Without this the message is
  // announced only if the reader happens to be past the submit button.
  useEffect(() => {
    if (state?.error) alert.current?.focus();
  }, [state]);

  const failed = Boolean(state?.error);

  return (
    <main className="auth">
      <div className="auth-head">
        <h1>Nau mai</h1>
        <p>Sign in to your centre.</p>
      </div>

      <form action={action}>
        {failed && (
          <p className="auth-alert" role="alert" tabIndex={-1} ref={alert}>
            <span aria-hidden="true">▲</span>
            <span>{state?.error}</span>
          </p>
        )}

        <label className="auth-field" htmlFor="email">
          <span>Email</span>
          {/* autocomplete=username, not email: the handoff's annotation, and it is what
              lets a password manager pair this with the password field. */}
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            aria-invalid={failed || undefined}
            required
          />
        </label>

        <label className="auth-field" htmlFor="password">
          <span>Password</span>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={failed || undefined}
            required
          />
        </label>

        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-note">
        Access to a centre comes from an invitation — there is no sign-up here. If you have
        forgotten your password, <Link href="/forgot-password">set a new one</Link>.
      </p>
    </main>
  );
}
