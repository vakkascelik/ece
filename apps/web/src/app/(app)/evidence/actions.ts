'use server';

import { revalidatePath } from 'next/cache';
import {
  createEvidencePhoto,
  deleteEvidencePhoto,
  evidenceStoragePath,
  listIncidentPhotos,
  listRunPhotos,
} from '@ece/api';
import { EVIDENCE_BUCKET } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

/**
 * Which page to refresh, and the one-parent rule shared by both actions.
 *
 * The freeze itself — no photo on a final incident or a completed run — is 0075's
 * policies, not this file. What lands here when the policy refuses is a Postgres
 * error, and `actionError` turns it into a sentence.
 */
function parentOf(form: FormData): { incidentId: string | null; runId: string | null; path: string } | null {
  const incidentId = str(form, 'incidentId') || null;
  const runId = str(form, 'runId') || null;
  if (incidentId && runId) return null;
  if (incidentId) return { incidentId, runId: null, path: `/incidents/${incidentId}` };
  if (runId) return { incidentId: null, runId, path: `/checklists/${runId}` };
  return null;
}

/** The bucket's own allowlist, repeated here so the refusal is a sentence, not a storage error. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export async function attachEvidencePhoto(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const parent = parentOf(form);
  if (!parent) return { error: 'Which record is this photo for?' };

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a photo first.' };
  if (!IMAGE_TYPES.includes(file.type)) {
    return { error: 'Photos only — JPEG, PNG, WebP or HEIC.' };
  }

  const storagePath = evidenceStoragePath(ctx.centre.id, file.name);

  const { error: uploadError } = await db.storage
    .from(EVIDENCE_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });
  if (uploadError) return { error: `The upload failed: ${uploadError.message}` };

  try {
    await createEvidencePhoto(db, {
      centreId: ctx.centre.id,
      incidentId: parent.incidentId,
      runId: parent.runId,
      storagePath,
      mimeType: file.type || null,
      byteSize: file.size,
      caption: str(form, 'caption') || null,
    });
  } catch (e) {
    // The row was refused — a finalised report, a completed run, a policy saying
    // no. The object must not outlive the refusal: with no row it is unreachable
    // and only the sweeper would ever find it.
    await db.storage.from(EVIDENCE_BUCKET).remove([storagePath]);
    return actionError(e, 'evidence.attach');
  }

  revalidatePath(parent.path);
  return { ok: true };
}

export async function removeEvidencePhoto(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const parent = parentOf(form);
  const photoId = str(form, 'photoId');
  if (!parent || !photoId) return { error: 'Which photo?' };

  try {
    // Re-read rather than trusting the form for the storage path: a path from a
    // hidden input would let a stale or edited form delete an arbitrary object the
    // caller's folder policy happens to allow.
    const photos = parent.incidentId
      ? await listIncidentPhotos(db, parent.incidentId)
      : await listRunPhotos(db, parent.runId!);
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) return { error: 'That photo is no longer there.' };
    await deleteEvidencePhoto(db, photo);
  } catch (e) {
    return actionError(e, 'evidence.remove');
  }

  revalidatePath(parent.path);
  return { ok: true };
}
