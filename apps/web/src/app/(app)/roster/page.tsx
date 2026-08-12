import Link from 'next/link';
import { listLeave, listShifts, listStaffMembers, readForecast } from '@ece/api';
import { can, currentStaff, shiftLocalDate, summariseForecast, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { RosterWeek, type DayView } from './RosterWeek';

const DAYS = 7;

/**
 * The week ahead, and whether the plan for it holds.
 *
 * Everything else in this product answers "what is the ratio now" or "what was it".
 * Both are late. This is the only screen that answers a question somebody can still
 * act on — and the answer it gives is arithmetic over `bookings` and `shifts`, with
 * no new source of truth of its own.
 *
 * Seven days, because that is the horizon a reliever can be booked within. A month
 * view was the obvious alternative and it answers a different question: a manager
 * looking a month out is planning, and a manager looking a week out is covering.
 */
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const params = await searchParams;

  const today = todayInZone(ctx.centre.timezone);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? (params.from as string) : today;
  const dates = Array.from({ length: DAYS }, (_, i) => shiftLocalDate(from, i));
  const to = dates[DAYS - 1] as string;

  const [members, shifts, leave, forecasts] = await Promise.all([
    listStaffMembers(db, ctx.centre.id),
    listShifts(db, ctx.centre.id, from, to),
    listLeave(db, ctx.centre.id, from, to),
    readForecast(db, { centreId: ctx.centre.id, dates }),
  ]);

  const nameById = new Map(members.map((m) => [m.id, m.fullName]));

  const days: DayView[] = dates.map((date, i) => {
    const forecast = forecasts[i]!;
    return {
      date,
      summary: summariseForecast(forecast),
      worstShortfall: forecast.worstShortfall,
      bookingsWithoutTimes: forecast.bookingsWithoutTimes,
      shortfalls: forecast.shortfalls.map((s) => ({
        from: s.from,
        to: s.to,
        shortfall: s.assessment.shortfall,
        children: s.assessment.present,
        adults: s.assessment.adultsPresent,
        covering: s.staffMemberIds.map((id) => nameById.get(id) ?? 'Somebody no longer listed'),
      })),
      shifts: shifts
        .filter((s) => s.onDate === date)
        .map((s) => ({
          id: s.id,
          name: nameById.get(s.staffMemberId) ?? 'Somebody no longer listed',
          fromTime: s.fromTime.slice(0, 5),
          toTime: s.toTime.slice(0, 5),
          roleNote: s.roleNote,
          status: s.status,
          // Rostered and away. The row stays visible: a manager needs to see that the
          // cover they arranged is not going to happen, which is precisely what the
          // forecast has already subtracted.
          onLeave: forecast.onLeave.includes(s.staffMemberId),
        })),
    };
  });

  const roster = currentStaff(members, today);
  const anyShortfall = days.some((d) => d.worstShortfall > 0);
  /*
   * "Covered" USED TO MEAN "NOTHING SAID OTHERWISE", WHICH IS NOT THE SAME CLAIM.
   *
   * `worstShortfall` can only exceed 0 on a segment that was assessed, and a booking with no hours
   * produces no segment — `ratioForecast` counts those separately as `bookingsWithoutTimes`. So a
   * day with children booked, nobody rostered, and no times on any booking assessed **nothing**,
   * reported `worstShortfall: 0`, and this banner printed "✓ The next 7 days are covered".
   *
   * That is the worst direction for this screen to be wrong in: a forward-looking figure is the one
   * a manager acts on by *not* calling a reliever, as the notice below already says. The per-day
   * text was honest all along — `summariseForecast` returns "Nothing booked or rostered." — and only
   * the week summary conflated "found no shortfall" with "checked and found none".
   */
  const unassessableDays = days.filter((d) => d.bookingsWithoutTimes > 0).length;

  return (
    <>
      <PageHeader
        title="Roster"
        helpHref="/roster"
        subtitle="Who is planned to be on, and whether that covers who is booked in."
      />

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="inline" style={{ margin: 0 }}>
          <span className={`flag ${anyShortfall || unassessableDays > 0 ? 'flag-warn' : 'flag-ok'}`}>
            {anyShortfall || unassessableDays > 0 ? '●' : '✓'}{' '}
            {anyShortfall
              ? 'Short in the next 7 days'
              : unassessableDays > 0
                ? `${unassessableDays} of the next 7 days cannot be checked`
                : 'The next 7 days are covered'}
          </span>
        </p>

        {/*
          The unverified notice, in the same words as every other ratio surface. A
          forward-looking figure is the one a manager acts on by NOT calling a
          reliever, which makes it the last place to imply the bands have been
          checked. See ratios.ts and unverified-claims.
        */}
        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          These figures use the same ratio tables as the attendance screen, and those tables have
          not been checked against the regulation by anybody. Treat a covered day as an indication,
          not a clearance.
        </p>

        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          Built from bookings and the roster, never from who actually turned up &mdash; a forecast
          mixed with attendance would be a number nobody could account for. Sign-ins are on{' '}
          <Link href="/staff">Staff</Link>; bookings are on <Link href="/children">Children</Link>.
        </p>
      </div>

      <RosterWeek
        days={days}
        staff={roster.map((m) => ({ id: m.id, name: m.fullName }))}
        canManage={can(ctx.role, 'manageMembers')}
        leave={leave
          .filter((l) => l.status !== 'declined')
          .map((l) => ({
            id: l.id,
            name: nameById.get(l.staffMemberId) ?? 'Somebody no longer listed',
            fromDate: l.fromDate,
            toDate: l.toDate,
            kind: l.kind,
            status: l.status,
          }))}
        from={from}
        previousFrom={shiftLocalDate(from, -DAYS)}
        nextFrom={shiftLocalDate(from, DAYS)}
        today={today}
      />
    </>
  );
}
