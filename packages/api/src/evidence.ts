/**
 * Evidence photos (0075): staff-only documentation on incidents and checklist runs.
 *
 * Not media, and none of `engagement.ts`'s consent machinery applies — consent is
 * for publication (owner ruling 2026-08-29, unverified-claims 42), and nothing in
 * this module is ever surfaced to a family. As everywhere in this package, no
 * tenant filtering: 0075's policies hold the boundary, including the freeze — a
 * photo can be attached or removed only while its parent is a draft incident or
 * an incomplete run, and the policy (not this code) is what refuses the rest.
 */

import { EVIDENCE_BUCKET, type EvidencePhoto } from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

const EVIDENCE_COLUMNS =
  'id, centre_id, incident_id, run_id, storage_path, mime_type, byte_size, caption, uploaded_by, created_at';

interface EvidenceRow {
  id: string;
  centre_id: string;
  incident_id: string | null;
  run_id: string | null;
  storage_path: string;
  mime_type: string | null;
  byte_size: number | null;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const toEvidencePhoto = (r: EvidenceRow): EvidencePhoto => ({
  id: r.id,
  centreId: r.centre_id,
  incidentId: r.incident_id,
  runId: r.run_id,
  storagePath: r.storage_path,
  mimeType: r.mime_type,
  byteSize: r.byte_size,
  caption: r.caption,
  uploadedBy: r.uploaded_by,
  createdAt: r.created_at,
});

/**
 * Where an upload should go. Same convention as `mediaStoragePath` and duplicated
 * rather than shared because the two must be free to diverge — the media path is
 * part of the consent gate's storage policy and this one is not.
 */
export function evidenceStoragePath(centreId: string, filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : 'bin';
  // Never the original filename — it can carry a child's name, and a storage path
  // is visible in more places than a database column.
  return `${centreId}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/g, '')}`;
}

/** Photos on one incident, oldest first — the order they were attached. */
export async function listIncidentPhotos(db: Db, incidentId: string): Promise<EvidencePhoto[]> {
  const rows = await fetchAll<EvidenceRow>('listIncidentPhotos', (a, b) =>
    db
      .from('evidence_photos')
      .select(EVIDENCE_COLUMNS)
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: true })
      .range(a, b),
  );
  return rows.map(toEvidencePhoto);
}

/** Photos on one checklist run, oldest first. */
export async function listRunPhotos(db: Db, runId: string): Promise<EvidencePhoto[]> {
  const rows = await fetchAll<EvidenceRow>('listRunPhotos', (a, b) =>
    db
      .from('evidence_photos')
      .select(EVIDENCE_COLUMNS)
      .eq('run_id', runId)
      .order('created_at', { ascending: true })
      .range(a, b),
  );
  return rows.map(toEvidencePhoto);
}

export interface CreateEvidencePhotoInput {
  centreId: string;
  /** Exactly one of these, matching the table's CHECK. */
  incidentId?: string | null;
  runId?: string | null;
  storagePath: string;
  mimeType?: string | null;
  byteSize?: number | null;
  caption?: string | null;
}

export async function createEvidencePhoto(
  db: Db,
  input: CreateEvidencePhotoInput,
): Promise<EvidencePhoto> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('evidence_photos')
    .insert({
      centre_id: input.centreId,
      incident_id: input.incidentId ?? null,
      run_id: input.runId ?? null,
      storage_path: input.storagePath,
      mime_type: input.mimeType ?? null,
      byte_size: input.byteSize ?? null,
      caption: input.caption?.trim() || null,
      uploaded_by: auth.user?.id ?? null,
    })
    .select(EVIDENCE_COLUMNS)
    .single();
  if (error) throw new Error(`createEvidencePhoto: ${error.message}`);
  return toEvidencePhoto(data as EvidenceRow);
}

/**
 * Remove a photo from a still-editable parent.
 *
 * ROW FIRST, THEN OBJECT — the reverse of `deleteMedia`'s order, forced by 0075's
 * storage policy: an object is deletable only while no row references it, which is
 * what keeps a finalised report's photograph beyond reach. Deleting the object
 * first would therefore always be refused. If the object removal fails after the
 * row is gone, the orphan is unreachable (no row, no signable read path for it to
 * matter) and the sweeper clears it.
 */
export async function deleteEvidencePhoto(db: Db, photo: EvidencePhoto): Promise<void> {
  const { error, count } = await db
    .from('evidence_photos')
    .delete({ count: 'exact' })
    .eq('id', photo.id);
  if (error) throw new Error(`deleteEvidencePhoto: ${error.message}`);
  // Zero rows means the policy refused — the parent has been finalised or completed
  // since the screen was rendered. Said plainly rather than silently leaving the
  // photo in place under a button that appeared to work.
  if (count === 0) {
    throw new Error(
      'deleteEvidencePhoto: nothing was removed. The report or run this photo belongs to has been finalised, and its photos are frozen with it.',
    );
  }
  await db.storage.from(EVIDENCE_BUCKET).remove([photo.storagePath]);
}

/**
 * A time-limited URL for a private evidence object. Same contract as
 * `signMediaUrl`: null is a malfunction (storage unreachable, bad path), never an
 * access decision — a caller who may not read the photo never received its row.
 */
export async function signEvidenceUrl(
  db: Db,
  storagePath: string,
  expiresInSeconds = 900,
): Promise<string | null> {
  const { data, error } = await db.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
