'use client';

import { useActionState } from 'react';
import type { OffFloorRecord } from '@ece/api';
import { addOffFloor, removeOffFloor, type Result } from './actions';

/**
 * Time an adult was here and not counted — `staff_off_floor` (0094).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT MOVES TWO FIGURES, AND ONE OF THEM IS LIVE
 *
 * Schedule 2 says an adult does not count towards the ratio while at lunch, on a break, or on
 * non-contact time. Funding Handbook §9-4 asks for staff hours *"at times when they were counted
 * towards regulated (ratio) staff"*.
 *
 * So an interval recorded here subtracts from **both**: the RS7 staff-hour figures, and — since
 * `0095` — `adults_present_now`, which is the ratio on the attendance screen right now. Most
 * tables in this product feed one or the other. This one is why the panel says so out loud rather
 * than leaving somebody to discover that recording a lunch break moved the room into a breach.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE EXCEPTIONS RATHER THAN THE COUNTED TIME
 *
 * Sign-in and sign-out stay the record of presence. Widening `attendance_kind` would have given
 * children's attendance two values that can never apply to a child and changed the signature of
 * `kiosk_sign_child`, to model something that is neither an arrival nor a departure. Recording
 * only what is unusual is also how the fact is captured today — the adult-count note field's
 * placeholder is literally *"two on lunch break"*, which is the same information as free text
 * nothing can read.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CENTRE THAT TYPES ITS ADULT COUNT CANNOT USE THIS
 *
 * `centres.ratio_source` decides whether adults are counted from individual sign-ins or from a
 * number somebody types. On the typed source there is no per-person attendance for these
 * intervals to subtract from, so the panel says so instead of quietly recording rows that change
 * nothing.
 */
export function OffFloorPanel({
  members,
  intervals,
  canEdit,
  ratioSource,
  defaultDate,
}: {
  members: { id: string; fullName: string }[];
  intervals: OffFloorRecord[];
  canEdit: boolean;
  ratioSource: 'declared' | 'derived';
  /** The date the roster is showing, so the form opens on the day being looked at. */
  defaultDate: string;
}) {
  const [addState, add, adding] = useActionState<Result | null, FormData>(addOffFloor, null);
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeOffFloor,
    null,
  );

  const nameOf = new Map(members.map((m) => [m.id, m.fullName]));

  return (
    <section>
      <h2>Off the floor</h2>
      <p className="sub">
        Time somebody was here and <strong>not counted</strong> — a break, or non-contact time.
        Schedule 2 excludes them from the ratio for those minutes, and section 9-4 excludes the
        hours from the staff figures on the RS7 return.
      </p>

      {ratioSource === 'declared' ? (
        <p role="status" className="sub">
          This centre records the number of adults present as a typed total rather than per person,
          so there is nothing for these intervals to subtract from and the ratio is whatever was
          typed. Change the adult count source in <strong>Settings</strong> to count adults from
          their own sign-ins, and this will apply.
        </p>
      ) : (
        <p className="sub">
          <strong>This changes the ratio on the attendance screen while the interval is running</strong>,
          as well as the funding figures. That is the rule doing its job — an adult on a break does
          not count — and it is worth knowing before you record one for a busy hour.
        </p>
      )}

      {intervals.length === 0 ? (
        <p>
          <em>Nothing recorded for these days.</em>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Who</th>
              <th>From</th>
              <th>To</th>
              <th>Why</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {intervals.map((i) => (
              <tr key={i.id}>
                <td>{i.onDate}</td>
                <td>{nameOf.get(i.staffMemberId) ?? <span className="empty">a former colleague</span>}</td>
                <td>{i.fromTime.slice(0, 5)}</td>
                <td>{i.toTime.slice(0, 5)}</td>
                <td>{i.reason ?? <span className="empty">—</span>}</td>
                {canEdit && (
                  <td>
                    <form action={remove} className="inline">
                      <input type="hidden" name="intervalId" value={i.id} />
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

      {canEdit && (
        <form action={add} className="stack">
          {/*
            "Staff member", not "Who" — and not "Who was off the floor" either, which was the
            first attempt.

            The leave form on this page has a label of exactly `Who`, and Playwright's
            `getByLabel` matches on SUBSTRING, so a longer label containing the word still
            resolves two elements and breaks strict mode before any assertion runs. Same class of
            failure as the duplicate heading on the child record, with an extra step: making a
            label more specific is not the same as making it distinct.
          */}
          <label htmlFor="offfloor-who">Staff member</label>
          <select id="offfloor-who" name="staffMemberId" defaultValue="">
            <option value="">Choose…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>

          <label htmlFor="offfloor-date">Date</label>
          <input id="offfloor-date" type="date" name="onDate" defaultValue={defaultDate} required />

          <label htmlFor="offfloor-from">From</label>
          <input id="offfloor-from" type="time" name="fromTime" required />

          <label htmlFor="offfloor-to">To</label>
          <input id="offfloor-to" type="time" name="toTime" required />

          <label htmlFor="offfloor-reason">Why</label>
          <input
            id="offfloor-reason"
            name="reason"
            placeholder="Lunch"
            autoComplete="off"
          />
          {/*
            Free text, and not a list. Schedule 2 says "at lunch, on a break, or on non-contact
            time" — a description, not a published code list — and §9-4 does not care which. An
            enum here would be inventing a vocabulary.
          */}

          <div>
            <button type="submit" disabled={adding}>
              {adding ? 'Recording…' : 'Record'}
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
