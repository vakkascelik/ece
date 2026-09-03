/**
 * The enrolment agreement as a recurring weekday pattern — reads and writes for `0085`.
 *
 * `child_booking_schedule` was migrated, secured, RLS-tested and left with **zero readers or
 * writers** on 2026-09-04. This is the layer that makes it reachable.
 *
 * WHAT THE TABLE IS, IN THE HANDBOOK'S WORDS
 *
 * An enrolment record is *"the formal written agreement between a parent or guardian and a service
 * that a specific child will attend that service **at specified times**"* (Glossary), and §6-1
 * requires *"the days and times each child is expected to attend, and details of any later changes
 * to the agreement signed and dated by at least one parent/guardian"*. These rows are those days
 * and times.
 *
 * It is a **contract, not a measurement**, and that is sourced rather than assumed: §6-5 claims for
 * sessions a child was *"enrolled to attend"* and §6-7 compares attendance *"against their enrolment
 * agreement"*. The measured side is `attendance_events`, and the two are compared — never
 * substituted. `unverified-claims` item 50 is the record of getting that distinction wrong on the
 * staff side, which is why it was asked before this table was cloned.
 *
 * NO TENANT FILTERING HERE, as everywhere in this package. `child_booking_schedule` has no
 * `centre_id`; the tenant is resolved through the child, by `caller_may_see_child` for reads and
 * `caller_may_enrol` for writes. That second predicate is narrower than the first on purpose: an
 * educator may read the agreement, because they run the room and need to know who is expected, and
 * must not rewrite the thing a child's absence funding is derived from.
 */

import type { WeekdayBlock } from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

const SCHEDULE_COLUMNS =
  'id, child_id, weekday, from_time, to_time, effective_from, effective_to, created_at';

interface ScheduleRow {
  id: string;
  child_id: string;
  weekday: number;
  from_time: string;
  to_time: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

/** A block with its id, which the screen needs in order to end or remove one. */
export interface BookingScheduleRow extends WeekdayBlock {
  id: string;
  childId: string;
}

const toBlock = (r: ScheduleRow): BookingScheduleRow => ({
  id: r.id,
  childId: r.child_id,
  weekday: r.weekday,
  fromTime: r.from_time,
  toTime: r.to_time,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
});

/**
 * Every block for the given children, superseded ones included.
 *
 * Paged, and **not** date-filtered in SQL — the same two reasons `listContactHours` gives. A screen
 * that lets somebody supersede an agreement has to show the history being superseded; and
 * `blocksOn` in `@ece/core` is the one written-down copy of the effective-date rule, so filtering
 * here as well would be a second copy that disagrees the first time either is changed.
 *
 * Paging is not decoration. §6-7 requires the agreement to be **changed** when a child's attendance
 * stops matching it, and every change is two rows — one closed, one opened. A child whose family
 * adjusts their days each term accumulates rows for the life of the enrolment, and a truncated read
 * would drop a weekday from a figure somebody claims funding on. `bounded-queries.test.ts` would
 * refuse this read unpaged anyway.
 */
export async function listBookingSchedule(db: Db, childIds: string[]): Promise<BookingScheduleRow[]> {
  if (childIds.length === 0) return [];
  const rows = await fetchAll<ScheduleRow>('listBookingSchedule', (from, to) =>
    db
      .from('child_booking_schedule')
      .select(SCHEDULE_COLUMNS)
      .in('child_id', childIds)
      .order('child_id')
      .order('weekday')
      .order('from_time')
      .order('id')
      .range(from, to),
  );
  return rows.map(toBlock);
}

export interface BookingScheduleInput {
  childId: string;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
  fromTime: string;
  toTime: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

/**
 * Add a block to the agreement.
 *
 * The overlap constraint refuses a block colliding with a live one on the same weekday, **including
 * one in a later period while the existing block is open-ended**, because a null `effective_to` is
 * infinity in the exclusion constraint. So changing an agreement is two calls — `endScheduleBlock`
 * then this — and the message says so, because a bare `23P01` sends somebody hunting for a
 * duplicate that does not exist. That surprised `0081`'s author and there is an RLS assertion
 * pinning it in `0085`.
 */
export async function addScheduleBlock(
  db: Db,
  input: BookingScheduleInput,
  createdBy: string | null,
): Promise<string> {
  const { data, error } = await db
    .from('child_booking_schedule')
    .insert({
      child_id: input.childId,
      weekday: input.weekday,
      from_time: input.fromTime,
      to_time: input.toTime,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo ?? null,
      created_by: createdBy,
    })
    .select('id');
  if (error) {
    if (error.code === '23P01') {
      throw new Error(
        'addScheduleBlock: these times overlap an existing block on that weekday. ' +
          'End the existing block first — an open-ended agreement covers every later date.',
      );
    }
    throw new Error(`addScheduleBlock: ${error.message}`);
  }
  const id = data?.[0]?.id;
  if (!id) {
    throw new Error('addScheduleBlock: nothing was written. The policy refused it.');
  }
  return id as string;
}

/**
 * Close an open-ended block — the first half of changing an agreement.
 *
 * §6-7 requires exactly this when attendance stops matching: *"change the child's enrolment
 * agreement to include new days and times"*. Closing rather than editing keeps the superseded
 * period answerable, which matters because a funding claim for last March was computed against the
 * agreement as it stood then.
 */
export async function endScheduleBlock(db: Db, id: string, effectiveTo: string): Promise<void> {
  const { data, error } = await db
    .from('child_booking_schedule')
    .update({ effective_to: effectiveTo })
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`endScheduleBlock: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('endScheduleBlock: nothing was updated. Either the id is wrong or the policy refused it.');
  }
}

/**
 * Remove a block outright.
 *
 * Available, unlike on the append-only ledgers, and for the reason `deleteContactHours` gives: an
 * agreement entered wrongly this morning has to be removable, because a mistaken Tuesday left in
 * place corrupts every funded-hours figure derived from it. What stays irremovable is the record of
 * what *happened* — `attendance_events` keeps its refusal.
 *
 * The screen offers this only for a block that has not been superseded; a block with an
 * `effective_to` is history and gets closed rather than deleted.
 */
export async function deleteScheduleBlock(db: Db, id: string): Promise<void> {
  const { data, error } = await db
    .from('child_booking_schedule')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`deleteScheduleBlock: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('deleteScheduleBlock: nothing was deleted. Either the id is wrong or the policy refused it.');
  }
}

/*
  NO `export { blocksOn }` here, though `census.ts` has one.

  Both modules are `export * from` in the barrel, so a second re-export of the same symbol is an
  ambiguous export — TypeScript refuses it, and the barrel is exactly where that would surface as a
  confusing error a long way from either file. A screen that needs it takes it from `@ece/core`,
  which is where it lives.
*/
