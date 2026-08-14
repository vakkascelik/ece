/**
 * The scheduler: every recurring job enters here, and only here.
 *
 *   npm run schedule:run -- verification-chase          # dry run: prints the plan
 *   ECE_SCHEDULER_LIVE=yes npm run schedule:run -- verification-chase
 *
 * WHY ONE DISPATCHER AND NOT A SCRIPT PER JOB
 *
 * Because this is the only code in the repo that routinely fans out across tenants with
 * the service key. `service_role` bypasses RLS, so here — and nowhere else — the tenant
 * boundary is the shape of the code: every job iterates centres explicitly and derives
 * everything else from one centre at a time. One file means one place to review that
 * shape, and a new job inherits the loop instead of reinventing the fan-out.
 *
 * WHY DRY-RUN IS THE DEFAULT
 *
 * The jobs' whole purpose is writing into families' and staff inboxes, which is
 * outward-facing. `ECE_SCHEDULER_LIVE=yes` is the same arrangement as
 * ECE_ALLOW_DEMO_SEED: the destructive/loud path must be asked for by name, so a person
 * poking at a job locally cannot notify a real centre by accident. Railway's cron sets
 * the variable; a laptop does not have it.
 *
 * WHY THE JUDGEMENT IS NOT IN THIS FILE
 *
 * The decision — who is asked, who is left alone — is `planVerificationChase` in
 * @ece/core, pure and mutation-tested. This file fetches, calls the planner, and writes
 * what it said. Code holding the service key should be auditable as exactly that and
 * nothing more.
 */

import { createServiceClient, listVerificationOverview, type Db } from '@ece/api';
import {
  displayName,
  lastCompletedWeek,
  planVerificationChase,
  shiftLocalDate,
  summariseVerification,
  todayInZone,
  type ChaseCandidate,
} from '@ece/core';

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const LIVE = process.env.ECE_SCHEDULER_LIVE === 'yes';

// ---------------------------------------------------------------------------
// verification-chase
// ---------------------------------------------------------------------------

interface CentreRow {
  id: string;
  name: string;
  timezone: string;
}

/**
 * Release last week to its signatories and remind the unanswered — §6-3's rhythm.
 *
 * Idempotent by construction: the planner reads `verification_notices` (at most one ask
 * per calendar week, three per period), so running this daily, or twice after a crash,
 * sends nothing twice. That property is what lets the cron be a dumb daily tick.
 */
async function verificationChase(db: Db): Promise<void> {
  const { data: centreRows, error: centresError } = await db
    .from('centres')
    .select('id, name, timezone')
    .is('archived_at', null);
  if (centresError) die(`could not list centres: ${centresError.message}`);

  let totalPlanned = 0;
  let totalSent = 0;

  for (const centre of (centreRows ?? []) as CentreRow[]) {
    const today = todayInZone(centre.timezone);
    const lastMonday = lastCompletedWeek(today).periodStart;

    // Three weeks back: an `awaiting` week is at most 20 days old by definition —
    // day 21 makes it `overdue`, and overdue weeks are the office card's, not this job's.
    const overview = await listVerificationOverview(db, {
      centreId: centre.id,
      lastCompletedMonday: lastMonday,
      weeksBack: 3,
    });
    const summaries = overview.map((w) => ({ week: w, summary: summariseVerification(w, today) }));

    // The signatories with accounts, per child. A signatory without a login is chased on
    // paper by the office — there is no inbox to notify.
    const { data: signatoryRows, error: sigError } = await db
      .from('child_guardians')
      .select('child_id, guardian_id, is_authorised_signatory, revoked_at, guardians!inner(id, user_id, centre_id, archived_at), children!inner(id, centre_id, first_name, last_name, preferred_name, archived_at)')
      .eq('children.centre_id', centre.id);
    if (sigError) die(`${centre.name}: could not list signatories: ${sigError.message}`);

    interface SignatoryRow {
      child_id: string;
      guardian_id: string;
      is_authorised_signatory: boolean;
      revoked_at: string | null;
      guardians: { id: string; user_id: string | null; centre_id: string; archived_at: string | null };
      children: {
        id: string;
        centre_id: string;
        first_name: string;
        last_name: string;
        preferred_name: string | null;
        archived_at: string | null;
      };
    }
    const signatories = ((signatoryRows ?? []) as unknown as SignatoryRow[]).filter(
      (r) =>
        r.is_authorised_signatory &&
        r.revoked_at === null &&
        r.guardians.user_id !== null &&
        r.guardians.archived_at === null &&
        r.children.archived_at === null,
    );

    const childIds = [...new Set(signatories.map((s) => s.child_id))];
    const nameOf = new Map(
      signatories.map((s) => [
        s.child_id,
        displayName({
          firstName: s.children.first_name,
          lastName: s.children.last_name,
          preferredName: s.children.preferred_name,
        }),
      ]),
    );

    // The chase's memory, aggregated per (child, guardian, period).
    // The window matches the overview's: three completed weeks, i.e. back to two weeks
    // before the most recent Monday.
    const { data: noticeRows, error: noticesError } =
      childIds.length === 0
        ? { data: [], error: null }
        : await db
            .from('verification_notices')
            .select('child_id, guardian_id, period_start, sent_on')
            .in('child_id', childIds)
            .gte('period_start', shiftLocalDate(lastMonday, -14));
    if (noticesError) die(`${centre.name}: could not read notices: ${noticesError.message}`);

    const history = new Map<string, { count: number; last: string }>();
    for (const n of (noticeRows ?? []) as { child_id: string; guardian_id: string; period_start: string; sent_on: string }[]) {
      const key = `${n.child_id}:${n.guardian_id}:${n.period_start}`;
      const prior = history.get(key);
      history.set(key, {
        count: (prior?.count ?? 0) + 1,
        last: prior && prior.last > n.sent_on ? prior.last : n.sent_on,
      });
    }

    const candidates: ChaseCandidate[] = [];
    for (const { week, summary } of summaries) {
      for (const s of signatories.filter((sig) => sig.child_id === week.childId)) {
        const key = `${week.childId}:${s.guardian_id}:${week.periodStart}`;
        const prior = history.get(key);
        candidates.push({
          childId: week.childId,
          guardianId: s.guardian_id,
          userId: s.guardians.user_id as string,
          periodStart: week.periodStart,
          periodEnd: week.periodEnd,
          status: summary.status,
          noticesSent: prior?.count ?? 0,
          lastSentOn: prior?.last ?? null,
        });
      }
    }

    const plan = planVerificationChase(candidates, today);
    totalPlanned += plan.length;

    for (const notice of plan) {
      const childName = nameOf.get(notice.childId) ?? 'your child';
      const title =
        notice.noticeNumber === 1
          ? `Please confirm ${childName}'s attendance for last week`
          : `Reminder: ${childName}'s attendance is waiting for you`;
      const body =
        `The week of ${notice.periodStart} is ready to check. It takes a minute — open the ` +
        `app, look at the times, and confirm they are right (or tell us if they are not).`;

      if (!LIVE) {
        console.log(
          `  [dry] ${centre.name}: notice ${notice.noticeNumber} → guardian ${notice.guardianId} ` +
            `for ${childName}, week ${notice.periodStart}`,
        );
        continue;
      }

      // The notification and its ledger row go in together; if either insert fails the
      // job dies loudly and the next run re-plans from what actually landed.
      const { error: notifError } = await db.from('notifications').insert({
        centre_id: centre.id,
        user_id: notice.userId,
        kind: 'attendance',
        title,
        body,
        route: `/children/${notice.childId}/attendance`,
      });
      if (notifError) die(`${centre.name}: notification insert failed: ${notifError.message}`);

      const { error: ledgerError } = await db.from('verification_notices').insert({
        child_id: notice.childId,
        guardian_id: notice.guardianId,
        period_start: notice.periodStart,
        period_end: notice.periodEnd,
        sent_on: today,
      });
      if (ledgerError) die(`${centre.name}: ledger insert failed AFTER the notification went — ${ledgerError.message}`);

      totalSent += 1;
    }
  }

  console.log(
    `\n  verification-chase: ${totalPlanned} notice(s) planned${LIVE ? `, ${totalSent} sent` : ' (dry run — set ECE_SCHEDULER_LIVE=yes to send)'}.\n`,
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const JOBS: Record<string, (db: Db) => Promise<void>> = {
  'verification-chase': verificationChase,
};

async function main() {
  const job = process.argv[2];
  if (!job || !JOBS[job]) {
    die(`usage: npm run schedule:run -- <job>\n  jobs: ${Object.keys(JOBS).join(', ')}`);
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.');

  console.log(`\n  Scheduler — ${job}${LIVE ? '' : ' (dry run)'}\n`);
  await JOBS[job]!(createServiceClient(url, key));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
