'use server';

import { revalidatePath } from 'next/cache';
import { kioskGuardians, kioskSignChild, type KioskGuardian } from '@ece/api';
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
