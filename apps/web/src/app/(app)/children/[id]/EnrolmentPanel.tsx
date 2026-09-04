'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  ENROLMENT_TYPES,
  ENROLMENT_TYPE_LABELS,
  enrolmentRecordGaps,
  formatDays,
  isEnrolmentCurrent,
  WEEKDAY_LABELS,
  type Enrolment,
} from '@ece/core';
import { completeEnrolmentRecord, endEnrolment, fileEnrolment, type Result } from '../actions';

/**
 * A guardian this child actually has, for the signatory pickers.
 *
 * A PICKER AND NOT A TEXT BOX, and that is `0087`'s doing rather than a design preference:
 * `signed_by` is a `guardians.id` and a trigger requires it to be a current guardian of this
 * child. A free-text name could not satisfy that, and a picker offering every guardian at the
 * centre would offer choices the database refuses — so the list is the child's own.
 */
export interface SignatoryOption {
  id: string;
  name: string;
}

/**
 * The signatory picker, once, because three forms need it.
 *
 * The empty option is "not recorded" rather than a prompt to choose, and it is the default
 * everywhere. Nothing preselects the first guardian: a signature is a claim that a named
 * person signed something, and a form that fills one in by default manufactures that claim
 * from a page load.
 */
function SignatoryPicker({
  id,
  name,
  guardians,
  defaultValue,
  label,
}: {
  id: string;
  name: string;
  guardians: SignatoryOption[];
  defaultValue?: string;
  label: string;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={defaultValue ?? ''}>
        <option value="">Not recorded</option>
        {guardians.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The three §6-1 fields that are neither the dates nor the days, shared by the file form and
 * the completion form so the two cannot drift into disagreeing about what the rule asks for.
 */
function RecordFields({
  guardians,
  enrolment,
  idPrefix,
}: {
  guardians: SignatoryOption[];
  /** Present when completing an existing record; absent when filing a new one. */
  enrolment?: Enrolment;
  idPrefix: string;
}) {
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-other-hours`}>Hours a week at another service</label>
        <input
          className="narrow"
          id={`${idPrefix}-other-hours`}
          name="hoursAtOtherServicePerWeek"
          type="number"
          min="0"
          max="50"
          step="0.25"
          defaultValue={enrolment?.hoursAtOtherServicePerWeek ?? ''}
        />
        <p className="sub">
          What the parent says the child is enrolled for elsewhere. <strong>Enter 0</strong> if
          they attend no other service &mdash; that is an answer, and leaving it blank is not.
          The daily and weekly funding caps follow the child rather than the service, so a
          child at two services can go over between them.
        </p>
      </div>

      <div className="row">
        <div>
          <label htmlFor={`${idPrefix}-signed-on`}>Enrolment record signed on</label>
          <input
            className="narrow"
            id={`${idPrefix}-signed-on`}
            name="signedOn"
            type="date"
            defaultValue={enrolment?.signedOn ?? ''}
          />
        </div>
        <SignatoryPicker
          id={`${idPrefix}-signed-by`}
          name="signedBy"
          guardians={guardians}
          defaultValue={enrolment?.signedBy ?? ''}
          label="Signed by"
        />
      </div>

      <div className="row">
        <div>
          <label htmlFor={`${idPrefix}-attested-on`}>20 Hours ECE attested on</label>
          <input
            className="narrow"
            id={`${idPrefix}-attested-on`}
            name="twentyHoursAttestedOn"
            type="date"
            defaultValue={enrolment?.twentyHoursAttestedOn ?? ''}
          />
        </div>
        <SignatoryPicker
          id={`${idPrefix}-attested-by`}
          name="twentyHoursAttestedBy"
          guardians={guardians}
          defaultValue={enrolment?.twentyHoursAttestedBy ?? ''}
          label="Attested by"
        />
      </div>
      <p className="sub">
        Both signatures are the parent&rsquo;s, not yours. Only fill them in once somebody has
        actually signed &mdash; a date entered to clear a warning is a record of something that
        did not happen.
      </p>

      {/*
        §6-5 NOTICE, AND IT IS NOT ONE OF THE FIELDS ABOVE.

        Everything above is a §6-1 record field: something the enrolment record must contain.
        This is an event that STOPS funding from its date, and the Handbook applies it "even if
        the three week period has not ended". Separated by a rule and its own heading, because
        somebody skimming a column of date-and-guardian pairs would otherwise read it as a
        third signature.

        Only offered on an existing enrolment, never on the form that files one: an enrolment
        filed with notice already given is not a case that happens, and the field would invite
        confusion with the last day.
      */}
      {enrolment && (
        <div style={{ borderTop: '1px solid var(--line)', marginTop: '1rem', paddingTop: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem' }}>Leaving</h4>
          <div className="row">
            <div>
              <label htmlFor={`${idPrefix}-notice-on`}>Notice given on</label>
              <input
                className="narrow"
                id={`${idPrefix}-notice-on`}
                name="noticeGivenOn"
                type="date"
                defaultValue={enrolment.noticeGivenOn ?? ''}
              />
            </div>
            <SignatoryPicker
              id={`${idPrefix}-notice-by`}
              name="noticeGivenBy"
              guardians={guardians}
              defaultValue={enrolment.noticeGivenBy ?? ''}
              label="Told to us by"
            />
          </div>
          <p className="sub">
            The date a family told you the child is not coming back. <strong>Not the last day</strong>
            &mdash; notice usually comes first, and the funding rules stop from the date you were
            told, not from the date they leave. Clear both fields if a family changes its mind.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Enrolment history, newest first.
 *
 * Enrolments are never edited into each other or deleted — a child who leaves and
 * comes back has two rows, and the roll return for last March has to still be
 * answerable from what is here. The database refuses overlapping rows outright,
 * because two overlapping enrolments double-count funded hours and the error only
 * surfaces months later as a discrepancy nobody can trace.
 */
export function EnrolmentPanel({
  childId,
  enrolments,
  canEdit,
  today,
  guardians,
}: {
  childId: string;
  enrolments: Enrolment[];
  canEdit: boolean;
  /** The date at the centre. Passed in rather than computed — see the child page. */
  today: string;
  /** This child's guardians, for the §6-1 signatory pickers. */
  guardians: SignatoryOption[];
}) {
  const [filing, setFiling] = useState(false);
  const hasOpen = enrolments.some((e) => e.endDate === null);

  return (
    <div className="card">
      {enrolments.length === 0 ? (
        <p className="empty">No enrolment on file.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Days</th>
              <th>Funded hours</th>
              <th>Status</th>
              {canEdit && <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>}
            </tr>
          </thead>
          <tbody>
            {enrolments.map((e) => (
              <EnrolmentRow
                key={e.id}
                childId={childId}
                enrolment={e}
                canEdit={canEdit}
                today={today}
                guardians={guardians}
              />
            ))}
          </tbody>
        </table>
      )}

      {canEdit && !filing && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setFiling(true)}>
            File an enrolment
          </button>
          {hasOpen && (
            <span className="sub" style={{ marginLeft: '0.6rem', fontSize: '0.8125rem' }}>
              There is an open enrolment — end it first, or the dates will overlap.
            </span>
          )}
        </p>
      )}
      {canEdit && filing && (
        <EnrolmentForm childId={childId} guardians={guardians} onDone={() => setFiling(false)} />
      )}
    </div>
  );
}

function EnrolmentRow({
  childId,
  enrolment,
  canEdit,
  today,
  guardians,
}: {
  childId: string;
  enrolment: Enrolment;
  canEdit: boolean;
  today: string;
  guardians: SignatoryOption[];
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(endEnrolment, null);
  const [completeState, complete, completing] = useActionState<Result | null, FormData>(
    completeEnrolmentRecord,
    null,
  );
  const [ending, setEnding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const error =
    (state && 'error' in state ? state.error : null) ??
    (completeState && 'error' in completeState ? completeState.error : null);
  useEffect(() => {
    if (state && 'ok' in state) setEnding(false);
  }, [state]);
  useEffect(() => {
    if (completeState && 'ok' in completeState) setExpanded(false);
  }, [completeState]);

  const gaps = enrolmentRecordGaps(enrolment);

  const current = isEnrolmentCurrent(enrolment, today);

  return (
    <>
    <tr>
      <td>{enrolment.startDate}</td>
      <td>{enrolment.endDate ?? <span className="empty">open</span>}</td>
      <td>{formatDays(enrolment.days)}</td>
      <td>
        {enrolment.fundedHoursPerWeek}
        {enrolment.twentyHoursEce && (
          <>
            {' '}
            <span className="flag flag-quiet">20 Hours ECE</span>
          </>
        )}
        {/*
          Shown only when stated. An absent flag reads as "nobody has said", which is the
          truth for every enrolment filed before 0084 — a flag saying "permanent" by default
          would be this product asserting the thing that decides whether absences may be
          claimed.
        */}
        {enrolment.enrolmentType && (
          <>
            {' '}
            <span className="flag flag-quiet">
              {ENROLMENT_TYPE_LABELS[enrolment.enrolmentType]}
            </span>
          </>
        )}
      </td>
      <td>
        {current ? (
          <span className="flag flag-ok">✓ current</span>
        ) : (
          <span className="flag flag-quiet">ended</span>
        )}
        {/*
          §6-1's required contents, named rather than scored. Every item is required, so this
          is not a completeness percentage — four missing fields is not "80% complete", it is a
          record that does not meet the rule. The flag is only ever absent or warning.

          Shown to everybody who can see the row, not only to somebody who can edit: an
          educator seeing that a record is incomplete is how it gets mentioned to the person
          who can fix it.
        */}
        {gaps.length > 0 && (
          <>
            {' '}
            <span className="flag flag-warn">Record incomplete</span>
          </>
        )}
        {error && <div className="error" role="alert">{error}</div>}
      </td>
      {canEdit && (
        <td>
          {/*
            Offered on every row rather than only on incomplete ones, because a recorded
            signature sometimes has to be corrected — a date typed wrong, or the wrong parent
            picked from the list — and a button that vanishes on success would make the one
            thing this panel writes the one thing it cannot fix.
          */}
          <button
            className="secondary small"
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Close' : gaps.length > 0 ? 'Complete' : 'Details'}
          </button>{' '}
          {enrolment.endDate === null ? (
            ending ? (
              <form action={action} className="inline">
                <input type="hidden" name="enrolmentId" value={enrolment.id} />
                <input type="hidden" name="childId" value={childId} />
                <input
                  className="narrow"
                  name="endDate"
                  type="date"
                  required
                  defaultValue={today}
                  aria-label="Last day"
                />
                <button className="small" type="submit" disabled={pending}>
                  End
                </button>
                <button className="secondary small" type="button" onClick={() => setEnding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button className="secondary small" type="button" onClick={() => setEnding(true)}>
                End
              </button>
            )
          ) : null}
        </td>
      )}
    </tr>

    {/*
      A second row rather than a form inside a cell. Five fields and their explanations do not
      fit in a table cell, and `colSpan` is what a table offers for a detail panel belonging to
      the row above it.
    */}
    {expanded && (
      <tr>
        <td colSpan={canEdit ? 6 : 5}>
          {gaps.length > 0 && (
            <p className="sub">
              <span className="flag flag-warn">Missing</span> {gaps.join(', ')}. The Funding
              Handbook requires all of these in an enrolment record.
            </p>
          )}
          <form action={complete}>
            <input type="hidden" name="childId" value={childId} />
            <input type="hidden" name="enrolmentId" value={enrolment.id} />
            {guardians.length === 0 ? (
              /*
                Named rather than shown as an empty dropdown. A signatory must be a current
                guardian of this child — 0087's trigger enforces it — so with none linked there
                is nobody who *could* sign, and an empty picker would look like a bug rather
                than like the missing prerequisite it is.
              */
              <p className="empty">
                No whānau are linked to this child yet, so nobody can be recorded as signing.
                Add them on the Whānau tab first.
              </p>
            ) : (
              <RecordFields
                guardians={guardians}
                enrolment={enrolment}
                idPrefix={`e-${enrolment.id}`}
              />
            )}
            {guardians.length > 0 && (
              <div className="inline" style={{ marginTop: '0.75rem' }}>
                <button type="submit" disabled={completing}>
                  {completing ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </form>
        </td>
      </tr>
    )}
    </>
  );
}

function EnrolmentForm({
  childId,
  guardians,
  onDone,
}: {
  childId: string;
  guardians: SignatoryOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(fileEnrolment, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <input type="hidden" name="childId" value={childId} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="startDate">First day</label>
            <input className="narrow" id="startDate" name="startDate" type="date" required />
          </div>
          <div>
            <label htmlFor="endDate">Last day</label>
            <input className="narrow" id="endDate" name="endDate" type="date" />
          </div>
          <div>
            <label htmlFor="fundedHoursPerWeek">Funded hours a week</label>
            <input
              className="narrow"
              id="fundedHoursPerWeek"
              name="fundedHoursPerWeek"
              type="number"
              min={0}
              max={50}
              step="0.5"
              defaultValue={0}
            />
          </div>
        </div>

        <div>
          <label>Days attending</label>
          <div className="days">
            {WEEKDAY_LABELS.map((label, i) => (
              <label key={label}>
                <input type="checkbox" name="days" value={i + 1} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="days">
          <label>
            {/*
              An attestation the parent signs, not something derived from the hours —
              so it is recorded separately from them.
            */}
            <input type="checkbox" name="twentyHoursEce" /> 20 Hours ECE attestation signed
          </label>
        </div>

        {/*
          Permanent, casual or conditional — and "Not stated" is the default because
          nothing here guesses.

          This is the axis the Funding Handbook's absence rules turn on (§6-4): funding may
          be claimed for days a *permanently* enrolled child was booked and absent, while a
          casual or conditional child is funded on attendance only. Defaulting an unknown to
          permanent would over-claim, which is the one direction this product's funding
          figures promise they never go.
        */}
        <div>
          <label htmlFor="enrolmentType">Enrolment type</label>
          <select id="enrolmentType" name="enrolmentType" defaultValue="">
            <option value="">Not stated</option>
            {ENROLMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ENROLMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <p className="sub">
            From the enrolment agreement. A permanently enrolled child can be claimed for some
            booked absences; a casual or conditional child cannot. Leave it blank if you are
            not sure &mdash; this system does not yet calculate absence funding either way, and
            a wrong answer here would be worse than none.
          </p>
        </div>

        {/*
          The rest of what §6-1 asks for, on the form that files the record rather than only on
          a second screen afterwards. A service filing an enrolment with the parent in the room
          should be able to record that they signed it without coming back.

          Every field is optional here. The record is incomplete without them and the panel
          says so — but refusing to file an enrolment until a parent has signed would mean
          either losing the enrolment or backdating a signature, and the second is worse than
          an honest gap.
        */}
        {guardians.length > 0 && (
          <RecordFields guardians={guardians} idPrefix="new" />
        )}

        <div>
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} />
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Filing…' : 'File enrolment'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
