'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { addLeave, addShift, cancelShift, declineLeave, type Result } from './actions';

export interface ShortfallView {
  from: string;
  to: string;
  shortfall: number;
  children: number;
  adults: number;
  covering: string[];
}

export interface ShiftView {
  id: string;
  name: string;
  fromTime: string;
  toTime: string;
  roleNote: string | null;
  status: 'planned' | 'confirmed' | 'cancelled';
  onLeave: boolean;
}

export interface DayView {
  date: string;
  summary: string;
  worstShortfall: number;
  bookingsWithoutTimes: number;
  shortfalls: ShortfallView[];
  shifts: ShiftView[];
}

export interface LeaveView {
  id: string;
  name: string;
  fromDate: string;
  toDate: string;
  kind: 'annual' | 'sick' | 'unpaid' | 'other';
  status: 'requested' | 'approved' | 'declined';
}

/**
 * `timeZone: 'UTC'` is load-bearing, not tidiness.
 *
 * `new Date('2026-09-15')` is UTC midnight, and a formatter with no `timeZone` renders
 * it in the *runtime's* zone — the 15th in New Zealand, the 14th in Honolulu. That is
 * two bugs at once here: a wrong heading for anybody east or west of the server, and a
 * hydration mismatch, because this component renders on a server that is on UTC and
 * again in a browser that is not.
 *
 * Constructing the date from UTC parts and reading it back in UTC keeps the label the
 * same characters as the string it came from, wherever it is rendered. The dates
 * themselves are already the centre's local days — `todayInZone` did that upstream.
 */
const WEEKDAY = new Intl.DateTimeFormat('en-NZ', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAY.format(new Date(Date.UTC(y as number, (m as number) - 1, d as number)));
}

export function RosterWeek({
  days,
  staff,
  leave,
  canManage,
  from,
  previousFrom,
  nextFrom,
  today,
}: {
  days: DayView[];
  staff: { id: string; name: string }[];
  leave: LeaveView[];
  canManage: boolean;
  from: string;
  previousFrom: string;
  nextFrom: string;
  today: string;
}) {
  return (
    <>
      {/* Links, not buttons dressed as links. These change the URL, so they have to be
          navigable, shareable and openable in a new tab — a manager sends "look at next
          week" to a colleague. */}
      <nav className="inline" style={{ marginBottom: '1rem' }} aria-label="Week">
        <Link href={`/roster?from=${previousFrom}`}>{'←'} Previous week</Link>
        {from !== today && <Link href="/roster">This week</Link>}
        <Link href={`/roster?from=${nextFrom}`}>Next week {'→'}</Link>
      </nav>

      {days.map((day) => (
        <Day key={day.date} day={day} staff={staff} canManage={canManage} />
      ))}

      <h2>Leave</h2>
      <LeaveList leave={leave} staff={staff} canManage={canManage} today={today} />
    </>
  );
}

function Day({
  day,
  staff,
  canManage,
}: {
  day: DayView;
  staff: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const short = day.worstShortfall > 0;

  return (
    <section className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>{dayLabel(day.date)}</h2>

      <p className="inline" style={{ margin: '0 0 0.5rem' }}>
        <span className={`flag ${short ? 'flag-warn' : day.shifts.length > 0 ? 'flag-ok' : 'flag-quiet'}`}>
          {short ? '●' : day.shifts.length > 0 ? '✓' : '·'} {day.summary}
        </span>
      </p>

      {day.shortfalls.length > 0 && (
        <table>
          <caption className="visually-hidden">Periods where the plan is short</caption>
          <thead>
            <tr>
              <th>When</th>
              <th>Short by</th>
              <th>Planned</th>
              <th>Already covering</th>
            </tr>
          </thead>
          <tbody>
            {day.shortfalls.map((s) => (
              <tr key={`${s.from}-${s.to}`}>
                <td>
                  <strong>
                    {s.from}&ndash;{s.to}
                  </strong>
                </td>
                <td>
                  <span className="flag flag-warn">
                    {'●'} {s.shortfall} {s.shortfall === 1 ? 'adult' : 'adults'}
                  </span>
                </td>
                <td>
                  {s.children} {s.children === 1 ? 'child' : 'children'}, {s.adults}{' '}
                  {s.adults === 1 ? 'adult' : 'adults'}
                </td>
                <td>{s.covering.length > 0 ? s.covering.join(', ') : <span className="empty">nobody</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {day.bookingsWithoutTimes > 0 && (
        // Said out loud rather than absorbed. Counting an untimed booking across the
        // whole day is the safe direction, and it can also invent a shortfall at 7am
        // for a child who arrives at noon — so the screen explains the inflation
        // instead of letting somebody discover it and stop trusting the number.
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          <span className="flag flag-quiet">
            {day.bookingsWithoutTimes} booking{day.bookingsWithoutTimes === 1 ? '' : 's'} with no
            hours set
          </span>{' '}
          Counted across the whole day, which can overstate the morning. Set hours on the booking
          to sharpen this.
        </p>
      )}

      {day.shifts.length > 0 ? (
        <ul className="stack" style={{ marginTop: '0.75rem' }}>
          {day.shifts.map((s) => (
            <ShiftRow key={s.id} shift={s} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className="empty" style={{ margin: '0.75rem 0 0' }}>
          Nobody rostered.
        </p>
      )}

      {canManage && !adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Roster somebody
          </button>
        </p>
      )}
      {canManage && adding && (
        <ShiftForm date={day.date} staff={staff} onDone={() => setAdding(false)} />
      )}
    </section>
  );
}

function ShiftRow({ shift, canManage }: { shift: ShiftView; canManage: boolean }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(cancelShift, null);
  const cancelled = shift.status === 'cancelled';

  return (
    <li className="inline" style={{ justifyContent: 'space-between' }}>
      <span>
        <strong style={cancelled ? { textDecoration: 'line-through' } : undefined}>
          {shift.fromTime}&ndash;{shift.toTime}
        </strong>{' '}
        {shift.name}
        {shift.roleNote && <span className="sub"> &middot; {shift.roleNote}</span>}
        {cancelled && <span className="flag flag-quiet"> Cancelled</span>}
        {shift.onLeave && !cancelled && (
          // The single most valuable line on the page. The shift still exists; the
          // person is on approved leave, and the forecast above has already stopped
          // counting them.
          <span className="flag flag-warn"> {'●'} On leave &mdash; not counted</span>
        )}
        {state && 'error' in state && (
          <span className="error" role="alert">
            {' '}
            {state.error}
          </span>
        )}
      </span>

      {canManage && !cancelled && (
        <form action={action}>
          <input type="hidden" name="id" value={shift.id} />
          <button className="small secondary" type="submit" disabled={pending}>
            {pending ? 'Cancelling…' : 'Cancel'}
          </button>
        </form>
      )}
    </li>
  );
}

function ShiftForm({
  date,
  staff,
  onDone,
}: {
  date: string;
  staff: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addShift, null);

  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      <input type="hidden" name="onDate" value={date} />
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor={`who-${date}`}>Who</label>
        <select id={`who-${date}`} name="staffMemberId" required defaultValue="">
          <option value="" disabled>
            Choose somebody
          </option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="inline">
        <div className="field">
          <label htmlFor={`from-${date}`}>From</label>
          <input id={`from-${date}`} name="fromTime" type="time" required defaultValue="08:00" />
        </div>
        <div className="field">
          <label htmlFor={`to-${date}`}>To</label>
          <input id={`to-${date}`} name="toTime" type="time" required defaultValue="16:00" />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`note-${date}`}>Role (optional)</label>
        <input id={`note-${date}`} name="roleNote" type="text" placeholder="Over-2s room" />
      </div>

      <div className="inline">
        <button type="submit" disabled={pending || staff.length === 0}>
          {pending ? 'Rostering…' : 'Add shift'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>

      {staff.length === 0 && (
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          Nobody is on the staff list yet. Add people on <Link href="/staff">Staff</Link> first
          &mdash; relievers and contractors belong there too.
        </p>
      )}
    </form>
  );
}

function LeaveList({
  leave,
  staff,
  canManage,
  today,
}: {
  leave: LeaveView[];
  staff: { id: string; name: string }[];
  canManage: boolean;
  today: string;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      {leave.length === 0 ? (
        <p className="empty">Nobody is away in this period.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>When</th>
              <th>Kind</th>
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {leave.map((l) => (
              <LeaveRow key={l.id} leave={l} canManage={canManage} />
            ))}
          </tbody>
        </table>
      )}

      {canManage && !adding && (
        <p style={{ margin: '0.75rem 0 0' }}>
          <button className="secondary small" type="button" onClick={() => setAdding(true)}>
            Record leave
          </button>
        </p>
      )}
      {canManage && adding && (
        <LeaveForm staff={staff} today={today} onDone={() => setAdding(false)} />
      )}
    </div>
  );
}

function LeaveRow({ leave, canManage }: { leave: LeaveView; canManage: boolean }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(declineLeave, null);

  return (
    <tr>
      <td>
        <strong>{leave.name}</strong>
        {state && 'error' in state && (
          <div className="error" role="alert">
            {state.error}
          </div>
        )}
      </td>
      <td>
        {leave.fromDate === leave.toDate ? (
          leave.fromDate
        ) : (
          <>
            {leave.fromDate} &ndash; {leave.toDate}
          </>
        )}
      </td>
      <td>
        {leave.kind}
        {leave.status === 'requested' && (
          // Requested leave is on the list and out of the forecast. Showing it without
          // saying so would look like the forecast had ignored it.
          <span className="flag flag-quiet"> Requested &mdash; not counted yet</span>
        )}
      </td>
      <td>
        {canManage && (
          <form action={action}>
            <input type="hidden" name="id" value={leave.id} />
            <button className="small secondary" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Withdraw'}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

function LeaveForm({
  staff,
  today,
  onDone,
}: {
  staff: { id: string; name: string }[];
  today: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addLeave, null);

  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '0.75rem' }}>
      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="leave-who">Who</label>
        <select id="leave-who" name="staffMemberId" required defaultValue="">
          <option value="" disabled>
            Choose somebody
          </option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="inline">
        <div className="field">
          <label htmlFor="leave-from">First day</label>
          <input id="leave-from" name="fromDate" type="date" required defaultValue={today} />
        </div>
        <div className="field">
          <label htmlFor="leave-to">Last day</label>
          <input id="leave-to" name="toDate" type="date" required defaultValue={today} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="leave-kind">Kind</label>
        <select id="leave-kind" name="kind" defaultValue="annual">
          <option value="annual">Annual</option>
          <option value="sick">Sick</option>
          <option value="unpaid">Unpaid</option>
          <option value="other">Other</option>
        </select>
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          This is availability, not payroll &mdash; there are no balances or entitlements here.
          Recording leave removes the person from the forecast for those days, and leaves any shift
          they already had on the roster so you can see what needs covering.
        </p>
      </div>

      <div className="field">
        <label htmlFor="leave-note">Note (optional)</label>
        <input id="leave-note" name="note" type="text" />
      </div>

      <div className="inline">
        <button type="submit" disabled={pending || staff.length === 0}>
          {pending ? 'Saving…' : 'Record leave'}
        </button>
        <button className="secondary" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
