/**
 * The offline drill, as far as it can be automated.
 *
 * WHAT THIS DOES AND DOES NOT COVER
 *
 * The plan asks for: airplane mode, sign three children in, restore the connection,
 * confirm exactly three events landed and no duplicates after a forced double flush.
 *
 * This runs the second half of that faithfully and simulates the first. It replays the
 * exact sequence the outbox performs — keys generated up front, the same keys reused on
 * every retry, a flush repeated — against the real database, through the same
 * `recordAttendance` the app calls. What it does **not** exercise is the `expo-sqlite`
 * layer itself, which needs a device or a simulator.
 *
 * So: this proves the contract the outbox relies on. A real device drill is still
 * required before Little Pearls uses it, and is listed as such in the README.
 *
 *   ECE_ALLOW_DEMO_SEED=yes npm run drill:offline
 */

import { randomUUID } from 'node:crypto';
import {
  assessRatio,
  buildRoll,
  splitByAgeBand,
  type Child,
  type HealthCondition,
} from '@ece/core';
import {
  createAnonClient,
  createServiceClient,
  listAttendanceToday,
  listChildren,
  readAdultsPresent,
  recordAdultsPresent,
  recordAttendance,
  type Db,
} from '@ece/api';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.ECE_DRILL_PASSWORD;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!url || !anonKey || !serviceKey) die('Supabase env vars are required. See .env.example.');
if (process.env.ECE_ALLOW_DEMO_SEED !== 'yes') {
  die('This writes attendance events. Set ECE_ALLOW_DEMO_SEED=yes to confirm.');
}
/*
  NO HUMAN CREDENTIAL IS REQUIRED, AND THAT USED TO BE THE BLOCKER.

  This script signed in as `vakkascelik@gmail.com` and demanded `ECE_DRILL_PASSWORD` — a named
  person's real account password. Three things wrong with that, and the first is the one that
  stopped it running today:

    • A password cannot be fetched. Supabase stores `auth.users.encrypted_password` as a bcrypt
      hash and no key, service role or PAT returns it, so anybody without that person's password
      simply cannot run the drill.
    • It cannot run in CI at all, which is most of what a drill is for.
    • It breaks the day that person changes their password or leaves, and the failure reads as
      "the offline path is broken" rather than "the credential is stale".

  So the drill provisions its own account: a `.invalid` address that cannot receive mail (RFC
  2606, the convention `seed-demo.ts` already uses), an educator membership on the demo centre,
  and a fresh random password set on each run and never stored. `ECE_DRILL_PASSWORD` still works
  as an override for anybody who wants to drill as a real person.

  It is an educator, not an owner. `recordDailyPractice` is everything this drill needs, and a
  drill account with more rights than the act it is drilling is a standing invitation.
*/
const DRILL_EMAIL = process.env.ECE_DRILL_EMAIL ?? 'drill.kaiako@littlepearls.invalid';

const results: boolean[] = [];
function check(ok: boolean, label: string) {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

/** One entry of the simulated queue. The key is fixed at enqueue, exactly as on device. */
interface Queued {
  clientUuid: string;
  childId: string;
  kind: 'in' | 'out';
  at: string;
}

/**
 * A flush pass. Returns what happened per entry, and — critically — reuses the key
 * from the queue rather than generating a new one. Regenerating it is the bug the
 * whole mechanism exists to prevent, so the drill has to be faithful about it.
 */
async function flushOnce(db: Db, queue: Queued[]) {
  let sent = 0;
  let duplicates = 0;
  for (const item of queue) {
    const result = await recordAttendance(db, {
      childId: item.childId,
      kind: item.kind,
      at: item.at,
      clientUuid: item.clientUuid,
    });
    if (result.outcome === 'duplicate') duplicates += 1;
    else sent += 1;
  }
  return { sent, duplicates };
}

async function main() {
  const admin = createServiceClient(url!, serviceKey!);

  /*
    Exact slug, not `.like('slug', '%albert%')`.

    That matched exactly one row until this project also came to hold a real
    `little-pearls-mt-albert` tenant alongside the demo one — found by running this
    against live data, which is what this drill is for. `.single()` then fails on two
    rows, not zero, and the old die() message ("Run npm run onboard first") pointed at
    the wrong fix entirely. `demo-mt-albert` is the slug `seed-demo.ts` itself commits
    to and guards on elsewhere in that script — matching it exactly here is also the
    safer choice on its own terms: a fuzzy match is one future centre name away from
    this drill writing invented attendance events into a real tenant.
  */
  const { data: centreRow } = await admin
    .from('centres')
    .select('id, name, timezone')
    .eq('slug', 'demo-mt-albert')
    .single();
  if (!centreRow) die('Expected the demo-mt-albert centre. Run `npm run seed:demo` first.');
  const centre = centreRow as { id: string; name: string; timezone: string };

  /*
    Find or make the drill's own account, then sign in as it through the anon key — the drill
    has to go through RLS exactly as the app does, which is why it does not simply use the
    service role it already holds.

    `generateLink({ type: 'invite' })` errors when the address already exists, and `recovery`
    then returns the existing user. That is the same find-or-create shape `seed-demo.ts` uses
    for the demo parent; it is not elegant and it is the documented way to ask "does this user
    exist" through the admin API without listing every user in the project.
  */
  const drillPassword = password ?? `Drill!${randomUUID().slice(0, 18)}`;
  let drillUserId: string;
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
    // Reset on every run, so nothing has to be stored anywhere and a leaked value is dead by
    // the next drill. Skipped when somebody supplied their own — theirs is not ours to change.
    await admin.auth.admin.updateUserById(drillUserId, {
      password: drillPassword,
      email_confirm: true,
    });
  }

  // Educator: `recordDailyPractice` is everything the drill exercises. Upserted rather than
  // inserted so a re-run is a no-op, and `revoked_at: null` so a previously revoked drill
  // account comes back rather than failing at the first policy.
  const membership = await admin
    .from('memberships')
    .upsert(
      { centre_id: centre.id, user_id: drillUserId, role: 'educator', revoked_at: null },
      { onConflict: 'centre_id,user_id' },
    );
  if (membership.error) die(`Could not give the drill account access: ${membership.error.message}`);

  const staff = createAnonClient(url!, anonKey!);
  const signIn = await staff.auth.signInWithPassword({
    email: DRILL_EMAIL,
    password: drillPassword,
  });
  if (signIn.error) die(`Sign-in failed for ${DRILL_EMAIL}: ${signIn.error.message}`);

  const children = (await listChildren(staff, centre.id)).filter((c) => c.lastName === 'Demo-Seed');
  if (children.length < 3) die('Need at least three demo children. Run `npm run seed:demo`.');

  // NO CLEANUP, and that is not an oversight.
  //
  // The first version of this script began by deleting today's events with the
  // service role. It silently did nothing: 0009 grants `service_role` select and
  // insert only, so attendance is append-only against the application's most
  // privileged credential too. The count assertion then read 8 instead of 3, because
  // events from earlier runs were still there — a test failing for the right reason.
  //
  // The fix is not to widen the grant. It is to assert on exactly the events this run
  // created, which is what "three landed, no duplicates" actually means. Clearing
  // attendance needs the database owner, or `npm run seed:demo -- --purge`, which
  // cascades from the children.

  console.log(`\n  ${centre.name} — ${children.length} demo children\n`);
  console.log('  --- offline: three sign-ins queued locally, nothing sent ---');

  const offlineAt = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const queue: Queued[] = children.slice(0, 3).map((c) => ({
    clientUuid: randomUUID(),
    childId: c.id,
    kind: 'in',
    at: offlineAt,
  }));

  // While offline the device still shows the right answer, from the queue alone.
  const offlineRoll = buildRoll({
    children,
    serverStates: [],
    queued: queue,
    health: new Map<string, HealthCondition[]>(),
    adultsPresent: 2,
    timeZone: centre.timezone,
  });
  check(
    offlineRoll.ratio.present === 3,
    `offline, the device counts all three as present (${offlineRoll.ratio.present})`,
  );
  check(
    offlineRoll.entries.filter((e) => e.pending).length === 3,
    'and marks all three as not yet sent',
  );

  console.log('\n  --- connection restored: first flush ---');
  const first = await flushOnce(staff, queue);
  check(first.sent === 3 && first.duplicates === 0, `three events sent (${first.sent} sent, ${first.duplicates} duplicate)`);

  console.log('\n  --- forced second flush, same keys ---');
  const second = await flushOnce(staff, queue);
  check(
    second.sent === 0 && second.duplicates === 3,
    `nothing new written, all three recognised as already there (${second.sent} sent, ${second.duplicates} duplicate)`,
  );

  // Counted by this run's keys, not by child. Precise, and independent of whatever
  // else is on the record from earlier runs or from the app.
  const { count } = await staff
    .from('attendance_events')
    .select('id', { count: 'exact', head: true })
    .in('client_uuid', queue.map((q) => q.clientUuid));
  check(count === 3, `exactly three events exist for these three keys (${count})`);

  // The time survived the outage. This is what decides funded hours.
  const landed = await staff
    .from('attendance_events')
    .select('at')
    .eq('client_uuid', queue[0]!.clientUuid)
    .single();
  check(
    landed.data?.at === offlineAt ||
      new Date(landed.data?.at as string).getTime() === new Date(offlineAt).getTime(),
    'the event kept the time it happened, not the time it was sent',
  );

  console.log('\n  --- a second device sees the same thing ---');
  const other = createAnonClient(url!, anonKey!);
  /*
    The same account, a second session — a second tablet in the same room, not a second person.

    Its error is checked, which it was not before. `signInWithPassword` resolves rather than
    throwing, so a failed sign-in here left `other` as an *anonymous* client and the failure
    surfaced three lines later as `permission denied for table staff_count_events` — which reads
    like a policy defect and is a stale credential. `anon` has `revoke all` on that table, so the
    grant refuses before any policy is consulted, and the message never mentions sign-in.
  */
  const otherSignIn = await other.auth.signInWithPassword({
    email: DRILL_EMAIL,
    password: drillPassword,
  });
  if (otherSignIn.error) die(`Second-device sign-in failed: ${otherSignIn.error.message}`);
  await recordAdultsPresent(other, { centreId: centre.id, adults: 2, clientUuid: randomUUID() });

  const [statesA, statesB] = await Promise.all([
    listAttendanceToday(staff, centre.id),
    listAttendanceToday(other, centre.id),
  ]);
  const presentOf = (states: typeof statesA) =>
    children.filter((c) => states.find((s) => s.childId === c.id)?.kind === 'in');

  const adults = await readAdultsPresent(other, centre.id);
  const ratioOf = (kids: Child[]) => {
    const { underTwo, twoAndOver } = splitByAgeBand(kids, centre.timezone);
    return assessRatio({ underTwo, twoAndOver, adultsPresent: adults });
  };
  const a = ratioOf(presentOf(statesA));
  const b = ratioOf(presentOf(statesB));
  check(
    a.present === b.present && a.adultsRequired === b.adultsRequired && a.status === b.status,
    `both devices agree: ${a.present} children, ${a.adultsRequired} adults required, ${a.status}`,
  );

  console.log('\n  --- the device that drained agrees with the server ---');
  const drained = buildRoll({
    children,
    serverStates: statesA,
    queued: [],
    health: new Map<string, HealthCondition[]>(),
    adultsPresent: adults,
    timeZone: centre.timezone,
  });
  check(
    drained.ratio.present === offlineRoll.ratio.present,
    `the same count before and after the flush (${offlineRoll.ratio.present} then ${drained.ratio.present})`,
  );
  check(drained.pendingCount === 0, 'and nothing left pending');

  console.log('\n  --- a permanently refused write must not retry forever ---');
  // An event that aged past the 14-day window while the device sat in a drawer. The
  // server will never accept it, so the outbox has to set it aside rather than block
  // everything behind it.
  let permanent = false;
  try {
    await recordAttendance(staff, {
      childId: children[0]!.id,
      kind: 'in',
      at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      clientUuid: randomUUID(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The same classification `outbox.ts#isPermanent` applies.
    permanent = /\b23514\b/.test(message) || /violates check constraint/i.test(message);
  }
  check(permanent, 'a 20-day-old event is refused with a code the outbox treats as permanent');

  const passed = results.filter(Boolean).length;
  console.log(`\n  ${passed}/${results.length} drill checks passed`);
  console.log(
    '\n  Not covered: the expo-sqlite queue itself, which needs a device.\n' +
      '  A real airplane-mode drill on a tablet is still required before use.\n',
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
