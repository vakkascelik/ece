'use client';

import { useActionState } from 'react';
import { signIn } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null as { error?: string } | null);

  return (
    <main className="center">
      <h1>Sign in</h1>
      <p className="sub">ECE Platform</p>

      <form action={action} className="card">
        <div style={{ marginBottom: '0.9rem' }}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div style={{ marginBottom: '1.1rem' }}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error && <p className="error" style={{ marginTop: 0 }}>{state.error}</p>}
        <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
