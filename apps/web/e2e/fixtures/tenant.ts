/**
 * The tenant the audit runs against.
 *
 * WHY THIS SEEDS ITS OWN DATA RATHER THAN USING THE DEMO CENTRE
 *
 * Two reasons, and the second is the important one.
 *
 * First, the demo drills (`drill:offline`, `reconcile:funding`) sign in as a human's
 * owner account and need `ECE_DRILL_PASSWORD` supplied at the keyboard. CI has no
 * keyboard. This creates its own account with a password generated at run time, so
 * the only secret it needs is the service-role key CI already has.
 *
 * Second — and this is the point of the whole file — **an accessibility audit of an
 * empty page is worthless.** axe cannot find a contrast failure in a table that has
 * no rows, an unlabelled control in a form nobody rendered, or a heading order
 * problem in a section that short-circuited to "nothing has been filed". Every page
 * in this app has an empty state, and every empty state passes trivially. So the
 * seed deliberately produces the *loaded* version of each screen: an expired staff
 * record so the critical flag renders, a severe allergy so the health chip renders,
 * a child signed in so the ratio bar renders, a thread with a message in it.
 *
 * WHAT IT DELIBERATELY DOES NOT SEED
 *
 * Media. A photo on a post is a signed URL to a real object in a private bucket, and
 * uploading one would mean this fixture writes to storage — which it would then have
 * to clean up, and a failed clean-up leaves a child's photo in a bucket. The image
 * elements on `/posts` are therefore *not* covered by this audit. Recorded in the
 * wiki rather than papered over.
 *
 * Two centres, not one, because `requireCtx()` auto-selects when there is exactly
 * one membership — and `/select-centre` is then unreachable and unaudited. Two also
 * happens to be the real shape of the first customer.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
export { TENANT_FILE } from './paths';

export interface AuditTenant {
  tag: string;
  ownerEmail: string;
  managerEmail: string;
  educatorEmail: string;
  parentEmail: string;
  password: string;
  /**
   * The user ids, carried rather than looked up. `auth.admin.listUsers` is paginated and
   * this project already has enough accounts to make "it was on the first page" an
   * assumption — and an assumption that fails as `undefined.id`, which reads like a bug
   * in the thing under test rather than in the lookup.
   */
  ownerId: string;
  managerId: string;
  educatorId: string;
  parentId: string;
  centreId: string;
  otherCentreId: string;
  childId: string;
  childName: string;
  /**
   * A second child at the same centre whom the parent is NOT a guardian of.
   *
   * The whole point of the second access boundary: `parent` is a role *inside* a
   * tenant, so centre-vs-centre isolation says nothing about whether one family can
   * read another family's child. This is the child that proves it through the app
   * rather than only in SQL.
   */
  otherChildId: string;
  /** Plaintext, so the audit can load the *valid* invitation screen. */
  inviteToken: string;
}

function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'e2e needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
        'Run through `npm run test:e2e`, which loads .env.local.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Throw on a PostgREST error instead of continuing with a half-built fixture.
 *
 * The null check is not defensive noise. PostgREST returns `data: null` on an insert
 * whose `select()` returns nothing — which is what happens when a policy allows the
 * write but not the read back — and a fixture that carried on from there produced the
 * bug where "the parent cannot see their own child" surfaced two steps later.
 */
function must<T>(
  label: string,
  res: { data: T; error: { message: string } | null },
): NonNullable<T> {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) {
    throw new Error(`${label}: insert returned no rows`);
  }
  return res.data;
}

/**
 * A local date `days` from today in the centre's timezone.
 *
 * Not `toISOString().slice(0,10)` — that is the bug that made the app reject a baby
 * born in the New Zealand morning, because PostgREST connects as UTC and NZ is
 * twelve hours ahead.
 */
function nzDate(days = 0): string {
  const at = new Date(Date.now() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function seedAuditTenant(): Promise<AuditTenant> {
  const db = admin();
  const tag = randomBytes(3).toString('hex');
  const password = `Aa1!${randomBytes(12).toString('base64url')}`;
  const ownerEmail = `audit.owner.${tag}@ece.invalid`;
  const managerEmail = `audit.manager.${tag}@ece.invalid`;
  const educatorEmail = `audit.educator.${tag}@ece.invalid`;
  const parentEmail = `audit.parent.${tag}@ece.invalid`;

  // All four roles, because a capability matrix with four rows tested at two of them is
  // a matrix nobody has checked. `educator` is the interesting one: it is the only role
  // that can write daily practice and must not reach the office screens, so it is where
  // a mis-set capability would be least visible.
  const makeUser = async (email: string) => {
    const res = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (res.error) throw new Error(`create ${email}: ${res.error.message}`);
    return res.data.user.id;
  };

  const ownerId = await makeUser(ownerEmail);
  const managerId = await makeUser(managerEmail);
  const educatorId = await makeUser(educatorEmail);
  const parentId = await makeUser(parentEmail);

  const centres = must(
    'centres',
    await db
      .from('centres')
      .insert([
        {
          name: `Audit Mt Albert ${tag}`,
          slug: `audit-albert-${tag}`,
          moe_service_number: `AUD-${tag}`,
          timezone: 'Pacific/Auckland',
        },
        {
          name: `Audit Mt Roskill ${tag}`,
          slug: `audit-roskill-${tag}`,
          moe_service_number: `AUD-${tag}-2`,
          timezone: 'Pacific/Auckland',
        },
      ])
      .select('id, name'),
  );
  const centreId = centres[0].id as string;
  const otherCentreId = centres[1].id as string;

  must(
    'memberships',
    await db
      .from('memberships')
      .insert([
        { centre_id: centreId, user_id: ownerId, role: 'owner' },
        // The second centre exists so /select-centre is reachable. Owner there too,
        // so the switch lands somewhere renderable rather than on /no-access.
        { centre_id: otherCentreId, user_id: ownerId, role: 'owner' },
        { centre_id: centreId, user_id: managerId, role: 'manager' },
        { centre_id: centreId, user_id: educatorId, role: 'educator' },
        { centre_id: centreId, user_id: parentId, role: 'parent' },
      ])
      .select('id'),
  );

  const child = must(
    'children',
    await db
      .from('children')
      .insert({
        centre_id: centreId,
        first_name: 'Tāne',
        last_name: `Audit-${tag}`,
        preferred_name: 'Tāne',
        // Under two, so the stricter ratio band is the one being rendered.
        date_of_birth: nzDate(-540),
        ethnicities: ['Māori', 'NZ European'],
        iwi: 'Ngāti Whātua',
        first_language: 'te reo Māori',
        gender: 'male',
      })
      .select('id, first_name, last_name, preferred_name')
      .single(),
  );
  const childId = child.id as string;

  const guardian = must(
    'guardians',
    await db
      .from('guardians')
      .insert({
        centre_id: centreId,
        user_id: parentId,
        full_name: `Hine Audit-${tag}`,
        email: parentEmail,
        phone: '021 555 0199',
        address: '1 Test Road, Mt Albert',
      })
      .select('id')
      .single(),
  );

  must(
    'child_guardians',
    await db
      .from('child_guardians')
      .insert({
        child_id: childId,
        guardian_id: guardian.id,
        relationship: 'māmā',
        is_primary: true,
        can_collect: true,
        is_emergency_contact: true,
        contact_priority: 1,
      })
      .select('id'),
  );

  must(
    'enrolments',
    await db
      .from('enrolments')
      .insert({
        child_id: childId,
        centre_id: centreId,
        start_date: nzDate(-30),
        funded_hours_per_week: 20,
        twenty_hours_ece: true,
        days: [1, 2, 3, 4, 5],
        notes: 'Audit fixture enrolment.',
      })
      .select('id'),
  );

  // Severe, so the child card renders its most urgent state rather than its calmest.
  must(
    'health_conditions',
    await db
      .from('health_conditions')
      .insert([
        {
          child_id: childId,
          kind: 'allergy',
          name: 'Peanuts',
          severity: 'anaphylaxis',
          response_plan: 'EpiPen in the red bag by the door. Call 111 immediately.',
        },
        {
          child_id: childId,
          kind: 'dietary_requirement',
          name: 'No dairy',
          severity: 'mild',
          response_plan: null,
        },
      ])
      .select('id'),
  );

  // A second child at the same centre, with NO link to the parent. The parent must not
  // be able to reach this record — not from the list, and not by typing the URL. That is
  // the boundary the RLS suite asserts in SQL and this is the same claim made through the
  // app, because a policy that holds and a page that leaks are both possible.
  const otherChild = must(
    'other child',
    await db
      .from('children')
      .insert({
        centre_id: centreId,
        first_name: 'Mereana',
        last_name: `NotYours-${tag}`,
        date_of_birth: nzDate(-1200),
        ethnicities: ['NZ European'],
      })
      .select('id')
      .single(),
  );
  const otherChildId = otherChild.id as string;

  // Custody: owner and manager only, never an educator and never a parent — including
  // the parent it concerns. Seeded so the section has content, because "the page did not
  // render an empty panel" and "the page did not render the panel" look identical when
  // there is nothing to put in it.
  must(
    'custody_arrangements',
    await db
      .from('custody_arrangements')
      .insert({
        child_id: childId,
        detail: 'Collection by the father is not permitted without written agreement.',
        court_order_reference: `FAM-${tag}`,
        recorded_by: ownerId,
      })
      .select('id'),
  );

  must(
    'medication_authorities',
    await db
      .from('medication_authorities')
      .insert({
        child_id: childId,
        medicine: 'Adrenaline auto-injector',
        dose: '150 mcg',
        route: 'intramuscular',
        instructions: 'Outer thigh. Then call 111.',
        authorised_by: guardian.id,
        starts_on: nzDate(-30),
        expires_on: nzDate(300),
      })
      .select('id'),
  );

  // One consent deliberately withheld, so the "missing consents" warning renders.
  must(
    'consent_events',
    await db
      .from('consent_events')
      .insert(
        (['medical_emergency', 'sunscreen', 'excursion'] as const).map((kind) => ({
          child_id: childId,
          kind,
          granted: true,
          given_by: guardian.id,
          recorded_by: ownerId,
          note: 'Audit fixture.',
        })),
      )
      .select('id'),
  );

  // Signed in an hour ago and still present, so the roll has a row and the ratio bar
  // has something to assess. One adult against one under-two is within ratio, which
  // is the state a screenshot should show.
  must(
    'attendance_events',
    await db
      .from('attendance_events')
      // No centre_id: attendance reaches its centre through the child, which is also
      // why dropping the centre cascades all the way down to these rows.
      .insert({
        child_id: childId,
        kind: 'in',
        at: new Date(Date.now() - 3_600_000).toISOString(),
        recorded_by: ownerId,
        client_uuid: randomUUID(),
        note: null,
      })
      .select('id'),
  );

  must(
    'staff_count_events',
    await db
      .from('staff_count_events')
      .insert({
        centre_id: centreId,
        adults: 2,
        at: new Date(Date.now() - 3_700_000).toISOString(),
        recorded_by: ownerId,
        client_uuid: randomUUID(),
        note: 'Audit fixture.',
      })
      .select('id'),
  );

  // All three expiry states, so every flag colour on /compliance is rendered and
  // measured. An audit that only ever sees the green one has not audited the red one.
  must(
    'staff_records',
    await db
      .from('staff_records')
      .insert([
        {
          centre_id: centreId,
          user_id: ownerId,
          person_name: `Kaiako Audit-${tag}`,
          kind: 'first_aid',
          reference: 'FA-1',
          issued_on: nzDate(-800),
          expires_on: nzDate(-10),
          sighted_by: ownerId,
          sighted_at: new Date().toISOString(),
        },
        {
          centre_id: centreId,
          person_name: `Kaiako Two-${tag}`,
          kind: 'police_vetting',
          reference: 'PV-1',
          issued_on: nzDate(-900),
          expires_on: nzDate(30),
        },
        {
          centre_id: centreId,
          person_name: `Kaiako Three-${tag}`,
          kind: 'practising_certificate',
          reference: 'PC-1',
          issued_on: nzDate(-100),
          expires_on: nzDate(600),
          sighted_by: ownerId,
          sighted_at: new Date().toISOString(),
        },
      ])
      .select('id'),
  );

  must(
    'evidence',
    await db
      .from('evidence')
      .insert({
        centre_id: centreId,
        kind: 'policy',
        title: 'Emergency evacuation procedure',
        detail: 'Reviewed at the March staff meeting.',
        location: 'Office folder 2, tab 4',
        covers_from: nzDate(-180),
        owner_name: `Kaiako Audit-${tag}`,
        added_by: ownerId,
      })
      .select('id'),
  );

  must(
    'posts',
    await db
      .from('posts')
      .insert({
        centre_id: centreId,
        kind: 'panui',
        title: 'Audit pānui',
        body: 'The centre is closed on Monday for a public holiday.',
        author_id: ownerId,
        published_at: new Date().toISOString(),
      })
      .select('id'),
  );

  const thread = must(
    'message_threads',
    await db
      .from('message_threads')
      .insert({
        centre_id: centreId,
        child_id: childId,
        subject: 'Tāne’s afternoon sleep',
        started_by: ownerId,
      })
      .select('id')
      .single(),
  );

  must(
    'messages',
    await db
      .from('messages')
      .insert([
        { thread_id: thread.id, author_id: parentId, body: 'He did not sleep well last night.' },
        { thread_id: thread.id, author_id: ownerId, body: 'Thanks for letting us know — we will keep an eye on him.' },
      ])
      .select('id'),
  );

  // A live invitation, so /invite/[token] can be audited in its *accept* state rather
  // than only its "this link is no good" state. The hash matches
  // `apps/web/src/lib/inviteToken.ts` — SHA-256 hex, and the plaintext is never
  // stored, which is why it has to be generated here and carried in memory.
  const inviteToken = randomBytes(32).toString('base64url');
  must(
    'invitations',
    await db
      .from('invitations')
      .insert({
        centre_id: centreId,
        email: `audit.invitee.${tag}@ece.invalid`,
        role: 'educator',
        token_hash: createHash('sha256').update(inviteToken).digest('hex'),
        invited_by: ownerId,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })
      .select('id'),
  );

  return {
    tag,
    ownerEmail,
    managerEmail,
    educatorEmail,
    parentEmail,
    password,
    ownerId,
    managerId,
    educatorId,
    parentId,
    centreId,
    otherCentreId,
    childId,
    otherChildId,
    childName: 'Tāne',
    inviteToken,
  };
}

/**
 * Remove everything the run created.
 *
 * Deleting the centres is enough for the data: every child table cascades from
 * `children`, which cascades from `centres`. That works even though the app and the
 * service role are both forbidden from deleting attendance — a cascade is a
 * referential action executed as the table owner, not a DELETE by the caller. The
 * append-only guarantee is intact; it just is not a guarantee against dropping the
 * tenant.
 *
 * The users are deleted separately because `auth.users` is not owned by the centre.
 */
export async function destroyAuditTenant(tenant: AuditTenant): Promise<void> {
  const db = admin();

  const del = await db.from('centres').delete().in('id', [tenant.centreId, tenant.otherCentreId]);
  if (del.error) throw new Error(`drop centres: ${del.error.message}`);

  for (const email of [tenant.ownerEmail, tenant.parentEmail]) {
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = data?.users.find((u) => u.email === email);
    if (user) {
      const res = await db.auth.admin.deleteUser(user.id);
      if (res.error) throw new Error(`drop user ${email}: ${res.error.message}`);
    }
  }
}
