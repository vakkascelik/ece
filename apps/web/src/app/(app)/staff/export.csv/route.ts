import { listStaffAttendance, listStaffMembers, listStaffRecords } from '@ece/api';
import { currentStaff, lastStaffEvent, staffPresentNow, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow } from '@/lib/dayWindow';
import { csvDownload } from '@/lib/csvDownload';
import { serverDb } from '@/lib/supabase';

/**
 * The staff list and today's hours, as a spreadsheet.
 *
 * `manageMembers` rather than the page's `recordDailyPractice`. Reading the roster is
 * open to every educator because everybody rostered needs to know who else is on; a
 * *file* of everybody's hours is a payroll document, and that is the office's.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HOURS COLUMN IS NOT A TIMESHEET, AND SAYS SO
 *
 * It reports the first and last event of today and the span between them. That is not
 * hours worked: it does not subtract breaks, it does not resolve a missing sign-out,
 * and it does not know about a shift that crosses midnight.
 *
 * A column called `Hours` that a payroll clerk pastes into a pay run would be the
 * single most expensive wrong number this product could emit, so the heading says
 * `First in`, `Last out` and `Span`, and there is no total row. When a real timesheet
 * export exists it will floor the way `toHours` floors — but in the opposite direction,
 * because under-claiming the Crown is conservative and under-paying staff is not.
 */
export async function GET() {
  const ctx = await requireCapability('manageMembers');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);
  const { fromUtc, toUtc } = dayWindow(today, ctx.centre.timezone);

  const [members, events, records] = await Promise.all([
    listStaffMembers(db, ctx.centre.id),
    listStaffAttendance(db, ctx.centre.id, fromUtc, toUtc),
    listStaffRecords(db, ctx.centre.id),
  ]);

  const present = staffPresentNow(events);
  const roster = new Set(currentStaff(members, today).map((m) => m.id));

  const clock = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const rows = members.map((member) => {
    const mine = events.filter((e) => e.staffMemberId === member.id);
    const first = mine.find((e) => e.kind === 'in') ?? null;
    const last = lastStaffEvent(events, member.id);
    const out = last && last.kind === 'out' ? last : null;

    const spanMinutes =
      first && out ? Math.round((Date.parse(out.at) - Date.parse(first.at)) / 60_000) : null;

    return {
      member,
      onRoster: roster.has(member.id),
      here: present.has(member.id),
      firstIn: first ? clock.format(new Date(first.at)) : null,
      lastOut: out ? clock.format(new Date(out.at)) : null,
      // Rendered as hours and minutes rather than a decimal, so nobody sums the column
      // by accident.
      span: spanMinutes === null ? null : `${Math.floor(spanMinutes / 60)}h ${spanMinutes % 60}m`,
      certificates: records
        .filter((r) => r.staffMemberId === member.id && r.archivedAt === null)
        .map((r) => `${r.kind}${r.expiresOn ? ` to ${r.expiresOn}` : ''}`)
        .join('; '),
    };
  });

  return csvDownload({
    rows,
    kind: 'staff',
    centreName: ctx.centre.name,
    on: today,
    columns: [
      { header: 'Name', value: (r) => r.member.fullName },
      { header: 'Role note', value: (r) => r.member.roleNote },
      // Said plainly rather than left blank: a person with no login is normal here —
      // relievers, contractors, the cook — and an empty cell reads as missing data.
      { header: 'App account', value: (r) => (r.member.userId ? 'yes' : 'no') },
      { header: 'Started', value: (r) => r.member.startedOn },
      { header: 'Last day', value: (r) => r.member.finishedOn },
      { header: 'On roster today', value: (r) => (r.onRoster ? 'yes' : 'no') },
      { header: 'Here now', value: (r) => (r.here ? 'yes' : 'no') },
      { header: 'First in', value: (r) => r.firstIn },
      { header: 'Last out', value: (r) => r.lastOut },
      { header: 'Span (not hours worked)', value: (r) => r.span },
      { header: 'Records held', value: (r) => r.certificates },
    ],
  });
}
