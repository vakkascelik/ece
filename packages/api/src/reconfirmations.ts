import type { EnrolmentReconfirmation, ReconfirmationOutcome } from '@ece/core';

import { fetchAll } from './paging';
import type { Db } from './index';

/**
 * §6-7 enrolment reconfirmations — `enrolment_reconfirmations` (0092).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SECOND TABLE FOUND WITH NO WRITE PATH
 *
 * `readFundingPeriod` has read this since 2026-09-04 to decide whether a third month of a
 * frequent-absence pattern may be claimed. **Nothing could write it** until 2026-09-05, so a third
 * month was never unlocked and the product under-claimed for every service that had done the
 * paperwork. Found by AST50's data-source mapping table, whose middle column asks *where is this
 * editable*. `absence_exemptions` and `staff_off_floor` were in the same state.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT §6-7 ACTUALLY ASKS FOR
 *
 * *"Signed, dated confirmation from parents/guardians either affirming the agreement remains valid
 * or documenting revised attendance days/times."*
 *
 * A dated act by a **named person**, which is why `guardian_id` is `not null` and why this is a
 * table rather than a boolean on the enrolment. A stored `reconfirmed` flag could not say who, or
 * when, or which of the two things they said — and month four asks whether the agreement was
 * *changed*, which only the outcome answers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REPEATS ARE ALLOWED, AND THAT IS THE DIVERGENCE FROM EVERY OTHER DATED TABLE HERE
 *
 * `absence_exemptions`, `service_closures` and `child_booking_schedule` all refuse overlapping
 * periods. This one must not: §6-7 expects a persisting pattern to be reconfirmed **again**, and an
 * exclusion constraint copied out of habit would have refused exactly what the rule asks for.
 * `0092` carries only `er_one_per_day` — one per agreement per day, because two on one date is a
 * double submission rather than two confirmations.
 */

const COLUMNS =
  'id, enrolment_id, guardian_id, confirmed_on, outcome, method, detail, guardians(full_name)';

interface ReconfirmationRow {
  id: string;
  enrolment_id: string;
  guardian_id: string;
  confirmed_on: string;
  outcome: string;
  method: string;
  detail: string | null;
  guardians: { full_name: string } | { full_name: string }[] | null;
}

const nameOf = (r: ReconfirmationRow): string | null => {
  // PostgREST returns an embedded to-one as an object, and some client versions as a
  // single-element array. Both are handled rather than assumed, because the difference shows up
  // as a blank name on a screen rather than as an error.
  const g = Array.isArray(r.guardians) ? r.guardians[0] : r.guardians;
  return g?.full_name ?? null;
};

const toReconfirmation = (r: ReconfirmationRow): EnrolmentReconfirmation => ({
  id: r.id,
  enrolmentId: r.enrolment_id,
  guardianId: r.guardian_id,
  guardianName: nameOf(r),
  confirmedOn: r.confirmed_on,
  outcome: r.outcome as ReconfirmationOutcome,
  method: r.method as EnrolmentReconfirmation['method'],
  detail: r.detail,
});

/**
 * Every reconfirmation for a child's enrolments, newest first.
 *
 * Paged, and history is kept rather than filtered: §6-7's timeline is about a run of months, and
 * the reconfirmation that unlocked last March is what explains a claim somebody may be asked
 * about a year later.
 */
export async function listReconfirmationsForChild(
  db: Db,
  childId: string,
): Promise<EnrolmentReconfirmation[]> {
  const rows = await fetchAll<ReconfirmationRow>('listReconfirmationsForChild', (from, to) =>
    db
      .from('enrolment_reconfirmations')
      .select(`${COLUMNS}, enrolments!inner(child_id)`)
      .eq('enrolments.child_id', childId)
      .order('confirmed_on', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toReconfirmation);
}

export interface ReconfirmationInput {
  enrolmentId: string;
  guardianId: string;
  confirmedOn: string;
  outcome: ReconfirmationOutcome;
  method: 'portal' | 'kiosk' | 'paper';
  detail?: string | null;
}

/**
 * Record a reconfirmation.
 *
 * `assert_signatories_are_guardians` (0087) fires on `guardian_id` and raises `23514` if the
 * person is not a current guardian of that child — a database check rather than a TypeScript one,
 * because the form's dropdown can be stale and the claim rests on who actually confirmed.
 */
export async function addReconfirmation(
  db: Db,
  input: ReconfirmationInput,
): Promise<EnrolmentReconfirmation> {
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from('enrolment_reconfirmations')
    .insert({
      enrolment_id: input.enrolmentId,
      guardian_id: input.guardianId,
      confirmed_on: input.confirmedOn,
      outcome: input.outcome,
      method: input.method,
      detail: input.detail?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (/er_revision_explained/.test(error.message)) {
      throw new Error(
        'addReconfirmation: a revised agreement has to say what changed — "the agreement changed" with no note is not something a service could answer an audit with.',
      );
    }
    if (/er_one_per_day/.test(error.message)) {
      throw new Error(
        'addReconfirmation: this agreement already has a reconfirmation on that date. §6-7 expects a pattern to be reconfirmed again later, but twice on one day is a double submission.',
      );
    }
    if (/is not a current guardian of this child/.test(error.message)) {
      throw new Error(
        'addReconfirmation: that person is not a current guardian of this child. §6-7 wants the confirmation from a parent or guardian.',
      );
    }
    throw new Error(`addReconfirmation: ${error.message}`);
  }
  return toReconfirmation(data as ReconfirmationRow);
}

/**
 * Remove one.
 *
 * Deletable, matching `0092`'s policies. A reconfirmation recorded against the wrong agreement
 * unlocks a month's claim that should not be unlocked, so it has to be removable — and the audit
 * trail keeps the record of it having existed.
 */
export async function deleteReconfirmation(db: Db, id: string): Promise<void> {
  const { error } = await db.from('enrolment_reconfirmations').delete().eq('id', id);
  if (error) throw new Error(`deleteReconfirmation: ${error.message}`);
}
