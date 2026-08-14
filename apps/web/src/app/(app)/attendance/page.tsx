import Link from 'next/link';
import {
  listAttendanceToday,
  listBookings,
  listChildren,
  listHealthByChild,
  listVerificationOverview,
  readAdultsPresent,
} from '@ece/api';
import {
  assessRatio,
  can,
  displayName,
  lastCompletedWeek,
  needsAttention,
  splitByAgeBand,
  summariseVerification,
  todayInZone,
} from '@ece/core';
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

  const [children, states, adultsPresent, healthByChild, todaysBookings, overview] =
    await Promise.all([
      listChildren(db, ctx.centre.id),
      listAttendanceToday(db, ctx.centre.id),
      readAdultsPresent(db, ctx.centre.id),
      listHealthByChild(db, ctx.centre.id),
      listBookings(db, { centreId: ctx.centre.id, from: today, to: today }),
      listVerificationOverview(db, {
        centreId: ctx.centre.id,
        lastCompletedMonday: lastCompletedWeek(today).periodStart,
        weeksBack: 4,
      }),
    ]);

  /*
    The §6-3 chase queue: superseded, then overdue, then in-review — the three states
    where somebody at the centre owes an action, ordered by who is worst off if nobody
    acts (needsAttention's own ordering). `awaiting` is deliberately not listed row by
    row: inside the chase window it is the families' turn, not the office's, and a queue
    padded with rows nobody should act on is a queue people stop reading.
  */
  const chase = needsAttention(
    overview.map((w) => summariseVerification(w, today)),
  ).map((s) => {
    const child = children.find((c) => c.id === s.childId);
    return {
      key: `${s.childId}:${s.periodStart}`,
      childId: s.childId,
      name: child ? displayName(child) : 'A child',
      week: s.periodStart,
      status: s.status,
    };
  });
  const awaitingCount = overview
    .map((w) => summariseVerification(w, today))
    .filter((s) => s.status === 'awaiting').length;

  /*
    Who the families have already said is away (0063). This is what turns a reported
    absence from a row nobody reads into the difference between "missing" and "accounted
    for" on the 8:30 roll — the phone call the button exists to replace was the centre
    ringing to ask a question the family had already answered.
  */
  const awayToday = todaysBookings
    .filter((b) => b.status === 'absent')
    .map((b) => {
      const child = children.find((c) => c.id === b.childId);
      return {
        childId: b.childId,
        name: child ? displayName(child) : 'A child',
        reason: b.absenceReason,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

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
      {/*
        Quiet and above the roll: the educator scans this BEFORE worrying about who is
        missing. Absent from the wall display on purpose — the wall answers "are we within
        ratio" at three metres, and names are unreadable there anyway.
      */}
      {awayToday.length > 0 && (
        <section aria-label="Reported away today" className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <p className="eyebrow" style={{ margin: 0 }}>
            Reported away today
          </p>
          <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
            {awayToday.map((a) => (
              <li key={a.childId}>
                {a.name}
                {a.reason && <span className="sub"> — {a.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Rendered even when empty IF weeks are awaiting, so "nothing to chase" is a stated
        fact rather than an absent card — the sleep-check rule about green screens. Fully
        absent only when there is genuinely nothing in flight.
      */}
      {(chase.length > 0 || awaitingCount > 0) && (
        <section
          aria-label="Attendance verification"
          className="card"
          style={{ marginBottom: 'var(--space-4)' }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>
            Weekly record verification
          </p>
          {chase.length > 0 ? (
            <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)' }}>
              {chase.map((row) => (
                <li key={row.key}>
                  <Link href={`/children/${row.childId}/attendance`}>{row.name}</Link>, week of{' '}
                  {row.week} —{' '}
                  {row.status === 'superseded' ? (
                    <span className="flag flag-critical">record changed after approval</span>
                  ) : row.status === 'overdue' ? (
                    <span className="flag flag-critical">unanswered past the window — offer paper</span>
                  ) : (
                    <span className="flag flag-quiet">family says something is wrong</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sub" style={{ margin: 'var(--space-2) 0 0' }}>
              Nothing needs the office.
            </p>
          )}
          {awaitingCount > 0 && (
            <p className="sub" style={{ margin: 'var(--space-2) 0 0' }}>
              {awaitingCount} week{awaitingCount === 1 ? '' : 's'} awaiting family confirmation —
              inside the window, no action needed yet.
            </p>
          )}
        </section>
      )}

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
