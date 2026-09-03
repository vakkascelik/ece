'use server';

import { revalidatePath } from 'next/cache';
import { createRoom, updateCentre, updateRoom } from '@ece/api';
import {
  LICENCE_TYPES,
  RATIO_SOURCES,
  SERVICE_MODELS,
  type LicenceType,
  type RatioSource,
  type ServiceModel,
} from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

/**
 * Which card is saving.
 *
 * The settings screen is one form per section, each with its own save, because a single
 * form with one button under forty fields is a form nobody finishes — and worse here, a
 * form that makes somebody who came to change the sleep interval also re-submit the
 * Ministry service number.
 *
 * One action rather than one per section. Every field's validation is already written once
 * and the rules are the interesting part; splitting into three copies of `requireCapability`
 * and three `revalidatePath` calls would be three places to forget something. `updateCentre`
 * already takes a partial patch and writes only the keys that are not `undefined`, so a
 * section save touches its own columns and no others — which is also what makes two people
 * editing different sections safe.
 */
type Section = 'details' | 'practice' | 'integrations';

export async function saveCentre(_prev: unknown, form: FormData) {
  const ctx = await requireCapability('manageCentre');

  const raw_section = String(form.get('section') ?? 'all');
  const section: Section | 'all' = (['details', 'practice', 'integrations'] as const).includes(
    raw_section as Section,
  )
    ? (raw_section as Section)
    : 'all';
  const wants = (s: Section) => section === 'all' || section === s;

  const name = String(form.get('name') ?? '').trim();
  if (wants('details') && !name) return { error: 'A centre needs a name.' };

  // The Ministry service number is the real-world identity of a licensed service
  // and is uniquely indexed, so a typo that collides with another centre fails at
  // the database. Digits only, and empty means "not recorded yet" rather than "".
  const raw = String(form.get('moeServiceNumber') ?? '').trim();
  if (raw && !/^\d{3,8}$/.test(raw)) {
    return { error: 'A Ministry service number is 3 to 8 digits, e.g. 46365.' };
  }

  /*
    The two practice settings 0032 and 0033 added. Both were readable by the product
    and settable by nobody until this — a column with no way to change it is a column
    that will be changed with a hand-written UPDATE against production.

    A blank interval is NULL, not zero. Null means "this centre has stated none", and
    the sleep register then shows elapsed time without judging it. Zero would make
    every child permanently overdue, which is why the CHECK in 0033 refuses it.
  */
  const witness = form.get('medicationRequiresWitness') === 'on';
  const intervalRaw = String(form.get('sleepCheckMinutes') ?? '').trim();
  let sleepCheckMinutes: number | null = null;
  if (intervalRaw) {
    const n = Number(intervalRaw);
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      return { error: 'A sleep-check interval is a whole number of minutes between 1 and 120.' };
    }
    sleepCheckMinutes = n;
  }

  // Same shape as the sleep interval: blank is NULL, not zero, and 0034's CHECK
  // refuses anything outside 1–730 anyway.
  const drillRaw = String(form.get('drillIntervalDays') ?? '').trim();
  let drillIntervalDays: number | null = null;
  if (drillRaw) {
    const n = Number(drillRaw);
    if (!Number.isInteger(n) || n < 1 || n > 730) {
      return { error: 'A drill interval is a whole number of days between 1 and 730.' };
    }
    drillIntervalDays = n;
  }

  /*
    The ratio source. Validated against the enum rather than trusted, and a value
    outside it is refused rather than coerced — 0040 forbids blending, and silently
    falling back to `declared` on a typo is a quiet version of exactly that.
  */
  /*
    Licensed places. Blank is NULL — not stated — with the same contract as the two
    intervals above, and for a sharper reason: this is the DENOMINATOR of every occupancy
    figure. A blank coerced to 0 divides by zero; a blank given a default produces
    percentages against a licence the centre never stated, and they look exactly like
    real ones.

    The upper bound is a sanity limit, not a rule. New Zealand' largest services are
    around 150 places, but that is a fact about today' market, and refusing a lawful
    licence is a support call this product cannot win.
  */
  const placesRaw = String(form.get('licensedPlaces') ?? '').trim();
  let licensedPlaces: number | null = null;
  if (placesRaw) {
    const n = Number(placesRaw);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      return { error: 'Licensed places is a whole number of children, 1 or more.' };
    }
    licensedPlaces = n;
  }

  /*
    Licence type and service model. Blank is a value, not a missing answer: it means the
    centre has not stated one, and it is what both selects default to.

    Validated against the constants rather than trusted, because the CHECK constraints in
    0083 will refuse anything else and a `23514` reaching the user is a worse message than
    a sentence. An unrecognised value becomes null rather than an error — the only way to
    send one is to edit the form, and silently not-stating is the safe reading.
  */
  const licenceRaw = String(form.get('licenceType') ?? '').trim();
  const licenceType = (LICENCE_TYPES as readonly string[]).includes(licenceRaw)
    ? (licenceRaw as LicenceType)
    : null;

  const modelRaw = String(form.get('serviceModel') ?? '').trim();
  const serviceModel = (SERVICE_MODELS as readonly string[]).includes(modelRaw)
    ? (modelRaw as ServiceModel)
    : null;

  const sourceRaw = String(form.get('ratioSource') ?? '').trim();
  const ratioSource = (RATIO_SOURCES as readonly string[]).includes(sourceRaw)
    ? (sourceRaw as RatioSource)
    : null;
  if (wants('practice') && !ratioSource) {
    return { error: 'Choose where the adult count comes from.' };
  }

  const db = await serverDb();
  try {
    /*
      Only this section's keys. `updateCentre` writes a column when its key is present and
      leaves it alone when the key is `undefined`, so omitting the others is not the same as
      clearing them — the distinction the sleep interval's own docblock insists on, applied
      one level up. Spreading the whole object here and relying on hidden inputs to carry the
      other sections' values would make one person's save overwrite another's.
    */
    await updateCentre(db, ctx.centre.id, {
      ...(wants('details')
        ? { name, moeServiceNumber: raw || null, licensedPlaces, licenceType, serviceModel }
        : {}),
      ...(wants('practice')
        ? {
            medicationRequiresWitness: witness,
            sleepCheckMinutes,
            drillIntervalDays,
            ratioSource: ratioSource as RatioSource,
          }
        : {}),
      ...(wants('integrations') ? { aiFeatures: form.get('aiFeatures') === 'on' } : {}),
    });
  } catch (err) {
    const message = (err as Error).message;
    if (/duplicate key|unique/i.test(message)) {
      return { error: 'Another centre already has that Ministry service number.' };
    }
    return { error: message };
  }

  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rooms (0066)
//
// Here rather than on a page of their own because a room list is configuration, edited
// when a centre is set up and roughly never afterwards — and `manageCentre` is already
// the gate on this screen. The tables that reference a room are read by educators; the
// list itself is written by the two roles that own the floor plan.
// ---------------------------------------------------------------------------

export type RoomResult = { error: string } | { ok: true };

const roomStr = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

export async function addRoom(_prev: unknown, form: FormData): Promise<RoomResult> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const name = roomStr(form, 'name');
  if (name.length < 2) return { error: 'What is the room called?' };

  const sortRaw = roomStr(form, 'sort');
  const sort = sortRaw ? Number(sortRaw) : 0;
  if (!Number.isInteger(sort)) return { error: 'The order has to be a whole number.' };

  try {
    await createRoom(db, { centreId: ctx.centre.id, name, sort });
  } catch (e) {
    return actionError(e, 'settings.addRoom');
  }

  revalidatePath('/settings');
  return { ok: true };
}

export async function renameRoom(_prev: unknown, form: FormData): Promise<RoomResult> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = roomStr(form, 'id');
  const name = roomStr(form, 'name');
  if (!id) return { error: 'Which room?' };
  if (name.length < 2) return { error: 'What is the room called?' };

  const sortRaw = roomStr(form, 'sort');
  const sort = sortRaw ? Number(sortRaw) : 0;
  if (!Number.isInteger(sort)) return { error: 'The order has to be a whole number.' };

  try {
    await updateRoom(db, id, { name, sort });
  } catch (e) {
    return actionError(e, 'settings.renameRoom');
  }

  revalidatePath('/settings');
  return { ok: true };
}

/**
 * Take a room out of every picker, and leave its history alone.
 *
 * There is no delete and there is no grant for one. A closed room still has last
 * year's incidents pointing at it, and the evidence binder has to keep rendering
 * them — which is the whole reason 0066 archives instead.
 */
export async function archiveRoom(_prev: unknown, form: FormData): Promise<RoomResult> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = roomStr(form, 'id');
  if (!id) return { error: 'Which room?' };
  const restoring = roomStr(form, 'restore') === 'yes';

  try {
    await updateRoom(db, id, { archivedAt: restoring ? null : new Date().toISOString() });
  } catch (e) {
    return actionError(e, 'settings.archiveRoom');
  }

  revalidatePath('/settings');
  return { ok: true };
}
