/**
 * The door tablet, and the office screen that issues its PINs.
 *
 * Every function here is a thin wrapper over a `SECURITY DEFINER` function from 0044.
 * That is the whole design: a kiosk has no table grants at all, so there is nothing
 * for this module to select from and no query for a future reader to widen. What a
 * device can learn is the `returns table` clause in the migration, and what it can do
 * is `kiosk_sign_child`.
 *
 * WHY THE SIGN RESULT IS A UNION AND NOT A STRING
 *
 * `kiosk_sign_child` returns a status rather than raising, because raising would roll
 * back the failed-attempt counter and the lockout would never engage — the reasoning
 * is in 0044's header. That means a wrong PIN arrives here as a *successful* call, and
 * a caller who treats a resolved promise as "it worked" would sign a child in on a
 * wrong PIN. Modelling it as a discriminated union makes ignoring the outcome a type
 * error rather than a judgement call, the same reasoning `RecordResult` records in
 * `attendance.ts`.
 */

import type { Db } from './index';

export interface KioskChild {
  childId: string;
  /** Preferred name if there is one, otherwise the first name. Never a full name. */
  displayName: string;
  present: boolean;
}

export interface KioskGuardian {
  guardianId: string;
  fullName: string;
  /**
   * Shown so the screen can grey a row out. **Not trusted** — `kiosk_sign_child`
   * enforces it again, because a flag the client could edit is not a rule.
   */
  canCollect: boolean;
  hasPin: boolean;
  /**
   * Whether the "review last week" control is drawn at all. Same contract as
   * `canCollect`: display only, re-enforced by both 0062 functions.
   */
  isSignatory: boolean;
}

/**
 * Every way a tap at the door can end.
 *
 * `duplicate` is a success. The same client key arriving twice means the first write
 * landed and the tablet did not hear about it, which is the ordinary consequence of a
 * flaky entrance connection — telling a parent it failed would produce a second tap
 * and, without the key, a second child in the room.
 */
export type KioskSignOutcome =
  | 'recorded'
  | 'duplicate'
  | 'wrong_pin'
  | 'locked'
  | 'no_pin'
  | 'not_permitted';

export type KioskSignResult =
  | { outcome: 'recorded' | 'duplicate' }
  | { outcome: 'wrong_pin' | 'locked' | 'no_pin' | 'not_permitted' };

const OUTCOMES: readonly string[] = [
  'recorded',
  'duplicate',
  'wrong_pin',
  'locked',
  'no_pin',
  'not_permitted',
];

interface RollRow {
  child_id: string;
  display_name: string;
  present: boolean;
}

interface GuardianRow {
  guardian_id: string;
  full_name: string;
  can_collect: boolean;
  has_pin: boolean;
  is_signatory: boolean;
}

/** The roll, as the three columns 0044 permits. Empty for anyone who is not a kiosk. */
export async function kioskRoll(db: Db): Promise<KioskChild[]> {
  const { data, error } = await db.rpc('kiosk_roll');
  if (error) throw new Error(`kioskRoll: ${error.message}`);
  return ((data ?? []) as RollRow[]).map((r) => ({
    childId: r.child_id,
    displayName: r.display_name,
    present: r.present,
  }));
}

export async function kioskGuardians(db: Db, childId: string): Promise<KioskGuardian[]> {
  const { data, error } = await db.rpc('kiosk_guardians', { p_child: childId });
  if (error) throw new Error(`kioskGuardians: ${error.message}`);
  return ((data ?? []) as GuardianRow[]).map((r) => ({
    guardianId: r.guardian_id,
    fullName: r.full_name,
    canCollect: r.can_collect,
    hasPin: r.has_pin,
    isSignatory: r.is_signatory,
  }));
}

// ---------------------------------------------------------------------------
// §6-3 verification at the door (0062)
// ---------------------------------------------------------------------------

/**
 * Every way the review flow can end. One list for both steps, because the week view and
 * the signature share their refusals by design — a week that can be shown is a week that
 * can be signed.
 */
export type KioskVerifyOutcome =
  | 'recorded'
  | 'wrong_pin'
  | 'locked'
  | 'no_pin'
  | 'not_permitted'
  | 'not_ended'
  | 'bad_period'
  | 'comment_required';

const VERIFY_OUTCOMES: readonly string[] = [
  'recorded',
  'wrong_pin',
  'locked',
  'no_pin',
  'not_permitted',
  'not_ended',
  'bad_period',
  'comment_required',
];

export interface KioskWeekEvent {
  /** ISO instant. Render with the timezone below, never the tablet's. */
  at: string;
  kind: 'in' | 'out';
}

export type KioskWeekResult =
  | { status: 'ok'; timezone: string; events: KioskWeekEvent[] }
  | { status: Exclude<KioskVerifyOutcome, 'recorded' | 'comment_required'> };

/**
 * The completed week, shown before it can be signed — §6-3 criterion 6. PIN-gated on the
 * same lockout counter as the door itself.
 */
export async function kioskWeekAttendance(
  db: Db,
  input: { childId: string; guardianId: string; from: string; to: string; pin: string },
): Promise<KioskWeekResult> {
  const { data, error } = await db.rpc('kiosk_week_attendance', {
    p_child: input.childId,
    p_guardian: input.guardianId,
    p_from: input.from,
    p_to: input.to,
    p_pin: input.pin,
  });
  if (error) throw new Error(`kioskWeekAttendance: ${error.message}`);

  const body = (data ?? {}) as { status?: string; timezone?: string; events?: KioskWeekEvent[] };
  if (body.status === 'ok' && typeof body.timezone === 'string' && Array.isArray(body.events)) {
    return { status: 'ok', timezone: body.timezone, events: body.events };
  }
  // Same rule as kioskSignChild: anything unrecognised is a refusal, because the
  // direction that fails in is "a week was shown to somebody it should not have been".
  const status = typeof body.status === 'string' && VERIFY_OUTCOMES.includes(body.status)
    ? body.status
    : 'not_permitted';
  return { status } as KioskWeekResult;
}

/** Record the signatory's outcome over the week they were just shown. */
export async function kioskVerifyAttendance(
  db: Db,
  input: {
    childId: string;
    guardianId: string;
    from: string;
    to: string;
    outcome: 'approved' | 'disputed';
    comment: string | null;
    pin: string;
  },
): Promise<KioskVerifyOutcome> {
  const { data, error } = await db.rpc('kiosk_verify_attendance', {
    p_child: input.childId,
    p_guardian: input.guardianId,
    p_from: input.from,
    p_to: input.to,
    p_outcome: input.outcome,
    p_comment: input.comment,
    p_pin: input.pin,
  });
  if (error) throw new Error(`kioskVerifyAttendance: ${error.message}`);
  return typeof data === 'string' && VERIFY_OUTCOMES.includes(data)
    ? (data as KioskVerifyOutcome)
    : 'not_permitted';
}

/**
 * Sign a child in or out at the door.
 *
 * `at` and `clientUuid` are the caller's, generated at the moment of the tap and
 * reused on retry — the same idempotency contract as `recordAttendance`, and the
 * server honours it with `on conflict (client_uuid) do nothing`.
 */
export async function kioskSignChild(
  db: Db,
  input: {
    childId: string;
    kind: 'in' | 'out';
    at: string;
    clientUuid: string;
    guardianId: string;
    pin: string;
  },
): Promise<KioskSignResult> {
  const { data, error } = await db.rpc('kiosk_sign_child', {
    p_child: input.childId,
    p_kind: input.kind,
    p_at: input.at,
    p_client_uuid: input.clientUuid,
    p_guardian: input.guardianId,
    p_pin: input.pin,
  });
  if (error) throw new Error(`kioskSignChild: ${error.message}`);

  /*
    An unrecognised status is treated as a refusal, not as success. The alternative —
    passing it through — means a future status added to the function is read by this
    version of the app as something it is not, and the direction that fails in is "a
    child was signed in".
  */
  const outcome = typeof data === 'string' && OUTCOMES.includes(data) ? data : 'not_permitted';
  return { outcome } as KioskSignResult;
}

// ---------------------------------------------------------------------------
// The office side
// ---------------------------------------------------------------------------

export interface GuardianPinStatus {
  hasPin: boolean;
  lockedUntil: string | null;
  setAt: string | null;
}

/**
 * Whether a guardian has a PIN, and whether they are locked out. Never the PIN.
 *
 * Returns no rows when there is none, which is indistinguishable from a caller who
 * may not ask — deliberately, and the reason the shape is a plain `hasPin: false`
 * rather than a null: staff need an answer to "why can this parent not sign in", and
 * that answer is the same in both cases from where they are standing.
 */
export async function guardianPinStatus(db: Db, guardianId: string): Promise<GuardianPinStatus> {
  const { data, error } = await db.rpc('guardian_pin_status', { p_guardian: guardianId });
  if (error) throw new Error(`guardianPinStatus: ${error.message}`);

  const row = ((data ?? []) as { locked_until: string | null; set_at: string | null }[])[0];
  if (!row) return { hasPin: false, lockedUntil: null, setAt: null };
  return { hasPin: true, lockedUntil: row.locked_until, setAt: row.set_at };
}

/**
 * Set or replace a guardian's PIN. Owner and manager only, enforced in Postgres.
 *
 * The four-to-eight-digit rule is checked in the function as well as in any form,
 * because this is reachable over RPC and a form is not a boundary.
 */
export async function setGuardianPin(db: Db, guardianId: string, pin: string): Promise<void> {
  const { error } = await db.rpc('set_guardian_pin', { p_guardian: guardianId, p_pin: pin });
  if (error) throw new Error(`setGuardianPin: ${error.message}`);
}

export async function clearGuardianPin(db: Db, guardianId: string): Promise<void> {
  const { error } = await db.rpc('clear_guardian_pin', { p_guardian: guardianId });
  if (error) throw new Error(`clearGuardianPin: ${error.message}`);
}
