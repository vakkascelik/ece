/**
 * That an identity document was sighted for a child — reads and writes for `0097`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FOURTH TABLE FOUND WITH NO WRITE PATH, AND THE FIRST FOUND BY AUDIT RATHER THAN BY USE
 *
 * `0097` shipped on 2026-09-05 with four verb-split policies, a grant, an audit trigger and
 * ninety-odd assertions in `rls_isolation.sql` — and **nothing that could put a row in it**. Its
 * commit touched four files: the migration, the RLS suite and two documents. The application
 * answer for `AST28` was updated the same day to say the identity path was built.
 *
 * It was not built. A schema is not a feature, and the RLS suite passing is not the same as the
 * feature existing — the suite writes its own rows with the service role precisely so it can test
 * policies without an application. `staff_off_floor` (0094) had the same shape and reached a UI
 * three commits later; this one had gone unnoticed until a plan audit asked what could write to
 * each new table.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A LIST, NOT A SLOT — the one place this departs from `childAddresses.ts`
 *
 * `child_addresses` has `unique (child_id, kind)`, so `(child_id, kind)` is the row's real identity
 * and both of its writers key on it. **There is no such constraint here and there must not be**: a
 * sighting is an act, and re-sighting a passport next year is a second act by a second person, not
 * a correction of the first. So `id` is the identity, exactly as in `bookingSchedule.ts`, and the
 * history is the answer `AST28` wants — "an identification document is present" is worth little
 * without who checked it and when.
 *
 * That difference is why `deleteIdentityDocument` takes an `id` and not a `(childId, kind)` pair.
 * `childAddresses.ts` records the mirror-image hazard: if its two writers disagreed about what
 * identifies a row, the save would replace one the delete could not find.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO TENANT FILTERING HERE, as everywhere in this package
 *
 * `child_identity_documents` has no `centre_id`; the tenant is resolved through the child.
 * `caller_may_see_child` reads and `caller_may_enrol` writes — character-identical to `0086`, and
 * the asymmetry is the same one: an educator and a guardian may both see that a document was
 * sighted, and neither may assert that it was. A sighting is a claim by the service.
 */

import type { ChildIdentityDocument } from '@ece/core';

import { fetchAll } from './paging';
import type { Db } from './index';

const COLUMNS = 'id, child_id, kind, sighted_by, sighted_at, note, recorded_at, recorded_by';

interface DocumentRow {
  id: string;
  child_id: string;
  kind: string | null;
  sighted_by: string | null;
  sighted_at: string | null;
  note: string | null;
  recorded_at: string;
  recorded_by: string | null;
}

const toDocument = (r: DocumentRow): ChildIdentityDocument => ({
  id: r.id,
  childId: r.child_id,
  kind: r.kind,
  sightedBy: r.sighted_by,
  sightedAt: r.sighted_at,
  note: r.note,
  recordedAt: r.recorded_at,
  recordedBy: r.recorded_by,
});

/**
 * Every recorded sighting for the given children, newest first.
 *
 * Paged, and here that is not ceremony: unlike an address there is **no unique constraint bounding
 * the row count**, so a roll of two hundred children re-verified annually is unbounded in exactly
 * the way `bounded-queries.test.ts` refuses to assume away. `sighted_at desc` matches the index
 * `0097` creates, and nulls — a document recorded as *not* sighted — sort last rather than first,
 * because an unsighted row is the weakest evidence on the list and should not head it.
 */
export async function listIdentityDocuments(
  db: Db,
  childIds: string[],
): Promise<ChildIdentityDocument[]> {
  if (childIds.length === 0) return [];
  const rows = await fetchAll<DocumentRow>('listIdentityDocuments', (from, to) =>
    db
      .from('child_identity_documents')
      .select(COLUMNS)
      .in('child_id', childIds)
      .order('sighted_at', { ascending: false, nullsFirst: false })
      // `id` last, because two sightings recorded in the same second would otherwise come back in
      // an order the database is free to change between two page loads — the same total-ordering
      // problem `readFundingPeriod` solves for its paged reads.
      .order('id', { ascending: false })
      .range(from, to),
  );
  return rows.map(toDocument);
}

export interface IdentityDocumentInput {
  childId: string;
  /** A `LookupCode` with no published list. Null or blank means the kind was not stated. */
  kind?: string | null;
  /**
   * Whether somebody actually looked at the document.
   *
   * `false` is a real and useful answer — "we have a note that a birth certificate exists and
   * nobody here has seen it" — and it is why this is a boolean rather than being inferred from
   * the presence of the row. Same shape as `addStaffRecord` and `recordImmunisation`.
   */
  sighted: boolean;
  note?: string | null;
}

const orNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Record a sighting.
 *
 * **`sighted_by` is the caller and cannot be anybody else.** The two existing writers of this
 * pattern — `addStaffRecord` (`compliance.ts`) and `recordImmunisation` (`facilities.ts`) — both
 * take a boolean and stamp `auth.user.id`, and that is the right shape rather than a convenience:
 * letting a form nominate who did the looking would turn a first-hand assertion into hearsay
 * somebody else is recorded as having made. If a colleague sighted the document, they record it.
 *
 * `sighted_at` is likewise `now()` rather than a date field. A back-dated sighting is a different
 * claim — that somebody looked on a day nobody can now check — and `0097`'s CHECK cannot tell the
 * two apart. If back-dating is ever needed it needs a column saying it was back-dated.
 *
 * The pair is written together or not at all, which is the CHECK's rule stated in code so the
 * failure is impossible rather than caught.
 */
export async function recordIdentityDocument(
  db: Db,
  input: IdentityDocumentInput,
): Promise<ChildIdentityDocument> {
  const { data: auth } = await db.auth.getUser();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('child_identity_documents')
    .insert({
      child_id: input.childId,
      kind: orNull(input.kind),
      // Both or neither — `child_identity_documents_sighting_complete`. A timestamp with nobody
      // attached is not evidence that anybody looked at the document.
      sighted_by: input.sighted ? (auth.user?.id ?? null) : null,
      sighted_at: input.sighted ? now : null,
      note: orNull(input.note),
      recorded_by: auth.user?.id ?? null,
    })
    .select(COLUMNS)
    .maybeSingle();

  if (error) {
    if (/child_identity_documents_kind_within_lookup_bound/.test(error.message)) {
      throw new Error(
        'recordIdentityDocument: the document type is a Ministry LookupCode and cannot be longer than ten characters.',
      );
    }
    if (/child_identity_documents_kind_not_blank/.test(error.message)) {
      throw new Error(
        'recordIdentityDocument: the document type cannot be only spaces. Leave it empty to record that the type was not stated.',
      );
    }
    throw new Error(`recordIdentityDocument: ${error.message}`);
  }
  /*
    Zero rows rather than an error is what an RLS refusal looks like on an INSERT … RETURNING:
    PostgREST reports success with nothing selected. Checked everywhere in this package, and it is
    the difference between "the policy refused you" and "it worked".
  */
  if (!data) {
    throw new Error(
      'recordIdentityDocument: nothing was written. Either the child does not exist or the policy refused it.',
    );
  }
  return toDocument(data as DocumentRow);
}

/**
 * Remove a sighting.
 *
 * Deletable — unlike the append-only ledgers — because a sighting recorded against the wrong child
 * is an assertion about a document nobody looked at, and leaving it while adding a correction
 * would make the record say two contradictory things about one child's identity. The audit trigger
 * keeps who removed it and when, which is the property that makes deletion safe here.
 *
 * Keyed on `id` for the reason in the header: these rows are a list, and nothing else tells two
 * sightings of the same kind apart.
 */
export async function deleteIdentityDocument(db: Db, id: string): Promise<void> {
  const { data, error } = await db
    .from('child_identity_documents')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`deleteIdentityDocument: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'deleteIdentityDocument: nothing was deleted. Either there is no such record or the policy refused it.',
    );
  }
}
