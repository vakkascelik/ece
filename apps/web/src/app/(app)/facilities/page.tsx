import { listDrills, listHazards, listSafetyChecks } from '@ece/api';
import {
  SAFETY_AREAS,
  daysSince,
  drillStatuses,
  latestByArea,
  summariseHazards,
  todayInZone,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { TabHelp } from '../help/TabHelp';
import { DrillLog, type DrillRow } from './DrillLog';
import { HazardList, type HazardRow } from './HazardList';
import { SafetyChecks, type SafetyRow } from './SafetyChecks';

/**
 * The site: hazards, drills and the routine checks.
 *
 * Three registers on one page because they answer one question — is the building
 * safe to open — and a manager thinks about them together. The visitor book is
 * deliberately not here: it is used dozens of times a day at the door, and burying it
 * under a page somebody visits weekly would guarantee it stays a spiral notebook.
 *
 * Staff only, and educators included: the person who spots a loose paving stone is
 * the person walking on it.
 */
const SAFETY_WINDOW_DAYS = 2;

export default async function FacilitiesPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const today = todayInZone(ctx.centre.timezone);
  // Two days rather than one: a check made at 6pm yesterday is the last thing that
  // happened to the sandpit, and a today-scoped page would call it "not checked".
  const { fromUtc } = dayWindow(shiftLocalDate(today, -(SAFETY_WINDOW_DAYS - 1)), ctx.centre.timezone);
  const { toUtc } = dayWindow(today, ctx.centre.timezone);

  const [hazards, drills, checks] = await Promise.all([
    listHazards(db, ctx.centre.id),
    listDrills(db, ctx.centre.id),
    listSafetyChecks(db, ctx.centre.id, fromUtc, toUtc),
  ]);

  const now = new Date().toISOString();

  // Every time in this product is formatted on the server in the centre's zone. A
  // date that shifts depending on who opens the page is worse than useless in a
  // review.
  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const dayOnly = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const hazardRows: HazardRow[] = hazards.map((hazard) => ({
    hazard,
    identifiedLabel: dayOnly.format(new Date(hazard.identifiedAt)),
    resolvedLabel: hazard.resolvedAt ? dayOnly.format(new Date(hazard.resolvedAt)) : null,
    daysOpen: hazard.resolvedAt === null ? daysSince(hazard.identifiedAt, now) : null,
  }));

  const statuses = drillStatuses(drills, now, ctx.centre.drillIntervalDays);
  const drillRows: DrillRow[] = statuses.map((status) => {
    const last = status.lastHeldAt
      ? drills.find((d) => d.kind === status.kind && d.heldAt === status.lastHeldAt)
      : undefined;
    return {
      status,
      lastHeldLabel: status.lastHeldAt ? when.format(new Date(status.lastHeldAt)) : null,
      lastIssues: last?.issuesFound ?? null,
    };
  });

  const latest = latestByArea(checks);
  const safetyRows: SafetyRow[] = SAFETY_AREAS.map((area) => {
    const last = latest.get(area);
    return {
      area,
      lastLabel: last ? when.format(new Date(last.at)) : null,
      lastPassed: last ? last.passed : null,
      lastNote: last?.note ?? null,
    };
  });

  const summary = summariseHazards(hazards);

  const nowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ctx.centre.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const part = (t: string) => nowParts.find((p) => p.type === t)?.value ?? '00';
  const defaultWallClock = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;

  return (
    <>
      <div className="has-help">
        <h1>Site safety</h1>
        <TabHelp href="/facilities" />
      </div>
      <p className="sub">Hazards, drills and daily checks at {ctx.centre.name}.</p>

      {/*
        What is outstanding, not how many hazards have ever been found. A centre that
        has found and fixed forty reads the same as one that has found none — a
        register that only goes up is one nobody opens.
      */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        {summary.clear ? (
          <p style={{ margin: 0 }}>
            <span className="flag flag-ok">{'✓'} No open hazards</span>{' '}
            <span className="sub">Everything recorded has been closed with a resolution.</span>
          </p>
        ) : (
          <p className="inline" style={{ margin: 0 }}>
            <span className="flag flag-quiet">{summary.open} open</span>
            {summary.uncontrolled > 0 && (
              // Narrower than "high risk" on purpose: a high-risk hazard with a
              // control written is a managed risk, not an outstanding job.
              <span className="flag flag-critical">
                {'▲'} {summary.uncontrolled} high risk with nothing recorded
              </span>
            )}
            {summary.openHigh > summary.uncontrolled && (
              <span className="flag flag-warn">
                {summary.openHigh - summary.uncontrolled} high risk being managed
              </span>
            )}
          </p>
        )}
      </div>

      <h2>Hazards</h2>
      <HazardList rows={hazardRows} />

      <h2>Emergency drills</h2>
      <DrillLog
        rows={drillRows}
        intervalDays={ctx.centre.drillIntervalDays}
        defaultWallClock={defaultWallClock}
      />

      <h2>Daily checks</h2>
      <p className="sub">
        The last {SAFETY_WINDOW_DAYS} days. An area with no check shown has not been recorded in
        that time.
      </p>
      <SafetyChecks rows={safetyRows} />
    </>
  );
}
