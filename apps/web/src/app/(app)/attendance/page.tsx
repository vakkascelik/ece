import Link from 'next/link';
import { listAttendanceToday, listChildren, listHealthByChild, readAdultsPresent } from '@ece/api';
import { assessRatio, can, splitByAgeBand, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { AdultCount } from './AdultCount';
import { RatioBanner } from './RatioBanner';
import { RollClient } from './RollClient';

/**
 * The room, right now.
 *
 * Everything here is derived from `attendance_events` and `staff_count_events` on
 * every render. There is no stored "present" flag and no cached ratio — a counter
 * drifts on a missed sign-out or a failed write, and a drifting ratio reports itself
 * as compliant.
 *
 * The office view of what the tablets are doing. The mobile app is where an educator
 * actually signs children in; this is for the person who needs the whole picture and
 * has a keyboard.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ wall?: string }>;
}) {
  const ctx = await requireCapability('recordDailyPractice');
  // Screen 13. A query parameter rather than a route, because this is the same screen at a
  // different reading distance and the pack's route list is complete without a `/wall`.
  const wall = (await searchParams).wall === '1';
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const [children, states, adultsPresent, healthByChild] = await Promise.all([
    listChildren(db, ctx.centre.id),
    listAttendanceToday(db, ctx.centre.id),
    readAdultsPresent(db, ctx.centre.id),
    listHealthByChild(db, ctx.centre.id),
  ]);

  /*
    The wall display's ratio is computed here, on the server, and the roll's is computed in the
    client from the same server state plus the browser's queue. Two derivations of one number
    would normally be a smell; the wall panel has no queue to merge and no interactivity, and
    giving it a client component purely to reach the same answer would ship JavaScript to a
    screen bolted to a wall.
  */
  const serverPresent = children.filter(
    (c) => states.find((s) => s.childId === c.id)?.kind === 'in',
  );
  const { underTwo, twoAndOver } = splitByAgeBand(serverPresent, ctx.centre.timezone);
  const ratio = assessRatio({ underTwo, twoAndOver, adultsPresent });

  /*
    The wall display is the ratio and nothing else. Not a stripped-down roll: at three metres
    a list of twenty names is unreadable anyway, and the question a wall panel answers as
    somebody walks past the door is "are we within ratio", which is one sentence and two
    numbers. Signing children in stays on the handheld roll below, where a name can be read.
  */
  if (wall) {
    return (
      <>
        <div className="wall-frame">
          <RatioBanner ratio={ratio} wall />
        </div>
        <p style={{ fontSize: 'var(--text-sm)' }}>
          {ctx.centre.name} · {today} · <Link href="/attendance">Leave wall display</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="page-head" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1>Attendance</h1>
          <p className="sub" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {ctx.centre.name} · {today}
          </p>
        </div>
        <div className="page-actions">
          <Link className="btn secondary" href="/attendance?wall=1">
            Wall display
          </Link>
        </div>
      </div>

      {/*
        Adults first, then the roll. The ratio itself is rendered inside RollClient, because a
        queued sign-in has to count toward it and the server cannot see the browser's queue.
      */}

      {/*
        <section> with a name rather than <div>, so a screen reader user can jump
        between "adults present", "here now" and "not here" instead of walking the
        whole roll. An unnamed <section> is not exposed as a region at all, which is
        why each carries aria-labelledby rather than just the element.
      */}
      <section className="section" aria-labelledby="adults-heading">
        <h2 id="adults-heading">Adults present</h2>
        <AdultCount current={adultsPresent} canEdit={can(ctx.role, 'recordDailyPractice')} />
      </section>

      {/*
        The ratio and both roll sections live in RollClient. `serverStates` and the health map
        are handed over as plain data — a Map cannot cross the boundary, so health arrives as
        pairs — and the client merges the browser's outbox into them.
      */}
      <RollClient
        childList={children}
        serverStates={states}
        healthPairs={[...healthByChild.entries()]}
        adultsPresent={adultsPresent}
        timeZone={ctx.centre.timezone}
        userId={ctx.userId}
      />
    </>
  );
}
