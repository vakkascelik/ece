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
 *   ECE_ALLOW_DEMO_SEED=yes npm run reconcile:funding
 *
 * `ECE_DRILL_PASSWORD` is no longer required. It provisions its own manager account on a
 * `.invalid` address with a fresh random password each run; supply the variable only if you
 * would rather drill as a real person.
 */

import { randomUUID } from 'node:crypto';
import { createAnonClient, createServiceClient, readFundingPeriod } from '@ece/api';
import { DEFAULT_CAPS, type FundingPeriod } from '@ece/core';

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

  const summary = await readFundingPeriod(staff, {
    centreId: centre.id,
    period,
    timeZone: centre.timezone,
    fromUtc: new Date(`${from}T00:00:00Z`).toISOString(),
    toUtc: new Date(`${to}T23:59:59Z`).toISOString(),
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
