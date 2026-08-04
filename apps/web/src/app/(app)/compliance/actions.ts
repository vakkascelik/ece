'use server';

import { revalidatePath } from 'next/cache';
import {
  addEvidence,
  addStaffRecord,
  archiveEvidence,
  archiveStaffRecord,
  markSighted,
  EVIDENCE_KINDS,
  type EvidenceKind,
} from '@ece/api';
import { STAFF_RECORD_KINDS, type StaffRecordKind } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();
const bool = (f: FormData, k: string): boolean => f.get(k) === 'on' || f.get(k) === 'true';

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function recordStaffDocument(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const personName = str(form, 'personName');
  const kind = oneOf<StaffRecordKind>(str(form, 'kind'), STAFF_RECORD_KINDS);
  const issuedOn = str(form, 'issuedOn');
  const expiresOn = str(form, 'expiresOn');

  if (!personName) return { error: 'Whose record is this?' };
  if (!kind) return { error: 'That is not a kind of record we track.' };
  if (issuedOn && !ISO_DATE.test(issuedOn)) return { error: 'That issue date is not a date.' };
  if (expiresOn && !ISO_DATE.test(expiresOn)) return { error: 'That expiry date is not a date.' };
  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    return { error: 'The expiry is before the issue date.' };
  }
  // A vetting or certificate with no expiry is almost always an unfinished record rather
  // than a document that never lapses, and a blank expiry silently never warns.
  if (!expiresOn && kind !== 'child_protection_training' && kind !== 'other') {
    return {
      error:
        'Put the expiry date from the document. Without one this record will never come up for renewal.',
    };
  }

  try {
    await addStaffRecord(db, ctx.centre.id, {
      personName,
      kind,
      roleNote: str(form, 'roleNote') || null,
      reference: str(form, 'reference') || null,
      issuedOn: issuedOn || null,
      expiresOn: expiresOn || null,
      note: str(form, 'note') || null,
      sighted: bool(form, 'sighted'),
    });
  } catch (e) {
    return actionError(e, 'compliance.recordStaffDocument');
  }

  revalidatePath('/compliance');
  return { ok: true };
}

/** Records that somebody has now seen the original document. */
export async function sight(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();
  const id = str(form, 'recordId');
  if (!id) return { error: 'Missing record.' };
  try {
    await markSighted(db, id);
  } catch (e) {
    return actionError(e, 'compliance.sight');
  }
  revalidatePath('/compliance');
  return { ok: true };
}

export async function retireStaffRecord(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();
  const id = str(form, 'recordId');
  if (!id) return { error: 'Missing record.' };
  try {
    await archiveStaffRecord(db, id);
  } catch (e) {
    return actionError(e, 'compliance.retireStaffRecord');
  }
  revalidatePath('/compliance');
  return { ok: true };
}

export async function fileEvidence(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const title = str(form, 'title');
  const kind = oneOf<EvidenceKind>(str(form, 'kind'), EVIDENCE_KINDS);
  const criterionId = str(form, 'criterionId');

  if (!title) return { error: 'Give it a title somebody will recognise in a year.' };
  if (!kind) return { error: 'That is not a kind of evidence we file.' };

  try {
    await addEvidence(db, ctx.centre.id, {
      // Unattached evidence is allowed: a centre often knows it has a document before it
      // knows which criterion it answers, and refusing it would mean losing the note.
      criterionId: criterionId || null,
      kind,
      title,
      detail: str(form, 'detail') || null,
      location: str(form, 'location') || null,
      coversFrom: str(form, 'coversFrom') || null,
      coversTo: str(form, 'coversTo') || null,
      ownerName: str(form, 'ownerName') || null,
    });
  } catch (e) {
    return actionError(e, 'compliance.fileEvidence');
  }

  revalidatePath('/compliance');
  return { ok: true };
}

export async function retireEvidence(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageCentre');
  const db = await serverDb();
  const id = str(form, 'evidenceId');
  if (!id) return { error: 'Missing item.' };
  try {
    await archiveEvidence(db, id);
  } catch (e) {
    return actionError(e, 'compliance.retireEvidence');
  }
  revalidatePath('/compliance');
  return { ok: true };
}
