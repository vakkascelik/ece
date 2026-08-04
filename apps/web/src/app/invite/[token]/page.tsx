import Link from 'next/link';
import { findInvitationForDisplay } from '@ece/api';
import { hashInviteToken } from '@/lib/inviteToken';
import { serverDb, serviceDb } from '@/lib/supabase';
import { AcceptForm } from './AcceptForm';

/**
 * The invitation acceptance page.
 *
 * Outside `(app)` on purpose: the person here has no membership yet, and
 * `requireCtx()` would route them to /no-access — which is the screen for somebody
 * whose invitation has *not* arrived.
 *
 * The token is in the URL, so it lands in browser history and in any referrer. That
 * is the accepted trade for a link somebody can click from an email, and it is why
 * tokens are single-use, expire in seven days, and are stored only as a hash.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findInvitationForDisplay(serviceDb(), hashInviteToken(token));

  // Who, if anyone, is already signed in — which decides whether this is a "set a
  // password" or a "join" screen.
  const db = await serverDb();
  const { data: auth } = await db.auth.getUser();
  const signedInAs = auth.user?.email?.toLowerCase() ?? null;

  if (invite.status !== 'live' || !invite.email || !invite.role) {
    return (
      <div className="center">
        <h1>This invitation cannot be used</h1>
        <p className="sub">
          {invite.status === 'expired'
            ? 'It has expired. Invitations last seven days.'
            : invite.status === 'used'
              ? 'It has already been used. If that was not you, tell the centre.'
              : invite.status === 'revoked'
                ? 'It was withdrawn by the centre.'
                : 'The link is not one we recognise. It may have been mistyped or already replaced by a newer invitation.'}
        </p>
        <p>
          Ask the centre to send a new one, or <Link href="/login">sign in</Link> if you already
          have an account.
        </p>
      </div>
    );
  }

  const matches = signedInAs === invite.email;

  return (
    <div className="center">
      <h1>Join {invite.centreName ?? 'the centre'}</h1>
      <p className="sub">
        You have been invited as <strong>{invite.role}</strong>, at{' '}
        <strong>{invite.email}</strong>.
      </p>

      {signedInAs && !matches ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            You are signed in as <strong>{signedInAs}</strong>, and this invitation was sent to{' '}
            <strong>{invite.email}</strong>.
          </p>
          {/*
            Not offered as a "join anyway" button. An invitation that any signed-in
            person could accept is a bearer token for access to children's records,
            and a forwarded email would be a way in.
          */}
          <p className="sub" style={{ marginBottom: 0 }}>
            Sign out and back in as the invited address, then open this link again.
          </p>
        </div>
      ) : (
        <AcceptForm token={token} email={invite.email} alreadySignedIn={matches} />
      )}
    </div>
  );
}
