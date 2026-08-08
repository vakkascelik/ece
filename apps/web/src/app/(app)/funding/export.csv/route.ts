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
      { header: 'Days capped', value: (c) => c.cappedDates.length },
      // The disclaimer, as data. A file whose totals exclude three days must say which
      // three on the row they came from, or somebody keys the total into ELI Web.
      { header: 'Unresolved days', value: (c) => c.unresolvedDates.join(' ') },
    ],
  });
}
