import Link from 'next/link';
import { readRs7Return } from '@ece/api';
import { ministryFundingPeriods, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { dayWindow } from '@/lib/dayWindow';
import { PageHeader } from '../../PageHeader';
import { PageActions } from '../../PageActions';
import { DeclarationForm } from './DeclarationForm';

/**
 * The RS7 return, prepared.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DIFFERENT SCREEN FROM `/funding`, AND THE DIFFERENCE IS THE AXIS
 *
 * `/funding` is per child: the figure a manager checks against one family's attendance, and
 * the place a wrong number gets noticed. This is per **calendar date**, because that is the
 * shape the return asks for — six counts a day, and none of them nameable to a child.
 *
 * The transposition is not a view of the same data. Rounding happens at the daily total across
 * children (§9-2 step 5), so the two screens legitimately disagree in the last decimal and a
 * reader has to know which question each answers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PERIOD IS THE MINISTRY'S, NOT A DATE RANGE
 *
 * `/funding` deliberately lets an operator choose any range. This one does not: RS7 periods
 * are February, June and October the first, and `RS7PeriodStartDate` in the public schema is
 * `[0-9]{4}-(02|06|10)-01`. Offering an arbitrary range here would produce figures the Ministry
 * cannot accept, which is worse than making the choice for somebody.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT STILL CANNOT SUBMIT, AND EVERY LABEL SAYS SO
 *
 * Submitting requires being an approved integrated SMS. Every label says "preparation"; none
 * say "return", "submit" or "file". A screen that looks like it filed something is a screen
 * after which nobody files anything.
 */
export default async function Rs7Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const params = await searchParams;
  const today = todayInZone(ctx.centre.timezone);

  /*
    Two years, so the current period and the one just closed are both reachable — a return is
    prepared after its period ends, which is precisely when the previous year's October–January
    period is the one wanted.
  */
  const year = Number(today.slice(0, 4));
  const periods = [...ministryFundingPeriods(year - 1), ...ministryFundingPeriods(year)];
  const period =
    periods.find((p) => p.from === params.period) ??
    periods.find((p) => p.from <= today && today <= p.to) ??
    periods[periods.length - 1];

  if (!period) {
    // Unreachable: three periods a year, two years. Handled rather than asserted away.
    return <p>No RS7 period could be resolved.</p>;
  }

  const start = dayWindow(period.from, ctx.centre.timezone);
  const end = dayWindow(period.to, ctx.centre.timezone);

  const rs7 = await readRs7Return(db, {
    centreId: ctx.centre.id,
    period,
    timeZone: ctx.centre.timezone,
    fromUtc: start.fromUtc,
    toUtc: end.toUtc,
    ratioSource: ctx.centre.ratioSource,
    licensedPlaces: ctx.centre.licensedPlaces,
    serviceModel: ctx.centre.serviceModel,
  });

  const totals = rs7.days.reduce(
    (acc, d) => ({
      underTwo: acc.underTwo + d.subsidyFundedChildUnderTwo,
      twoAndOver: acc.twoAndOver + d.subsidyFundedChildTwoAndOver,
      twentyHours: acc.twentyHours + d.twentyHoursFundedChild,
      plusTen: acc.plusTen + d.twentyHoursFundedChildPlusTen,
    }),
    { underTwo: 0, twoAndOver: 0, twentyHours: 0, plusTen: 0 },
  );

  return (
    <div className="binder">
      <div className="no-print">
        <PageHeader
          title="RS7 preparation"
          subtitle={
            <>
              Figures for keying into ELI Web, one row per day. Nothing here has been submitted and
              this system cannot submit. The <Link href="/funding">funding page</Link> shows the
              same period per child.
            </>
          }
        />
        <PageActions>
          <a className="button" href={`/funding/rs7.csv?period=${period.from}`}>
            Download the figures
          </a>
        </PageActions>
      </div>

      <section>
        <h2>Period</h2>
        {/*
          A plain GET form. The period is the only input and it belongs in the URL, so a manager
          can send somebody the exact screen they are looking at — the same reason `/funding`
          keeps its range in the query string.
        */}
        <form method="get" className="inline">
          <label htmlFor="period">Funding period</label>
          <select id="period" name="period" defaultValue={period.from}>
            {periods.map((p) => (
              <option key={p.from} value={p.from}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="submit">Show</button>
        </form>
      </section>

      {rs7.assumptions.length > 0 && (
        <div
          className="card"
          style={{ background: 'var(--breach-soft)', borderColor: 'var(--breach-border)' }}
        >
          <p style={{ marginTop: 0 }} role="status">
            <strong>Read these before you key anything in</strong>
          </p>
          {/*
            Not hidden behind a toggle. Every line here is either a figure that could not be
            computed or an allocation the Handbook does not make, and a caveat somebody has to
            click to see is a caveat nobody reads.
          */}
          <ul style={{ marginBottom: 0 }}>
            {rs7.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <h2>Daily figures — {period.label}</h2>
        {rs7.days.length === 0 ? (
          <p>
            <em>No attendance was recorded in this period.</em>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Subsidy under 2</th>
                <th>Subsidy 2 and over</th>
                <th>20 Hours ECE</th>
                <th>Plus 10</th>
                <th>Staff hours qualified</th>
                <th>Staff hours not qualified</th>
              </tr>
            </thead>
            <tbody>
              {rs7.days.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{d.subsidyFundedChildUnderTwo}</td>
                  <td>{d.subsidyFundedChildTwoAndOver}</td>
                  <td>{d.twentyHoursFundedChild}</td>
                  <td>{d.twentyHoursFundedChildPlusTen}</td>
                  {/*
                    An em dash, never a zero. A service reporting zero staff hours is making a
                    different and false statement, and the assumptions block above says why the
                    figure is missing.
                  */}
                  <td>{d.staffHourQualified ?? '—'}</td>
                  <td>{d.staffHourNotQualified ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Period total</th>
                <td>{totals.underTwo}</td>
                <td>{totals.twoAndOver}</td>
                <td>{totals.twentyHours}</td>
                <td>{totals.plusTen}</td>
                <td colSpan={2} className="sub">
                  Staff hours are a daily figure and are not totalled here.
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section>
        <h2>Advance months</h2>
        {/*
          Forward operating days by service model. A dash rather than a zero throughout: zero
          forward operating days is a statement that the service is closing, and neither an
          unrecorded service model nor an unrecorded booking schedule means that.
        */}
        {rs7.advanceMonths.length === 0 ? (
          <p>
            <em>No forward months could be counted.</em>
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>All-day days</th>
                <th>Sessional days</th>
                <th>Parent-led days</th>
              </tr>
            </thead>
            <tbody>
              {rs7.advanceMonths.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{m.allDayDays ?? '—'}</td>
                  <td>{m.sessionalDays ?? '—'}</td>
                  <td>{m.parentLedDays ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Declaration</h2>
        {rs7.missingDeclarationFields.length > 0 && (
          <p className="sub" role="status">
            Still to answer: {rs7.missingDeclarationFields.join(', ')}.
          </p>
        )}
        <DeclarationForm
          periodStartDate={period.from}
          periodLabel={period.label}
          declaration={rs7.declaration}
        />
      </section>
    </div>
  );
}
