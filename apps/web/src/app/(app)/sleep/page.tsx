import Link from 'next/link';
import { listAttendanceToday, listChildren, listSleepChecks } from '@ece/api';
import { SLEEP_POSITION_LABELS, sleepStatuses, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { TabHelp } from '../help/TabHelp';
import { SleepRegister, type SleepRow } from './SleepRegister';

/**
 * The sleep register.
 *
 * Scoped to children who are **signed in**, because a register listing everyone on
 * the roll is a register nobody scans. Derived from `attendance_events` like every
 * other "who is here" answer in this product — there is no stored present flag.
 *
 * The screen makes no claim about whether the checks were frequent enough unless the
 * centre has stated an interval, and says so where the interval would go. That is
 * the whole design; see `sleep-checks.md` and unverified-claims item 23.
 */
export default async function SleepPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const today = todayInZone(ctx.centre.timezone);
  const { fromUtc, toUtc } = dayWindow(today, ctx.centre.timezone);

  const [children, attendance] = await Promise.all([
    listChildren(db, ctx.centre.id),
    listAttendanceToday(db, ctx.centre.id),
  ]);

  const present = children.filter(
    (c) => attendance.find((s) => s.childId === c.id)?.kind === 'in',
  );

  // Scoped by child, because `sleep_checks` reaches its centre through the child and
  // the caller already holds the roll.
  const checks = await listSleepChecks(
    db,
    present.map((c) => c.id),
    fromUtc,
    toUtc,
  );

  /*
    `now` is passed in rather than read inside the pure code, and the whole page is
    a fresh server render — so "12 minutes ago" is 12 minutes ago at the moment the
    page was built, not whenever the tab happened to be left open. A client-side
    ticking counter would be friendlier and would also keep counting on a tablet
    nobody is holding, which is worse than a number that is obviously a snapshot.
  */
  const now = new Date().toISOString();
  const statuses = sleepStatuses(
    present.map((c) => c.id),
    checks,
    now,
    ctx.centre.sleepCheckMinutes,
  );

  const clock = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  const latestFor = (childId: string) =>
    checks.filter((c) => c.childId === childId).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

  const rows: SleepRow[] = statuses.map((status) => {
    const child = present.find((c) => c.id === status.childId)!;
    const last = status.lastCheckedAt ? latestFor(status.childId) : null;
    return {
      status,
      childName: `${child.firstName} ${child.lastName}`,
      lastLabel: status.lastCheckedAt ? clock.format(new Date(status.lastCheckedAt)) : null,
      lastPosition: last ? SLEEP_POSITION_LABELS[last.observedPosition] : null,
      lastBreathing: last ? last.breathingObserved : null,
    };
  });

  return (
    <>
      <div className="has-help">
        <h1>Sleep checks</h1>
        <TabHelp href="/sleep" />
      </div>
      <p className="sub">
        Children signed in at {ctx.centre.name} today, longest since a check first.
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        {ctx.centre.sleepCheckMinutes === null ? (
          <p style={{ margin: 0 }}>
            <span className="flag flag-quiet">No interval set</span>{' '}
            <span className="sub">
              This screen shows how long ago each child was checked and does not judge whether
              that is often enough &mdash; nobody has told it what often enough means. Your centre
              can state an interval in <Link href="/settings">Settings</Link>, and this page will
              measure against it.
            </span>
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            <span className="sub">
              Measured against your centre&rsquo;s stated interval of{' '}
              <strong>{ctx.centre.sleepCheckMinutes} minutes</strong>. That figure is your
              centre&rsquo;s, not a requirement this product has verified.
            </span>
          </p>
        )}
      </div>

      <SleepRegister rows={rows} intervalMinutes={ctx.centre.sleepCheckMinutes} />
    </>
  );
}
