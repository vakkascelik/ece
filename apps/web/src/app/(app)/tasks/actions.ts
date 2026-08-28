'use server';

import { revalidatePath } from 'next/cache';
import { createTask, updateTask } from '@ece/api';
import {
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  todayInZone,
  type TaskCategory,
  type TaskPriority,
} from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function addTask(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const title = str(form, 'title');
  const category = oneOf<TaskCategory>(str(form, 'category'), TASK_CATEGORIES);
  const priority = oneOf<TaskPriority>(str(form, 'priority'), TASK_PRIORITIES);
  if (title.length < 3) return { error: 'What needs doing?' };
  if (!category) return { error: 'That is not a kind of task we record.' };
  if (!priority) return { error: 'How urgent is it?' };

  const dueOn = str(form, 'dueOn');
  if (dueOn && !LOCAL_DATE.test(dueOn)) return { error: 'That is not a date.' };
  /*
    Compared against the CENTRE's today, not the server's. A manager in Auckland
    picking today's date at 9am would otherwise be told it is in the past, because for
    the whole New Zealand morning UTC is still yesterday — the class of bug AGENTS.md
    §4.3 exists for, and which `billing.ts` still contains at line 424.
  */
  if (dueOn && dueOn < todayInZone(ctx.centre.timezone)) {
    return { error: 'That day has already passed.' };
  }

  try {
    await createTask(db, {
      centreId: ctx.centre.id,
      title,
      category,
      priority,
      roomId: str(form, 'roomId') || null,
      detail: str(form, 'detail') || null,
      dueOn: dueOn || null,
      hazardId: str(form, 'hazardId') || null,
    });
  } catch (e) {
    return actionError(e, 'tasks.addTask');
  }

  revalidatePath('/tasks');
  return { ok: true };
}

/** Move a task between the two live states, or reprioritise it. */
export async function setTaskState(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  const priority = oneOf<TaskPriority>(str(form, 'priority'), TASK_PRIORITIES);
  const status = str(form, 'status');
  if (!id) return { error: 'Which task?' };
  if (status !== 'pending' && status !== 'open') {
    // Finishing goes through `finishTask`, which requires a resolution. Routing it
    // here would let a caller reach 'closed' with an empty patch and be refused by
    // the CHECK with a message written for a developer.
    return { error: 'Use Resolve to finish a task.' };
  }
  if (!priority) return { error: 'How urgent is it?' };

  try {
    await updateTask(db, id, { status, priority });
  } catch (e) {
    return actionError(e, 'tasks.setTaskState');
  }

  revalidatePath('/tasks');
  return { ok: true };
}

/**
 * Finish a task.
 *
 * A resolution is required here as well as by the CHECK in 0067, and this copy exists
 * to say why in a sentence rather than as `tasks_resolution_complete`. A queue where
 * "Closed" carries no account of what was done is a queue nobody trusts within a
 * month, and the first time somebody asks whether the gate was actually fixed there
 * is no answer in the record.
 */
export async function finishTask(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  const resolution = str(form, 'resolution');
  const status = str(form, 'status') === 'closed' ? 'closed' : 'resolved';
  if (!id) return { error: 'Which task?' };
  if (resolution.length < 3) return { error: 'Say what was done.' };

  try {
    await updateTask(db, id, { status, resolution, resolvedAt: new Date().toISOString() });
  } catch (e) {
    return actionError(e, 'tasks.finishTask');
  }

  revalidatePath('/tasks');
  return { ok: true };
}

/**
 * Reopen a finished task.
 *
 * Clears the resolution as well as the timestamp, because 0067's CHECK pairs them and
 * because a reopened task carrying last month's "Fixed the latch" is worse than one
 * carrying nothing — it reads as an account of the state it is now in.
 */
export async function reopenTask(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const id = str(form, 'id');
  if (!id) return { error: 'Which task?' };

  try {
    await updateTask(db, id, { status: 'open', resolution: null, resolvedAt: null });
  } catch (e) {
    return actionError(e, 'tasks.reopenTask');
  }

  revalidatePath('/tasks');
  return { ok: true };
}
