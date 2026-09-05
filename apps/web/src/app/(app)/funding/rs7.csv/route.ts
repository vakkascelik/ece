import { readRs7Return } from '@ece/api';
import { ministryFundingPeriods, todayInZone, type Rs7Day } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { csvDownload } from '@/lib/csvDownload';
import { serverDb } from '@/lib/supabase';

/**
 * The RS7 return's daily figures, as a spreadsheet.
 *
 * ONE ROW PER CALENDAR DATE, which is what makes this a different file from
 * `funding/export.csv` rather than a variant of it. That one is per child and is what a
 * manager checks a figure against; this is per date and is what gets keyed into ELI Web.
 *
 * **Still preparation, and the file has to say so on its own.** A CSV emailed to an
 * accountant loses every banner it came with, so the gaps travel in the rows: `staffHour…`
 * columns are blank rather than zero where §9-4's hours cannot be computed, and a trailing
 * assumptions block names every allocation the Handbook did not make. A file whose figures
 * look final while three of them rest on a stated assumption is a file somebody submits.
 *
 * The period comes from `ministryFundingPeriods`, not from a free date range. RS7 periods are
 * fixed — February, June and October the first — and `RS7PeriodStartDate` in the public schema
 * enforces exactly that, so offering an arbitrary range here would produce a file the Ministry
 * cannot accept.
 */
export async function GET(request: Request) {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const params = new URL(request.url).searchParams;
  const requested = params.get('period');

  /*
    Two years of periods, so the current one and the one just closed are both reachable — a
    return is prepared after its period ends. An absent or unrecognised value falls back to the
    period containing today rather than erroring: this is a download, and a 400 in a browser's
    download tray is invisible.
  */
  const year = Number(today.slice(0, 4));
  const periods = [...ministryFundingPeriods(year - 1), ...ministryFundingPeriods(year)];
  const period =
    periods.find((p) => p.from === requested) ??
    periods.find((p) => p.from <= today && today <= p.to) ??
    periods[periods.length - 1];

  if (!period) {
    // Unreachable — `ministryFundingPeriods` returns three per year — and typed rather than
    // asserted away, because a `!` here would be the one place this file lies to the compiler.
    return new Response('No RS7 period could be resolved.', { status: 500 });
  }

  const { dayWindow } = await import('@/lib/dayWindow');
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

  /*
    The assumptions ride at the foot of the file as rows rather than in a header comment,
    because a CSV header comment is not a thing — every consumer would show it as a broken first
    row. A date column of `—` marks them as commentary, and they sort last.
  */
  const rows: Rs7Day[] = [...rs7.days];

  return csvDownload({
    rows,
    kind: `rs7-${period.from}`,
    centreName: ctx.centre.name,
    on: today,
    columns: [
      { header: 'Date', value: (d) => d.date },
      { header: 'Subsidy under 2', value: (d) => d.subsidyFundedChildUnderTwo },
      { header: 'Subsidy 2 and over', value: (d) => d.subsidyFundedChildTwoAndOver },
      { header: '20 Hours ECE', value: (d) => d.twentyHoursFundedChild },
      { header: '20 Hours ECE Plus 10', value: (d) => d.twentyHoursFundedChildPlusTen },
      /*
        Blank, not zero, where the figure could not be computed. A service reporting zero staff
        hours is making a different and false statement, and `null` renders as an empty cell —
        which is what an unanswered figure looks like in a spreadsheet.
      */
      { header: 'Staff hours qualified', value: (d) => d.staffHourQualified },
      { header: 'Staff hours not qualified', value: (d) => d.staffHourNotQualified },
    ],
    /*
      Not a column: one line per assumption, after the data. `csvDownload` takes them as
      trailing rows so the numbers stay machine-readable and the caveats stay attached.
    */
    trailing: [
      [],
      ['These are preparation figures. Nothing has been submitted and this system cannot submit.'],
      [`Period: ${period.label}`],
      [],
      ['Advance months', 'All-day days', 'Sessional days', 'Parent-led days'],
      ...rs7.advanceMonths.map((m) => [
        m.month,
        m.allDayDays ?? '',
        m.sessionalDays ?? '',
        m.parentLedDays ?? '',
      ]),
      [],
      ...rs7.assumptions.map((a) => [a]),
      ...(rs7.outOfRangeDates.length > 0
        ? [[`Figures outside the schema's 0-9999 bound on: ${rs7.outOfRangeDates.join(' ')}`]]
        : []),
    ],
  });
}
