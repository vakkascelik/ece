'use server';

import { revalidatePath } from 'next/cache';
import {
  countOwners,
  createInvitation,
  listMembers,
  revokeInvitation,
  revokeMember,
  setMemberRole,
} from '@ece/api';
import { MEMBER_ROLES, type MemberRole } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { hashInviteToken, inviteExpiry, newInviteToken } from '@/lib/inviteToken';
import { publicAppBase } from '@/lib/origin';
import { serverDb } from '@/lib/supabase';

/** The link is returned once and never stored — see `invite` below. */
export type InviteResult = { error: string } | { ok: true; email: string; link: string };

/**
 * Roster changes.
 *
 * Every action re-derives the caller's context rather than trusting anything in
 * the form, and every membership id is checked to belong to the caller's own
 * centre before it is touched. RLS enforces this too — the write policy carries
 * both USING and WITH CHECK — but a server action that acts on an unverified id
 * is a habit that outlives whichever table still has good policies.
 */

async function ownMembership(centreId: string, membershipId: string) {
  const db = await serverDb();
  const members = await listMembers(db, centreId);
  return members.find((m) => m.id === membershipId) ?? null;
}

export async function changeRole(_prev: unknown, form: FormData) {
  const ctx = await requireCapability('manageMembers');
  const membershipId = String(form.get('membershipId') ?? '');
  const role = String(form.get('role') ?? '') as MemberRole;

  if (!MEMBER_ROLES.includes(role)) return { error: 'Unknown role.' };

  const target = await ownMembership(ctx.centre.id, membershipId);
  if (!target) return { error: 'That person is not at this centre.' };

  // Demoting the last owner leaves a centre nobody can administer — including
  // nobody who can promote a replacement. The centre becomes unreachable
  // through the app and needs service-role intervention to recover.
  if (target.role === 'owner' && role !== 'owner') {
    const db = await serverDb();
    if ((await countOwners(db, ctx.centre.id)) <= 1) {
      return { error: 'This is the only owner. Add another owner before changing this one.' };
    }
  }

  const db = await serverDb();
  await setMemberRole(db, membershipId, role);
  revalidatePath('/members');
  return { ok: true };
}

export async function revoke(_prev: unknown, form: FormData) {
  const ctx = await requireCapability('manageMembers');
  const membershipId = String(form.get('membershipId') ?? '');

  const target = await ownMembership(ctx.centre.id, membershipId);
  if (!target) return { error: 'That person is not at this centre.' };

  // Same trap as demotion, plus the self-lockout case: revoking your own only-
  // owner access logs you out of a centre you can no longer get back into.
  if (target.role === 'owner') {
    const db = await serverDb();
    if ((await countOwners(db, ctx.centre.id)) <= 1) {
      return { error: 'This is the only owner. Add another owner first.' };
    }
  }

  const db = await serverDb();
  await revokeMember(db, membershipId);
  revalidatePath('/members');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * Issue an invitation and return the link.
 *
 * The raw token is generated here, hashed for storage, and returned to the caller
 * exactly once — it is never persisted and cannot be recovered. Losing the link
 * means issuing another, which is the correct trade for not keeping usable tokens
 * in a database.
 *
 * No email is sent, because this project has no mailer configured. The link is
 * shown to the manager to pass on however they already talk to their staff, which
 * is honest about what the system actually does rather than claiming to have sent
 * something. Wiring a mailer changes only this function.
 */
export async function invite(_prev: unknown, form: FormData): Promise<InviteResult> {
  const ctx = await requireCapability('manageMembers');
  const db = await serverDb();

  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const role = String(form.get('role') ?? '') as MemberRole;

  if (!email.includes('@') || email.length < 5) return { error: 'That is not an email address.' };
  if (!MEMBER_ROLES.includes(role)) return { error: 'Unknown role.' };

  // Inviting a second owner is legitimate — a two-site operator usually has two —
  // but it is not something to do by accident, so it is spelled out rather than
  // sitting quietly in a dropdown.
  const members = await listMembers(db, ctx.centre.id);
  if (members.some((m) => m.email?.toLowerCase() === email)) {
    return { error: 'They are already at this centre.' };
  }

  const token = newInviteToken();
  try {
    await createInvitation(db, {
      centreId: ctx.centre.id,
      email,
      role,
      tokenHash: hashInviteToken(token),
      invitedBy: ctx.userId,
      expiresAt: inviteExpiry(),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create the invitation.' };
  }

  revalidatePath('/members');
  /*
   * `publicAppBase()`, not `originOf()`. This link is read off a screen and pasted into a message to
   * a kaiako or a parent, so it has to be the address the world can reach — which under the `/portal`
   * mount means carrying the prefix, and behind the proxy means coming from configuration rather than
   * from a header the proxy has already overwritten. Without it the invitation pointed at
   * `…/invite/<token>` with no `/portal`, which is the marketing site's 404.
   */
  return { ok: true, email, link: `${await publicAppBase()}/invite/${token}` };
}

export async function withdrawInvite(_prev: unknown, form: FormData) {
  await requireCapability('manageMembers');
  const id = String(form.get('invitationId') ?? '');
  if (!id) return { error: 'Missing invitation.' };
  const db = await serverDb();
  try {
    await revokeInvitation(db, id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not withdraw it.' };
  }
  revalidatePath('/members');
  return { ok: true as const };
}
