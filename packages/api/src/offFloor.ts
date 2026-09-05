import type { OffFloorInterval } from '@ece/core';

import { fetchAll } from './paging';
import type { Db } from './index';

/**
 * Off-floor intervals — `staff_off_floor` (0094).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THIRD TABLE FOUND WITH NO WRITE PATH
 *
 * `readRs7Return` has read this since 2026-09-05 for §9-4's staff hours, and
 * `adults_present_now` has subtracted it from the live ratio since `0095`. **Nothing could
 * write it**, so nothing was ever subtracted: counted hours equalled hours present, and an adult
 * at lunch went on counting towards the ratio exactly as the caveat said they did.
 *
 * Found by AST50's data-source mapping table, whose middle column asks *where is this editable*.
 * `absence_exemptions` and `enrolment_reconfirmations` were in the same state.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT SUBTRACTS FROM TWO DIFFERENT THINGS
 *
 * §9-4's funding figure, and the ratio on the wall. That is unusual here — most tables feed one
 * or the other — and it is why the panel warns that recording an interval lowers a live
 * compliance figure as well as a claim.
 */

const COLUMNS = 'id, staff_member_id, on_date, from_time, to_time, reason';

interface OffFloorRow {
  id: string;
  staff_member_id: string;
  on_date: string;
  from_time: string;
  to_time: string;
  reason: string | null;
}

/** An interval with the id an editor needs, which `OffFloorInterval` deliberately lacks. */
export interface OffFloorRecord extends OffFloorInterval {
  id: string;
  reason: string | null;
}

const toRecord = (r: OffFloorRow): OffFloorRecord => ({
  id: r.id,
  staffMemberId: r.staff_member_id,
  onDate: r.on_date,
  fromTime: r.from_time,
  toTime: r.to_time,
  reason: r.reason,
});

/**
 * Intervals for a centre over a date range.
 *
 * Joined through `staff_members` because the table has no `centre_id` of its own — a person
 * belongs to a centre and their intervals belong to the person. Paged: twenty staff taking one
 * break each is twenty rows a day, and a truncated read would report **more** counted staff hours
 * than the service worked, which is the direction that over-claims.
 */
export async function listOffFloorIntervals(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<OffFloorRecord[]> {
  const rows = await fetchAll<OffFloorRow>('listOffFloorIntervals', (a, b) =>
    db
      .from('staff_off_floor')
      .select(`${COLUMNS}, staff_members!inner(centre_id)`)
      .eq('staff_members.centre_id', centreId)
      .gte('on_date', from)
      .lte('on_date', to)
      .order('on_date')
      .order('from_time')
      .range(a, b),
  );
  return rows.map(toRecord);
}

export interface OffFloorInput {
  staffMemberId: string;
  onDate: string;
  fromTime: string;
  toTime: string;
  reason?: string | null;
}

/**
 * Record that somebody was off the floor.
 *
 * The exclusion constraint is the one worth translating: two overlapping intervals would each
 * subtract their own overlap, so the same half hour would come off a staff-hour figure twice.
 * `0094` refuses it, and a bare `23P01` sends somebody hunting for a duplicate that does not
 * exist — which is the surprise `0081`'s author recorded and `0085` has an assertion pinning.
 */
export async function addOffFloorInterval(
  db: Db,
  input: OffFloorInput,
): Promise<OffFloorRecord> {
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from('staff_off_floor')
    .insert({
      staff_member_id: input.staffMemberId,
      on_date: input.onDate,
      from_time: input.fromTime,
      to_time: input.toTime,
      reason: input.reason?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (/staff_off_floor_no_overlap/.test(error.message)) {
      throw new Error(
        'addOffFloorInterval: this person already has an overlapping interval that day. Two would each subtract their own overlap, so the same half hour would come off twice.',
      );
    }
    if (/staff_off_floor_times_ordered/.test(error.message)) {
      throw new Error('addOffFloorInterval: the interval cannot end before it starts.');
    }
    throw new Error(`addOffFloorInterval: ${error.message}`);
  }
  return toRecord(data as OffFloorRow);
}

/** Remove one. Recorded against the wrong person, it removes hours somebody actually worked. */
export async function deleteOffFloorInterval(db: Db, id: string): Promise<void> {
  const { error } = await db.from('staff_off_floor').delete().eq('id', id);
  if (error) throw new Error(`deleteOffFloorInterval: ${error.message}`);
}
