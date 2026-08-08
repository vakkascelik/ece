import { listAttendanceToday, listChildren } from '@ece/api';
import { displayName, isUnderTwo, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { csvDownload } from '@/lib/csvDownload';
import { serverDb } from '@/lib/supabase';

/**
 * Today's roll, as a spreadsheet.
 *
 * The file a centre reaches for in an evacuation, and the reason it exists: a printed
 * roll is a page somebody has to have printed, and this is a download from a phone in
 * a car park.
 *
 * So it is ordered **present first**, unlike the children export, which is
 * alphabetical. The two files answer different questions — this one is "who is in the
 * building right now", and an alphabetical list makes somebody read all of it.
 *
 * `recordDailyPractice`, matching the page: the person holding the tablet at the gate
 * is an educator, and a roll they cannot download is a roll that stays on paper.
 *
 * No allergies and no conditions, for the reason `children/export.csv` records at
 * length. The under-2 column is here because it is the one fact that changes what the
 * ratio requires, and it is derived from a date of birth the reader already holds.
 */
export async function GET() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const [children, attendance] = await Promise.all([
    listChildren(db, ctx.centre.id),
    listAttendanceToday(db, ctx.centre.id),
  ]);

  const stateOf = new Map(attendance.map((s) => [s.childId, s]));

  const clock = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const rows = children
    .map((child) => {
      const state = stateOf.get(child.id) ?? null;
      return {
        child,
        here: state?.kind === 'in',
        at: state ? clock.format(new Date(state.at)) : null,
        underTwo: isUnderTwo(child.dateOfBirth, today),
      };
    })
    .sort(
      (a, b) =>
        Number(b.here) - Number(a.here) ||
        displayName(a.child).localeCompare(displayName(b.child)),
    );

  return csvDownload({
    rows,
    kind: 'roll',
    centreName: ctx.centre.name,
    on: today,
    columns: [
      { header: 'Child', value: (r) => displayName(r.child) },
      { header: 'Here now', value: (r) => (r.here ? 'yes' : 'no') },
      { header: 'Last event', value: (r) => r.at },
      { header: 'Under 2', value: (r) => (r.underTwo ? 'yes' : 'no') },
      { header: 'Date of birth', value: (r) => r.child.dateOfBirth },
    ],
  });
}
