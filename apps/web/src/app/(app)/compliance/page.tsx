import Link from 'next/link';
import {
  currentCriteriaSet,
  listCriteria,
  listEvidence,
  listStaffRecords,
  readDayRatio,
} from '@ece/api';
import { assessAll, summarise, summariseDay, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { dayWindow, lastSevenDays } from '@/lib/dayWindow';
import { CriteriaGaps } from './CriteriaGaps';
import { EvidenceList } from './EvidenceList';
import { RatioHistory } from './RatioHistory';
import { StaffRecords } from './StaffRecords';

/**
 * The compliance dashboard.
 *
 * Ordered by exposure rather than by date or by category, because the question it
 * answers is "what would hurt if somebody walked in today". An expired police vetting
 * outranks a first aid certificate lapsing next week even though the date is further
 * away.
 *
 * Ratio history is computed from Phase 2's events on every render, never cached. A
 * cached compliance figure that drifts from the events does not report itself as broken
 * — it reports itself as compliant.
 */
export default async function CompliancePage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const [staffRecords, evidence, criteriaSet] = await Promise.all([
    listStaffRecords(db, ctx.centre.id),
    listEvidence(db, ctx.centre.id),
    currentCriteriaSet(db),
  ]);

  const criteria = criteriaSet ? await listCriteria(db, criteriaSet.id) : [];

  const assessed = assessAll(staffRecords, today);
  const summary = summarise(assessed);

  // Seven days of ratio history. Each day is a separate replay because "a day" is local
  // and the events are instants — the window has to be worked out per date from the
  // centre's timezone.
  const days = lastSevenDays(today);
  const replays = await Promise.all(
    days.map(async (date) => {
      const { fromUtc, toUtc } = dayWindow(date, ctx.centre.timezone);
      return readDayRatio(db, { centreId: ctx.centre.id, date, fromUtc, toUtc });
    }),
  );

  const breachDays = replays.filter((r) => r.breaches.length > 0).length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Compliance</h1>
          <p className="sub" style={{ marginBottom: '1rem' }}>
            {ctx.centre.name} · as at {today}
          </p>
        </div>
        <Link href="/compliance/binder">
          <button type="button">Evidence binder</button>
        </Link>
      </div>

      {/* The one-line answer, before any table. */}
      <div
        className="card"
        style={{
          background: summary.clean && breachDays === 0 ? 'var(--ok-soft)' : 'var(--warn-soft)',
          borderColor: summary.clean && breachDays === 0 ? 'var(--ok-border)' : 'var(--warn-border)',
        }}
      >
        <div role="status" className="inline">
          {summary.expired > 0 && (
            <span className="flag flag-critical">
              {'▲'} {summary.expired} expired
            </span>
          )}
          {summary.unsighted > 0 && (
            <span className="flag flag-warn">
              {'●'} {summary.unsighted} never sighted
            </span>
          )}
          {summary.dueSoon > 0 && (
            <span className="flag flag-warn">
              {'●'} {summary.dueSoon} due soon
            </span>
          )}
          {breachDays > 0 && (
            <span className="flag flag-warn">
              {'●'} ratio breaches on {breachDays} of the last 7 days
            </span>
          )}
          {summary.clean && breachDays === 0 && (
            <span className="flag flag-ok">
              {'✓'} Nothing expired, nothing unsighted, no ratio breaches recorded this week
            </span>
          )}
        </div>
        {summary.total === 0 && (
          <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
            No staff records yet. Nothing being flagged is not the same as nothing being
            wrong.
          </p>
        )}
      </div>

      <div className="section">
        <h2>Staff records — {summary.total}</h2>
        <StaffRecords assessed={assessed} />
      </div>

      <div className="section">
        <h2>Ratio history — last 7 days</h2>
        <RatioHistory
          days={replays.map((r) => ({
            date: r.date,
            summary: summariseDay(r),
            breaches: r.breaches,
            events: r.snapshots.length,
            worstShortfall: r.worst?.shortfall ?? 0,
            minutesInBreach: r.minutesInBreach,
          }))}
          unverified={replays.some((r) => r.snapshots.some((s) => !s.assessment.verified))}
        />
      </div>

      <div className="section">
        <h2>Licensing criteria</h2>
        <CriteriaGaps
          set={criteriaSet}
          criteria={criteria}
          evidence={evidence.map((e) => ({ id: e.id, criterionId: e.criterionId }))}
        />
      </div>

      <div className="section">
        <h2>Evidence — {evidence.length}</h2>
        <EvidenceList evidence={evidence} criteria={criteria} />
      </div>
    </>
  );
}
