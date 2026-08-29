'use server';

import { revalidatePath } from 'next/cache';
import {
  createIncidentInvestigation,
  finaliseIncident,
  openIncident,
  recordParentNotified,
  updateIncidentDraft,
  updateIncidentInvestigation,
} from '@ece/api';
import { INCIDENT_KINDS, type IncidentKind } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { zonedWallClockToUtc } from '@/lib/dayWindow';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** `2026-08-07T14:30`, which is what `<input type="datetime-local">` submits. */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Open a draft.
 *
 * Always a draft. There is no "save and send" on the form and no argument here to
 * skip the step, because final is the version a family reads and cannot be amended
 * afterwards — only superseded. The two-step is the whole design.
 */
export async function openDraft(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const kind = oneOf<IncidentKind>(str(form, 'kind'), INCIDENT_KINDS);
  const occurredAtLocal = str(form, 'occurredAt');
  const description = str(form, 'description');

  if (!childId) return { error: 'Which child was this about?' };
  if (!kind) return { error: 'That is not a kind of incident we record.' };
  if (!WALL_CLOCK.test(occurredAtLocal)) return { error: 'When did it happen?' };
  if (description.length < 3) {
    return { error: 'Describe what happened. This is the record a family will read.' };
  }

  /*
    The form submits a wall clock with no zone. Reading it as UTC would file a 9am
    incident at 9pm the previous day for the whole New Zealand morning — the bug
    0006, 0029 and localDates.test.ts all exist for. The centre's zone is the one
    the person typing was standing in.
  */
  const occurredAt = zonedWallClockToUtc(occurredAtLocal, ctx.centre.timezone);
  if (occurredAt > new Date(Date.now() + 2 * 3_600_000).toISOString()) {
    // The CHECK would refuse this anyway; catching it here says something useful
    // instead of surfacing a constraint name.
    return { error: 'That is in the future. Check the time.' };
  }

  try {
    await openIncident(db, {
      centreId: ctx.centre.id,
      childId,
      kind,
      occurredAt,
      description,
      location: str(form, 'location') || null,
      roomId: str(form, 'roomId') || null,
      firstAidGiven: str(form, 'firstAidGiven') || null,
      witnessName: str(form, 'witnessName') || null,
      supersedes: str(form, 'supersedes') || null,
    });
  } catch (e) {
    return actionError(e, 'incidents.openDraft');
  }

  revalidatePath('/incidents');
  return { ok: true };
}

/**
 * Draft to final.
 *
 * After this the family can read it and nobody can edit it — so the button that
 * calls this says so, and the confirmation is in the UI rather than here. One way,
 * enforced by the trigger in 0030 rather than by this function being careful.
 */
export async function finalise(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which incident?' };

  try {
    await finaliseIncident(db, id);
  } catch (e) {
    return actionError(e, 'incidents.finalise');
  }

  revalidatePath('/incidents');
  return { ok: true };
}

/**
 * Record that the family was told.
 *
 * The time is taken here rather than from the form: this records the moment somebody
 * pressed the button, and a form field would invite back-dating the one fact in the
 * report that is about the centre's own conduct. `toISOString` is correct — this is
 * an instant, not a calendar day.
 */
export async function markNotified(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which incident?' };

  try {
    await recordParentNotified(db, id, new Date().toISOString());
  } catch (e) {
    return actionError(e, 'incidents.markNotified');
  }

  revalidatePath('/incidents');
  return { ok: true };
}

/** `2026-08-29`, what `<input type="date">` submits. */
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Record or update the investigation.
 *
 * One action for both because the form cannot know which it is doing across two
 * open tabs anyway — it sends `investigationId` when it rendered with a row, and a
 * create that races another create fails on the unique index rather than making a
 * second row. Not an upsert: `incident_id` is outside the UPDATE grant, and an
 * upsert writes every column (the reasoning is on `createIncidentInvestigation`).
 *
 * There is deliberately no check here of the form "severity X so WorkSafe must…".
 * The two WorkSafe fields record what the centre did; whether it was required is
 * the centre's judgement, and encoding a threshold would be a regulatory claim
 * nobody has sourced.
 */
export async function saveInvestigation(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const incidentId = str(form, 'incidentId');
  const investigationId = str(form, 'investigationId');
  const requiredRaw = str(form, 'required');
  if (!incidentId) return { error: 'Which incident?' };
  if (requiredRaw !== 'yes' && requiredRaw !== 'no') {
    return { error: 'Decide whether an investigation was required — that decision is the record.' };
  }

  const investigatedOn = str(form, 'investigatedOn');
  const worksafeRaw = str(form, 'worksafeAdvised');
  const worksafeAdvisedOn = str(form, 'worksafeAdvisedOn');
  if (investigatedOn && !LOCAL_DATE.test(investigatedOn)) return { error: 'When was it investigated?' };
  if (worksafeAdvisedOn && !LOCAL_DATE.test(worksafeAdvisedOn)) {
    return { error: 'When was WorkSafe advised?' };
  }
  if (worksafeAdvisedOn && worksafeRaw !== 'yes') {
    // The CHECK refuses this too; catching it here says it in a sentence.
    return { error: 'A date of advising WorkSafe needs “WorkSafe advised” set to yes.' };
  }

  const patch = {
    required: requiredRaw === 'yes',
    investigatedOn: investigatedOn || null,
    worksafeAdvised: worksafeRaw === 'yes' ? true : worksafeRaw === 'no' ? false : null,
    worksafeAdvisedOn: worksafeAdvisedOn || null,
    hazardId: str(form, 'hazardId') || null,
    medicalFollowup: str(form, 'medicalFollowup') || null,
    agencyContacted: str(form, 'agencyContacted') || null,
    outcome: str(form, 'outcome') || null,
    notes: str(form, 'notes') || null,
  };

  try {
    if (investigationId) {
      await updateIncidentInvestigation(db, investigationId, patch);
    } else {
      await createIncidentInvestigation(db, {
        centreId: ctx.centre.id,
        incidentId,
        ...patch,
      });
    }
  } catch (e) {
    return actionError(e, 'incidents.saveInvestigation');
  }

  revalidatePath(`/incidents/${incidentId}`);
  return { ok: true };
}

/**
 * Correct a draft in place.
 *
 * The counterpart to `openDraft` and deliberately not the same thing as amending. A
 * draft has not been shown to anybody, so fixing a typo in one is an edit and leaves
 * no trace worth keeping. Once final, the same typo costs a superseding report that
 * marks the original as replaced forever — right for a correction a family has seen,
 * absurd for a missing apostrophe nobody has read.
 *
 * `status` is not accepted here. Finalising is `finalise`, for the reason that
 * function records: a patch that happens to carry a status is how a report gets sent
 * to a family as a side effect of fixing a word.
 *
 * The trigger in 0030 refuses this outright once the row is final, so the narrowing
 * below is about giving a person a sentence rather than about enforcement.
 */
export async function saveDraft(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'editing');
  const kind = oneOf<IncidentKind>(str(form, 'kind'), INCIDENT_KINDS);
  const occurredAtLocal = str(form, 'occurredAt');
  const description = str(form, 'description');

  if (!id) return { error: 'Which draft?' };
  if (!kind) return { error: 'That is not a kind of incident we record.' };
  if (!WALL_CLOCK.test(occurredAtLocal)) return { error: 'When did it happen?' };
  if (description.length < 3) {
    return { error: 'Describe what happened. This is the record a family will read.' };
  }

  const occurredAt = zonedWallClockToUtc(occurredAtLocal, ctx.centre.timezone);
  if (occurredAt > new Date(Date.now() + 2 * 3_600_000).toISOString()) {
    return { error: 'That is in the future. Check the time.' };
  }

  try {
    await updateIncidentDraft(db, id, {
      kind,
      occurredAt,
      description,
      location: str(form, 'location') || null,
      roomId: str(form, 'roomId') || null,
      firstAidGiven: str(form, 'firstAidGiven') || null,
      witnessName: str(form, 'witnessName') || null,
    });
  } catch (e) {
    return actionError(e, 'incidents.saveDraft');
  }

  revalidatePath('/incidents');
  return { ok: true };
}
