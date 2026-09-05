'use client';

import { useActionState } from 'react';
import {
  RECONFIRMATION_OUTCOMES,
  RECONFIRMATION_OUTCOME_LABELS,
  type EnrolmentReconfirmation,
} from '@ece/core';
import { addReconfirmation, removeReconfirmation, type Result } from '../actions';
import type { SignatoryOption } from './EnrolmentPanel';

/**
 * §6-7 reconfirmations — what unlocks a third month of a frequent-absence pattern.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SERVICE WOULD EVER FILL THIS IN
 *
 * §6-7's timeline: month one, note it and claim. Month two, re-check and claim. **Month three,
 * *"funding for absences must only be claimed if the child's enrolment agreement has been
 * reconfirmed"*.** Month four, the absences must not be claimed at all and the agreement must be
 * changed.
 *
 * So this row is worth money, and its absence costs money. Until 2026-09-05 nothing could write
 * this table while the funding calculation read it, which meant a third month was never unlocked
 * and the product under-claimed for every service that had actually done the paperwork.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO OUTCOMES, AND THEY ARE NOT DEGREES OF ONE THING
 *
 * *"Either affirming the agreement remains valid or documenting revised attendance days/times."*
 *
 * **Affirmed** says the absences were incidental. **Revised** says the agreement was wrong — and
 * satisfies month four's *"must be changed"* only when the new days are actually recorded on the
 * agreement panel below. This row does not change the schedule and must not: two sources for one
 * fact is how a funding claim stops being answerable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY REPEATS ARE ALLOWED HERE AND REFUSED EVERYWHERE ELSE
 *
 * Every other dated table in this product refuses overlapping periods. §6-7 expects a persisting
 * pattern to be reconfirmed **again**, so `0092` has no period and no exclusion constraint — only
 * one per agreement per day. A screen offering to "update" the existing one would be modelling the
 * opposite of the rule.
 */
export function ReconfirmationPanel({
  childId,
  enrolmentId,
  reconfirmations,
  guardians,
  canEdit,
}: {
  childId: string;
  /** The current enrolment. `0092` keys on the agreement, not the child. */
  enrolmentId: string | null;
  reconfirmations: EnrolmentReconfirmation[];
  /** This child's current guardians — §6-7 wants a named person, not "the family". */
  guardians: SignatoryOption[];
  canEdit: boolean;
}) {
  const [addState, add, adding] = useActionState<Result | null, FormData>(addReconfirmation, null);
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeReconfirmation,
    null,
  );

  return (
    <section>
      <h2>Agreement reconfirmations</h2>
      <p className="sub">
        Section 6-7: where a child&rsquo;s attendance has not matched their agreement for half of
        each month, the third month&rsquo;s absences may only be claimed if the agreement has been
        reconfirmed. Record the signed, dated confirmation here.
      </p>

      {reconfirmations.length === 0 ? (
        <p>
          <em>No reconfirmation is recorded.</em> If a frequent-absence pattern reaches a third
          month, that month&rsquo;s absences will not be claimed.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Confirmed</th>
              <th>By</th>
              <th>Outcome</th>
              <th>How</th>
              <th>What changed</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {reconfirmations.map((r) => (
              <tr key={r.id}>
                <td>{r.confirmedOn}</td>
                <td>{r.guardianName ?? <span className="empty">a former guardian</span>}</td>
                <td>{RECONFIRMATION_OUTCOME_LABELS[r.outcome]}</td>
                <td>{r.method}</td>
                <td>{r.detail ?? <span className="empty">—</span>}</td>
                {canEdit && (
                  <td>
                    <form action={remove} className="inline">
                      <input type="hidden" name="childId" value={childId} />
                      <input type="hidden" name="reconfirmationId" value={r.id} />
                      <button type="submit" className="link" disabled={removing}>
                        Remove
                      </button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removeState && 'error' in removeState && (
        <p role="alert" className="error">
          {removeState.error}
        </p>
      )}

      {canEdit && enrolmentId === null && (
        <p className="sub">
          A reconfirmation applies to an enrolment agreement, and this child has no current
          enrolment.
        </p>
      )}

      {canEdit && enrolmentId !== null && guardians.length === 0 && (
        <p className="sub">
          Section 6-7 wants the confirmation from a parent or guardian, and this child has none
          recorded. Add one on the Whānau tab first.
        </p>
      )}

      {canEdit && enrolmentId !== null && guardians.length > 0 && (
        <form action={add} className="stack">
          <input type="hidden" name="childId" value={childId} />
          <input type="hidden" name="enrolmentId" value={enrolmentId} />

          <label htmlFor="reconfirm-guardian">Confirmed by</label>
          <select id="reconfirm-guardian" name="guardianId" defaultValue="">
            <option value="">Choose…</option>
            {guardians.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <label htmlFor="reconfirm-on">Confirmed on</label>
          <input id="reconfirm-on" type="date" name="confirmedOn" required />

          <label htmlFor="reconfirm-outcome">Outcome</label>
          <select id="reconfirm-outcome" name="outcome" defaultValue="">
            <option value="">Choose…</option>
            {RECONFIRMATION_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {RECONFIRMATION_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>

          <label htmlFor="reconfirm-method">How</label>
          <select id="reconfirm-method" name="method" defaultValue="paper">
            <option value="paper">On paper</option>
            <option value="portal">In the whānau portal</option>
            <option value="kiosk">At the kiosk</option>
          </select>

          <label htmlFor="reconfirm-detail">What changed</label>
          <input id="reconfirm-detail" name="detail" autoComplete="off" />
          <p className="sub">
            Required when the days or times have changed. <strong>Record the new pattern on the
            agreement below as well</strong> — this note says which conversation happened, and the
            agreement is what a funding claim is worked out from.
          </p>

          <div>
            <button type="submit" disabled={adding}>
              {adding ? 'Recording…' : 'Record the reconfirmation'}
            </button>
          </div>

          {addState && 'error' in addState && (
            <p role="alert" className="error">
              {addState.error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
