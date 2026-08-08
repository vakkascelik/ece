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
  }));
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
