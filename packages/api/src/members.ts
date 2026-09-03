/**
 * Membership queries — who may see which centre.
 *
 * As everywhere in this package, no tenant filter appears here. RLS restricts
 * `memberships` to centres the caller belongs to, and the write policy further
 * restricts changes to owners and managers. If a call here returns fewer rows
 * than expected, the answer is a missing membership, not a missing filter.
 */

import type { LicenceType, MemberRole, RatioSource, ServiceModel } from '@ece/core';
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

/*
 * ZERO-ROW CHECKS ON BOTH WRITERS BELOW — added 2026-09-03, item 49.
 *
 * A PostgREST UPDATE matching no rows returns `error: null`, and under RLS "matched no
 * rows" is exactly what a refusal looks like. Without the check these two report success
 * on a refusal — and these are the access-control writes: *"this person is now an
 * educator"* and *"this person no longer has access"*, said to somebody who is deciding
 * who may read children's records.
 *
 * Neither can legitimately match nothing. An UPDATE matches its row whether or not the
 * value changes, so setting a role to the value it already holds still matches, and
 * revoking an already-revoked membership still matches. Zero rows therefore means the id
 * is wrong or the policy refused — never "nothing needed doing".
 *
 * That distinction is the whole reason this is not a codemod: the superseding update in
 * `createInvitation` is *supposed* to match nothing when a mailbox has no live
 * invitation, and a check there would break it. See [[conventions]].
 */
export async function setMemberRole(db: Db, membershipId: string, role: MemberRole): Promise<void> {
  const { data, error } = await db
    .from('memberships')
    .update({ role })
    .eq('id', membershipId)
    .select('id');
  if (error) throw new Error(`setMemberRole: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'setMemberRole: nobody was updated. Either the membership id is wrong or the policy refused it.',
    );
  }
}

/**
 * Revoke rather than delete.
 *
 * A deleted membership takes with it the answer to "who had access when this
 * happened", which is exactly the question that gets asked after an incident in
 * a childcare setting. The row stays; `revoked_at` closes the access.
 */
export async function revokeMember(db: Db, membershipId: string): Promise<void> {
  const { data, error } = await db
    .from('memberships')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', membershipId)
    .select('id');
  if (error) throw new Error(`revokeMember: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'revokeMember: nobody was revoked. Either the membership id is wrong or the policy refused it.',
    );
  }
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
  patch: {
    name?: string;
    moeServiceNumber?: string | null;
    medicationRequiresWitness?: boolean;
    /**
     * `null` is a value here, not an omission: it means the centre states no sleep-check
     * interval, and the product then shows elapsed time and declines to call anything
     * overdue. `undefined` means "leave it alone". The two must not be collapsed — see
     * `sleep-checks.md`.
     */
    sleepCheckMinutes?: number | null;
    /** Same null-means-none-stated contract as the sleep interval. */
    drillIntervalDays?: number | null;
    /** Never blended and never guessed — see 0040. */
    ratioSource?: RatioSource;
    /**
     * Whether this centre permits data being sent to an external model provider.
     * Off until somebody turns it on — see 0047 and `docs/claude-api-plan.md`.
     */
    aiFeatures?: boolean;
    /** Same null-means-none-stated contract as the intervals above. See 0050. */
    licensedPlaces?: number | null;
    /**
     * The licence this service holds, and how it operates. Two fields because they are
     * two facts — see 0083 and `LICENCE_TYPES` in `@ece/core`.
     *
     * Same null-means-not-stated contract as everything above it. `undefined` leaves the
     * column alone; `null` is the centre saying it has not stated one, and nothing here
     * defaults either of them, because a guess at the service model selects a ratio
     * schedule.
     */
    licenceType?: LicenceType | null;
    serviceModel?: ServiceModel | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.moeServiceNumber !== undefined) row.moe_service_number = patch.moeServiceNumber;
  if (patch.medicationRequiresWitness !== undefined) {
    row.medication_requires_witness = patch.medicationRequiresWitness;
  }
  if (patch.sleepCheckMinutes !== undefined) row.sleep_check_minutes = patch.sleepCheckMinutes;
  if (patch.drillIntervalDays !== undefined) row.drill_interval_days = patch.drillIntervalDays;
  if (patch.ratioSource !== undefined) row.ratio_source = patch.ratioSource;
  if (patch.aiFeatures !== undefined) row.ai_features = patch.aiFeatures;
  if (patch.licensedPlaces !== undefined) row.licensed_places = patch.licensedPlaces;
  if (patch.licenceType !== undefined) row.licence_type = patch.licenceType;
  if (patch.serviceModel !== undefined) row.service_model = patch.serviceModel;
  if (Object.keys(row).length === 0) return;

  /*
    `.select('id')` is not decoration.

    An UPDATE that matches no rows is not an error in PostgREST — `error` is null and
    the call looks like a success. Under RLS "matches no rows" is the normal shape of
    a refusal, so without this a caller who may not update this centre, or a centre id
    that does not exist, gets a silent no-op and a "Saved." message.

    Added while chasing a settings-form failure that turned out to be two other things
    entirely (a test fixture holding an invalid service number, and a test racing the
    server action). So: **not** evidence that this ever silently failed in production —
    it did not, and an earlier version of this comment claiming otherwise was wrong.
    Kept because the hazard is real and free to close: nothing else in this file would
    have told the difference between "refused" and "saved".
  */
  const { data, error } = await db.from('centres').update(row).eq('id', centreId).select('id');
  if (error) throw new Error(`updateCentre: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'updateCentre: no centre was updated. Either the id is wrong or the policy refused it.',
    );
  }
}
