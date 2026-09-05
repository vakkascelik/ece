import type {
  AbsenceExemption,
  ExemptionBasis,
  ExemptionEvidence,
} from '@ece/core';

import { fetchAll } from './paging';
import type { Db } from './index';

/**
 * §7-7 absence-rule exemptions — `absence_exemptions` (0089).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS SEPARATELY FROM THE READ IN `billing.ts`
 *
 * `readFundingPeriod` has read this table since 2026-09-04 to widen §6-5's window from three
 * weeks to twelve. **Nothing could write it** until 2026-09-05 — the rule was implemented and
 * mutation-tested against a table no screen could fill, so every window was three weeks and the
 * product under-claimed for every exempt child.
 *
 * Found by writing `AST50`'s data-source mapping table, which asks *where is this editable* for
 * every parameter. Two other tables were in the same state.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT IS NOT AN APPROVAL, AND THE SHAPE SAYS SO
 *
 * §7-7: *"Services must complete an EC12 form (and EC13 where applicable) with supporting
 * documentation, retained by the service and provided to the Ministry or Resourcing Auditors upon
 * request."* No application goes to the Ministry and no decision comes back, which is why `0089`
 * has no status column and no `approved_at` — those would be four lies at once. `ec12CompletedOn`
 * is the date the **service** completed its own form.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * KEYED ON THE ENROLMENT, NOT THE CHILD
 *
 * §7-7: *"Exemptions apply only to specific enrolment agreements."* A child who leaves and returns
 * has two agreements, and an exemption against the first must not carry to the second.
 *
 * No tenant filtering here, as everywhere in this package. `0089`'s policies are
 * `caller_may_exempt` — owner or manager — on every verb.
 */

const COLUMNS =
  'id, enrolment_id, basis, evidence, evidence_dated_on, ec12_completed_on, exempt_from, exempt_to, notes';

interface ExemptionRow {
  id: string;
  enrolment_id: string;
  basis: string;
  evidence: string;
  evidence_dated_on: string | null;
  ec12_completed_on: string;
  exempt_from: string;
  exempt_to: string | null;
  notes: string | null;
}

const toExemption = (r: ExemptionRow): AbsenceExemption => ({
  id: r.id,
  enrolmentId: r.enrolment_id,
  // Cast rather than re-validated: `0089`'s CHECKs hold the same two and three values the core
  // constants do, and a second copy of an enumeration is how the two start to disagree.
  basis: r.basis as ExemptionBasis,
  evidence: r.evidence as ExemptionEvidence,
  evidenceDatedOn: r.evidence_dated_on,
  ec12CompletedOn: r.ec12_completed_on,
  exemptFrom: r.exempt_from,
  exemptTo: r.exempt_to,
  notes: r.notes,
});

/**
 * Every exemption for a child's enrolments, expired ones included.
 *
 * History is shown, not filtered: an exemption that ended last term is what explains why a claim
 * for last term was twelve weeks rather than three, and a screen that hides it makes the figure
 * unexplainable. Paged for the same reason `listBookingSchedule` is — one per illness over the
 * life of an enrolment adds up, and a truncated read would silently narrow a funding window.
 */
export async function listExemptionsForChild(
  db: Db,
  childId: string,
): Promise<AbsenceExemption[]> {
  const rows = await fetchAll<ExemptionRow>('listExemptionsForChild', (from, to) =>
    db
      .from('absence_exemptions')
      .select(`${COLUMNS}, enrolments!inner(child_id)`)
      .eq('enrolments.child_id', childId)
      .order('exempt_from', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toExemption);
}

export interface ExemptionInput {
  enrolmentId: string;
  basis: ExemptionBasis;
  evidence: ExemptionEvidence;
  evidenceDatedOn?: string | null;
  ec12CompletedOn: string;
  exemptFrom: string;
  exemptTo?: string | null;
  notes?: string | null;
}

/**
 * Record an exemption.
 *
 * The four CHECKs in `0089` are transcriptions of §7-7, so a violation means the service has
 * recorded something the section does not allow — which is worth saying in words rather than
 * handing back a constraint name. A funding window is chosen from this row, and a manager sent
 * hunting through five fields by a bare `23514` will pick the wrong one.
 */
export async function addExemption(db: Db, input: ExemptionInput): Promise<AbsenceExemption> {
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from('absence_exemptions')
    .insert({
      enrolment_id: input.enrolmentId,
      basis: input.basis,
      evidence: input.evidence,
      evidence_dated_on: input.evidenceDatedOn ?? null,
      ec12_completed_on: input.ec12CompletedOn,
      exempt_from: input.exemptFrom,
      exempt_to: input.exemptTo ?? null,
      notes: input.notes?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    if (/absence_exemptions_short_term_needs_ec13/.test(error.message)) {
      throw new Error(
        'addExemption: §7-7 evidences a short-term illness with an EC13 form and nothing else.',
      );
    }
    if (/absence_exemptions_short_term_is_bounded/.test(error.message)) {
      throw new Error(
        'addExemption: a short-term illness exemption needs an end date — §7-7 wants "an EC13 form specifying the exemption period".',
      );
    }
    if (/absence_exemptions_idp_needs_a_date/.test(error.message)) {
      throw new Error(
        'addExemption: an Individual Development Plan needs its issue date, because §7-7 requires one issued within the previous 6 months.',
      );
    }
    if (/absence_exemptions_dates_ordered/.test(error.message)) {
      throw new Error('addExemption: the exemption cannot end before it starts.');
    }
    if (/absence_exemptions_no_overlap/.test(error.message)) {
      throw new Error(
        'addExemption: this agreement already has an exemption covering some of those days. Two answers for one day is not a choice the funding calculation can make — end the existing one first.',
      );
    }
    throw new Error(`addExemption: ${error.message}`);
  }
  return toExemption(data as ExemptionRow);
}

/**
 * End an open exemption on a date.
 *
 * Separate from a general update, and the same shape `endScheduleBlock` and `endContactHours`
 * keep: ending is the ordinary act and rewriting the dates is not, so the ordinary act gets the
 * narrow function. The overlap constraint makes the order matter — end the current one, then
 * record the next.
 */
export async function endExemption(db: Db, id: string, exemptTo: string): Promise<void> {
  const { error } = await db
    .from('absence_exemptions')
    .update({ exempt_to: exemptTo })
    .eq('id', id);
  if (error) throw new Error(`endExemption: ${error.message}`);
}

/**
 * Remove one.
 *
 * Deletable rather than archivable, matching `0089`'s policies, because an exemption recorded
 * against the wrong enrolment is a mistake rather than history — and the audit trail keeps the
 * record of it having existed.
 */
export async function deleteExemption(db: Db, id: string): Promise<void> {
  const { error } = await db.from('absence_exemptions').delete().eq('id', id);
  if (error) throw new Error(`deleteExemption: ${error.message}`);
}
