'use server';

import { revalidatePath } from 'next/cache';
import { countOwners, listMembers, revokeMember, setMemberRole } from '@ece/api';
import { MEMBER_ROLES, type MemberRole } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

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
