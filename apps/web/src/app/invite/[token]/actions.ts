'use server';

/**
 * Accepting an invitation.
 *
 * Deliberately outside `(app)`, because the person doing it has no membership yet —
 * `requireCtx()` would send them to /no-access, which is the screen for somebody
 * whose invitation has *not* arrived.
 *
 * Signups are disabled on the project, so a new educator cannot create an account
 * for themselves. That is on purpose, and it makes the invitation the authorisation:
 * possessing a token sent to a mailbox is proof of holding that mailbox, which is
 * exactly what an email verification link proves. So this creates the account when
 * there isn't one.
 */

import { redirect } from 'next/navigation';
import { acceptInvitation, findInvitationForDisplay } from '@ece/api';
import { hashInviteToken } from '@/lib/inviteToken';
import { passwordProblem } from '@/lib/password';
import { CENTRE_COOKIE } from '@/lib/auth';
import { serverDb, serviceDb } from '@/lib/supabase';
import { cookies } from 'next/headers';

export type AcceptResult = { error: string } | { ok: true };

/**
 * Set a password, get an account, join the centre.
 *
 * Order matters and is not obvious: the account is created *before* the invitation
 * is claimed. If it were the other way round, a failure to create the user would
 * leave the invitation spent and the person locked out with no way back except a
 * manager reissuing it.
 */
export async function acceptWithNewAccount(
  _prev: unknown,
  form: FormData,
): Promise<AcceptResult> {
  const token = (form.get('token') ?? '').toString();
  const password = (form.get('password') ?? '').toString();
  const confirm = (form.get('confirm') ?? '').toString();

  if (!token) return { error: 'This link is incomplete.' };
  const problem = passwordProblem(password, confirm);
  if (problem) return { error: problem };

  const admin = serviceDb();
  const invite = await findInvitationForDisplay(admin, hashInviteToken(token));
  if (invite.status !== 'live' || !invite.email) {
    return { error: 'This invitation is no longer valid. Ask the centre for a new one.' };
  }

  // `email_confirm: true` because the invitation already proved the mailbox: the
  // token was sent there and nowhere else.
  const created = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
  });

  const userId = created.data?.user?.id ?? null;
  if (created.error) {
    const exists =
      created.error.status === 422 || /already.*registered/i.test(created.error.message);
    if (!exists) return { error: `Could not create the account: ${created.error.message}` };
    // Somebody already has an account on this address — perhaps they were invited to
    // another centre first. Setting a password for them here would be a takeover, so
    // they sign in instead.
    return {
      error:
        'An account already exists for that address. Sign in first, then open this link again.',
    };
  }
  if (!userId) return { error: 'Could not create the account.' };

  // Sign them in through the cookie-backed client, so the session lands in the
  // browser and the redirect below arrives authenticated.
  const db = await serverDb();
  const signIn = await db.auth.signInWithPassword({ email: invite.email, password });
  if (signIn.error || !signIn.data.user) {
    return { error: 'Your account was created but signing in failed. Try the sign-in page.' };
  }

  const outcome = await acceptInvitation(admin, {
    tokenHash: hashInviteToken(token),
    userId,
    userEmail: invite.email,
  });
  if (!outcome.ok) return { error: explain(outcome.reason) };

  // Pre-select the centre they just joined, so the first screen is the centre rather
  // than a chooser with one option.
  (await cookies()).set(CENTRE_COOKIE, outcome.centreId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });
  redirect('/');
}

/** For somebody already signed in. */
export async function acceptAsCurrentUser(_prev: unknown, form: FormData): Promise<AcceptResult> {
  const token = (form.get('token') ?? '').toString();
  if (!token) return { error: 'This link is incomplete.' };

  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user?.email) return { error: 'You are not signed in.' };

  const outcome = await acceptInvitation(serviceDb(), {
    tokenHash: hashInviteToken(token),
    userId: auth.user.id,
    userEmail: auth.user.email,
  });
  if (!outcome.ok) return { error: explain(outcome.reason, auth.user.email) };

  (await cookies()).set(CENTRE_COOKIE, outcome.centreId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });
  redirect('/');
}

function explain(reason: string, signedInAs?: string): string {
  switch (reason) {
    case 'expired':
      return 'This invitation has expired. Ask the centre to send another.';
    case 'used':
      return 'This invitation has already been used.';
    case 'revoked':
      return 'This invitation was withdrawn.';
    case 'wrong-email':
      return signedInAs
        ? `This invitation was sent to a different address. You are signed in as ${signedInAs} — sign out and back in as the invited address.`
        : 'This invitation was sent to a different address.';
    default:
      return 'This link is not valid.';
  }
}
