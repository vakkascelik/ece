'use client';

import { useActionState, useEffect, useState } from 'react';
import { closureOn, type ServiceClosure } from '@ece/core';
import { addClosure, endClosure, removeClosure, type RoomResult } from './actions';

/**
 * Days the service did not operate.
 *
 * ON SETTINGS RATHER THAN ITS OWN PAGE, because it is centre-level configuration in the same
 * sense the rooms and the licence figure are: entered rarely, by the same two roles, and read
 * by everything else. A calendar of its own would be a nicer screen and is not what is missing.
 *
 * WHAT THIS IS FOR, which is worth saying because a closure list looks like housekeeping and
 * is not. Four things read it, and three of them are arithmetic somebody submits:
 *
 *   - Funding Handbook §6-6 suspends the Three Week Rule while a service is closed for two
 *     weeks or more, so absence funding cannot be computed without it.
 *   - RS7's advance-month counts are operating days in the months ahead.
 *   - The ELI `EceServiceClosure` event is this record.
 *   - The occupancy average currently infers "closed" from nobody attending, which cannot
 *     tell a closed day from an open day nobody came to.
 *
 * NOT THE SAME AS CLOSING A CHILD'S BOOKING. That says one child had no place on a day; this
 * says the service did not operate. The screen says so, because the two are easy to conflate
 * and conflating them puts a child-level fact into a service-level return.
 */
export function ClosureList({
  closures,
  today,
}: {
  closures: ServiceClosure[];
  /** The centre's date, resolved on the server — not the browser's. See the note below. */
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [addState, add, addPending] = useActionState<RoomResult | null, FormData>(addClosure, null);
  const [endState, end, endPending] = useActionState<RoomResult | null, FormData>(endClosure, null);
  const [removeState, remove, removePending] = useActionState<RoomResult | null, FormData>(
    removeClosure,
    null,
  );

  /*
    TWO ERROR SLOTS, AND THE SPLIT IS NOT COSMETIC.

    `BookingSchedulePanel` merges its three action errors into one line, on the grounds that
    three alerts on one panel is three places to look. That reasoning holds where every
    gesture is permanent furniture. It fails here, and an e2e run found the failure: the add
    form is DISMISSIBLE, so a merged slot goes on showing "those dates overlap a closure
    already recorded" after the form has gone and after a completely different gesture has
    succeeded. A stale error beside a successful action is worse than no error at all — it
    reads as though the thing that just worked did not.

    So the add error is rendered INSIDE the add form, where the values that caused it still
    are, and it is unmounted with the form. The row errors — reopening, deleting — keep the
    slot above, because those controls are not dismissible and their errors have nowhere else
    to be.
  */
  const addError = addState && 'error' in addState ? addState.error : null;
  const rowError = [endState, removeState].find(
    (s): s is { error: string } => !!s && 'error' in s,
  )?.error;

  /*
    Close the add form on success, and NOT on failure.

    In a `useEffect` rather than the render body, which is this repo's standing rule: calling
    `setState` during render is a React error that only shows up in the console.

    The asymmetry is the point. On success the row is in the table above and a form still
    holding the values that produced it invites a second identical closure. On failure the
    form stays open WITH what was typed, because the failure that actually happens here is the
    overlap — and the fix for it is to change one of the two dates, which is impossible if the
    form has just thrown them away.
  */
  useEffect(() => {
    if (addState && 'ok' in addState) setAdding(false);
  }, [addState]);

  /*
    Whether the centre is shut RIGHT NOW, answered against the centre's date rather than the
    browser's. A manager checking from home on holiday is in a different zone, and a date
    computed here would be wrong for exactly the person most likely to be looking.
  */
  const closedToday = closureOn(closures, today);

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Closed days</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        Periods the service did not operate &mdash; term breaks, public holidays, a closure for
        weather. Not the same as closing one child&rsquo;s booking: this says the service was
        shut.
      </p>

      {closedToday && (
        <p className="sub">
          <span className="flag flag-warn">Closed today</span>{' '}
          {closedToday.endsOn === null
            ? 'with no end date recorded yet.'
            : `until ${closedToday.endsOn}.`}
        </p>
      )}

      {closures.length === 0 ? (
        <p className="empty">No closures recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Reason</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {closures.map((c) => (
              <tr key={c.id}>
                <td>{c.startsOn}</td>
                <td>
                  {c.endsOn ?? (
                    /*
                      Named, not blank. An empty cell reads as missing data; this is a
                      recorded state that covers every later date, and the next person trying
                      to add a closure will collide with it — so the word has to be here.
                    */
                    <span className="flag flag-warn">no end date</span>
                  )}
                </td>
                <td>
                  {c.reasonNote ?? <span className="empty">&mdash;</span>}
                  {c.reasonCode && (
                    <>
                      {' '}
                      {/*
                        The raw code with a caveat, never a guessed label. `ClosureReasonCode`
                        is a LookupCode and the Ministry has not published the list, so
                        `code_sets` ships a `closure_reason` domain with nothing in it. A name
                        invented here would be the kind of thing AGENTS.md §7 forbids.
                      */}
                      <span className="flag flag-quiet" title="Ministry code — no published list to resolve it against">
                        {c.reasonCode}
                      </span>
                    </>
                  )}
                </td>
                <td>
                  <div className="inline">
                    {c.endsOn === null && (
                      <form action={end} className="inline">
                        <input type="hidden" name="id" value={c.id} />
                        <input
                          className="narrow"
                          name="endsOn"
                          type="date"
                          required
                          defaultValue={today}
                          aria-label={`Last closed day for the closure starting ${c.startsOn}`}
                        />
                        <button className="small" type="submit" disabled={endPending}>
                          Reopened
                        </button>
                      </form>
                    )}
                    <form action={remove} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <button className="secondary small" type="submit" disabled={removePending}>
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rowError && (
        <p className="error" role="alert">
          {rowError}
        </p>
      )}

      {!adding ? (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Record a closure
          </button>
        </p>
      ) : (
        <form action={add} style={{ marginTop: '1rem' }}>
          <div className="row">
            <div>
              <label htmlFor="closure-from">First closed day</label>
              <input
                className="narrow"
                id="closure-from"
                name="startsOn"
                type="date"
                required
                defaultValue={today}
              />
            </div>
            <div>
              <label htmlFor="closure-to">Last closed day</label>
              <input className="narrow" id="closure-to" name="endsOn" type="date" />
            </div>
            <div>
              <label htmlFor="closure-note">Reason</label>
              <input id="closure-note" name="reasonNote" placeholder="Term break" />
            </div>
            <div>
              <label htmlFor="closure-code">Ministry code</label>
              <input className="narrow" id="closure-code" name="reasonCode" maxLength={10} />
            </div>
            <button type="submit" disabled={addPending}>
              Record
            </button>
            <button className="secondary" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {addError && (
            <p className="error" role="alert">
              {addError}
            </p>
          )}
          <p className="sub">
            Leave the last day empty if you do not know when the service will reopen &mdash; that
            is a real answer, not a missing one, and you can set it later. A closure with no end
            date covers every day after it, so the next one you record will clash until you close
            it off.
          </p>
          <p className="sub">
            The Ministry code is optional and there is nowhere yet to look it up: the ELI schema
            asks for one but the published list has not been made available to us, so whatever you
            enter is stored as you typed it and shown as you typed it.
          </p>
        </form>
      )}
    </section>
  );
}
