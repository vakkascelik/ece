/**
 * Membership queries — who may see which centre.
 *
 * As everywhere in this package, no tenant filter appears here. RLS restricts
 * `memberships` to centres the caller belongs to, and the write policy further
 * restricts changes to owners and managers. If a call here returns fewer rows
 * than expected, the answer is a missing membership, not a missing filter.
 */

import type { MemberRole } from '@ece/core';
import type { Db } from './index';

export interface MemberWithUser {
  id: string;
  centreId: string;
  userId: string;
  role: MemberRole;
  revokedAt: string | null;
  email: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  centre_id: string;
  user_id: string;
  role: MemberRole;
  revoked_at: string | null;
  created_at: string;
  member_email: string | null;
}

/**
 * The roster for one centre.
 *
 * Email comes from the `centre_members` view rather than a join, because
 * `auth.users` is not reachable from an anon-key client — Supabase keeps it out
 * of the exposed schema, and rightly so. See 0002_members_view.sql.
 */
export async function listMembers(db: Db, centreId: string): Promise<MemberWithUser[]> {
  const { data, error } = await db
    .from('centre_members')
    .select('id, centre_id, user_id, role, revoked_at, created_at, member_email')
    .eq('centre_id', centreId)
    .is('revoked_at', null)
    .order('created_at');
  if (error) throw new Error(`listMembers: ${error.message}`);

  return (data as Row[]).map((r) => ({
    id: r.id,
    centreId: r.centre_id,
    userId: r.user_id,
    role: r.role,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    email: r.member_email,
  }));
}

export async function setMemberRole(db: Db, membershipId: string, role: MemberRole): Promise<void> {
  const { error } = await db.from('memberships').update({ role }).eq('id', membershipId);
  if (error) throw new Error(`setMemberRole: ${error.message}`);
}

/**
 * Revoke rather than delete.
 *
 * A deleted membership takes with it the answer to "who had access when this
 * happened", which is exactly the question that gets asked after an incident in
 * a childcare setting. The row stays; `revoked_at` closes the access.
 */
export async function revokeMember(db: Db, membershipId: string): Promise<void> {
  const { error } = await db
    .from('memberships')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', membershipId);
  if (error) throw new Error(`revokeMember: ${error.message}`);
}

export async function countOwners(db: Db, centreId: string): Promise<number> {
  const { count, error } = await db
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('centre_id', centreId)
    .eq('role', 'owner')
    .is('revoked_at', null);
  if (error) throw new Error(`countOwners: ${error.message}`);
  return count ?? 0;
}

export async function updateCentre(
  db: Db,
  centreId: string,
  patch: { name?: string; moeServiceNumber?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.moeServiceNumber !== undefined) row.moe_service_number = patch.moeServiceNumber;
  if (Object.keys(row).length === 0) return;

  const { error } = await db.from('centres').update(row).eq('id', centreId);
  if (error) throw new Error(`updateCentre: ${error.message}`);
}
