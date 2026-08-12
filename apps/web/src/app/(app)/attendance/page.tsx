import Link from 'next/link';
import { listAttendanceToday, listChildren, listHealthByChild, readAdultsPresent } from '@ece/api';
import { assessRatio, can, splitByAgeBand, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import './attendance.css';
import { AdultCount } from './AdultCount';
import { RatioBanner } from './RatioBanner';
import { RollClient } from './RollClient';
import { appPath } from '@/lib/origin';

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
      <PageHeader
        title="Attendance"
        helpHref="/attendance"
        subtitle={
          <>
            {ctx.centre.name} · {today}
          </>
        }
        /*
          Both secondary. The thing this screen exists to do is sign a child in or out, and
          that control is on the row — not up here. Neither of these is it: one opens a
          read-only view on a wall, the other downloads a file.
        */
        actions={
          <div className="page-actions">
            <Link className="btn secondary" href="/attendance?wall=1">
              Wall display
            </Link>
            <a className="btn" href={appPath('/attendance/export.csv')}>
              Download roll
            </a>
          </div>
        }
      />

      {/*
        The ratio, the adult count and both roll sections all live in RollClient, because the
        ratio has to include the browser's queue and the server cannot see it.

        `AdultCount` used to be a section of its own above the roll, with its own "Adults
        present" heading. It is now a card beside the ratio — the two are one question, and a
        person reading "within ratio" is reading it *about* that number. Its eyebrow carries
        the label the heading used to, so nothing is lost from the reading order; the section
        landmark is, and it was a landmark over a single card.

        `serverStates` and the health map are handed over as plain data — a Map cannot cross
        the boundary, so health arrives as pairs — and the client merges the outbox into them.
      */}
      <RollClient
        childList={children}
        serverStates={states}
        healthPairs={[...healthByChild.entries()]}
        adultsPresent={adultsPresent}
        adultCount={
          <AdultCount current={adultsPresent} canEdit={can(ctx.role, 'recordDailyPractice')} />
        }
        timeZone={ctx.centre.timezone}
        userId={ctx.userId}
      />
    </>
  );
}
