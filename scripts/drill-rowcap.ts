/**
 * The 1000-row drill: prove the funding calculation reads every event, not the first thousand.
 *
 * WHY THIS EXISTS
 *
 * PostgREST is configured with `max_rows: 1000` — read from the project's own configuration.
 * An unbounded `select()` returns at most 1000 rows **with `error` set to null**, so nothing
 * about the response says anything was left behind.
 *
 * That produced a real bug in the money path, found by measurement: with 1,200 attendance
 * events present, `readFundingPeriod` reported 72 hours where the answer was higher, and
 * invented unresolved days because the cut landed mid-day and left sign-ins with no sign-out.
 * Under-reporting the claim and fabricating broken records at once, in the calculation whose
 * whole principle is that nothing is estimated.
 *
 * `fetchAll` fixed it. This drill is what stops it coming back, and it is the only test in the
 * repo that crosses the cap — unit tests cannot, because the cap is a property of the server.
 *
 * WHY THE ARITHMETIC IS SPELLED OUT RATHER THAN SNAPSHOTTED
 *
 * Same reason as `reconcile:funding`: a snapshot proves the code agrees with itself. The
 * expected total below is worked out by hand, in the comments, so a reader can check it
 * without running anything.
 *
 *     8 local days  ×  75 sessions  ×  5 minutes  =  3,000 minutes  =  50.00 hours
 *     8 local days  ×  75 sessions  ×  2 events   =  1,200 events   (the cap is 1,000)
 *
 * Every session sits inside one local day, so there are no boundary-crossing pairs and the
 * correct answer has no unresolved days in it. The first version of this probe used a
 * continuous ten-minute cadence that ran through midnight, which produced orphan sign-outs at
 * every date boundary — genuinely incomplete days, correctly reported, and a hopeless
 * instrument for measuring anything else.
 *
 * ~~No enrolment is created, so `twenty_hours_ece` is false and NO CAPS apply.~~
 *
 * **STALE AS OF 2026-09-04, and the reasoning behind it survives.** The caps used to be gated on
 * the 20 Hours attestation, so a child with no enrolment was uncapped. They are not any more: the
 * ECE Funding Subsidy caps at 6 hours a day and 30 a week for **every** child (Handbook §9-2,
 * §9-3), and Phase 2b applied it. See unverified-claims item 54.
 *
 * The design note was right about why it mattered, though, and it is why `attendedHours` is the
 * load-bearing assertion here rather than `fundedHours`: a daily cap **compresses** the difference
 * this drill exists to measure. At 6.25 hours a day, true and truncated reads both clamp to 6 per
 * day, so the only signal left in the funded figure is the number of days — a much blunter
 * instrument than 50.00 against 41.67. `attendedHours` is uncapped and stays sharp.
 *
 * So the funded assertions below became a **bound plus a deterministic side-effect**, not an
 * equality. 8 days × 6.25 hours clamps to 8 × 6 = 48, and the 30-hour weekly cap then bites
 * differently depending on which ISO weeks the eight days straddle — which varies by the day the
 * drill runs. Asserting a fixed number would make this drill fail on some weekdays and pass on
 * others, which is the nondeterminism `reconcile-funding.ts` had for the same reason.
 *
 *   npm run drill:rowcap
 */
import { createClient } from '@supabase/supabase-js';
import { readFundingPeriod } from '@ece/api';
import { DEFAULT_CAPS } from '@ece/core';

const DAYS = 8;
const SESSIONS_PER_DAY = 75;
const MINUTES_PER_SESSION = 5;

const EXPECTED_EVENTS = DAYS * SESSIONS_PER_DAY * 2; // 1,200
const EXPECTED_HOURS = (DAYS * SESSIONS_PER_DAY * MINUTES_PER_SESSION) / 60; // 50

let checks = 0;
let failures = 0;

function check(ok: boolean, label: string, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  if (!token || !ref) die('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required.');

  const sql = async (q: string) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${t.slice(0, 400)}\n  statement: ${q.slice(0, 140)}`);
    return JSON.parse(t) as Record<string, unknown>[];
  };

  // `audit-` prefixed, so `npm run sweep:audit` collects it if this run dies before cleanup.
  const tag = Math.random().toString(36).slice(2, 8);
  const slug = `audit-rowcap-${tag}`;

  console.log('\n  1000-row drill');
  console.log(`  ${EXPECTED_EVENTS} events, expecting ${EXPECTED_HOURS.toFixed(2)} hours\n`);

  const centreId = (
    await sql(
      `insert into public.centres (name, slug) values ('AUDIT rowcap ${tag}', '${slug}') returning id`,
    )
  )[0].id as string;

  try {
    const childId = (
      await sql(
        `insert into public.children (centre_id, first_name, last_name, date_of_birth)
         values ('${centreId}', 'Rowcap', 'Drill', current_date - interval '3 years') returning id`,
      )
    )[0].id as string;

    /*
     * The timestamp incantation matters and is the trap this project keeps meeting.
     *
     *   (local_date + time '07:00') at time zone 'Pacific/Auckland'
     *
     * `date + time` produces a NAIVE timestamp; `at time zone` then reads it as a local wall
     * clock and returns the instant. Writing `(now() at time zone 'Pacific/Auckland')::date +
     * interval '7 hours'` instead produces a naive value that Postgres later interprets as
     * UTC — which is how an earlier version of this drill put events three hours in the future
     * and tripped `attendance_not_future`.
     *
     * Days 1..8 back, so nothing is today and nothing is in the future. All inside the
     * 14-day window `attendance_not_ancient` allows.
     */
    await sql(`
      insert into public.attendance_events (child_id, kind, at, client_uuid)
      select '${childId}',
             (case when leg = 0 then 'in' else 'out' end)::public.attendance_kind,
             ((((now() at time zone 'Pacific/Auckland')::date - d)
                 + time '07:00'
                 + (k * interval '10 minutes')
                 + (leg * interval '${MINUTES_PER_SESSION} minutes')
              ) at time zone 'Pacific/Auckland'),
             gen_random_uuid()
        from generate_series(1, ${DAYS}) d
        cross join generate_series(0, ${SESSIONS_PER_DAY - 1}) k
        cross join generate_series(0, 1) leg`);

    const inTable = Number(
      (await sql(`select count(*)::int as n from public.attendance_events where child_id = '${childId}'`))[0]
        .n,
    );
    check(inTable === EXPECTED_EVENTS, 'the events were all written', `${inTable}`);

    // The cap is real, and this line is the evidence. A deliberately unbounded select.
    const db = createClient(url, key, { auth: { persistSession: false } });
    const raw = await db.from('attendance_events').select('id').eq('child_id', childId);
    check(
      raw.data?.length === 1000 && raw.error === null,
      'an unbounded select still truncates at 1000, silently',
      `${raw.data?.length} rows, error ${raw.error ? 'set' : 'null'}`,
    );

    // And the paged path reads all of them.
    const from = new Date(Date.now() - (DAYS + 2) * 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    const summary = await readFundingPeriod(db as never, {
      centreId,
      period: { label: 'rowcap drill', from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      timeZone: 'Pacific/Auckland',
      fromUtc: from.toISOString(),
      toUtc: to.toISOString(),
    });

    const child = summary.children[0];
    check(summary.children.length === 1, 'one child in the summary', `${summary.children.length}`);
    check(
      child?.attendedHours === EXPECTED_HOURS,
      `attended hours is exactly ${EXPECTED_HOURS.toFixed(2)}`,
      `got ${child?.attendedHours}`,
    );
    /*
      THE FOURTH ASSERTION THAT HAD ENCODED THE PRE-2b DEFECT, and the one its commit missed.

      It read `child?.fundedHours === EXPECTED_HOURS` with the label "funded equals attended, since
      no attestation means no caps". Phase 2b found and corrected three others — two unit tests and
      `reconcile-funding.ts` — and reported that as the complete set. It was not: 2b's conditional
      gates did not include `drill:rowcap`, because that change added no multi-row read, so this
      file was never run against it. It surfaced a day later when Phase 2A added one.

      Worth the paragraph because the reconciliation 2b did — "check what already asserts this
      figure" — was sound and **searched the wrong set of files**: the unit tests and the script
      with "funding" in its name, not the drills. A grep for the figure would have found it; a grep
      for the files I expected to hold it did not.
    */
    const dailyCap = DEFAULT_CAPS.maxHoursPerDay;
    check(
      child?.cappedDates.length === DAYS,
      `every one of the ${DAYS} days hit the ${dailyCap}h daily cap — ${(SESSIONS_PER_DAY * MINUTES_PER_SESSION) / 60}h attended each`,
      `${child?.cappedDates.length ?? '?'} capped`,
    );
    check(
      (child?.fundedHours ?? 0) <= DAYS * dailyCap,
      `funded is at most ${DAYS * dailyCap}.00 — a bound, not an equality, because the weekly cap bites differently depending on which ISO weeks these ${DAYS} days straddle`,
      `got ${child?.fundedHours}`,
    );
    check(
      (child?.fundedHours ?? 0) < (child?.attendedHours ?? 0),
      'and funded is now strictly below attended, which it was not before 2026-09-04',
      `${child?.fundedHours} < ${child?.attendedHours}`,
    );
    check(
      child?.unresolvedDates.length === 0,
      'no day is reported unresolved — every session sits inside one local day',
      `${child?.unresolvedDates.length ?? '?'} unresolved`,
    );
    check(summary.complete === true, 'the summary reports itself complete');
  } finally {
    await sql(`delete from public.centres where id = '${centreId}'`).catch(() => {});
    console.log('\n  drill centre dropped.');
  }

  console.log('');
  if (failures > 0) {
    console.error(`  ${failures} of ${checks} checks failed.\n`);
    process.exit(1);
  }
  console.log(`  ${checks}/${checks} checks passed.\n`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
