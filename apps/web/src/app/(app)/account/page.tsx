import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * The user's own account, as opposed to /settings which is the centre's and
 * gated on manageCentre. Every role gets this page — a parent's password guards
 * their child's records exactly as much as a manager's does.
 */
export default async function AccountPage() {
  await requireCtx();
  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();

  return (
    <>
      <h1>Your account</h1>
      <p className="sub">{auth.user?.email}</p>

      <h2 style={{ fontSize: '1.05rem' }}>Change password</h2>
      <ChangePasswordForm />
    </>
  );
}
