import Link from 'next/link';
import { listCentreBookingSchedule, listServiceClosures, readAttendanceByDay } from '@ece/api';
import {
  completeWeeksBefore,
  operatingDays,
  shiftLocalDate,
  summariseWeekdayPattern,
  summariseWeeklyAttendance,
  todayInZone,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { dayWindow } from '@/lib/dayWindow';
import { PageActions } from '../../PageActions';
import { PageHeader } from '../../PageHeader';

const WEEK_COUNT = 12;
const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Twelve complete weeks, not thirty days — the trend the day-by-day occupancy report
 * cannot show.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY "COMPLETE" WEEKS
 *
 * `completeWeeksBefore` excludes the week `today` falls in. A Wednesday's three open days
 * would otherwise average as though the week had already finished, understating it for a
 * reason nothing on the page would explain. The same discipline the occupancy report
 * applies to closed days, one level up.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TREND FIGURE COMPARES TWO WEEKS, NOT A REGRESSION LINE
 *
 * "Busier than twelve weeks ago" is the earliest week with any attendance against the
 * most recent one — a fact a reader can check against the table above it. A slope or a
 * moving average would compress twelve numbers into one that looks more rigorous and is
 * harder to audit against what is printed on the same page. Two named weeks, plainly
 * labelled, is the whole claim.
 */
export default async function TrendsPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);
  const { rangeStart, rangeEnd } = completeWeeksBefore(today, WEEK_COUNT);

  const dates: string[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = shiftLocalDate(d, 1)) dates.push(d);
  const days = dates.map((date) => ({ date, ...dayWindow(date, ctx.centre.timezone) }));

  /*
    THE OPERATING CALENDAR, ADDED 2026-09-05 — and until then this page was quietly on the
    flattering denominator the occupancy report next door had already stopped using.

    Both summaries called `averageOverOpenDays` with no calendar, so a day the service was open
    and nobody came was dropped from the divisor rather than counted as the zero it is. That is
    the defect [[unverified-claims]] item 59 was opened for, closed on `/reports` and left in
    place here — and worse than merely being wrong, the page had no field to say which basis it
    had used, so the two reports could disagree with no way to see why.

    Three reads rather than one, matching `/reports` exactly: the same two facts are recorded
    separately, and `operatingDays` refuses to guess where no schedule is effective.
  */
  const [attendance, closures, blocks] = await Promise.all([
    readAttendanceByDay(db, ctx.centre.id, days),
    listServiceClosures(db, ctx.centre.id),
    listCentreBookingSchedule(db, ctx.centre.id),
  ]);

  const operating = operatingDays({
    blocks,
    closures,
    from: rangeStart,
    to: rangeEnd,
  });
  const weeks = summariseWeeklyAttendance(attendance, operating);
  const weekdayPattern = summariseWeekdayPattern(attendance, operating);

  const openWeeks = weeks.filter((w) => w.averageChildren !== null);
  const earliest = openWeeks[0] ?? null;
  const latest = openWeeks[openWeeks.length - 1] ?? null;
  const changePercent =
    earliest && latest && earliest !== latest && earliest.averageChildren! > 0
      ? Math.round(
          ((latest.averageChildren! - earliest.averageChildren!) / earliest.averageChildren!) * 1000,
        ) / 10
      : null;

  const busiestWeekday = weekdayPattern.reduce<(typeof weekdayPattern)[number] | null>(
    (best, w) =>
      w.averageChildren !== null && (best === null || w.averageChildren! > best.averageChildren!)
        ? w
        : best,
    null,
  );

  return (
    <div className="binder">
      <div className="no-print">
        <PageHeader
          title="Attendance trends"
          subtitle={
            <>
              {ctx.centre.name} · {WEEK_COUNT} complete weeks, {weeks[0]?.weekStart} to{' '}
              {weeks[weeks.length - 1]?.weekEnd}
            </>
          }
          actions={
            <PageActions hint="The printed version keeps the tables and drops the navigation." />
          }
        />
      </div>

      <div className="card">
        {openWeeks.length === 0 ? (
          <p style={{ margin: 0 }}>
            <em>No attendance was recorded across these {WEEK_COUNT} weeks.</em>
          </p>
        ) : changePercent === null ? (
          <p style={{ margin: 0 }}>
            Not enough weeks with attendance yet to compare — see the table below for what
            there is.
          </p>
        ) : (
          <div role="status" className="inline">
            <span className={changePercent >= 0 ? 'flag flag-ok' : 'flag flag-warn'}>
              {changePercent >= 0 ? '▲' : '▼'} {Math.abs(changePercent)}% since the week of{' '}
              {earliest!.weekStart}
            </span>
            <span className="flag flag-quiet">
              {earliest!.averageChildren} on average that week → {latest!.averageChildren} the
              week of {latest!.weekStart}
            </span>
          </div>
        )}

        {/*
          WHICH DENOMINATOR, in words, and the same sentence the occupancy report makes — because
          the two pages read the same attendance and would otherwise print different averages with
          nothing on either explaining the difference.

          Taken from the weeks rather than held separately: every week on this page is computed
          from one calendar, so the first week's basis is the page's basis, and deriving it here
          means it cannot drift from the figures beside it.
        */}
        {openWeeks.length > 0 && (
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            {weeks[0]?.averageBasis === 'operating-days' ? (
              <>
                Averages are over the days your booking schedule says you operated, closures
                excluded — so a day you were open and nobody came counts as a zero, because it is
                one.
              </>
            ) : (
              <>
                Averages are over the days that had any attendance,{' '}
                <strong>because no booking schedule covers this period</strong> — so a day you were
                open and nobody came is not counted at all, and these figures read higher than they
                would against a real calendar. Record a booking schedule and they will be over the
                days you operate.
              </>
            )}
          </p>
        )}
        {busiestWeekday && busiestWeekday.averageChildren !== null && (
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            {WEEKDAY_LABELS[busiestWeekday.weekday - 1]} is the busiest day of the week on
            average, at {busiestWeekday.averageChildren} tamariki — see the pattern below for
            every day.
          </p>
        )}
      </div>

      <div className="section">
        <h2>Week by week</h2>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Week</th>
                <th>Days open</th>
                <th>Average tamariki</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td>
                    {w.weekStart} – {w.weekEnd}
                  </td>
                  <td>{w.daysWithAttendance}</td>
                  <td>{w.averageChildren ?? <span className="sub">no attendance</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h2>By day of the week</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Averaged across the {WEEK_COUNT} weeks above — useful for roster planning, not for
          compliance. For whether the centre was ever over ratio at a moment, see the{' '}
          <Link href="/compliance">ratio history</Link>.
        </p>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Weeks with attendance</th>
                <th>Average tamariki</th>
              </tr>
            </thead>
            <tbody>
              {weekdayPattern.map((w) => (
                <tr key={w.weekday}>
                  <td>{WEEKDAY_LABELS[w.weekday - 1]}</td>
                  <td>{w.daysWithAttendance}</td>
                  <td>{w.averageChildren ?? <span className="sub">no attendance</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
