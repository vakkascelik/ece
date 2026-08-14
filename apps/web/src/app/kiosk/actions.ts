'use server';

import { revalidatePath } from 'next/cache';
import {
  kioskGuardians,
  kioskSignChild,
  kioskVerifyAttendance,
  kioskWeekAttendance,
  type KioskGuardian,
  type KioskWeekEvent,
} from '@ece/api';
import { actionError } from '@/lib/actionError';
import { requireKiosk } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

/**
 * The two things a door tablet can ask for.
 *
 * Both re-check `requireKiosk` rather than trusting the page that rendered the form.
 * A server action is a public endpoint — the page having already checked says nothing
 * about who is calling this.
 */

export type GuardiansResult = { error: string } | { ok: true; guardians: KioskGuardian[] };

export async function loadGuardians(childId: string): Promise<GuardiansResult> {
  await requireKiosk();
  const db = await serverDb();
  try {
    return { ok: true, guardians: await kioskGuardians(db, childId) };
  } catch (e) {
    return actionError(e, 'kiosk.loadGuardians');
  }
}

/**
 * What the screen says for each outcome.
 *
 * Written here rather than in the component because these are the sentences a parent
 * reads while a queue forms behind them, and they are the part of this feature most
 * likely to be edited carelessly.
 *
 * `not_permitted` is deliberately vague about *which* rule refused — not to be
 * mysterious, but because the screen already filtered the list it offered, so anybody
 * reaching it is not a parent who has made a mistake. The office can answer; the
 * tablet should not enumerate its own boundaries to whoever is standing at it.
 */
const MESSAGES: Record<string, string> = {
  wrong_pin: 'That PIN was not right. Try again, or ask a kaiako.',
  locked:
    'Too many wrong PINs, so this one is locked for a few minutes. Please ask a kaiako to sign in for you.',
  no_pin: 'No PIN has been set up for you yet. Ask the office and they will sort it out.',
  not_permitted: 'That is not something this tablet can do. Please ask a kaiako.',
  // The review flow. `not_ended` and `bad_period` mean this screen computed a wrong
  // window — a defect, not a family's mistake — so both borrow the not_permitted voice
  // rather than explaining a boundary a parent cannot act on.
  not_ended: 'That is not something this tablet can do. Please ask a kaiako.',
  bad_period: 'That is not something this tablet can do. Please ask a kaiako.',
  comment_required: 'Please say what looks wrong, so the office knows what to check.',
};

export type SignResult = { error: string } | { ok: true; message: string | null };

export async function signAtDoor(_prev: unknown, form: FormData): Promise<SignResult> {
  await requireKiosk();
  const db = await serverDb();

  const str = (k: string) => (form.get(k) ?? '').toString().trim();
  const childId = str('childId');
  const guardianId = str('guardianId');
  const kind = str('kind');
  const pin = str('pin');
  const clientUuid = str('clientUuid');

  if (!childId || !guardianId) return { error: 'Start again and choose a child.' };
  if (kind !== 'in' && kind !== 'out') return { error: 'Start again and choose a child.' };
  if (!clientUuid) return { error: 'The screen did not finish loading. Try again.' };
  if (!/^[0-9]{4,8}$/.test(pin)) return { error: 'A PIN is four to eight numbers.' };

  try {
    const result = await kioskSignChild(db, {
      childId,
      guardianId,
      kind,
      pin,
      clientUuid,
      // The moment of the tap, not the moment the write lands. Attendance times decide
      // funded hours, and a slow connection must not move a child's arrival.
      at: new Date().toISOString(),
    });

    if (result.outcome === 'recorded' || result.outcome === 'duplicate') {
      // A duplicate means the first write landed and the tablet did not hear. Reported
      // as success, because the alternative is a parent tapping again.
      revalidatePath('/kiosk');
      return { ok: true, message: null };
    }

    return { ok: true, message: MESSAGES[result.outcome] ?? MESSAGES.not_permitted! };
  } catch (e) {
    /*
      A thrown error here is a real failure — no connection, or the row was refused —
      and never a wrong PIN, which arrives as a resolved status. `actionError` scrubs
      the message, which matters more on this screen than anywhere else in the product:
      Postgres quotes offending values back, and there are parents standing in front of
      it.
    */
    return actionError(e, 'kiosk.signAtDoor');
  }
}

// ---------------------------------------------------------------------------
// §6-3 verification at the door (0062)
// ---------------------------------------------------------------------------

export type ReviewWeekResult =
  | { error: string }
  | { ok: true; timezone: string; events: KioskWeekEvent[] }
  | { ok: false; message: string };

/**
 * Unlock last week's record with a PIN, so it can be read before it is signed.
 *
 * The period arrives from the client, but the client got it from the server page, and
 * `kiosk_week_attendance` re-validates it anyway — ended, ordered, no longer than a
 * month. The form is not the boundary; it never is on this screen.
 */
export async function reviewWeek(input: {
  childId: string;
  guardianId: string;
  from: string;
  to: string;
  pin: string;
}): Promise<ReviewWeekResult> {
  await requireKiosk();
  const db = await serverDb();

  if (!/^[0-9]{4,8}$/.test(input.pin)) return { ok: false, message: 'A PIN is four to eight numbers.' };

  try {
    const result = await kioskWeekAttendance(db, input);
    if (result.status === 'ok') {
      return { ok: true, timezone: result.timezone, events: result.events };
    }
    return { ok: false, message: MESSAGES[result.status] ?? MESSAGES.not_permitted! };
  } catch (e) {
    return actionError(e, 'kiosk.reviewWeek');
  }
}

export type VerifyResult = { error: string } | { ok: true; message: string | null };

/** Record the outcome over the week the signatory was just shown. */
export async function verifyAtDoor(input: {
  childId: string;
  guardianId: string;
  from: string;
  to: string;
  outcome: 'approved' | 'disputed';
  comment: string;
  pin: string;
}): Promise<VerifyResult> {
  await requireKiosk();
  const db = await serverDb();

  if (!/^[0-9]{4,8}$/.test(input.pin)) return { ok: true, message: 'A PIN is four to eight numbers.' };

  try {
    const outcome = await kioskVerifyAttendance(db, {
      ...input,
      comment: input.comment.trim() === '' ? null : input.comment.trim(),
    });
    if (outcome === 'recorded') return { ok: true, message: null };
    return { ok: true, message: MESSAGES[outcome] ?? MESSAGES.not_permitted! };
  } catch (e) {
    return actionError(e, 'kiosk.verifyAtDoor');
  }
}
