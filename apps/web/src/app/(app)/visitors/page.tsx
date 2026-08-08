import { listVisitors } from '@ece/api';
import { onSite, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { VisitorBook, type VisitorRow } from './VisitorBook';

/**
 * The visitor book — its own page, not a section of /facilities.
 *
 * Used dozens of times a day at the door, where the site-safety page is opened
 * weekly. Burying the frequent thing under the infrequent one is how it stays a
 * spiral notebook.
 *
 * The window reaches back seven days rather than one, because "in the building"
 * must not have a horizon: a contractor who signed in on Friday and was never
 * signed out should still be at the top of the list on Monday, as a question —
 * did they really stay, or did nobody sign them out? A today-scoped read would
 * quietly resolve that question by hiding it.
 */
const WINDOW_DAYS = 7;

export default async function VisitorsPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const today = todayInZone(ctx.centre.timezone);
  const { fromUtc } = dayWindow(shiftLocalDate(today, -(WINDOW_DAYS - 1)), ctx.centre.timezone);
  const { fromUtc: todayFrom, toUtc } = dayWindow(today, ctx.centre.timezone);

  const visitors = await listVisitors(db, ctx.centre.id, fromUtc, toUtc);

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  const toRow = (v: (typeof visitors)[number]): VisitorRow => ({
    visitor: v,
    inLabel: when.format(new Date(v.signedInAt)),
    outLabel: v.signedOutAt ? when.format(new Date(v.signedOutAt)) : null,
  });

  const onSiteRows = onSite(visitors).map(toRow);
  // "Earlier today" is exactly that: signed out, and today. Last week's completed
  // visits are in the data for the on-site check above, not on the screen.
  const todayRows = visitors
    .filter((v) => v.signedOutAt !== null && v.signedInAt >= todayFrom)
    .map(toRow);

  return (
    <>
      <h1>Visitors</h1>
      <p className="sub">Who is at {ctx.centre.name}, and who has been.</p>
      <VisitorBook onSiteRows={onSiteRows} todayRows={todayRows} />
    </>
  );
}
