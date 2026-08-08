/**
 * Staff as people: the roster, per-person sign-in, and the link to licensing
 * evidence.
 *
 * No tenant filtering, as everywhere here. `staff_members_select` restricts the
 * roster to staff of the centre; `staff_attendance_events` reaches its centre
 * through `caller_is_staff_for_member`, which is a definer function rather than an
 * inline join for the reason `conventions.md` records.
 */

import type { StaffAttendanceEvent, StaffMember } from '@ece/core';
import { fetchAll } from './paging';
import type { RecordOutcome } from './registers';
import type { Db } from './index';

const MEMBER_COLUMNS =
  'id, centre_id, full_name, user_id, role_note, started_on, finished_on, archived_at';

interface MemberRow {
  id: string;
  centre_id: string;
  full_name: string;
  user_id: string | null;
  role_note: string | null;
  started_on: string | null;
  finished_on: string | null;
  archived_at: string | null;
}

const toMember = (r: MemberRow): StaffMember => ({
  id: r.id,
  centreId: r.centre_id,
  fullName: r.full_name,
  userId: r.user_id,
  roleNote: r.role_note,
  startedOn: r.started_on,
  finishedOn: r.finished_on,
  archivedAt: r.archived_at,
});

/**
 * The whole roster, archived people included.
 *
 * Archived rows are returned because a report about February must still be able to
 * name somebody who left in March — the same reasoning `readDayRatio` applies to
 * archived children. Callers wanting today's roster use `currentStaff` from
 * `@ece/core`.
 */
export async function listStaffMembers(db: Db, centreId: string): Promise<StaffMember[]> {
  const rows = await fetchAll<MemberRow>('listStaffMembers', (a, b) =>
    db
      .from('staff_members')
      .select(MEMBER_COLUMNS)
      .eq('centre_id', centreId)
      .order('full_name')
      .range(a, b),
  );
  return rows.map(toMember);
}

export async function createStaffMember(
  db: Db,
  input: {
    centreId: string;
    fullName: string;
    userId?: string | null;
    roleNote?: string | null;
    startedOn?: string | null;
  },
): Promise<StaffMember> {
  const { data, error } = await db
    .from('staff_members')
    .insert({
      centre_id: input.centreId,
      full_name: input.fullName.trim(),
      // Explicit null rather than omitted: a reliever with no account is the common
      // case, and `unique (centre_id, user_id)` does not collide NULLs.
      user_id: input.userId ?? null,
      role_note: input.roleNote?.trim() || null,
      started_on: input.startedOn || null,
    })
    .select(MEMBER_COLUMNS)
    .single();
  if (error) throw new Error(`createStaffMember: ${error.message}`);
  return toMember(data as MemberRow);
}

export async function updateStaffMember(
  db: Db,
  id: string,
  patch: {
    fullName?: string;
    userId?: string | null;
    roleNote?: string | null;
    startedOn?: string | null;
    finishedOn?: string | null;
    archivedAt?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName.trim();
  if (patch.userId !== undefined) row.user_id = patch.userId;
  if (patch.roleNote !== undefined) row.role_note = patch.roleNote?.trim() || null;
  if (patch.startedOn !== undefined) row.started_on = patch.startedOn || null;
  if (patch.finishedOn !== undefined) row.finished_on = patch.finishedOn || null;
  if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
  if (Object.keys(row).length === 0) return;

  // Zero-row check, for the reason recorded on `updateCentre`: under RLS, "matched
  // nothing" is what a refusal looks like and PostgREST reports it as success.
  const { data, error } = await db.from('staff_members').update(row).eq('id', id).select('id');
  if (error) throw new Error(`updateStaffMember: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('updateStaffMember: nobody was updated. Either the id is wrong or the policy refused it.');
  }
}

/**
 * Link a staff record to the person it is about.
 *
 * The human act 0038 exists to require. No migration does this, because matching on
 * `person_name` merges two relievers who share a first name and attaches a police
 * vetting result to the wrong person. Passing `null` unlinks, which is the escape
 * hatch for having linked the wrong one.
 */
export async function linkStaffRecord(
  db: Db,
  recordId: string,
  staffMemberId: string | null,
): Promise<void> {
  const { data, error } = await db
    .from('staff_records')
    .update({ staff_member_id: staffMemberId })
    .eq('id', recordId)
    .select('id');
  if (error) throw new Error(`linkStaffRecord: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('linkStaffRecord: no record was updated. Either the id is wrong or the policy refused it.');
  }
}

// ---------------------------------------------------------------------------
// Per-person attendance
// ---------------------------------------------------------------------------

const EVENT_COLUMNS = 'id, staff_member_id, kind, at, recorded_by, corrects, note';

interface EventRow {
  id: number;
  staff_member_id: string;
  kind: 'in' | 'out';
  at: string;
  recorded_by: string | null;
  corrects: number | null;
  note: string | null;
}

const toEvent = (r: EventRow): StaffAttendanceEvent => ({
  id: r.id,
  staffMemberId: r.staff_member_id,
  kind: r.kind,
  at: r.at,
  recordedBy: r.recorded_by,
  corrects: r.corrects,
  note: r.note,
});

/**
 * Staff attendance in a window.
 *
 * Reached through `staff_members` so the centre filter is expressible at all — the
 * events table has no `centre_id`, deliberately, because a person belongs to a
 * centre and their events belong to the person.
 */
export async function listStaffAttendance(
  db: Db,
  centreId: string,
  fromUtc: string,
  toUtc: string,
): Promise<StaffAttendanceEvent[]> {
  const rows = await fetchAll<EventRow>('listStaffAttendance', (a, b) =>
    db
      .from('staff_attendance_events')
      .select(`${EVENT_COLUMNS}, staff_members!inner(centre_id)`)
      .eq('staff_members.centre_id', centreId)
      .gte('at', fromUtc)
      .lte('at', toUtc)
      .order('at')
      .range(a, b),
  );
  return rows.map(toEvent);
}

/** Same idempotency contract as every other event write in this schema. */
export async function recordStaffAttendance(
  db: Db,
  input: {
    staffMemberId: string;
    kind: 'in' | 'out';
    at: string;
    clientUuid: string;
    corrects?: number | null;
    note?: string | null;
  },
): Promise<{ outcome: RecordOutcome }> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('staff_attendance_events')
    .upsert(
      {
        staff_member_id: input.staffMemberId,
        kind: input.kind,
        at: input.at,
        recorded_by: auth.user?.id ?? null,
        client_uuid: input.clientUuid,
        corrects: input.corrects ?? null,
        note: input.note?.trim() || null,
      },
      { onConflict: 'client_uuid', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw new Error(`recordStaffAttendance: ${error.message}`);
  return { outcome: (data ?? []).length === 0 ? 'duplicate' : 'recorded' };
}
