import Link from 'next/link';
import { listAttendanceToday, listChildren, listHealthByChild, readAdultsPresent } from '@ece/api';
import {
  assessRatio,
  can,
  compareBySeverity,
  displayName,
  formatAge,
  hasCriticalCondition,
  initials,
  isUnderTwo,
  splitByAgeBand,
  todayInZone,
  type Child,
  type HealthCondition,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { AdultCount } from './AdultCount';
import { AttendanceRow } from './AttendanceRow';
import { RatioBanner } from './RatioBanner';

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

  const byChild = new Map(states.map((s) => [s.childId, s]));
  const present = children.filter((c) => byChild.get(c.id)?.kind === 'in');
  const away = children.filter((c) => byChild.get(c.id)?.kind !== 'in');

  const { underTwo, twoAndOver } = splitByAgeBand(present, ctx.centre.timezone);
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

      {/* First thing on the page, always. Not a report somebody goes and finds. */}
      <RatioBanner ratio={ratio} />

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

      <section className="section" aria-labelledby="here-heading">
        <h2 id="here-heading">Here now — {present.length}</h2>
        {present.length === 0 ? (
          <div className="card">
            <p className="empty">Nobody signed in yet.</p>
          </div>
        ) : (
          <Roll
            rows={present}
            states={byChild}
            health={healthByChild}
            timezone={ctx.centre.timezone}
          />
        )}
      </section>

      <section className="section" aria-labelledby="away-heading">
        <h2 id="away-heading">Not here — {away.length}</h2>
        {away.length === 0 ? (
          <div className="card">
            <p className="empty">Everyone enrolled is signed in.</p>
          </div>
        ) : (
          <Roll
            rows={away}
            states={byChild}
            health={healthByChild}
            timezone={ctx.centre.timezone}
          />
        )}
      </section>
    </>
  );
}

/**
 * The roll as a list.
 *
 * Was a `<table>` with Name / Age / Since / Flags / Actions columns. The design pack
 * folds age and flags into a line under the name, which leaves three columns of
 * unrelated things — a layout, not tabular data. Restyling a table's rows as grids also
 * costs the row semantics in some engines, so this is a list with an explicit grid.
 */
function Roll({
  rows,
  states,
  health,
  timezone,
}: {
  rows: Child[];
  states: Map<string, { kind: 'in' | 'out'; at: string; eventId: number }>;
  health: Map<string, HealthCondition[]>;
  timezone: string;
}) {
  return (
    <ul className="roll">
      {rows.map((child) => {
        const state = states.get(child.id);
        const conditions = health.get(child.id) ?? [];
        const worst = [...conditions].sort(compareBySeverity)[0];
        return (
          <AttendanceRow
            key={child.id}
            childId={child.id}
            name={displayName(child)}
            monogram={initials(child)}
            // Against the centre's today, not the server's — a Next server runs in UTC
            // and would age every child in the country by a day for the NZ morning.
            age={formatAge(child.dateOfBirth, todayInZone(timezone))}
            underTwo={isUnderTwo(child.dateOfBirth, todayInZone(timezone))}
            present={state?.kind === 'in'}
            since={state?.at ?? null}
            eventId={state?.eventId ?? null}
            critical={
              hasCriticalCondition(conditions) && worst
                ? {
                    label: worst.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe',
                    name: worst.name,
                    plan: worst.responsePlan,
                  }
                : null
            }
          />
        );
      })}
    </ul>
  );
}
