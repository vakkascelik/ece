import { listChildren, readFundingPeriod } from '@ece/api';
import { displayName, todayInZone, type FundingPeriod } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { csvDownload } from '@/lib/csvDownload';
import { serverDb } from '@/lib/supabase';

/**
 * The RS7 preparation figures, as a spreadsheet.
 *
 * The page insists these are *preparation* and never a return, and the file has to say
 * the same thing — a CSV emailed to an accountant loses every banner it came with. So
 * the disclaimer travels **in the rows**: an `Unresolved days` column that names the
 * dates, so a file with gaps in it cannot be read as a complete claim without noticing.
 *
 * The date range comes from the query string, matching the page, so "download what I am
 * looking at" produces what the operator is looking at. An absent or malformed range
 * falls back to the same current-month default rather than erroring — this is a
 * download, and a 400 in a browser's download tray is invisible.
 */
export async function GET(request: Request) {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const params = new URL(request.url).searchParams;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = iso.test(params.get('from') ?? '') ? (params.get('from') as string) : `${today.slice(0, 7)}-01`;
  const to = iso.test(params.get('to') ?? '') ? (params.get('to') as string) : today;

  const period: FundingPeriod = { label: `${from} to ${to}`, from, to };
  const { dayWindow } = await import('@/lib/dayWindow');
  const start = dayWindow(from, ctx.centre.timezone);
  const end = dayWindow(to, ctx.centre.timezone);

  const [summary, children] = await Promise.all([
    readFundingPeriod(db, {
      centreId: ctx.centre.id,
      period,
      timeZone: ctx.centre.timezone,
      fromUtc: start.fromUtc,
      toUtc: end.toUtc,
    }),
    listChildren(db, ctx.centre.id, { includeArchived: true }),
  ]);

  const nameOf = new Map(children.map((c) => [c.id, displayName(c)]));

  return csvDownload({
    rows: summary.children,
    kind: `funding-${from}-to-${to}`,
    centreName: ctx.centre.name,
    on: today,
    columns: [
      { header: 'Child', value: (c) => nameOf.get(c.childId) ?? 'a former child' },
      { header: '20 Hours ECE', value: (c) => (c.twentyHoursEce ? 'yes' : 'no') },
      { header: 'Attended hours', value: (c) => c.attendedHours.toFixed(2) },
      { header: 'Funded hours', value: (c) => c.fundedHours.toFixed(2) },
      /*
        The two components, added 2026-09-04, because this file is what somebody keys into ELI
        Web and ELI Web asks for them separately — `TwentyHoursFundedChildCount` and
        `TwentyHoursFundedChildPlusTenCount` in the RS7 return.

        Both are zero for a child with no attestation, whose whole figure is subsidy, and for an
        attested child they sum to the funded total. Carried as columns rather than left to be
        worked out from the total, because "20 minus the funded hours, unless the week straddled
        a month boundary" is exactly the arithmetic a spreadsheet gets wrong once and nobody
        checks again.
      */
      { header: '20 Hours ECE hours', value: (c) => c.twentyHoursHours.toFixed(2) },
      { header: 'Plus 10 hours', value: (c) => c.plusTenHours.toFixed(2) },
      { header: 'Days capped', value: (c) => c.cappedDates.length },
      // The disclaimer, as data. A file whose totals exclude three days must say which
      // three on the row they came from, or somebody keys the total into ELI Web.
      { header: 'Unresolved days', value: (c) => c.unresolvedDates.join(' ') },
      // Dates, not a count, for the same reason as the column above: the fix is on the
      // enrolment, and a manager checking a wrong attestation needs to know which days
      // put the child outside the third-to-sixth-birthday band.
      { header: '20 Hours days outside age band', value: (c) => c.ineligibleDates.join(' ') },
      /*
        §9-2's SOURCE, IN THE ROW — added 2026-09-04, and it follows this file's own principle
        rather than extending it.

        The page shows which of §9-2's two sources funded each child; until now the FILE did not,
        and the file is what gets keyed into ELI Web. Two of the four bases produce the same
        number from the same events and differ only in whether it is right, so a row without its
        basis is a figure somebody could transcribe believing the wrong thing about it — exactly
        what the `Unresolved days` column exists to prevent, one field along.

        The raw basis value rather than a friendly phrase. A spreadsheet gets filtered and sorted,
        and `attendance-no-agreement` is greppable in a way that "may be low" is not.
      */
      { header: 'Hours basis', value: (c) => c.hoursBasis },
      /*
        Unconditional, unlike the split above it, and for the opposite reason: the split is zero
        or identical to the total for most children, whereas an absence figure of 0.00 is a
        positive statement that none of this claim rests on a day nobody attended. On a Crown
        return that is the number an auditor asks about first.
      */
      { header: 'Claimable absent hours', value: (c) => c.absenceHours.toFixed(2) },
      /*
        Dates and their reason, for the same reason `Unresolved days` carries dates: this is the
        actionable column. An enrolled child whose absences have run past the three-week window
        is what §6-7 expects a service to act on, and "which days" is the first thing they need.
      */
      {
        header: 'Absences not claimable',
        value: (c) => c.unclaimableAbsences.map((u) => `${u.date} (${u.reason})`).join('; '),
      },
      /*
        Attendance the agreement does not cover. Reported and never claimed — §9-2 step 1 asks
        for the hours of enrolment — so a service seeing dates here can change the agreement,
        which is what §6-7 asks for when attendance stops matching it.
      */
      { header: 'Attended outside agreement', value: (c) => c.attendedOutsideAgreement.join(' ') },
    ],
  });
}
