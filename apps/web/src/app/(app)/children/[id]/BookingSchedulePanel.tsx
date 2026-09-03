'use client';

import { useActionState } from 'react';
import { blocksOn, ELI_WEEKDAY_CODES, WEEKDAY_LABELS, type WeekdayBlock } from '@ece/core';
import {
  addScheduleBlock,
  endScheduleBlock,
  removeScheduleBlock,
  type Result,
} from '../actions';

/** A block as the API returns it — `WeekdayBlock` plus the id the editor needs. */
interface Block extends WeekdayBlock {
  id: string;
}

/**
 * The enrolment agreement: which days and times a child is expected to attend.
 *
 * §6-1 requires an enrolment record to state *"the days and times each child is expected to
 * attend, and details of any later changes to the agreement signed and dated by at least one
 * parent/guardian"*. This is that, and it is what §6-5 means by *"enrolled to attend"* and what
 * §6-7 compares attendance against.
 *
 * WHY IT IS NOT THE SAME THING AS THE DAYS ON THE ENROLMENT ROW ABOVE IT
 *
 * `enrolments.days` is a weekday array with no times, and it is what two screens have rendered
 * since 0004. This table adds times and an effective window, so a family who moves from a 9-to-3
 * Tuesday to an 8-to-1 Tuesday has two rows and a date the change took effect — which is what a
 * funding claim for last March has to be answerable from.
 *
 * **Both are shown, and the panel says which is authoritative**, because the alternative is worse
 * in a specific way: this table ships **empty**, so a screen that quietly preferred it would show
 * every existing child as having no days at all. `unverified-claims` item 53 records the
 * duplication and why collapsing it waits for a backfill — one that cannot be lossless, because
 * `days` carries no times to recover.
 *
 * CHANGING AN AGREEMENT IS TWO GESTURES, NOT AN EDIT. Close the open block with a last day, then
 * add the new one. The overlap constraint enforces it — a null `effective_to` is infinity, so an
 * open block collides with any later one on the same weekday — and the API turns that `23P01` into
 * a sentence saying so. Superseding rather than editing is what keeps the earlier period
 * answerable.
 */
export function BookingSchedulePanel({
  childId,
  blocks,
  canEdit,
  today,
  enrolmentDays,
}: {
  childId: string;
  blocks: Block[];
  canEdit: boolean;
  /** The date at the centre. Passed in rather than computed — see the child page. */
  today: string;
  /**
   * `enrolments.days` from the current enrolment, for the comparison note. Empty when there is no
   * current enrolment, which is not the same as a child attending no days.
   */
  enrolmentDays: number[];
}) {
  const [addState, add, adding] = useActionState<Result | null, FormData>(addScheduleBlock, null);
  const [endState, end, ending] = useActionState<Result | null, FormData>(endScheduleBlock, null);
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeScheduleBlock,
    null,
  );

  // One message, beside the controls that produced it. Three separate alerts on one panel is
  // three places to look for the same kind of answer.
  const error = [addState, endState, removeState].find(
    (s): s is { error: string } => !!s && 'error' in s,
  )?.error;

  const inForce = blocksOn(blocks, today);

  return (
    <div className="card">
      {blocks.length === 0 ? (
        <>
          <p className="empty">No days and times recorded.</p>
          {/*
            The honest version of an empty state here. `enrolments.days` may well hold days, and
            saying nothing would imply the child attends none — which is the failure mode a reader
            preferring the empty table would have had.
          */}
          {enrolmentDays.length > 0 && (
            <p className="sub">
              The enrolment above records{' '}
              <strong>
                {enrolmentDays
                  .slice()
                  .sort((a, b) => a - b)
                  .map((d) => WEEKDAY_LABELS[d - 1] ?? '?')
                  .join(', ')}
              </strong>{' '}
              with no times. The Ministry asks for the times as well, so recording them here is
              what makes the agreement complete.
            </p>
          )}
        </>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>From</th>
              <th>To</th>
              <th>Applies</th>
              <th>Status</th>
              {canEdit && (
                <th style={{ width: '1%' }}>
                  <span className="visually-hidden">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => {
              const current = inForce.some((f) => f.id === b.id);
              return (
                <tr key={b.id}>
                  {/*
                    The ELI code beside the day name, because this is the field that becomes
                    `WeekdayCode` on the wire and a manager checking a return against this screen
                    should not have to map Monday to `Mo` themselves.
                  */}
                  <td>
                    {WEEKDAY_LABELS[b.weekday - 1] ?? b.weekday}{' '}
                    <span className="sub">{ELI_WEEKDAY_CODES[b.weekday - 1] ?? ''}</span>
                  </td>
                  <td>{b.fromTime.slice(0, 5)}</td>
                  <td>{b.toTime.slice(0, 5)}</td>
                  <td>
                    {b.effectiveFrom}
                    {b.effectiveTo ? ` to ${b.effectiveTo}` : ' onwards'}
                  </td>
                  <td>
                    {current ? (
                      <span className="flag flag-ok">✓ current</span>
                    ) : (
                      <span className="flag flag-quiet">not in force</span>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      {/*
                        End is offered only while the block is open-ended — a block that already
                        has a last day is history, and history is not re-ended. Delete is offered
                        for a mistake; the API's docstring explains why deletion is available here
                        when it is refused on the append-only ledgers.
                      */}
                      {b.effectiveTo === null ? (
                        <form action={end} className="inline">
                          <input type="hidden" name="childId" value={childId} />
                          <input type="hidden" name="blockId" value={b.id} />
                          <input
                            className="narrow"
                            name="effectiveTo"
                            type="date"
                            required
                            defaultValue={today}
                            aria-label={`Last day for ${WEEKDAY_LABELS[b.weekday - 1] ?? 'this block'}`}
                          />
                          <button className="small" type="submit" disabled={ending}>
                            End
                          </button>
                        </form>
                      ) : (
                        <form action={remove} className="inline">
                          <input type="hidden" name="childId" value={childId} />
                          <input type="hidden" name="blockId" value={b.id} />
                          <button className="secondary small" type="submit" disabled={removing}>
                            Delete
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {canEdit && (
        <form action={add} style={{ marginTop: '1rem' }}>
          <input type="hidden" name="childId" value={childId} />
          <div className="row">
            <div>
              <label htmlFor="sched-weekday">Day</label>
              <select id="sched-weekday" name="weekday" defaultValue="1">
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sched-from">From</label>
              <input className="narrow" id="sched-from" name="fromTime" type="time" defaultValue="08:00" />
            </div>
            <div>
              <label htmlFor="sched-to">To</label>
              <input className="narrow" id="sched-to" name="toTime" type="time" defaultValue="15:00" />
            </div>
            <div>
              <label htmlFor="sched-from-date">Applies from</label>
              <input
                className="narrow"
                id="sched-from-date"
                name="effectiveFrom"
                type="date"
                defaultValue={today}
              />
            </div>
            <button type="submit" disabled={adding}>
              Add
            </button>
          </div>
          <p className="sub">
            More than one block on a day is allowed &mdash; a morning and an afternoon session are
            two blocks. To change an existing day, end the current block first and then add the new
            one, so the earlier period stays answerable.
          </p>
        </form>
      )}
    </div>
  );
}
