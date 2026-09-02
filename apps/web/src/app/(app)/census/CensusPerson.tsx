'use client';

import { useActionState } from 'react';
import {
  ELI_WEEKDAY_CODES,
  LEAVING_DESTINATION_CODES,
  STAFF_AGE_BANDS,
  STAFF_ROLE_KINDS,
  type CensusStaffRow,
  type StaffCensusDetails,
} from '@ece/core';
import {
  addHoursBlock,
  endHoursBlock,
  removeHoursBlock,
  saveCensusRow,
  type Result,
} from './actions';

export interface HoursBlock {
  id: string;
  weekday: number;
  fromTime: string;
  toTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PersonProps {
  row: CensusStaffRow;
  details: StaffCensusDetails | null;
  hours: HoursBlock[];
  /** Domains with a loaded code set. Empty today — `0080` ships every list empty. */
  loadedDomains: string[];
  today: string;
}

/**
 * What a gap is called on screen.
 *
 * Keyed to `CensusField`, so a field added to the core module without a label here
 * renders its own identifier rather than vanishing — visible and ugly beats absent.
 */
const FIELD_LABEL: Record<string, string> = {
  censusRecord: 'nothing recorded yet',
  genderCode: 'gender code',
  roleKind: 'kind of role',
  roleCode: 'staff role code',
  highestQualificationCode: 'highest qualification',
  isRegistered: 'registration',
  ethnicGroupCodes: 'ethnicity',
  isPaid: 'paid or unpaid',
  isPermanent: 'permanent or temporary',
  isFullTime: 'full or part time',
  contactHours: 'contracted contact hours',
};

const ROLE_KIND_LABEL: Record<string, string> = {
  educational: 'Teaching / educational',
  home_based_educator: 'Home-based educator',
  management: 'Management',
  support: 'Support',
  specialist: 'Specialist',
};

/** `UN_20` reads as "under 20", `36_40` as "36 to 40". Derived, never a second list. */
function ageBandLabel(code: string): string {
  if (code.startsWith('UN_')) return `Under ${code.slice(3)}`;
  if (code.startsWith('OV_')) return `Over ${code.slice(3)}`;
  const [a, b] = code.split('_');
  return `${a} to ${b}`;
}

function TriState({ name, label, value }: { name: string; label: string; value: boolean | null }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={value === null ? '' : value ? 'yes' : 'no'}>
        {/* Blank first and selected when null: a checkbox cannot say "nobody has said",
            and 0081 makes every one of these columns nullable for that reason. */}
        <option value="">Not recorded</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

/**
 * A field this product will not let anybody fill in yet, with the reason on the screen.
 *
 * Gender, staff role, qualification, playcentre qualification, ethnicity and iwi are
 * `LookupCode` values in the ELI schema, which enumerates none of them. Until a
 * published list is imported with its source recorded, the only thing a text box here
 * could produce is an invented code in a return to the Crown — so there is no text box.
 *
 * Same treatment the licensing criteria get: the feature exists, ships empty, and says
 * why rather than looking broken.
 */
function AwaitingCodeSet({ label, loaded }: { label: string; loaded: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select disabled defaultValue="">
        <option value="">{loaded ? 'Choose…' : 'No Ministry code list loaded'}</option>
      </select>
    </label>
  );
}

export function CensusPerson({ row, details, hours, loadedDomains, today }: PersonProps) {
  const [saveState, save, saving] = useActionState<Result | null, FormData>(saveCensusRow, null);
  const [addState, add, adding] = useActionState<Result | null, FormData>(addHoursBlock, null);
  const [endState, end, ending] = useActionState<Result | null, FormData>(endHoursBlock, null);
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeHoursBlock,
    null,
  );

  const loaded = (domain: string) => loadedDomains.includes(domain);
  const error = [saveState, addState, endState, removeState].find(
    (s): s is { error: string } => !!s && 'error' in s,
  );

  const gaps = row.missing.map((f) => FIELD_LABEL[f] ?? f);

  return (
    <details className="card">
      <summary>
        <strong>{row.fullName}</strong>{' '}
        {row.reportable ? (
          <span className="flag flag-ok">Ready</span>
        ) : (
          <span className="flag flag-warn">
            {gaps.length} to record
            {row.codeIssues.length > 0 ? `, ${row.codeIssues.length} to fix` : ''}
          </span>
        )}{' '}
        <span className="sub">
          {row.hoursWorked === null
            ? 'no contracted hours'
            : `${row.hoursWorked}h a week contracted`}
        </span>
      </summary>

      {gaps.length > 0 && (
        <p>
          Still needed for the Return: <strong>{gaps.join(', ')}</strong>.
        </p>
      )}

      {row.codeIssues.length > 0 && (
        <ul>
          {row.codeIssues.map((i) => (
            <li key={`${i.field}-${i.code}`}>
              <code>{i.field}</code>: <code>{i.code}</code> — {i.problem.replace(/-/g, ' ')}
            </li>
          ))}
        </ul>
      )}

      <p>
        Registration:{' '}
        {row.isRegistered === null ? (
          <strong>not known — no current practising certificate is linked to this person</strong>
        ) : row.isRegistered ? (
          'holds a current practising certificate'
        ) : (
          'no current practising certificate'
        )}
        .
      </p>
      <p className="sub">
        Read from their compliance records rather than entered here, so the Return and the
        licensing binder cannot disagree about the same person.
      </p>

      {error && (
        <p className="error" role="alert">
          {error.error}
        </p>
      )}

      <form action={save}>
        <input type="hidden" name="staffMemberId" value={row.staffMemberId} />

        <label className="field">
          <span>Kind of role</span>
          <select name="roleKind" defaultValue={details?.roleKind ?? ''}>
            <option value="">Not recorded</option>
            {STAFF_ROLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ROLE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Age band</span>
          <select name="ageBand" defaultValue={details?.ageBand ?? ''}>
            <option value="">Not recorded</option>
            {STAFF_AGE_BANDS.map((b) => (
              <option key={b} value={b}>
                {ageBandLabel(b)}
              </option>
            ))}
          </select>
        </label>

        <TriState name="isPaid" label="Paid" value={details?.isPaid ?? null} />
        <TriState name="isPermanent" label="Permanent" value={details?.isPermanent ?? null} />
        <TriState name="isFullTime" label="Full time" value={details?.isFullTime ?? null} />

        <label className="field">
          <span>Youngest age taught, in months</span>
          <input
            name="minAgeTaughtMonths"
            type="number"
            min={0}
            max={72}
            defaultValue={details?.minAgeTaughtMonths ?? ''}
          />
        </label>

        <label className="field">
          <span>Oldest age taught, in months</span>
          <input
            name="maxAgeTaughtMonths"
            type="number"
            min={0}
            max={72}
            defaultValue={details?.maxAgeTaughtMonths ?? ''}
          />
        </label>

        <TriState
          name="previouslyWorkedAsTeacher"
          label="Previously worked as a teacher"
          value={details?.previouslyWorkedAsTeacher ?? null}
        />
        <TriState
          name="arrivedFromAnotherService"
          label="Arrived from another service"
          value={details?.arrivedFromAnotherService ?? null}
        />

        <label className="field">
          <span>Leaving destination</span>
          <select name="leavingDestinationCode" defaultValue={details?.leavingDestinationCode ?? ''}>
            <option value="">Not recorded</option>
            {LEAVING_DESTINATION_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {/* Shown as raw codes on purpose. The ELI schema enumerates D01 to D04 and UNK
            and does not say what any of them mean, so a label here would be this product
            inventing one — the thing AGENTS.md §7 forbids by name. */}
        <p className="sub">
          The schema we hold lists these codes without definitions, so they are shown as
          codes.
        </p>

        <AwaitingCodeSet label="Gender" loaded={loaded('gender')} />
        <AwaitingCodeSet label="Staff role code" loaded={loaded('staff_role')} />
        <AwaitingCodeSet label="Highest qualification" loaded={loaded('qualification')} />
        <AwaitingCodeSet label="Ethnicity" loaded={loaded('ethnic_group')} />
        <AwaitingCodeSet label="Iwi" loaded={loaded('iwi')} />

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save details'}
        </button>
      </form>

      <h4>Contracted contact hours</h4>

      {hours.length === 0 ? (
        <p className="empty">No contracted hours recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>From</th>
              <th>To</th>
              <th>Applies</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.id}>
                <td>{ELI_WEEKDAY_CODES[h.weekday - 1] ?? h.weekday}</td>
                <td>{h.fromTime.slice(0, 5)}</td>
                <td>{h.toTime.slice(0, 5)}</td>
                <td>
                  {h.effectiveFrom}
                  {h.effectiveTo ? ` to ${h.effectiveTo}` : ' onwards'}
                </td>
                <td className="inline">
                  {h.effectiveTo === null && (
                    <form action={end} className="inline">
                      <input type="hidden" name="id" value={h.id} />
                      <input
                        name="effectiveTo"
                        type="date"
                        defaultValue={today}
                        aria-label={`Last day these hours apply for ${row.fullName}`}
                      />
                      <button type="submit" className="small secondary" disabled={ending}>
                        End
                      </button>
                    </form>
                  )}
                  <form action={remove} className="inline">
                    <input type="hidden" name="id" value={h.id} />
                    <button type="submit" className="small secondary" disabled={removing}>
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={add}>
        <input type="hidden" name="staffMemberId" value={row.staffMemberId} />
        <label className="field">
          <span>Day</span>
          <select name="weekday" defaultValue="1">
            {ELI_WEEKDAY_CODES.map((code, i) => (
              <option key={code} value={i + 1}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input name="fromTime" type="time" defaultValue="08:00" required />
        </label>
        <label className="field">
          <span>To</span>
          <input name="toTime" type="time" defaultValue="16:00" required />
        </label>
        <label className="field">
          <span>Applies from</span>
          <input name="effectiveFrom" type="date" defaultValue={today} required />
        </label>
        <button type="submit" className="secondary" disabled={adding}>
          {adding ? 'Adding…' : 'Add hours'}
        </button>
      </form>
      <p className="sub">
        Changing somebody&rsquo;s hours means ending the block that applies now and adding a
        new one. An open-ended block covers every later date, so the database refuses an
        overlapping one until the old block has an end date.
      </p>
    </details>
  );
}
