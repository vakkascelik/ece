import Link from 'next/link';
import { readAttendanceByDay } from '@ece/api';
import { summariseOccupancy, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { TabHelp } from '../help/TabHelp';
import { PageActions } from '../PageActions';

/**
 * Occupancy and attendance over the last thirty days.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REPORT SAYS WHAT IT CANNOT WORK OUT
 *
 * Occupancy needs a denominator, and `licensed_places` is null until a centre types it in
 * (0050). Rather than defaulting it — a licence is anywhere from 10 to 150 places, so a
 * guess can be wrong by a factor of three while looking entirely plausible — the page
 * shows the attendance counts, which are real, and says plainly that it cannot compute a
 * percentage. That is the standing rule in `unverified-claims`: if you cannot source a
 * figure, make the product say so.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT "OVER THE LICENCE" DOES AND DOES NOT MEAN HERE
 *
 * `children` is everyone present at **any point** in a day. So a morning child who leaves
 * before an afternoon child arrives counts twice toward a day's total while the centre
 * was never over its licence at any instant. A report that called that a breach would be
 * accusing a centre of something it did not do, so the page says which question it is
 * answering and points at the ratio history for the other one.
 */
export default async function ReportsPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  // Thirty days ending today, oldest first. Each day's window is computed from the
  // centre's timezone — a day is local, the events are instants, and `dayWindow` handles
  // the two days a year the offset moves.
  const days = Array.from({ length: 30 }, (_, i) => shiftLocalDate(today, i - 29)).map((date) => ({
    date,
    ...dayWindow(date, ctx.centre.timezone),
  }));

  const attendance = await readAttendanceByDay(db, ctx.centre.id, days);
  const summary = summariseOccupancy(attendance, ctx.centre.licensedPlaces);

  const busiestPercent =
    summary.busiest && ctx.centre.licensedPlaces
      ? Math.round((summary.busiest.children / ctx.centre.licensedPlaces) * 1000) / 10
      : null;

  return (
    <div className="binder">
      <div className="no-print">
        <div className="section-head">
          <div className="has-help">
            <h1>Reports</h1>
            <TabHelp href="/reports" />
            <p className="sub">
              {ctx.centre.name} · thirty days to {today}
            </p>
          </div>
          <div className="inline">
            <Link href="/reports/trends">
              <button type="button">Attendance trends</button>
            </Link>
            <Link href="/reports/waitlist-conversion">
              <button type="button">Enquiry conversion</button>
            </Link>
          </div>
        </div>
        <PageActions hint="The printed version keeps the table and drops the navigation." />
      </div>

      {/* The one-line answer, before the table. */}
      <div className="card">
        {summary.daysWithAttendance === 0 ? (
          <p style={{ margin: 0 }}>
            <em>No attendance was recorded in this period.</em> That is not the same as no
            tamariki attending — a day nobody signed in looks identical here to a day the
            centre was closed.
          </p>
        ) : (
          <>
            <div role="status" className="inline">
              <span className="flag flag-quiet">
                {summary.averageChildren} tamariki on an average open day
              </span>
              <span className="flag flag-quiet">
                {summary.daysWithAttendance} of 30 days with attendance
              </span>
              {summary.busiest && (
                <span className="flag flag-quiet">
                  busiest {summary.busiest.date} · {summary.busiest.children}
                  {busiestPercent !== null ? ` (${busiestPercent}%)` : ''}
                </span>
              )}
              {summary.daysAtOrOverLicence.length > 0 && (
                <span className="flag flag-warn">
                  ● {summary.daysAtOrOverLicence.length} day
                  {summary.daysAtOrOverLicence.length === 1 ? '' : 's'} at or over the licence
                </span>
              )}
            </div>
            <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
              The average is over the {summary.daysWithAttendance} days that had any attendance,
              not over all thirty. Averaging closed days in would report roughly a third of the
              truth.
            </p>
          </>
        )}
      </div>

      {/*
        The absent denominator, said once and prominently rather than as a dash in every
        row of the table.
      */}
      {ctx.centre.licensedPlaces === null ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            <strong>This report cannot work out occupancy.</strong> It does not know how many
            tamariki this service is licensed for, and it will not guess — a licence is
            anywhere from ten to a hundred and fifty places, so a default would produce
            percentages that look real and are not.
          </p>
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            The attendance counts below are real either way. Enter the figure in{' '}
            <Link href="/settings">Settings</Link> and the percentages appear.
          </p>
        </div>
      ) : (
        <div className="card">
          <p style={{ margin: 0 }}>
            Against <strong>{ctx.centre.licensedPlaces} licensed places</strong>, as stated by
            this centre.
          </p>
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            A day counts every child present at <strong>any point</strong>, so a morning child
            leaving before an afternoon child arrives can push a day over the licence without the
            centre ever being over it at once. For the moment-by-moment question, see the{' '}
            <Link href="/compliance">ratio history</Link>.
          </p>
        </div>
      )}

      <div className="section">
        <h2>Day by day</h2>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Tamariki</th>
                <th>Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{day.children === 0 ? '—' : day.children}</td>
                  <td>
                    {!day.stated ? (
                      <span className="sub">not stated</span>
                    ) : day.children === 0 ? (
                      '—'
                    ) : (
                      <span className={day.children >= day.licensedPlaces ? 'flag flag-warn' : ''}>
                        {day.percent}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
