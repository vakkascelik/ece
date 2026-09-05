/**
 * Reconciles a month of attendance against hand-calculated funding figures.
 *
 * The plan's verification for Phase 5: "reconcile a month of attendance against a manually
 * calculated roll return for one Little Pearls site."
 *
 * So this writes a month whose correct answer is worked out **by hand in the comments below**, runs
 * it through `readFundingPeriod`, and compares. The expected numbers are arithmetic anybody can
 * check by reading — not a snapshot of whatever the code produced, which would only prove the code
 * agrees with itself.
 *
 * Every case in it is one that would silently corrupt a funding claim if the calculation were wrong:
 * a day over the cap, a week over the cap, a split day, a correction, a missing sign-out, and a
 * child without the 20 Hours attestation.
 *
 * **Child C, added 2026-09-05, reconciles the AGREEMENT basis** — §9-2 step 1, the absence rules
 * and the RS7 transposition. Until then this script passed 16/16 while none of that was touched by
 * any live-database check, and the plan said so in as many words rather than letting the score
 * stand as cover for it.
 *
 *   ECE_ALLOW_DEMO_SEED=yes npm run reconcile:funding
 *
 * `ECE_DRILL_PASSWORD` is no longer required. It provisions its own manager account on a
 * `.invalid` address with a fresh random password each run; supply the variable only if you
 * would rather drill as a real person.
 */

import { randomUUID } from 'node:crypto';
import { createAnonClient, createServiceClient, readFundingPeriod } from '@ece/api';
import {
  coversDate,
  DEFAULT_CAPS,
  isoWeekdayOf,
  rs7DayCounts,
  type FundingPeriod,
} from '@ece/core';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.ECE_DRILL_PASSWORD;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!url || !anonKey || !serviceKey) die('Supabase env vars are required.');
if (process.env.ECE_ALLOW_DEMO_SEED !== 'yes') {
  die('This writes attendance events. Set ECE_ALLOW_DEMO_SEED=yes to confirm.');
}
/*
  NO LONGER REQUIRED — 2026-09-04. This used to `die` without it, which meant the drill could
  only be run by one person, and so it was not run against the two commits that changed the
  arithmetic it exists to check. It is now an optional override; see `main()`.
*/
const DRILL_EMAIL = process.env.ECE_DRILL_EMAIL ?? 'reconcile.manager@littlepearls.invalid';

const results: boolean[] = [];
function check(ok: boolean, label: string) {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const NZ = 'Pacific/Auckland';

/**
 * An instant from a New Zealand wall clock, within the 14-day window the attendance CHECK
 * constraints allow. Days are counted back from today so the script keeps working.
 */
function nzAt(daysAgo: number, hh: number, mm = 0): { iso: string; date: string } {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = local.split('-').map(Number);
  const target = new Date(Date.UTC(y!, m! - 1, d! - daysAgo));
  const date = target.toISOString().slice(0, 10);
  // NZST is +12 in August; the offset is read rather than assumed so this survives the DST switch.
  const guess = new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
  const offsetMin =
    (Date.parse(
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: NZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .format(guess)
        .replace(' ', 'T') + 'Z',
    ) -
      guess.getTime()) /
    60_000;
  return { iso: new Date(guess.getTime() - offsetMin * 60_000).toISOString(), date };
}

async function main() {
  const admin = createServiceClient(url!, serviceKey!);

  /*
    THE DEMO TENANT, BY EXACT SLUG — corrected 2026-09-04, and the bug it fixes is worse than
    the one that surfaced.

    This read `.like('slug', '%albert%').single()`. Two problems, and the second is the serious
    one:

      • IT IS AMBIGUOUS. `demo-mt-albert` and `little-pearls-mt-albert` both match, `.single()`
        errors on more than one row, and the script reported "Expected Little Pearls Mt Albert.
        Run `npm run onboard` first" — a message pointing at the opposite of the actual problem.
        That is how this surfaced.
      • IT WAS AIMED AT THE REAL CUSTOMER'S TENANT. The name in the old error message says so
        outright. This script SEEDS ATTENDANCE EVENTS — `ECE_ALLOW_DEMO_SEED=yes` exists to make
        the caller confirm exactly that — so had the pattern ever resolved to one row, it would
        have written invented attendance into a live centre's records, from which funding is
        claimed. The ambiguity was the only thing preventing it.

    Measured before changing it: the three `Demo-Seed` children this drill needs are in
    `demo-mt-albert` (the other two are in `demo-mt-roskill`), and there were no attendance
    events anywhere in the project. So the demo tenant is both the correct target and the one
    that already holds the fixtures.

    Exact match, not a pattern. A pattern is what let this point somewhere it should never have
    pointed, and the slug is a constant `seed-demo.ts` controls.
  */
  const DEMO_SLUG = 'demo-mt-albert';
  const { data: centreRow } = await admin
    .from('centres')
    .select('id, name, timezone')
    .eq('slug', DEMO_SLUG)
    .maybeSingle();
  if (!centreRow) {
    die(`No centre with slug '${DEMO_SLUG}'. Run \`npm run seed:demo\` first — this drill writes
  attendance events and must never target a real tenant.`);
  }
  const centre = centreRow as { id: string; name: string; timezone: string };

  /*
    NO HUMAN CREDENTIAL IS REQUIRED — 2026-09-04, and this was the blocker that stopped this
    drill running for weeks.

    It signed in as `vakkascelik@gmail.com` and demanded `ECE_DRILL_PASSWORD`: a named person's
    real account password. `offline-drill.ts` records why that is wrong and fixed itself months
    ago; this script never got the same treatment, and the consequence was concrete — it has
    NOT been run against the two commits that changed its arithmetic, because the one person who
    could run it had to be present with their own password.

    The first of its three reasons is the one that bites: A PASSWORD CANNOT BE FETCHED. Supabase
    stores `auth.users.encrypted_password` as a bcrypt hash, and no anon key, service role or
    PAT returns it. Anybody without that person's password simply cannot run the drill, and the
    only "fix" available to them is resetting a real login in order to run a test.

    So it provisions its own account, exactly as the offline drill does: a `.invalid` address
    that cannot receive mail (RFC 2606), a membership on the demo centre, and a fresh random
    password on every run, never stored. `ECE_DRILL_PASSWORD` still works as an override for
    anybody who would rather drill as a real person.

    A MANAGER, NOT AN OWNER, and not an educator either — which differs from the offline drill
    and the reason is worth stating. `readFundingPeriod` reads `absence_exemptions`, whose select
    policy is `caller_may_exempt`: owner or manager. An educator would read no exemptions, every
    §7-7 window would silently be three weeks instead of twelve, and the drill would reconcile a
    figure that was wrong for a reason it could not see. Manager is the least privilege that can
    actually answer the question this drill asks.
  */
  const drillPassword = password ?? `Drill!${randomUUID().slice(0, 18)}`;
  let drillUserId: string;

  /*
    Find-or-create through `generateLink`, the same shape `offline-drill.ts` and `seed-demo.ts`
    use: `invite` errors when the address already exists, and `recovery` then returns the
    existing user. Not elegant, and it is the documented way to ask "does this user exist"
    without listing every user in the project — which on this project intermittently returns a
    500 with an empty body.
  */
  const invite = await admin.auth.admin.generateLink({ type: 'invite', email: DRILL_EMAIL });
  if (invite.error) {
    const recovery = await admin.auth.admin.generateLink({ type: 'recovery', email: DRILL_EMAIL });
    if (recovery.error || !recovery.data?.user) {
      die(`Could not resolve the drill account: ${recovery.error?.message}`);
    }
    drillUserId = recovery.data.user.id;
  } else {
    drillUserId = invite.data.user.id;
  }

  if (!password) {
    // Reset every run, so nothing is stored anywhere and a leaked value is dead by the next
    // drill. Skipped when somebody supplied their own — theirs is not ours to change.
    await admin.auth.admin.updateUserById(drillUserId, {
      password: drillPassword,
      email_confirm: true,
    });
  }

  // Upserted rather than inserted so a re-run is a no-op, and `revoked_at: null` so a
  // previously revoked drill account comes back rather than failing at the first policy.
  const membership = await admin
    .from('memberships')
    .upsert(
      { centre_id: centre.id, user_id: drillUserId, role: 'manager', revoked_at: null },
      { onConflict: 'centre_id,user_id' },
    );
  if (membership.error) die(`Could not give the drill account access: ${membership.error.message}`);

  const staff = createAnonClient(url!, anonKey!);
  const signIn = await staff.auth.signInWithPassword({
    email: DRILL_EMAIL,
    password: drillPassword,
  });
  if (signIn.error) die(`Sign-in failed for ${DRILL_EMAIL}: ${signIn.error.message}`);

  /**
   * A dedicated child, so the figures are not disturbed by other probes.
   *
   * Named with the Demo-Seed surname so `seed:demo -- --purge` clears it and its attendance,
   * which is the only way attendance can be removed at all.
   */
  const { data: existing } = await admin
    .from('children')
    .select('id')
    .eq('centre_id', centre.id)
    .eq('first_name', 'Reconcile')
    .maybeSingle();

  let childId = (existing as { id: string } | null)?.id ?? null;
  let attestedId: string | null = null;

  if (!childId) {
    const born = new Date();
    born.setFullYear(born.getFullYear() - 4);
    const { data, error } = await admin
      .from('children')
      .insert({
        centre_id: centre.id,
        first_name: 'Reconcile',
        last_name: 'Demo-Seed',
        date_of_birth: born.toISOString().slice(0, 10),
      })
      .select('id')
      .single();
    if (error) die(`Creating the test child failed: ${error.message}`);
    childId = (data as { id: string }).id;
  }

  // A second child WITHOUT the 20 Hours attestation, to prove the caps do not apply to them.
  const { data: other } = await admin
    .from('children')
    .select('id')
    .eq('centre_id', centre.id)
    .eq('first_name', 'Uncapped')
    .maybeSingle();
  attestedId = (other as { id: string } | null)?.id ?? null;
  if (!attestedId) {
    const born = new Date();
    born.setFullYear(born.getFullYear() - 4);
    const { data, error } = await admin
      .from('children')
      .insert({
        centre_id: centre.id,
        first_name: 'Uncapped',
        last_name: 'Demo-Seed',
        date_of_birth: born.toISOString().slice(0, 10),
      })
      .select('id')
      .single();
    if (error) die(`Creating the second test child failed: ${error.message}`);
    attestedId = (data as { id: string }).id;
  }

  // Enrolments: one with the attestation, one without. Upserted so re-running is idempotent.
  for (const [id, twenty] of [
    [childId, true],
    [attestedId, false],
  ] as const) {
    const { data: enrolled } = await admin
      .from('enrolments')
      .select('id')
      .eq('child_id', id)
      .maybeSingle();
    if (!enrolled) {
      const start = nzAt(20, 9).date;
      await admin.from('enrolments').insert({
        child_id: id,
        centre_id: centre.id,
        start_date: start,
        twenty_hours_ece: twenty,
        funded_hours_per_week: twenty ? 20 : 0,
        days: [1, 2, 3, 4, 5],
      });
    }
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * THE MONTH, AND THE ARITHMETIC DONE BY HAND
   *
   * Caps, corrected 2026-09-04 from Handbook §9-2 and §9-3: **6 hours a day and 30 a week for
   * EVERY child**, of which up to 20 a week may be claimed as 20 Hours ECE and the rest as
   * Plus 10. This script previously said "6 a day, 20 a week (unverified)" and asserted that no
   * cap at all applied without an attestation — see Child B below, where the hand arithmetic was
   * verifying the defect.
   *
   * Child A ("Reconcile"), 20 Hours ECE = yes:
   *   day -9   08:00–16:00   8h attended → daily cap → 6h
   *   day -8   08:00–16:00   8h attended → daily cap → 6h
   *   day -7   08:00–16:00   8h attended → daily cap → 6h
   *   day -6   09:00–12:00 + 13:00–15:00 = 3h + 2h = 5h attended, under the cap → 5h
   *   day -5   08:00, no sign-out        → UNRESOLVED, excluded entirely
   *   day -2   09:00–14:00 (corrected from 10:00) → 5h attended → 5h
   *
   *   Attended, complete days only: 8 + 8 + 8 + 5 + 5 = 34h
   *   After the daily cap:          6 + 6 + 6 + 5 + 5 = 28h
   *   Weekly cap: **28 is now deterministic.** It used to be asserted as a bound (`<= 28`) because
   *   the weekly cap was 20, so the answer depended on which ISO week each relative day landed in
   *   — days -9 to -5 and day -2 usually straddle two weeks, and 20 bites on the larger group. At
   *   30 a week it cannot bite: even if all 28 hours fell in one ISO week, min(28, 30) = 28. So
   *   raising the cap to the figure the Handbook actually states removed the source of the
   *   nondeterminism, which is a better outcome than a looser assertion.
   *
   *   The 20 Hours / Plus 10 split is NOT deterministic, and asserted as an invariant instead:
   *   28 hours in one week splits 20 + 8, and split 18/10 across two weeks it is 18 + 10 = 28 as
   *   20 Hours with no Plus 10 at all, because each week gets its own 20-hour allowance. What must
   *   hold either way is that the two components sum to the funded total.
   *
   * Child B ("Uncapped"), 20 Hours ECE = no:
   *   day -9   08:00–16:00   8h attended → daily cap → 6h
   *   day -8   08:00–16:00   8h attended → daily cap → 6h
   *   Funded = 12h, and BOTH days are capped.
   *
   *   **This block asserted 16h until 2026-09-04, with the message "the caps must NOT apply
   *   without the attestation".** That was hand arithmetic verifying a defect: the ECE Funding
   *   Subsidy is claimable for an unattested child and §9-2 caps it at six hours a day. So this
   *   script was confirming a four-hour over-statement across two days, in a file whose whole
   *   purpose is to catch exactly that. The child's name in the fixture — "Uncapped" — is left
   *   as it is, because it now records what this script used to believe.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const add = async (id: string, kind: 'in' | 'out', when: { iso: string }, corrects?: number) => {
    const { data, error } = await staff
      .from('attendance_events')
      .upsert(
        {
          child_id: id,
          kind,
          at: when.iso,
          client_uuid: randomUUID(),
          recorded_by: signIn.data.user!.id,
          corrects: corrects ?? null,
          note: corrects ? 'reconciliation: corrected time' : null,
        },
        { onConflict: 'client_uuid', ignoreDuplicates: true },
      )
      .select('id')
      .single();
    if (error) die(`Writing an event failed: ${error.message}`);
    return (data as { id: number }).id;
  };

  // Wipe only this run's events, via the owner role — attendance cannot be deleted by the app or
  // the service role, so the Management API is not available here. Instead the child is recreated
  // by `seed:demo -- --purge` when a clean slate is wanted; a re-run simply adds more.
  const { count: already } = await staff
    .from('attendance_events')
    .select('id', { count: 'exact', head: true })
    .eq('child_id', childId);
  if ((already ?? 0) > 0) {
    die(
      `This child already has ${already} attendance events, so a re-run would double the figures.\n` +
        `  Attendance is append-only by design and cannot be cleared by the app.\n` +
        `  Run: ECE_ALLOW_DEMO_SEED=yes npm run seed:demo -- --purge\n` +
        `  then re-seed and re-run this.`,
    );
  }

  console.log(`\n  ${centre.name} — writing a month with known answers\n`);

  for (const day of [9, 8, 7]) {
    await add(childId, 'in', nzAt(day, 8));
    await add(childId, 'out', nzAt(day, 16));
  }
  // A split day.
  await add(childId, 'in', nzAt(6, 9));
  await add(childId, 'out', nzAt(6, 12));
  await add(childId, 'in', nzAt(6, 13));
  await add(childId, 'out', nzAt(6, 15));
  // A missing sign-out.
  await add(childId, 'in', nzAt(5, 8));
  // A correction: signed in at 10:00, actually 09:00.
  const wrong = await add(childId, 'in', nzAt(2, 10));
  await add(childId, 'in', nzAt(2, 9), wrong);
  await add(childId, 'out', nzAt(2, 14));

  for (const day of [9, 8]) {
    await add(attestedId, 'in', nzAt(day, 8));
    await add(attestedId, 'out', nzAt(day, 16));
  }

  // The period: the last 14 days, comfortably inside the CHECK window.
  const from = nzAt(13, 12).date;
  const to = nzAt(0, 12).date;
  const period: FundingPeriod = { label: `${from} to ${to}`, from, to };

  /*
    ═══════════════════════════════════════════════════════════════════════════
    THE BOUNDS ARE NEW ZEALAND MIDNIGHTS, NOT UTC ONES — corrected 2026-09-05

    This passed `new Date(`${from}T00:00:00Z`)` and `${to}T23:59:59Z`. Both were wrong, and
    wrong in the direction that makes a funding drill say "fine":

      • `${from}T00:00:00Z` is **midday** in Auckland, not midnight. Every event before noon on
        the first day of a period was outside the window and silently absent from the figures.
      • `.gte(fromUtc).lt(toUtc)` is half-open (`billing.ts:836`), so the end bound wants the
        start of the day AFTER the last one — not `23:59:59` of the last, and certainly not
        `23:59:59Z`, which is 11:59 the following morning in Auckland.

    Neither ever showed, because Child A's earliest event is day -9 inside a window starting at
    day -13, and nothing is written for today. Luck, twice. It surfaced the moment Child C's
    period began on a day it actually attended, at 09:00 — the drill reported six hours where
    twelve were recorded, and the first suspicion was the §9-2 agreement branch, which was fine.

    This is the second time this file has been recruited into the thing it exists to catch. The
    first is recorded above, on Child B: hand arithmetic that asserted a four-hour over-statement
    was correct. `AGENTS.md §5` carries it as a standing lesson and it has now cost twice.

    `nzAt` already reads the real offset from `Intl` rather than assuming +12, so the correct
    instants were available in this file the whole time.
    ═══════════════════════════════════════════════════════════════════════════
  */
  const summary = await readFundingPeriod(staff, {
    centreId: centre.id,
    period,
    timeZone: centre.timezone,
    fromUtc: nzAt(13, 0).iso,
    // Start of tomorrow in Auckland: the exclusive end of today.
    toUtc: nzAt(-1, 0).iso,
  });

  const a = summary.children.find((c) => c.childId === childId);
  const b = summary.children.find((c) => c.childId === attestedId);
  if (!a || !b) die('The test children did not appear in the summary.');

  console.log('  --- Child A: 20 Hours ECE, with a missing sign-out and a correction ---');
  check(a.attendedHours === 34, `attended on complete days is 34.00 by hand (got ${a.attendedHours})`);
  check(
    a.unresolvedDates.length === 1 && a.unresolvedDates[0] === nzAt(5, 8).date,
    `exactly one unresolved day, and it is the one with no sign-out (got ${a.unresolvedDates.join(', ') || 'none'})`,
  );
  check(a.cappedDates.length === 3, `three days hit the ${DEFAULT_CAPS.maxHoursPerDay}h daily cap (got ${a.cappedDates.length})`);
  check(
    a.fundedHours === 28,
    `funded is exactly 28.00 — deterministic since the weekly cap became ${DEFAULT_CAPS.maxHoursPerWeek}h, because 28 cannot be capped by 30 however the ISO weeks fall (got ${a.fundedHours})`,
  );
  check(
    a.twentyHoursHours + a.plusTenHours === a.fundedHours,
    `the 20 Hours and Plus 10 components sum to the funded total (${a.twentyHoursHours} + ${a.plusTenHours} = ${a.fundedHours})`,
  );
  check(
    a.twentyHoursHours <= DEFAULT_CAPS.twentyHoursWeeklyCap * 2,
    `and the 20 Hours component respects its own weekly cap across at most two ISO weeks (got ${a.twentyHoursHours})`,
  );
  check(a.fundedHours <= a.attendedHours, `and never more than attended (${a.fundedHours} ≤ ${a.attendedHours})`);
  // The correction: without it the 10:00 sign-in would pair with the 14:00 sign-out for 4h, and the
  // 09:00 one would be left unclosed — making the day unresolved AND losing an hour.
  check(
    !a.unresolvedDates.includes(nzAt(2, 9).date),
    'the corrected day is complete, so the superseded sign-in was dropped',
  );

  console.log('\n  --- Child B: no attestation, and the subsidy cap applies anyway ---');
  check(b.attendedHours === 16, `attended is 16.00 (got ${b.attendedHours})`);
  check(
    b.fundedHours === 12,
    `funded is 12.00 — the subsidy caps at ${DEFAULT_CAPS.maxHoursPerDay}h a day whether or not a child is attested (got ${b.fundedHours})`,
  );
  check(b.cappedDates.length === 2, `both eight-hour days were capped (got ${b.cappedDates.length})`);
  check(
    b.twentyHoursHours === 0 && b.plusTenHours === 0,
    'and an unattested child has no 20 Hours component and no Plus 10 — the whole figure is subsidy',
  );

  console.log('\n  --- the summary ---');
  check(summary.complete === false, 'the period is reported INCOMPLETE because of the missing sign-out');
  /**
   * Asserted on *this* child, not on the global count.
   *
   * The first version asserted `unresolvedChildCount === 1` and got 4 — because other demo children
   * carry unpaired events left behind by earlier probe runs, and **attendance cannot be deleted** by
   * the app or the service role. That is the append-only guarantee working, so the test has to be
   * specific rather than the schema being loosened. It also means the calculation was correct on
   * genuinely messy data, which is the more useful demonstration.
   */
  check(
    summary.unresolvedChildCount >= 1 &&
      summary.children.some((c) => c.childId === childId && c.unresolvedDates.length > 0),
    `this child is among the ${summary.unresolvedChildCount} needing the record fixed`,
  );
  check(
    Math.abs(summary.totalFundedHours - (a.fundedHours + b.fundedHours)) < 0.005,
    'the total is the sum of the children',
  );
  check(summary.verified === false, 'and the figures are marked unverified against the Funding Handbook');

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * CHILD C — THE AGREEMENT BASIS, AND THE HOLE THIS SECTION EXISTS TO FILL
   *
   * Everything above reconciles the ATTENDANCE basis. Until 2026-09-05 that was the whole script,
   * and it passed 16/16 while §6-5, §6-6, §6-7, §9-2's hours source and the entire RS7
   * transposition were checked by **nothing but unit tests and mutation drills** — every one of
   * them written against fixtures by the same hand that wrote the rules. A fixture cannot
   * contradict the person who wrote it. Live Postgres can.
   *
   * WHY IT RUNS LAST, WHICH IS NOT COSMETIC. A permanently enrolled child with a booking schedule
   * is funded from the agreement whether or not they ever attend, so the moment Child C exists it
   * contributes hours to any period covering it — and `summary.totalFundedHours` above is asserted
   * to be exactly `a.fundedHours + b.fundedHours`. Creating this child earlier would break a
   * correct assertion. It is created after that assertion has been made, and the re-run guard for
   * Child A above fires before any of this on a second run.
   *
   * A SIX-DAY WINDOW, deliberately, and it is its own period. `enrolledSessions` emits one session
   * per matching weekday per date in range, so a fortnight contains each weekday twice and every
   * figure doubles in a way that would hide an off-by-one. Six consecutive days contain each
   * weekday exactly once, so the sessions below are exactly the four dates named.
   *
   * Child C ("Agreement"), permanently enrolled, four years old, NO 20 Hours attestation.
   * A booking-schedule block on the weekday of each of days -6 to -2 — four of six hours, and
   * one deliberately of five and a half.
   *
   *   day -6   attended 09:00–15:00   → 6h, from the AGREEMENT and not from the turnstile
   *   day -5   attended 09:00–15:00   → 6h
   *   day -4   ABSENT                 → 6h,   claimable — day 1 of §6-5's three-week window
   *   day -3   ABSENT                 → 6h,   claimable — day 2 of it
   *   day -2   ABSENT   09:00–14:30   → 5.5h, claimable — day 3
   *   day -1                          → no block, so no session, so nothing at all
   *
   *     attended = 12h     two days actually present, exactly as agreed
   *     absence  = 17.5h   three enrolled days missed, all inside the window
   *     funded   = 29.5h   five enrolled sessions, attended or not
   *
   * Neither cap can bite: no day exceeds six hours and 29.5 is under the 30-hour weekly one even
   * if every session falls in one ISO week. So unlike Child A there is no nondeterminism to
   * reason around, and unlike Child B there is nothing here that a cap could be hiding.
   *
   * THE HALF HOUR ON DAY -2 IS THE POINT OF ITS EXISTENCE, and it was added after the first run
   * of this section passed 35/35. Every figure was a whole number, so §9-2 step 5 — *"round the
   * total to the nearest whole number… 0.5 or above should be rounded up"* — was asserted by
   * numbers that round the same way under any rule. Item 52 is specifically about NOT reusing
   * `toHours`, which floors; a drill in which flooring and rounding agree cannot see the
   * difference. Five and a half hours is the smallest fixture that can.
   *
   * §6-7 cannot refuse these months either: `assessFrequentAbsence` returns `claimable` for
   * every month at run index 1 and 2, and a six-day window touches at most two calendar months.
   * That is the rule doing nothing, which is worth asserting — see the `frequentAbsence` check.
   * ─────────────────────────────────────────────────────────────────────────
   */
  console.log('\n  --- Child C: the agreement basis, over its own six-day window ---');

  const cFrom = nzAt(6, 12).date;
  const cTo = nzAt(1, 12).date;
  const cPeriod: FundingPeriod = { label: `${cFrom} to ${cTo}`, from: cFrom, to: cTo };

  /*
    Five weekdays, one of them short. Six consecutive days hold five distinct weekdays, so each
    of these produces exactly one session — the property the whole six-day window was chosen for.
  */
  const agreedBlocks = [
    { daysAgo: 6, from: '09:00', to: '15:00' },
    { daysAgo: 5, from: '09:00', to: '15:00' },
    { daysAgo: 4, from: '09:00', to: '15:00' },
    { daysAgo: 3, from: '09:00', to: '15:00' },
    { daysAgo: 2, from: '09:00', to: '14:30' },
  ];
  const enrolledOn = agreedBlocks.map((b) => nzAt(b.daysAgo, 9).date);
  const scheduleFrom = nzAt(20, 9).date;

  /*
    A closure deletes an enrolled session — `enrolledSessions` skips a closed day, correctly, and
    §6-6 then suspends the three-week window over it. Every figure below would be wrong by six
    hours and the failure would look like an arithmetic bug rather than a fixture problem. So the
    guard names it, using `coversDate` rather than a hand-written comparison: that is the one
    written-down copy of the effective-window rule and it decides boundary days the same way the
    calculation does.
  */
  const { data: closureRows } = await staff
    .from('service_closures')
    .select('starts_on, ends_on, reason_code')
    .eq('centre_id', centre.id);
  for (const cl of (closureRows ?? []) as {
    starts_on: string;
    ends_on: string | null;
    reason_code: string | null;
  }[]) {
    const hit = enrolledOn.find((d) => coversDate(cl.starts_on, cl.ends_on, d));
    if (hit) {
      die(
        `A service closure (${cl.reason_code ?? 'no reason recorded'}, ${cl.starts_on} to ` +
          `${cl.ends_on ?? 'open'}) covers ${hit}, which is one of the four days this section's\n` +
          `  hand arithmetic depends on. Remove it, or run this drill on a different day.`,
      );
    }
  }

  const { data: agreementRow } = await admin
    .from('children')
    .select('id')
    .eq('centre_id', centre.id)
    .eq('first_name', 'Agreement')
    .maybeSingle();
  let agreementId = (agreementRow as { id: string } | null)?.id ?? null;
  if (!agreementId) {
    const born = new Date();
    born.setFullYear(born.getFullYear() - 4);
    const { data, error } = await admin
      .from('children')
      .insert({
        centre_id: centre.id,
        first_name: 'Agreement',
        last_name: 'Demo-Seed',
        date_of_birth: born.toISOString().slice(0, 10),
      })
      .select('id')
      .single();
    if (error) die(`Creating the agreement child failed: ${error.message}`);
    agreementId = (data as { id: string }).id;
  }

  /*
    `enrolment_type: 'permanent'` is the whole switch. `childFunding` consults the agreement only
    for a permanent child — §9-2 step 2 and §6-4 both say attendance is the rule for a casual or
    conditional one — so the same schedule under `casual` would produce the attendance figure and
    every assertion below would fail by exactly the absence hours. Worth knowing when one does.
  */
  const { data: cEnrolled } = await admin
    .from('enrolments')
    .select('id')
    .eq('child_id', agreementId)
    .maybeSingle();
  if (!cEnrolled) {
    const { error } = await admin.from('enrolments').insert({
      child_id: agreementId,
      centre_id: centre.id,
      start_date: scheduleFrom,
      twenty_hours_ece: false,
      funded_hours_per_week: 0,
      days: [1, 2, 3, 4, 5],
      enrolment_type: 'permanent',
    });
    if (error) die(`Enrolling the agreement child failed: ${error.message}`);
  }

  /*
    The agreement itself. Inserted through the service role because `0085`'s write policy is
    `caller_may_manage_children`, which a manager holds — but the child was created by the service
    role too, and mixing the two here would make a policy failure look like a fixture failure.
    The reconciliation that matters is done on the READ path, as the drill account.

    A duplicate insert is a `23P01` from the GiST exclusion constraint, which on a re-run means the
    block is already there. Tolerated by name, not by swallowing every error: an insert that fails
    for any other reason still kills the drill.
  */
  for (const block of agreedBlocks) {
    const { error } = await admin.from('child_booking_schedule').insert({
      child_id: agreementId,
      weekday: isoWeekdayOf(nzAt(block.daysAgo, 9).date),
      from_time: block.from,
      to_time: block.to,
      effective_from: scheduleFrom,
    });
    if (error && !/child_booking_schedule_no_overlap/.test(error.message)) {
      die(`Recording the agreement failed: ${error.message}`);
    }
  }

  const { count: alreadyC } = await staff
    .from('attendance_events')
    .select('id', { count: 'exact', head: true })
    .eq('child_id', agreementId);
  if ((alreadyC ?? 0) > 0) {
    die(
      `The agreement child already has ${alreadyC} attendance events, so a re-run would double\n` +
        `  the figures. Purge and re-seed exactly as for Child A above.`,
    );
  }

  for (const day of [6, 5]) {
    await add(agreementId, 'in', nzAt(day, 9));
    await add(agreementId, 'out', nzAt(day, 15));
  }

  const cSummary = await readFundingPeriod(staff, {
    centreId: centre.id,
    period: cPeriod,
    timeZone: centre.timezone,
    // Auckland midnights, for the reason recorded at the fourteen-day read above. This is the
    // period that exposed it: `cFrom` is a day the child attended from 09:00.
    fromUtc: nzAt(6, 0).iso,
    toUtc: nzAt(0, 0).iso,
  });

  const c = cSummary.children.find((x) => x.childId === agreementId);
  if (!c) {
    die(
      'The agreement child did not appear in the summary at all. `readFundingPeriod` drops a child\n' +
        '  contributing nothing, so this means the agreement produced no sessions — check the\n' +
        '  booking-schedule blocks and the enrolment window rather than the arithmetic.',
    );
  }

  check(
    c.hoursBasis === 'agreement',
    `the figure comes from the agreement, not the turnstile (got ${c.hoursBasis})`,
  );
  check(
    c.enrolmentType === 'permanent',
    `and it is a permanent enrolment, which is what makes §9-2 step 1 apply (got ${c.enrolmentType})`,
  );
  check(c.attendedHours === 12, `attended is 12.00 by hand (got ${c.attendedHours})`);
  check(
    c.absenceHours === 17.5,
    `and 17.50 more is claimed absence — three enrolled days missed inside §6-5's window (got ${c.absenceHours})`,
  );
  check(
    c.fundedHours === 29.5,
    `funded is 29.50: five enrolled sessions, attended or not (got ${c.fundedHours})`,
  );
  /*
    THE ASSERTION THAT SEPARATES THE TWO BASES, and the reason this section exists.

    On attendance this child is funded 12 hours; on the agreement, 24. A regression that quietly
    reverted §9-2 step 1 — the change that closed item 55 — would halve a Crown claim, and every
    unit test in `funding.test.ts` would still pass, because each of them supplies its own
    agreement and would simply be testing a function nobody calls that way any more.
  */
  check(
    c.fundedHours > c.attendedHours,
    `and MORE is funded than was attended (${c.fundedHours} > ${c.attendedHours}), which is only possible starting from the agreement`,
  );
  check(
    c.unclaimableAbsences.length === 0,
    `no absence was refused — both are days old (got ${c.unclaimableAbsences.map((u) => u.reason).join('; ') || 'none'})`,
  );
  check(
    Object.keys(c.absenceHoursByDate).length === 3 &&
      c.absenceHoursByDate[nzAt(4, 9).date] === 6 &&
      c.absenceHoursByDate[nzAt(3, 9).date] === 6 &&
      c.absenceHoursByDate[nzAt(2, 9).date] === 5.5,
    'the three claimed absences are on the days the child was enrolled and did not come, at the agreed hours for each',
  );
  check(
    c.attendedOutsideAgreement.length === 0,
    `nothing was attended outside the agreement (got ${c.attendedOutsideAgreement.join(', ') || 'none'})`,
  );
  /*
    §6-7 RAN AND ALLOWED IT, which is a different statement from "§6-7 did not refuse anything" —
    and `unclaimableAbsences` alone cannot tell them apart. An empty `frequentAbsence` would mean
    the rule was never applied, which is exactly the failure mode a passing drill would hide.
  */
  check(
    c.frequentAbsence.length > 0 && c.frequentAbsence.every((m) => m.claimable),
    `§6-7 assessed ${c.frequentAbsence.length} calendar month(s) and refused none, at run index 1 or 2`,
  );

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * RS7, TRANSPOSED — the last link in the chain, on one date
   *
   * Day -3 is chosen because it is the only date in this window where **nobody else has any
   * hours**: Child A's events fall on days -6, -5 and -2, and Child B's on -9 and -8, outside it
   * altogether. So the whole figure on that date is Child C's claimed absence.
   *
   * That makes a single number an end-to-end check of six separate pieces of machinery: the
   * booking schedule produced a session, §6-5 classified the absence as claimable, §9-2 funded it
   * from the agreement rather than the turnstile, `ageInMonths` put it in the two-and-over bucket
   * as at that date, §9-2 step 5 rounded the daily total to the nearest hour, and the
   * transposition put it on the right calendar date.
   *
   * Six hours, on one date, for a child who was not there.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const { data: dobRows } = await staff
    .from('children')
    .select('id, date_of_birth')
    .in(
      'id',
      cSummary.children.map((x) => x.childId),
    );
  const dobs = new Map<string, string | null>(
    ((dobRows ?? []) as { id: string; date_of_birth: string | null }[]).map((r) => [
      r.id,
      r.date_of_birth,
    ]),
  );

  const rs7 = rs7DayCounts({ children: cSummary.children, datesOfBirth: dobs, period: cPeriod });
  const absentDate = nzAt(3, 9).date;
  const rs7Day = rs7.days.find((d) => d.date === absentDate);

  console.log('\n  --- RS7: the same hours, transposed onto the return ---');
  check(
    rs7Day !== undefined,
    `the return has a row for ${absentDate}, a day one child was enrolled and absent and nobody else was there`,
  );
  check(
    rs7Day?.subsidyFundedChildTwoAndOver === 6,
    `and it reports 6 subsidy hours for a child who was not present (got ${rs7Day?.subsidyFundedChildTwoAndOver})`,
  );
  check(
    rs7Day?.subsidyFundedChildUnderTwo === 0,
    `with nothing in the under-two figure — the band is judged as at that date (got ${rs7Day?.subsidyFundedChildUnderTwo})`,
  );
  check(
    rs7Day?.twentyHoursFundedChild === 0 && rs7Day?.twentyHoursFundedChildPlusTen === 0,
    'and nothing in either 20 Hours figure, because this child has no attestation',
  );
  /*
    BLANK, NOT ZERO. The three-state contract this product applies everywhere, on the one field
    where a zero would be a false statement to the Crown: it would say the service was staffed by
    nobody. `null` says the hours are not produced, and the assumption below says why.
  */
  check(
    rs7Day?.staffHourQualified === null && rs7Day?.staffHourNotQualified === null,
    'both staff figures are BLANK rather than zero, because no staff hours were supplied',
  );
  check(
    rs7.assumptions.some((a) => a.includes('§9-4')),
    'and the return says so in words rather than leaving the gap unexplained',
  );
  /*
    ─────────────────────────────────────────────────────────────────────────
    DAY -2, WHERE THE ROUNDING AND THE 20 HOURS DEDUCTION BOTH SHOW

    Two children have hours on this date and they land in different buckets, which is what makes
    it worth asserting:

      Child C   5.5h   unattested, so the whole of it is subsidy, two-and-over
      Child A   5h     attested, so §9-2's two-and-over step takes it out again — *"less any
                       hours for children claimed as 20 Hours ECE"* — and it appears in the
                       20 Hours figure instead

    So `subsidyFundedChildTwoAndOver` is 5.5 rounded, and **`Math.round` gives 6 where `toHours`
    would floor to 5.** That one hour is the whole of item 52, and until day -2 existed nothing
    in this drill could tell the two rules apart.

    A's five hours are deterministic despite the ISO-week split the Child A comment warns about:
    A is funded ten hours across this window, so the week's first twenty are never exhausted and
    all of it is 20 Hours ECE however the weeks fall. Under `deduct-both` — the default, and the
    reading that cannot double-count — both components come out of the two-and-over figure, so
    A contributes nothing to it either way.
    ─────────────────────────────────────────────────────────────────────────
  */
  const shortDate = nzAt(2, 9).date;
  const shortDay = rs7.days.find((d) => d.date === shortDate);
  check(
    shortDay?.subsidyFundedChildTwoAndOver === 6,
    `on ${shortDate} five and a half hours round UP to 6 — §9-2 step 5, not the flooring \`toHours\` does (got ${shortDay?.subsidyFundedChildTwoAndOver})`,
  );
  check(
    shortDay?.twentyHoursFundedChild === 5,
    `and the attested child's five hours are in the 20 Hours figure instead, deducted out of the subsidy one (got ${shortDay?.twentyHoursFundedChild})`,
  );

  check(
    rs7.outOfRangeDates.length === 0,
    `no figure exceeded the schema's 0..9999 bound (got ${rs7.outOfRangeDates.join(', ') || 'none'})`,
  );
  /*
    ONE MESSAGE, NOT SIX — and this assertion said six until the drill was run.

    `missingDeclarationFields(null)` returns a single entry naming the whole declaration, which
    is the right behaviour and the reason to assert the decision rather than the count: a manager
    who has recorded nothing needs one instruction, and six field names would read as six
    separate problems. Six entries is what a PARTLY filled declaration returns.

    Asserting `length === 6` was a guess about an implementation, made while writing the drill
    and not checked against the function. It is left recorded here rather than quietly swapped,
    because the lesson is the one AGENTS §5 already carries: assert the decision, not a number
    that happens to be true.
  */
  check(
    rs7.declaration === null && rs7.missingDeclarationFields.length === 1,
    `nothing is recorded for this period, so the return names the whole declaration once rather than six fields (got ${rs7.missingDeclarationFields.length})`,
  );
  check(
    rs7.assumptions.some((a) => a.includes('The declaration is incomplete')),
    'and it says so in the assumptions, where a reader of the figures will see it',
  );


  const passed = results.filter(Boolean).length;
  console.log(`\n  ${passed}/${results.length} reconciliation checks passed`);
  console.log(
    '\n  Expected values above are hand arithmetic in the comments, not a snapshot — a snapshot\n' +
      '  would only prove the code agrees with itself.\n',
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
