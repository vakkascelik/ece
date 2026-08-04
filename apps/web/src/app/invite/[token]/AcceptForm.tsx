'use client';

import { useActionState } from 'react';
import { acceptAsCurrentUser, acceptWithNewAccount, type AcceptResult } from './actions';

/**
 * Two paths, one component.
 *
 * Already signed in as the invited address → one button. Not signed in → set a
 * password, because signups are disabled on the project and the invitation is what
 * authorises the account.
 */
export function AcceptForm({
  token,
  email,
  alreadySignedIn,
}: {
  token: string;
  email: string;
  alreadySignedIn: boolean;
}) {
  const [state, action, pending] = useActionState<AcceptResult | null, FormData>(
    alreadySignedIn ? acceptAsCurrentUser : acceptWithNewAccount,
    null,
  );
  const error = state && 'error' in state ? state.error : null;

  if (alreadySignedIn) {
    return (
      <form action={action} className="card">
        <input type="hidden" name="token" value={token} />
        <p style={{ marginTop: 0 }}>
          You are signed in as <strong>{email}</strong>.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {pending ? 'Joining…' : 'Join the centre'}
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="card">
      <input type="hidden" name="token" value={token} />
      <div className="stack">
        <p style={{ margin: 0 }}>Choose a password and your account is ready.</p>

        {/*
          A read-only email field rather than none at all: password managers need
          something to associate the credential with, and a form that saves a password
          against no username tends not to be offered again.
        */}
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" value={email} readOnly autoComplete="username" />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            aria-describedby="pw-hint"
          />
          <p id="pw-hint" className="sub" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
            At least 10 characters. Length matters more than symbols — a phrase you will
            remember beats something you write down.
          </p>
        </div>

        <div>
          <label htmlFor="confirm">Password again</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
          />
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div>
          <button type="submit" disabled={pending}>
            {pending ? 'Creating your account…' : 'Create account and join'}
          </button>
        </div>
      </div>
    </form>
  );
}
