'use client';

import { useActionState } from 'react';
import {
  EXEMPTION_BASES,
  EXEMPTION_BASIS_LABELS,
  EXEMPTION_EVIDENCE,
  EXEMPTION_EVIDENCE_LABELS,
  type AbsenceExemption,
} from '@ece/core';
import { addExemption, endExemption, removeExemption, type Result } from '../actions';

/**
 * §7-7 absence-rule exemptions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CHANGES, AND IT IS A FUNDING FIGURE
 *
 * With an exemption in force, §6-5's three-week absence window becomes **twelve**. Without one it
 * is three. The rule has been implemented and mutation-tested since 2026-09-04 and **nothing could
 * write this table until 2026-09-05**, so every window was three weeks and the product
 * under-claimed for every exempt child.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT IS NOT AN APPROVAL, AND THE WORDS ON THE SCREEN HAVE TO SAY SO
 *
 * §7-7: *"Services must complete an EC12 form (and EC13 where applicable) with supporting
 * documentation, retained by the service and provided to the Ministry or Resourcing Auditors upon
 * request."* Nothing is submitted and nothing comes back approved. So there is no status here, no
 * "pending", and the date field is named for what it is — when the **service** completed its own
 * form.
 *
 * A screen that showed an exemption as *approved* would be inventing a decision nobody made, on
 * the record a Resourcing Auditor asks for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE RULES BETWEEN THE FIELDS ARE §7-7's, NOT A FORM'S PREFERENCES
 *
 * A short-term illness is evidenced by an EC13 and nothing else — a Child Disability Allowance
 * letter does not evidence a fortnight of chickenpox. A short-term exemption must have an end
 * date, because §7-7 wants *"an EC13 form specifying the exemption period"*. An IDP must carry its
 * issue date, because the section requires one *"issued within previous 6 months"* and without a
 * date that condition cannot be answered at all.
 *
 * All three are CHECK constraints in `0089` as well. The form states them in words so the message
 * names the rule; the database refuses them so a hand-posted form gets the same answer.
 */
export function ExemptionPanel({
  childId,
  enrolmentId,
  exemptions,
  canEdit,
  today,
}: {
  childId: string;
  /** The current enrolment. §7-7 scopes an exemption to an agreement, not to a child. */
  enrolmentId: string | null;
  exemptions: AbsenceExemption[];
  canEdit: boolean;
  today: string;
}) {
  const [addState, add, adding] = useActionState<Result | null, FormData>(addExemption, null);
  const [endState, end, ending] = useActionState<Result | null, FormData>(endExemption, null);
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeExemption,
    null,
  );

  return (
    <section>
      <h2>Absence-rule exemptions</h2>
      <p className="sub">
        With an exemption in force, funding may be claimed for absences within <strong>twelve</strong>{' '}
        weeks of the first day rather than three. Section 7-7 asks the service to complete an EC12
        form and keep the evidence — <strong>nothing is submitted to the Ministry and nothing comes
        back approved</strong>, so this records what you hold.
      </p>

      {exemptions.length === 0 ? (
        <p>
          <em>No exemption is recorded for this child.</em> Absences are assessed against the
          three-week rule.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Basis</th>
              <th>Evidence</th>
              <th>EC12 completed</th>
              {canEdit && <th>Change</th>}
            </tr>
          </thead>
          <tbody>
            {exemptions.map((e) => {
              /*
                "In force" is a date comparison against the centre's today, not a stored flag —
                the same rule `coversDate` applies everywhere else, and a stored one would be
                wrong the morning after it expired.
              */
              const inForce = e.exemptFrom <= today && (e.exemptTo === null || e.exemptTo >= today);
              return (
                <tr key={e.id}>
                  <td>{e.exemptFrom}</td>
                  <td>
                    {e.exemptTo ?? <span className="empty">open-ended</span>}{' '}
                    {inForce && <span className="flag flag-quiet">in force</span>}
                  </td>
                  <td>{EXEMPTION_BASIS_LABELS[e.basis]}</td>
                  <td>
                    {EXEMPTION_EVIDENCE_LABELS[e.evidence]}
                    {e.evidenceDatedOn && <span className="sub"> · dated {e.evidenceDatedOn}</span>}
                  </td>
                  <td>{e.ec12CompletedOn}</td>
                  {canEdit && (
                    <td>
                      {/*
                        Ending is offered only on an open-ended exemption, and the overlap
                        constraint is why: a new exemption cannot be recorded while one still
                        covers those days, so ending the current one is the ordinary first step.
                      */}
                      {e.exemptTo === null && (
                        <form action={end} className="inline">
                          <input type="hidden" name="childId" value={childId} />
                          <input type="hidden" name="exemptionId" value={e.id} />
                          <label htmlFor={`end-${e.id}`} className="sr-only">
                            Ends on
                          </label>
                          <input id={`end-${e.id}`} type="date" name="exemptTo" required />
                          <button type="submit" disabled={ending}>
                            End
                          </button>
                        </form>
                      )}
                      <form action={remove} className="inline">
                        <input type="hidden" name="childId" value={childId} />
                        <input type="hidden" name="exemptionId" value={e.id} />
                        <button type="submit" className="link" disabled={removing}>
                          Remove
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {endState && 'error' in endState && (
        <p role="alert" className="error">
          {endState.error}
        </p>
      )}
      {removeState && 'error' in removeState && (
        <p role="alert" className="error">
          {removeState.error}
        </p>
      )}

      {canEdit && enrolmentId === null && (
        <p className="sub">
          An exemption applies to an enrolment agreement, and this child has no current enrolment —
          section 7-7 says exemptions <em>&ldquo;apply only to specific enrolment
          agreements&rdquo;</em>. Enrol them first.
        </p>
      )}

      {canEdit && enrolmentId !== null && (
        <form action={add} className="stack">
          <input type="hidden" name="childId" value={childId} />
          <input type="hidden" name="enrolmentId" value={enrolmentId} />

          <label htmlFor="basis">Basis</label>
          <select id="basis" name="basis" defaultValue="">
            <option value="">Choose…</option>
            {EXEMPTION_BASES.map((b) => (
              <option key={b} value={b}>
                {EXEMPTION_BASIS_LABELS[b]}
              </option>
            ))}
          </select>

          <label htmlFor="evidence">Evidence held</label>
          <select id="evidence" name="evidence" defaultValue="">
            <option value="">Choose…</option>
            {EXEMPTION_EVIDENCE.map((e) => (
              <option key={e} value={e}>
                {EXEMPTION_EVIDENCE_LABELS[e]}
              </option>
            ))}
          </select>
          <p className="sub">
            A short-term illness is evidenced by an EC13 and nothing else, and needs an end date. An
            Individual Development Plan needs its issue date, because section 7-7 wants one issued
            within the previous 6 months.
          </p>

          <label htmlFor="evidenceDatedOn">Date on the evidence</label>
          <input id="evidenceDatedOn" type="date" name="evidenceDatedOn" />

          <label htmlFor="ec12CompletedOn">EC12 completed on</label>
          <input id="ec12CompletedOn" type="date" name="ec12CompletedOn" required />

          <label htmlFor="exemptFrom">Exempt from</label>
          <input id="exemptFrom" type="date" name="exemptFrom" required />

          <label htmlFor="exemptTo">Exempt to</label>
          <input id="exemptTo" type="date" name="exemptTo" />
          <p className="sub">
            Leave the end date blank only for an ongoing learning support need.
          </p>

          <label htmlFor="exemption-notes">Notes</label>
          <input id="exemption-notes" name="notes" autoComplete="off" />

          <div>
            <button type="submit" disabled={adding}>
              {adding ? 'Recording…' : 'Record the exemption'}
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
