import { redirect } from 'next/navigation';
import { serverDb } from '@/lib/supabase';
import { ResetForm } from './ResetForm';

/**
 * Deliberately outside `(app)`, like /invite: the person arriving holds a
 * recovery session, which is authenticated but should not have to pass the
 * centre-membership checks in requireCtx() just to set a password.
 */
export default async function ResetPasswordPage() {
  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect('/forgot-password?expired=1');

  return (
    <main className="auth">
      <div className="auth-head">
        <h1>Set a new password</h1>
        <p>For {auth.user.email}.</p>
      </div>
      <ResetForm />
    </main>
  );
}
