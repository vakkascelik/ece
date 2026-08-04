/**
 * Demo data, for checking the app against something that looks like a real roll.
 *
 * GUARDED ON PURPOSE. This inserts invented children into whatever database
 * `.env.local` points at, and that database is going to hold real children's
 * records. So it refuses to run unless `ECE_ALLOW_DEMO_SEED=yes`, everything it
 * creates is tagged, and `--purge` removes exactly what it made.
 *
 *   ECE_ALLOW_DEMO_SEED=yes npm run seed:demo
 *   ECE_ALLOW_DEMO_SEED=yes npm run seed:demo -- --purge
 *
 * Emails use the `.invalid` TLD, which is reserved by RFC 2606 and cannot resolve,
 * so a stray notification can never reach a real person.
 */

import { createClient } from '@supabase/supabase-js';

const TAG = 'Demo-Seed';
const PARENT_EMAIL = 'demo.parent@littlepearls.invalid';

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
if (process.env.ECE_ALLOW_DEMO_SEED !== 'yes') {
  die(
    'Refusing to run. This writes invented children into the database in\n' +
      '  .env.local, which is the one that holds real records.\n\n' +
      '  Set ECE_ALLOW_DEMO_SEED=yes if that is what you want.',
  );
}

const db = createClient(url, key, { auth: { persistSession: false } });
const purge = process.argv.includes('--purge');

/**
 * Insert, and stop if it fails.
 *
 * The first version of this script ignored the returned error on several inserts.
 * The `child_guardians` rows silently never landed, and what surfaced two steps
 * later was "the parent cannot see their own child" — which looks exactly like an
 * RLS bug and is not one. A seed that half-succeeds is worse than one that dies.
 */
async function must(label: string, op: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await op;
  if (error) die(`${label} failed: ${error.message}`);
}

/** Every child, guardian and centre this script touches carries the tag in its surname/name. */
async function purgeAll() {
  const { data: kids } = await db.from('children').select('id').eq('last_name', TAG);
  const ids = (kids ?? []).map((k) => k.id);
  if (ids.length) {
    // Children cascade to enrolments, health, consents and guardian links.
    await db.from('children').delete().in('id', ids);
  }
  await db.from('guardians').delete().like('full_name', `%(${TAG})`);
  console.log(`  purged ${ids.length} demo children and their guardians`);

  // The demo parent's account and membership go too, or the next run finds a
  // membership with no child attached to it.
  const link = await db.auth.admin.generateLink({ type: 'recovery', email: PARENT_EMAIL });
  if (link.data?.user?.id) {
    await db.from('memberships').delete().eq('user_id', link.data.user.id);
    await db.auth.admin.deleteUser(link.data.user.id);
    console.log('  removed the demo parent account');
  }
}

async function main() {
  if (purge) {
    await purgeAll();
    return;
  }

  /*
   * `demo-%`, and it used to be `little-pearls-%`.
   *
   * THIS IS THE MOST DANGEROUS LINE THIS SCRIPT HAS EVER HAD.
   *
   * The demo centres were originally created with the real customer's own slugs, because at
   * the time there was no real customer — only a plan naming Little Pearls as the first one.
   * The moment that tenant was actually created, this pattern would have matched **the real
   * centres**, and the script would have inserted seven invented children, with a fabricated
   * peanut anaphylaxis plan and a fabricated asthma plan, into a live service's roll. Then
   * `purgeAll()` at the top of the next run would have deleted them again, which is worse:
   * it would have looked like nothing happened.
   *
   * Caught while onboarding, by the slug collision refusing the insert. That collision was
   * luck — a unique index doing a job nobody asked it to do.
   *
   * So: demo data lives under `demo-`, the real tenant lives under its own name, and the
   * guard below refuses to run if the pattern ever matches something that is not a demo
   * centre. A prefix convention alone is a convention; the assertion is the rule.
   */
  const { data: centres, error } = await db
    .from('centres')
    .select('id, name, slug')
    .like('slug', 'demo-%')
    .order('slug');
  if (error) die(`Could not read centres: ${error.message}`);
  if (!centres || centres.length < 2) {
    die(
      'Expected two demo centres with slugs starting `demo-`.\n  ' +
        'Create them with:\n  ' +
        '  npm run onboard -- --name "DEMO — Mt Albert (invented data)" --slug demo-mt-albert --owner you@example.com',
    );
  }

  const notDemo = centres.filter((c) => !c.slug.startsWith('demo-'));
  if (notDemo.length > 0) {
    die(
      `Refusing to seed invented children into: ${notDemo.map((c) => c.slug).join(', ')}.\n  ` +
        'This script only ever writes to centres whose slug starts `demo-`.',
    );
  }

  const albert = centres.find((c) => c.slug.includes('albert'));
  const roskill = centres.find((c) => c.slug.includes('roskill'));
  if (!albert || !roskill) {
    die(
      `Expected a demo centre matching "albert" and one matching "roskill". Found: ${centres
        .map((c) => c.slug)
        .join(', ')}`,
    );
  }

  // Start clean so re-running is idempotent rather than cumulative.
  await purgeAll();

  const dob = (years: number, months = 0) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  const roll = [
    { centre: albert, first: 'Anahera', preferred: 'Ana', dob: dob(3, 2), ethnicities: ['Māori'], iwi: 'Ngāti Whātua' },
    { centre: albert, first: 'Tobias', preferred: 'Toby', dob: dob(1, 6), ethnicities: ['NZ European'] },
    { centre: albert, first: 'Mei', preferred: null, dob: dob(4, 1), ethnicities: ['Chinese'] },
    { centre: roskill, first: 'Sione', preferred: null, dob: dob(2, 8), ethnicities: ['Tongan'] },
    { centre: roskill, first: 'Ruby', preferred: null, dob: dob(1, 1), ethnicities: ['NZ European', 'Māori'] },
  ];

  const created: { id: string; first: string; centreId: string }[] = [];
  for (const r of roll) {
    const { data, error: e } = await db
      .from('children')
      .insert({
        centre_id: r.centre.id,
        first_name: r.first,
        last_name: TAG,
        preferred_name: r.preferred,
        date_of_birth: r.dob,
        ethnicities: r.ethnicities,
        iwi: r.iwi ?? null,
      })
      .select('id')
      .single();
    if (e) die(`Creating ${r.first} failed: ${e.message}`);
    created.push({ id: data.id, first: r.first, centreId: r.centre.id });

    await must(`Enrolling ${r.first}`, db.from('enrolments').insert({
      child_id: data.id,
      centre_id: r.centre.id,
      start_date: dob(0, 4),
      funded_hours_per_week: 20,
      twenty_hours_ece: true,
      days: [1, 2, 3, 4, 5],
    }));
  }

  const ana = created.find((c) => c.first === 'Anahera')!;
  const toby = created.find((c) => c.first === 'Tobias')!;
  const sione = created.find((c) => c.first === 'Sione')!;

  // The case the whole flag design exists for.
  await must('Recording health conditions', db.from('health_conditions').insert([
    {
      child_id: ana.id,
      kind: 'allergy',
      name: 'Peanuts',
      severity: 'anaphylaxis',
      response_plan: 'EpiPen in the office cupboard, top shelf. Use it, then call 111, then ring Mum.',
    },
    { child_id: toby.id, kind: 'dietary_requirement', name: 'No dairy', severity: null, response_plan: null },
    { child_id: sione.id, kind: 'medical_condition', name: 'Asthma', severity: 'moderate', response_plan: 'Blue inhaler in his bag.' },
  ]));

  // A parent with an app account, to exercise guardianship scoping for real.
  let parentUserId: string;
  const invite = await db.auth.admin.generateLink({ type: 'invite', email: PARENT_EMAIL });
  if (invite.error) {
    const recovery = await db.auth.admin.generateLink({ type: 'recovery', email: PARENT_EMAIL });
    if (recovery.error || !recovery.data?.user) die(`Demo parent: ${recovery.error?.message}`);
    parentUserId = recovery.data.user.id;
  } else {
    parentUserId = invite.data.user.id;
  }

  const password = 'DemoParent!' + Math.floor(Date.now() / 100000);
  await db.auth.admin.updateUserById(parentUserId, { password, email_confirm: true });
  await db
    .from('memberships')
    .upsert(
      { centre_id: albert.id, user_id: parentUserId, role: 'parent', revoked_at: null },
      { onConflict: 'centre_id,user_id' },
    );

  // Ana's mother has an account; her grandmother is on the collection list without
  // one, which is the ordinary case.
  const { data: mum } = await db
    .from('guardians')
    .insert({ centre_id: albert.id, user_id: parentUserId, full_name: `Hine Rangi (${TAG})`, phone: '021 555 0100', email: PARENT_EMAIL })
    .select('id')
    .single();
  const { data: nan } = await db
    .from('guardians')
    .insert({ centre_id: albert.id, full_name: `Whaea Materoa (${TAG})`, phone: '021 555 0101' })
    .select('id')
    .single();
  // Toby's father, so the demo parent has a same-centre family they must not see.
  const { data: dad } = await db
    .from('guardians')
    .insert({ centre_id: albert.id, full_name: `Mark Fletcher (${TAG})`, phone: '021 555 0102' })
    .select('id')
    .single();

  // Every object carries every key, deliberately.
  //
  // PostgREST builds one INSERT from the UNION of keys across a bulk array, so a
  // key present in one object and absent from another is sent as an explicit NULL
  // — it does not fall back to the column default. Omitting `is_primary` on the
  // second row here failed with "null value in column is_primary violates not-null
  // constraint", which reads like a schema problem and is a client one.
  await must('Linking whānau', db.from('child_guardians').insert([
    { child_id: ana.id,  guardian_id: mum!.id, relationship: 'mother',      is_primary: true,  can_collect: true, is_emergency_contact: true,  contact_priority: 1 },
    { child_id: ana.id,  guardian_id: nan!.id, relationship: 'grandmother', is_primary: false, can_collect: true, is_emergency_contact: true,  contact_priority: 2 },
    { child_id: toby.id, guardian_id: dad!.id, relationship: 'father',      is_primary: true,  can_collect: true, is_emergency_contact: false, contact_priority: 1 },
  ]));

  // Some answered, some not, and one refused — so the three-state display has all
  // three states to show.
  await must('Recording consents', db.from('consent_events').insert([
    { child_id: ana.id, kind: 'medical_emergency', granted: true, given_by: mum!.id },
    { child_id: ana.id, kind: 'sunscreen', granted: true, given_by: mum!.id },
    { child_id: ana.id, kind: 'photo_internal', granted: true, given_by: mum!.id },
    { child_id: ana.id, kind: 'photo_public', granted: false, given_by: mum!.id },
    { child_id: toby.id, kind: 'medical_emergency', granted: true, given_by: dad!.id },
  ]));

  await must('Recording the custody arrangement', db.from('custody_arrangements').insert({
    child_id: toby.id,
    detail: 'Parenting order in place. Only Mr Fletcher may collect. Do not discuss with the mother.',
    court_order_reference: 'FAM-2025-0001',
  }));

  console.log(`\n  ${created.length} children across both sites, tagged "${TAG}".`);
  console.log(`  Anahera has an anaphylaxis flag; Tobias has a custody arrangement.\n`);
  console.log(`  Demo parent (sees Anahera only, never Tobias):`);
  console.log(`    ${PARENT_EMAIL}`);
  console.log(`    ${password}\n`);
  console.log(`  Remove it all with: ECE_ALLOW_DEMO_SEED=yes npm run seed:demo -- --purge\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
