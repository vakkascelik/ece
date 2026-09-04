/**
 * Service closures — reads and writes for `0088`.
 *
 * TENANT-SCOPED THROUGH `centre_id` AND NOT FILTERED HERE, as everywhere in this package.
 * `caller_centre_ids()` decides who reads — every member of the centre, parents included —
 * and `caller_has_role(centre_id, owner|manager)` decides who writes. The read is wider than
 * almost anything else in this package on purpose: a family needs to know the centre is shut
 * next Thursday.
 *
 * `centreId` IS STILL PASSED IN, and that is not tenant filtering doing the security work. It
 * is there because an owner belongs to more than one centre — the operator with two sites is
 * the case `caller_centre_ids()` returns a set for — and a query without it would return both
 * sites' closures onto one screen. The policy stops another operator's data; the argument
 * picks which of *your own* centres you are looking at.
 */

import type { ServiceClosure } from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

const CLOSURE_COLUMNS = 'id, centre_id, starts_on, ends_on, reason_code, reason_note';

interface ClosureRow {
  id: string;
  centre_id: string;
  starts_on: string;
  ends_on: string | null;
  reason_code: string | null;
  reason_note: string | null;
}

const toClosure = (r: ClosureRow): ServiceClosure => ({
  id: r.id,
  centreId: r.centre_id,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  reasonCode: r.reason_code,
  reasonNote: r.reason_note,
});

/**
 * Every closure for a centre, newest first.
 *
 * Paged, and the row count here is genuinely unbounded: a service that records its public
 * holidays keeps eleven or so a year plus term breaks, and these rows are never archived
 * because a funding claim for 2027 has to stay answerable from them. Twenty years of a
 * diligent centre is past PostgREST's cap, and the truncation would silently *shorten* a
 * suspension under §6-6.
 *
 * NOT DATE-FILTERED IN SQL. The screen shows history, §6-6 needs a window that straddles
 * whatever period is being assessed, and `isClosedOn` in `@ece/core` is the one written-down
 * copy of the covers-a-date rule — a second copy in a `.gte()` here would disagree with it the
 * first time either changed.
 */
export async function listServiceClosures(db: Db, centreId: string): Promise<ServiceClosure[]> {
  const rows = await fetchAll<ClosureRow>('listServiceClosures', (from, to) =>
    db
      .from('service_closures')
      .select(CLOSURE_COLUMNS)
      .eq('centre_id', centreId)
      .order('starts_on', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toClosure);
}

export interface ServiceClosureInput {
  centreId: string;
  startsOn: string;
  /** Null or omitted means closed with no stated end. */
  endsOn?: string | null;
  reasonCode?: string | null;
  reasonNote?: string | null;
}

/**
 * Record a closure.
 *
 * The `23P01` translation is the one that earns its place. An open-ended closure covers every
 * later date — `coalesce(ends_on, 'infinity')` in the exclusion constraint — so while a flood
 * closure sits open, *every* attempt to record next term's holidays collides with it. A bare
 * "conflicting key value violates exclusion constraint" sends somebody hunting for a duplicate
 * that does not exist, which is exactly what happened to `0081`'s author and is why `0085`
 * carries the same translation.
 */
export async function addServiceClosure(
  db: Db,
  input: ServiceClosureInput,
  recordedBy: string | null,
): Promise<string> {
  const { data, error } = await db
    .from('service_closures')
    .insert({
      centre_id: input.centreId,
      starts_on: input.startsOn,
      ends_on: input.endsOn ?? null,
      reason_code: input.reasonCode?.trim() || null,
      reason_note: input.reasonNote?.trim() || null,
      recorded_by: recordedBy,
    })
    .select('id');
  if (error) {
    if (error.code === '23P01') {
      throw new Error(
        'addServiceClosure: those dates overlap a closure already recorded. ' +
          'If one of them has no end date, give it one first — a closure with no end covers every later date.',
      );
    }
    throw new Error(`addServiceClosure: ${error.message}`);
  }
  const id = data?.[0]?.id;
  if (!id) {
    throw new Error('addServiceClosure: nothing was written. The policy refused it.');
  }
  return id as string;
}

/**
 * Give an open closure an end date — the service reopened.
 *
 * The gesture this exists for is the flood: closed on Tuesday, nobody knew for how long, and
 * three weeks later the centre reopens. Without it the only way to close that record would be
 * to delete and re-enter it, which loses the audit row saying when the original was made.
 *
 * Deliberately narrow — it sets only the end date. A closure whose *start* is wrong is a
 * different mistake, and the honest fix is to remove it and record the right one, because a
 * start date that moves changes which days were funded.
 */
export async function endServiceClosure(db: Db, id: string, endsOn: string): Promise<void> {
  const { data, error } = await db
    .from('service_closures')
    .update({ ends_on: endsOn })
    .eq('id', id)
    .select('id');
  if (error) {
    if (error.code === '23514') {
      throw new Error(
        'endServiceClosure: that end date is before the closure started.',
      );
    }
    throw new Error(`endServiceClosure: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(
      'endServiceClosure: nothing was updated. Either the id is wrong or the policy refused it.',
    );
  }
}

/**
 * Remove a closure.
 *
 * Available, unlike on the append-only ledgers, and for the reason `deleteScheduleBlock`
 * gives: a closure entered against the wrong week corrupts every funded-days figure derived
 * from it, so it has to be removable. What stays irremovable is the record of what *happened*
 * — attendance keeps its refusal.
 */
export async function deleteServiceClosure(db: Db, id: string): Promise<void> {
  const { data, error } = await db
    .from('service_closures')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`deleteServiceClosure: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'deleteServiceClosure: nothing was deleted. Either the id is wrong or the policy refused it.',
    );
  }
}
