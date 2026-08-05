import { listAttendanceToday, listChildren, listHealthByChild, readAdultsPresent } from '@ece/api';
import {
  assessRatio,
  can,
  compareBySeverity,
  displayName,
  hasCriticalCondition,
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
export default async function AttendancePage() {
  const ctx = await requireCapability('recordDailyPractice');
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

  return (
    <>
      <div className="page-head" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1>Attendance</h1>
          <p className="sub" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
            {ctx.centre.name} · {today}
          </p>
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
          <Table rows={present} states={byChild} health={healthByChild} />
        )}
      </section>

      <section className="section" aria-labelledby="away-heading">
        <h2 id="away-heading">Not here — {away.length}</h2>
        {away.length === 0 ? (
          <div className="card">
            <p className="empty">Everyone enrolled is signed in.</p>
          </div>
        ) : (
          <Table rows={away} states={byChild} health={healthByChild} />
        )}
      </section>
    </>
  );
}

function Table({
  rows,
  states,
  health,
}: {
  rows: Child[];
  states: Map<string, { kind: 'in' | 'out'; at: string; eventId: number }>;
  health: Map<string, HealthCondition[]>;
}) {
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Age</th>
            <th>Since</th>
            <th>Flags</th>
            <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((child) => {
            const state = states.get(child.id);
            const conditions = health.get(child.id) ?? [];
            const worst = [...conditions].sort(compareBySeverity)[0];
            return (
              <AttendanceRow
                key={child.id}
                childId={child.id}
                name={displayName(child)}
                underTwo={isUnderTwo(child.dateOfBirth)}
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
        </tbody>
      </table>
    </div>
  );
}
