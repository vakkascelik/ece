/**
 * Invitations — a manager states an intention, the invitee proves they hold the
 * mailbox, and the server creates the membership.
 *
 * WHY THE HASHING IS NOT IN HERE
 *
 * These functions take a `tokenHash` and never see a raw token. Hashing needs a
 * crypto primitive, and `@ece/core`/`@ece/api` may not import Node built-ins — the
 * mobile bundle cannot resolve them, and `node:crypto` is exactly the import that
 * breaks a Metro build with an error that never mentions workspaces.
 *
 * So the caller hashes. In practice that is the web app, which is the only surface
 * that issues or accepts invitations; see `apps/web/src/lib/inviteToken.ts`. The
 * queries stay in the shared layer because the read side is ordinary and there is no
 * reason to write it twice if mobile ever grows an invitations screen.
 */

import type { MemberRole } from '@ece/core';
import type { Db } from './index';

export interface Invitation {
  id: string;
  centreId: string;
  email: string;
  role: MemberRole;
  invitedBy: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Note the absence of `token_hash`: 0007 does not grant it to `authenticated`. */
const COLUMNS =
  'id, centre_id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at';

interface Row {
  id: string;
  centre_id: string;
  email: string;
  role: MemberRole;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const toInvitation = (r: Row): Invitation => ({
  id: r.id,
  centreId: r.centre_id,
  email: r.email,
  role: r.role,
  invitedBy: r.invited_by,
  expiresAt: r.expires_at,
  acceptedAt: r.accepted_at,
  revokedAt: r.revoked_at,
  createdAt: r.created_at,
});

/** Live invitations for a centre: not accepted, not revoked, not expired. */
export async function listPendingInvitations(db: Db, centreId: string): Promise<Invitation[]> {
  const { data, error } = await db
    .from('invitations')
    .select(COLUMNS)
    .eq('centre_id', centreId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listPendingInvitations: ${error.message}`);
  return (data as Row[]).map(toInvitation);
}

/**
 * Issue an invitation.
 *
 * Runs as the caller, so the policy in 0007 confines it to owners and managers of
 * the centre named. Re-inviting somebody who already has a live invitation replaces
 * it: `invitations_one_live_per_email` refuses the second row, and leaving two
 * working links for one mailbox is worse than losing the first.
 */
export async function createInvitation(
  db: Db,
  input: {
    centreId: string;
    email: string;
    role: MemberRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: string;
  },
): Promise<void> {
  const email = input.email.trim().toLowerCase();

  // Withdraw any live invitation for this mailbox first, so the partial unique
  // index does not reject the new one. Revoked rather than deleted: who invited
  // whom, and when, is part of how somebody got access to children's records.
  const { error: revokeError } = await db
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('centre_id', input.centreId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null);
  if (revokeError) throw new Error(`createInvitation (superseding): ${revokeError.message}`);

  const { error } = await db.from('invitations').insert({
    centre_id: input.centreId,
    email,
    role: input.role,
    token_hash: input.tokenHash,
    invited_by: input.invitedBy,
    expires_at: input.expiresAt,
  });
  if (error) throw new Error(`createInvitation: ${error.message}`);
}

export async function revokeInvitation(db: Db, invitationId: string): Promise<void> {
  const { error } = await db
    .from('invitations')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', invitationId);
  if (error) throw new Error(`revokeInvitation: ${error.message}`);
}

export type InvitationStatus = 'live' | 'unknown' | 'expired' | 'used' | 'revoked';

export interface InvitationForDisplay {
  status: InvitationStatus;
  email: string | null;
  role: MemberRole | null;
  centreName: string | null;
}

/**
 * What to show on the acceptance page, before anybody has accepted anything.
 *
 * **Service role only** — the invitee has no membership at the centre yet, so no
 * policy would let them read this.
 *
 * Returns the invited email so the page can say "sign in as this address" rather
 * than leaving somebody guessing which of their mailboxes was used. That is a
 * disclosure to whoever holds the link, which is acceptable: they were sent it, and
 * knowing the address it went to tells them nothing they could not read off the
 * email itself.
 */
export async function findInvitationForDisplay(
  serviceDb: Db,
  tokenHash: string,
): Promise<InvitationForDisplay> {
  const none: InvitationForDisplay = { status: 'unknown', email: null, role: null, centreName: null };

  // Two queries rather than a `centres(name)` embed: PostgREST types a to-one
  // relation as an array, so the embed needs a cast that reads like a mistake.
  const { data, error } = await serviceDb
    .from('invitations')
    .select('centre_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw new Error(`findInvitationForDisplay: ${error.message}`);
  if (!data) return none;

  const row = data as {
    centre_id: string;
    email: string;
    role: MemberRole;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  };

  const { data: centre } = await serviceDb
    .from('centres')
    .select('name')
    .eq('id', row.centre_id)
    .maybeSingle();

  const status: InvitationStatus = row.revoked_at
    ? 'revoked'
    : row.accepted_at
      ? 'used'
      : new Date(row.expires_at) <= new Date()
        ? 'expired'
        : 'live';

  return {
    status,
    email: row.email,
    role: row.role,
    centreName: (centre as { name: string } | null)?.name ?? null,
  };
}

export type AcceptOutcome =
  | { ok: true; centreId: string; centreName: string; role: MemberRole }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' | 'revoked' | 'wrong-email'; email?: string };

/**
 * Accept an invitation.
 *
 * **Service role only.** It has to find the invitation before the caller has any
 * membership at the centre, and then insert into `memberships`, which no other
 * credential may do.
 *
 * Three things are checked here and none of them are optional:
 *
 *  - the token hash matches something live;
 *  - the signed-in user's email is the one invited. Without this the link is a
 *    bearer token for access to children's records, and a forwarded email — or one
 *    sitting in a shared inbox — becomes a way in. The cost is that somebody who
 *    signed up under a different address has to be re-invited, which is the right
 *    way round;
 *  - it has not already been used. Marking it used and creating the membership are
 *    two statements rather than one transaction, so the update is written *first*
 *    and made conditional on the row still being unaccepted. If the membership
 *    insert then fails, the invitation is spent and must be reissued — the failure
 *    mode is an inconvenience rather than a link that works twice.
 */
export async function acceptInvitation(
  serviceDb: Db,
  input: { tokenHash: string; userId: string; userEmail: string },
): Promise<AcceptOutcome> {
  const { data, error } = await serviceDb
    .from('invitations')
    .select('id, centre_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token_hash', input.tokenHash)
    .maybeSingle();
  if (error) throw new Error(`acceptInvitation: ${error.message}`);
  if (!data) return { ok: false, reason: 'unknown' };

  const invite = data as {
    id: string;
    centre_id: string;
    email: string;
    role: MemberRole;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  };

  if (invite.revoked_at) return { ok: false, reason: 'revoked' };
  if (invite.accepted_at) return { ok: false, reason: 'used' };
  if (new Date(invite.expires_at) <= new Date()) return { ok: false, reason: 'expired' };
  if (invite.email !== input.userEmail.trim().toLowerCase()) {
    return { ok: false, reason: 'wrong-email', email: invite.email };
  }

  // Conditional on still being unaccepted, so two simultaneous clicks cannot both
  // win. `select` afterwards tells us whether this call was the one that claimed it.
  const { data: claimed, error: claimError } = await serviceDb
    .from('invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: input.userId })
    .eq('id', invite.id)
    .is('accepted_at', null)
    .select('id');
  if (claimError) throw new Error(`acceptInvitation (claiming): ${claimError.message}`);
  if (!claimed || claimed.length === 0) return { ok: false, reason: 'used' };

  // Upsert, because a revoked membership from a previous stint should be reinstated
  // rather than colliding with the unique constraint and stranding the person.
  const { error: memberError } = await serviceDb
    .from('memberships')
    .upsert(
      { centre_id: invite.centre_id, user_id: input.userId, role: invite.role, revoked_at: null },
      { onConflict: 'centre_id,user_id' },
    );
  if (memberError) throw new Error(`acceptInvitation (membership): ${memberError.message}`);

  const { data: centre } = await serviceDb
    .from('centres')
    .select('name')
    .eq('id', invite.centre_id)
    .single();

  return {
    ok: true,
    centreId: invite.centre_id,
    centreName: (centre as { name: string } | null)?.name ?? 'the centre',
    role: invite.role,
  };
}
