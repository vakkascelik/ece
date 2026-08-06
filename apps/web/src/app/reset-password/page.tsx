import Link from 'next/link';
import { redirect } from 'next/navigation';
import { recoveryGate } from './guard';
import { ResetForm } from './ResetForm';

/**
 * Deliberately outside `(app)`, like /invite: the person arriving holds a
 * recovery session, which is authenticated but should not have to pass the
 * centre-membership checks in requireCtx() just to set a password.
 *
 * A RECOVERY session, and the check for that is new. This page used to render the form for anybody
 * with any session, so somebody at an unlocked signed-in browser could set a new password without
 * knowing the old one — see `guard.ts` and `lib/recoverySession.ts`.
 */
export default async function ResetPasswordPage() {
  const gate = await recoveryGate();

  if (!gate.ok) {
    if (gate.reason === 'no-session') redirect('/forgot-password?expired=1');

    /*
     * Signed in, but with an ordinary session. Explained rather than redirected: sending them to
     * /account would bounce anybody without a centre membership, and a silent redirect from a page
     * that used to work reads like a bug.
     *
     * The wording says which door to use and does not imply anything went wrong.
     */
    return (
      <main className="auth">
        <div className="auth-head">
          <h1>Use your account settings</h1>
          <p>
            You are already signed in, so changing your password here is not the right route — this
            page is only for a link sent to your email. To change it now, go to{' '}
            <Link href="/account">your account</Link>, where you will be asked for your current
            password.
          </p>
          <p>
            If you cannot remember it, <Link href="/forgot-password">ask for a reset link</Link> and
            open the one that arrives in your email.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-head">
        <h1>Set a new password</h1>
        <p>For {gate.email}.</p>
      </div>
      <ResetForm />
    </main>
  );
}
