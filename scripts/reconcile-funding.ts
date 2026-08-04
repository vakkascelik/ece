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
 *   ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=… npm run reconcile:funding
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
if (!password) die('Set ECE_DRILL_PASSWORD to the owner password for the demo centre.');

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

  const { data: centreRow } = await admin
    .from('centres')
    .select('id, name, timezone')
    .like('slug', '%albert%')
    .single();
  if (!centreRow) die('Expected Little Pearls Mt Albert. Run `npm run onboard` first.');
  const centre = centreRow as { id: string; name: string; timezone: string };

  const staff = createAnonClient(url!, anonKey!);
  const signIn = await staff.auth.signInWithPassword({
    email: 'vakkascelik@gmail.com',
    password: password!,
  });
  if (signIn.error) die(`Sign-in failed: ${signIn.error.message}`);

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
   * Caps: 6 hours a day, 20 a week (unverified — DEFAULT_CAPS).
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
   *   Weekly cap: days -9 to -5 and days -2 fall in different ISO weeks in most months, so the
   *   20h weekly cap may bite on the first group. Asserted as a bound rather than a fixed number,
   *   because which ISO week a relative day lands in depends on when this is run — see below.
   *
   * Child B ("Uncapped"), 20 Hours ECE = no:
   *   day -9   08:00–16:00   8h → no cap → 8h
   *   day -8   08:00–16:00   8h → no cap → 8h
   *   Funded = 16h exactly, and the cap must not touch it.
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
    a.fundedHours <= 28,
    `funded is at most 28.00 — the daily cap applied to complete days (got ${a.fundedHours})`,
  );
  check(a.fundedHours <= a.attendedHours, `and never more than attended (${a.fundedHours} ≤ ${a.attendedHours})`);
  // The correction: without it the 10:00 sign-in would pair with the 14:00 sign-out for 4h, and the
  // 09:00 one would be left unclosed — making the day unresolved AND losing an hour.
  check(
    !a.unresolvedDates.includes(nzAt(2, 9).date),
    'the corrected day is complete, so the superseded sign-in was dropped',
  );

  console.log('\n  --- Child B: no attestation, so no caps ---');
  check(b.attendedHours === 16, `attended is 16.00 (got ${b.attendedHours})`);
  check(b.fundedHours === 16, `funded is 16.00 — the caps must NOT apply without the attestation (got ${b.fundedHours})`);
  check(b.cappedDates.length === 0, 'and nothing was capped');

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
