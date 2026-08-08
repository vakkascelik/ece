'use server';

import { revalidatePath } from 'next/cache';
import { recordDrill, recordHazard, recordSafetyCheck, updateHazard } from '@ece/api';
import {
  DRILL_KINDS,
  HAZARD_RISKS,
  SAFETY_AREAS,
  type DrillKind,
  type HazardRisk,
  type SafetyArea,
} from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { zonedWallClockToUtc } from '@/lib/dayWindow';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function logDrill(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const kind = oneOf<DrillKind>(str(form, 'kind'), DRILL_KINDS);
  const heldAtLocal = str(form, 'heldAt');
  if (!kind) return { error: 'That is not a kind of drill we record.' };
  if (!WALL_CLOCK.test(heldAtLocal)) return { error: 'When was it held?' };

  // The centre's zone, not the browser's and not UTC. A drill logged at 9am would
  // otherwise be filed the previous evening for the whole New Zealand morning.
  const heldAt = zonedWallClockToUtc(heldAtLocal, ctx.centre.timezone);
  if (heldAt > new Date(Date.now() + 2 * 3_600_000).toISOString()) {
    return { error: 'That is in the future. Check the time.' };
  }

  const num = (k: string): number | null => {
    const raw = str(form, k);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  try {
    await recordDrill(db, {
      centreId: ctx.centre.id,
      kind,
      heldAt,
      durationSeconds: num('durationSeconds'),
      adultsPresent: num('adultsPresent'),
      childrenPresent: num('childrenPresent'),
      notes: str(form, 'notes') || null,
      issuesFound: str(form, 'issuesFound') || null,
    });
  } catch (e) {
    return actionError(e, 'facilities.logDrill');
  }

  revalidatePath('/facilities');
  return { ok: true };
}

export async function addHazard(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const description = str(form, 'description');
  const risk = oneOf<HazardRisk>(str(form, 'risk'), HAZARD_RISKS);
  if (description.length < 3) return { error: 'Describe the hazard.' };
  if (!risk) return { error: 'How serious is it?' };

  try {
    await recordHazard(db, {
      centreId: ctx.centre.id,
      description,
      risk,
      area: str(form, 'area') || null,
      control: str(form, 'control') || null,
    });
  } catch (e) {
    return actionError(e, 'facilities.addHazard');
  }

  revalidatePath('/facilities');
  return { ok: true };
}

/** Write or change what is being done about a hazard that is still open. */
export async function setHazardControl(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  const control = str(form, 'control');
  if (!id) return { error: 'Which hazard?' };
  if (control.length < 3) return { error: 'Say what is being done about it.' };

  try {
    await updateHazard(db, id, { control, reviewedAt: new Date().toISOString() });
  } catch (e) {
    return actionError(e, 'facilities.setHazardControl');
  }

  revalidatePath('/facilities');
  return { ok: true };
}

/**
 * Close a hazard.
 *
 * A resolution is required here as well as by the CHECK in 0034, and this one exists
 * to say why in a sentence rather than as `hazards_resolution_complete`. Closing with
 * no account of what changed is the empty claim a review pushes on.
 */
export async function closeHazard(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  const resolution = str(form, 'resolution');
  if (!id) return { error: 'Which hazard?' };
  if (resolution.length < 3) {
    return { error: 'Say how it was resolved. A closing date on its own is not a record.' };
  }

  try {
    await updateHazard(db, id, { resolvedAt: new Date().toISOString(), resolution });
  } catch (e) {
    return actionError(e, 'facilities.closeHazard');
  }

  revalidatePath('/facilities');
  return { ok: true };
}

export async function logSafetyCheck(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const area = oneOf<SafetyArea>(str(form, 'area'), SAFETY_AREAS);
  const passed = str(form, 'passed') === 'yes';
  const note = str(form, 'note');
  const clientUuid = str(form, 'clientUuid');

  if (!area) return { error: 'Which area?' };
  if (str(form, 'passed') !== 'yes' && str(form, 'passed') !== 'no') {
    return { error: 'Record whether the check passed.' };
  }
  if (!clientUuid) return { error: 'The page did not finish loading. Reload and try again.' };
  // Also a CHECK in 0034. Caught here so the person gets a sentence instead of
  // `safety_checks_failure_has_note`, and because the note IS the row when a check
  // fails — without it the register tells the next person nothing.
  if (!passed && note.length < 3) {
    return { error: 'Say what was wrong. A failed check with no note helps nobody.' };
  }

  try {
    await recordSafetyCheck(db, {
      centreId: ctx.centre.id,
      area,
      at: new Date().toISOString(),
      passed,
      clientUuid,
      note: note || null,
    });
  } catch (e) {
    return actionError(e, 'facilities.logSafetyCheck');
  }

  revalidatePath('/facilities');
  return { ok: true };
}
