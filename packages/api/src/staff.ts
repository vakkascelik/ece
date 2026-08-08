/**
 * Staff as people: the roster, per-person sign-in, and the link to licensing
 * evidence.
 *
 * No tenant filtering, as everywhere here. `staff_members_select` restricts the
 * roster to staff of the centre; `staff_attendance_events` reaches its centre
 * through `caller_is_staff_for_member`, which is a definer function rather than an
 * inline join for the reason `conventions.md` records.
 */

import {
  forecastDay,
  type DayForecast,
  type ForecastBooking,
  type RatioTable,
  type StaffAttendanceEvent,
  type StaffMember,
} from '@ece/core';
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

// ---------------------------------------------------------------------------
// The planned roster (0041)
// ---------------------------------------------------------------------------

export type ShiftStatus = 'planned' | 'confirmed' | 'cancelled';

export interface Shift {
  id: string;
  staffMemberId: string;
  onDate: string;
  fromTime: string;
  toTime: string;
  roleNote: string | null;
  status: ShiftStatus;
}

const SHIFT_COLUMNS = 'id, staff_member_id, on_date, from_time, to_time, role_note, status';

interface ShiftRow {
  id: string;
  staff_member_id: string;
  on_date: string;
  from_time: string;
  to_time: string;
  role_note: string | null;
  status: ShiftStatus;
}

const toShift = (r: ShiftRow): Shift => ({
  id: r.id,
  staffMemberId: r.staff_member_id,
  onDate: r.on_date,
  fromTime: r.from_time,
  toTime: r.to_time,
  roleNote: r.role_note,
  status: r.status,
});

/**
 * Shifts in a date range.
 *
 * Same join shape as `listStaffAttendance`, and for the same reason: `shifts` has no
 * `centre_id`, because a person belongs to a centre and their shifts belong to the
 * person.
 *
 * Cancelled shifts are returned. A roster that hides them cannot show that Tuesday's
 * cover was withdrawn, which is the state somebody most needs to see; `forecastDay`
 * drops them from the arithmetic.
 */
export async function listShifts(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<Shift[]> {
  const rows = await fetchAll<ShiftRow>('listShifts', (a, b) =>
    db
      .from('shifts')
      .select(`${SHIFT_COLUMNS}, staff_members!inner(centre_id)`)
      .eq('staff_members.centre_id', centreId)
      .gte('on_date', from)
      .lte('on_date', to)
      .order('on_date')
      .order('from_time')
      // `id` joins the ordering because two shifts share a date and a start time by
      // definition — the lesson `listBookings` records, where paging over a non-unique
      // order repeated one row and skipped another.
      .order('id')
      .range(a, b),
  );
  return rows.map(toShift);
}

export async function createShift(
  db: Db,
  input: {
    staffMemberId: string;
    onDate: string;
    fromTime: string;
    toTime: string;
    roleNote?: string | null;
    status?: ShiftStatus;
  },
): Promise<Shift> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('shifts')
    .insert({
      staff_member_id: input.staffMemberId,
      on_date: input.onDate,
      from_time: input.fromTime,
      to_time: input.toTime,
      role_note: input.roleNote?.trim() || null,
      status: input.status ?? 'planned',
      created_by: auth.user?.id ?? null,
    })
    .select(SHIFT_COLUMNS)
    .single();
  if (error) throw new Error(`createShift: ${error.message}`);
  return toShift(data as ShiftRow);
}

/**
 * Change a shift's status. There is no delete, by design — see 0041.
 *
 * Cancelling is the operation that looks like deleting and is not: the row stays, so
 * the roster can show that cover was withdrawn, and the exclusion constraint stops
 * counting it so the replacement can be booked.
 */
export async function setShiftStatus(db: Db, id: string, status: ShiftStatus): Promise<void> {
  const { data, error } = await db.from('shifts').update({ status }).eq('id', id).select('id');
  if (error) throw new Error(`setShiftStatus: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('setShiftStatus: no shift was updated. Either the id is wrong or the policy refused it.');
  }
}

export type LeaveKind = 'annual' | 'sick' | 'unpaid' | 'other';
export type LeaveStatus = 'requested' | 'approved' | 'declined';

export interface StaffLeave {
  id: string;
  staffMemberId: string;
  fromDate: string;
  toDate: string;
  kind: LeaveKind;
  status: LeaveStatus;
  note: string | null;
}

const LEAVE_COLUMNS = 'id, staff_member_id, from_date, to_date, kind, status, note';

interface LeaveRow {
  id: string;
  staff_member_id: string;
  from_date: string;
  to_date: string;
  kind: LeaveKind;
  status: LeaveStatus;
  note: string | null;
}

const toLeave = (r: LeaveRow): StaffLeave => ({
  id: r.id,
  staffMemberId: r.staff_member_id,
  fromDate: r.from_date,
  toDate: r.to_date,
  kind: r.kind,
  status: r.status,
  note: r.note,
});

/**
 * Leave overlapping a window.
 *
 * Overlap, not containment: leave running from the week before to the week after
 * covers every day in between, and a `gte(from_date)` filter would miss it entirely —
 * which would put an adult on the forecast who is in another country.
 */
export async function listLeave(
  db: Db,
  centreId: string,
  from: string,
  to: string,
): Promise<StaffLeave[]> {
  const rows = await fetchAll<LeaveRow>('listLeave', (a, b) =>
    db
      .from('staff_leave')
      .select(`${LEAVE_COLUMNS}, staff_members!inner(centre_id)`)
      .eq('staff_members.centre_id', centreId)
      .lte('from_date', to)
      .gte('to_date', from)
      .order('from_date')
      .order('id')
      .range(a, b),
  );
  return rows.map(toLeave);
}

export async function recordLeave(
  db: Db,
  input: {
    staffMemberId: string;
    fromDate: string;
    toDate: string;
    kind: LeaveKind;
    status?: LeaveStatus;
    note?: string | null;
  },
): Promise<StaffLeave> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('staff_leave')
    .insert({
      staff_member_id: input.staffMemberId,
      from_date: input.fromDate,
      to_date: input.toDate,
      kind: input.kind,
      status: input.status ?? 'requested',
      note: input.note?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(LEAVE_COLUMNS)
    .single();
  if (error) throw new Error(`recordLeave: ${error.message}`);
  return toLeave(data as LeaveRow);
}

export async function setLeaveStatus(db: Db, id: string, status: LeaveStatus): Promise<void> {
  const { data, error } = await db.from('staff_leave').update({ status }).eq('id', id).select('id');
  if (error) throw new Error(`setLeaveStatus: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error('setLeaveStatus: no leave was updated. Either the id is wrong or the policy refused it.');
  }
}

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

/**
 * The planned ratio for each of a run of days.
 *
 * A range and not a single day, because the screen shows a week and the per-day version
 * of this made **thirty-one** queries to answer what four answer: one set of bookings,
 * shifts, leave and children covers the whole period, and `forecastDay` is pure, so the
 * split is a filter rather than a fetch.
 *
 * Every judgement — which bookings count, which leave removes an adult, how a day is cut
 * into segments — is in `@ece/core` and tested there. This fetches four things.
 *
 * **It does not read attendance, and must not.** A forecast is about days that have not
 * happened. Mixing in what actually occurred would produce a figure whose provenance
 * nobody could state, which is the same mistake 0040 forbids for the adult count.
 */
export async function readForecast(
  db: Db,
  input: {
    centreId: string;
    dates: string[];
    underTwoTable?: RatioTable;
    twoAndOverTable?: RatioTable;
  },
): Promise<DayForecast[]> {
  if (input.dates.length === 0) return [];
  const sorted = [...input.dates].sort();
  const from = sorted[0] as string;
  const to = sorted[sorted.length - 1] as string;

  interface BookingRow {
    child_id: string;
    on_date: string;
    status: 'booked' | 'absent' | 'cancelled' | 'closed';
    from_time: string | null;
    to_time: string | null;
  }

  const [bookings, shifts, leave, children] = await Promise.all([
    /*
      Paged, unlike the day-scoped reads in `compliance.ts`. A week of bookings is the
      roll times seven, and a 150-child service crosses PostgREST's 1000-row cap in a
      fortnight — at which point the forecast would silently lose the last days of the
      period and report them as quiet.
    */
    fetchAll<BookingRow>('readForecast', (a, b) =>
      db
        .from('bookings')
        .select('child_id, on_date, status, from_time, to_time')
        .eq('centre_id', input.centreId)
        .gte('on_date', from)
        .lte('on_date', to)
        .order('on_date')
        .order('child_id')
        .range(a, b),
    ),
    listShifts(db, input.centreId, from, to),
    listLeave(db, input.centreId, from, to),
    // Archived children included, as in `readDayRatio`. A child archived this morning
    // may still hold a booking for Thursday, and dropping them would understate the
    // roll — which is the direction that flatters the forecast.
    db.from('children').select('id, date_of_birth').eq('centre_id', input.centreId),
  ]);

  if (children.error) throw new Error(`readForecast (children): ${children.error.message}`);

  const roll = (children.data ?? []).map((c) => ({
    id: c.id as string,
    dateOfBirth: c.date_of_birth as string,
  }));

  const bookingsByDate = new Map<string, ForecastBooking[]>();
  for (const b of bookings) {
    const day = bookingsByDate.get(b.on_date) ?? [];
    day.push({
      childId: b.child_id,
      status: b.status,
      fromTime: b.from_time,
      toTime: b.to_time,
    });
    bookingsByDate.set(b.on_date, day);
  }

  return input.dates.map((date) =>
    forecastDay({
      date,
      bookings: bookingsByDate.get(date) ?? [],
      // Shifts have to be split here because a `ForecastShift` carries no date — the
      // module works in one day's local clock and nothing else. Leave is passed whole:
      // `forecastDay` already decides which leave covers the date, and doing it twice
      // would be the same rule in two places, disagreeing eventually.
      shifts: shifts.filter((s) => s.onDate === date),
      leave,
      children: roll,
      ...(input.underTwoTable ? { underTwoTable: input.underTwoTable } : {}),
      ...(input.twoAndOverTable ? { twoAndOverTable: input.twoAndOverTable } : {}),
    }),
  );
}
