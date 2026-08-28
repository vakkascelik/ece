'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addChecklistItem,
  answerChecklistItem,
  completeChecklistRun,
  createChecklistTemplate,
  forkChecklistVersion,
  listChecklistItems,
  listChecklistVersions,
  publishChecklistVersion,
  removeChecklistItem,
  startChecklistRun,
  updateChecklistTemplate,
} from '@ece/api';
import { CHECKLIST_RESPONSES, todayInZone, type ChecklistResponse } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

// ---------------------------------------------------------------------------
// Runs — what an educator does
// ---------------------------------------------------------------------------

/**
 * Start filling a form in, and go straight to it.
 *
 * The `clientUuid` is generated here rather than in the browser, which is the right
 * place for a server action and the wrong place for the offline path — when the run
 * screen becomes an outbox write, the id has to come from the device so a replay
 * produces one run and not two. Recorded rather than deferred silently: the
 * idempotency column already exists and is already unique, so the change is to who
 * generates the value, not to the schema.
 */
export async function beginRun(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const versionId = str(form, 'versionId');
  if (!versionId) return { error: 'That checklist has no published version yet.' };

  let id: string | null = null;
  try {
    const started = await startChecklistRun(db, {
      versionId,
      centreId: ctx.centre.id,
      clientUuid: randomUUID(),
      roomId: str(form, 'roomId') || null,
      dueOn: todayInZone(ctx.centre.timezone),
    });
    id = started.id;
  } catch (e) {
    return actionError(e, 'checklists.beginRun');
  }

  revalidatePath('/checklists');
  if (id) redirect(`/checklists/${id}`);
  return { ok: true };
}

export async function saveAnswer(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const runId = str(form, 'runId');
  const itemId = str(form, 'itemId');
  const value = str(form, 'value');
  const note = str(form, 'note');
  if (!runId || !itemId) return { error: 'Which item?' };
  if (!value) return { error: 'Answer the item first.' };

  /*
    A "no" must say what was wrong. Enforced by `checklist_answers_no_needs_note` in
    0068 as well; this copy exists to say why in a sentence rather than as a
    constraint name. Without the note a run reads "gate latch: no" and the next person
    learns nothing, which destroys the only reason to keep the form.
  */
  if (value === 'no' && note.length < 3) {
    return { error: 'A “no” needs a note saying what was wrong.' };
  }

  try {
    await answerChecklistItem(db, { runId, itemId, value, note: note || null });
  } catch (e) {
    return actionError(e, 'checklists.saveAnswer');
  }

  revalidatePath(`/checklists/${runId}`);
  return { ok: true };
}

/**
 * Sign a run off.
 *
 * The required-items rule is the trigger's, not this function's. The button is
 * disabled when `runProgress().canComplete` is false, so reaching here with something
 * missing means two people had the form open — which is exactly when the database
 * should be the one deciding.
 */
export async function signRun(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const runId = str(form, 'runId');
  if (!runId) return { error: 'Which run?' };

  try {
    await completeChecklistRun(db, runId, new Date().toISOString(), str(form, 'note') || null);
  } catch (e) {
    return actionError(e, 'checklists.signRun');
  }

  revalidatePath('/checklists');
  revalidatePath(`/checklists/${runId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Templates — what a manager does
// ---------------------------------------------------------------------------

export async function addTemplate(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const name = str(form, 'name');
  if (name.length < 3) return { error: 'What is this checklist called?' };

  const recurRaw = str(form, 'recurDays');
  let recurDays: number | null = null;
  if (recurRaw) {
    const n = Number(recurRaw);
    if (!Number.isInteger(n) || n < 1 || n > 730) return { error: 'How many days between checks?' };
    recurDays = n;
  }

  let versionId: string | null = null;
  try {
    const created = await createChecklistTemplate(db, {
      centreId: ctx.centre.id,
      name,
      folder: str(form, 'folder') || null,
      recurDays,
    });
    versionId = created.versionId;
  } catch (e) {
    return actionError(e, 'checklists.addTemplate');
  }

  revalidatePath('/checklists');
  if (versionId) redirect(`/checklists/templates/${versionId}`);
  return { ok: true };
}

export async function editTemplate(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which checklist?' };

  const name = str(form, 'name');
  if (name.length < 3) return { error: 'What is this checklist called?' };

  const recurRaw = str(form, 'recurDays');
  let recurDays: number | null = null;
  if (recurRaw) {
    const n = Number(recurRaw);
    if (!Number.isInteger(n) || n < 1 || n > 730) return { error: 'How many days between checks?' };
    recurDays = n;
  }

  try {
    await updateChecklistTemplate(db, id, { name, folder: str(form, 'folder') || null, recurDays });
  } catch (e) {
    return actionError(e, 'checklists.editTemplate');
  }

  revalidatePath('/checklists');
  return { ok: true };
}

export async function archiveTemplate(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which checklist?' };

  try {
    // Archived, never deleted. Completed runs point at its versions and the binder
    // has to keep rendering them.
    await updateChecklistTemplate(db, id, { archivedAt: new Date().toISOString() });
  } catch (e) {
    return actionError(e, 'checklists.archiveTemplate');
  }

  revalidatePath('/checklists');
  return { ok: true };
}

export async function addItem(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const versionId = str(form, 'versionId');
  const prompt = str(form, 'prompt');
  const responseType = oneOf<ChecklistResponse>(str(form, 'responseType'), CHECKLIST_RESPONSES);
  if (!versionId) return { error: 'Which version?' };
  if (prompt.length < 3) return { error: 'What is the question?' };
  if (!responseType) return { error: 'How is it answered?' };

  const sortRaw = str(form, 'sort');
  const sort = sortRaw ? Number(sortRaw) : 0;

  try {
    await addChecklistItem(db, {
      versionId,
      prompt,
      responseType,
      required: str(form, 'required') === 'on',
      sort: Number.isInteger(sort) ? sort : 0,
      guidance: str(form, 'guidance') || null,
    });
  } catch (e) {
    return actionError(e, 'checklists.addItem');
  }

  revalidatePath(`/checklists/templates/${versionId}`);
  return { ok: true };
}

export async function deleteItem(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const id = str(form, 'id');
  const versionId = str(form, 'versionId');
  if (!id) return { error: 'Which item?' };

  try {
    await removeChecklistItem(db, id);
  } catch (e) {
    return actionError(e, 'checklists.deleteItem');
  }

  revalidatePath(`/checklists/templates/${versionId}`);
  return { ok: true };
}

/**
 * Publish a draft, making it the form runs are filled in against.
 *
 * Refuses an empty one here rather than letting it through: 0068's trigger is happy
 * to complete a run with no required items, which is correct as a rule and useless as
 * a form. A published checklist with no questions is a button that records nothing.
 */
export async function publishVersion(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const versionId = str(form, 'versionId');
  if (!versionId) return { error: 'Which version?' };

  try {
    const items = await listChecklistItems(db, [versionId]);
    if (items.length === 0) return { error: 'Add at least one question before publishing.' };
    await publishChecklistVersion(db, versionId, new Date().toISOString());
  } catch (e) {
    return actionError(e, 'checklists.publishVersion');
  }

  revalidatePath('/checklists');
  revalidatePath(`/checklists/templates/${versionId}`);
  return { ok: true };
}

/**
 * Start a new draft from the published version, so editing begins from what is there.
 *
 * A blank draft would make changing one word in a twelve-item form a retyping
 * exercise, and a centre that has to retype will instead not change it — which is how
 * a checklist ends up describing a building that was renovated two years ago.
 */
export async function reviseTemplate(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();

  const templateId = str(form, 'templateId');
  const fromVersionId = str(form, 'fromVersionId');
  if (!templateId || !fromVersionId) return { error: 'Which checklist?' };

  let created: string | null = null;
  try {
    const versions = await listChecklistVersions(db, [templateId]);
    if (versions.some((v) => v.publishedAt === null)) {
      return { error: 'There is already a draft. Finish or publish that one first.' };
    }
    const next = Math.max(...versions.map((v) => v.version), 0) + 1;
    created = (await forkChecklistVersion(db, fromVersionId, templateId, next)).id;
  } catch (e) {
    return actionError(e, 'checklists.reviseTemplate');
  }

  revalidatePath('/checklists');
  if (created) redirect(`/checklists/templates/${created}`);
  return { ok: true };
}
