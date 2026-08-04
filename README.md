# ece

Multi-tenant platform for New Zealand early learning services. One web app, one
mobile app, one deployment serving every centre.

```
apps/web        Next.js 15 — admin and staff web
apps/mobile     Expo 57 / React Native — whānau and educators
packages/core   types, roles, capabilities. No Node, no Next, no React Native.
packages/api    the only place either app talks to Supabase
supabase/       migrations. RLS is the tenant boundary.
```

```bash
npm install
npm run dev:web        # http://localhost:3000
npm run dev:mobile     # Expo
npm run typecheck      # all four workspaces
npm run test:rls       # tenant isolation — 32 assertions
npm run onboard        # create a centre and its first owner (see below)
```

Copy `.env.example` to `.env.local` first.

## `npm run test:rls` is the test that matters

Tenant separation is enforced by policy, and until something asserts it, it is a
claim. [`supabase/tests/rls_isolation.sql`](supabase/tests/rls_isolation.sql)
creates two centres with a member each and proves, from both directions, that
neither can read or write the other's rows — plus that the audit log cannot be
forged, altered or deleted by anyone including `service_role`.

It is one self-contained script ending in `ROLLBACK`, so it needs no Docker, no
pgTAP and no local Postgres, and is safe to point at a live project. Impersonation
is `set local role authenticated` plus a `request.jwt.claims` blob, which is
exactly what PostgREST does per request.

**The first time it was ever executed it failed three times in a row, each on a
real bug** — a view no authenticated caller could read, and two tables whose
policies were unreachable for want of a `GRANT`. All three were invisible to
`typecheck`, to `next build`, and to reading the migrations. Add an assertion here
in the same commit as any new table.

Run it against a bare `create schema public` to check the migrations are still
self-contained; they are not allowed to depend on how a project happened to be
set up.

---

## Why this is pooled and not siloed

`shop-platform` and `charity-platform` both put one deployment and one database
schema per customer. That is right for them: each customer wants their own
website on their own domain.

It cannot work here, because **this ships a mobile app**. You cannot publish one
App Store binary per childcare centre. One app must serve every centre, so the
tenant is resolved at sign-in and isolation has to live somewhere the client
cannot reach.

What carries over from `shop-platform` is the monorepo and the shared-core
discipline. What changes is the tenancy model, because mobile forces it.

## The tenant boundary is Postgres, not the application

Every tenant-scoped table carries `centre_id` and has Row Level Security keyed
on `caller_centre_ids()`. The query layer in `packages/api` contains **no tenant
filtering at all**, deliberately:

- A filter in the app is one forgotten `.eq('centre_id', …)` away from showing
  one centre another centre's children.
- A mobile client cannot be trusted to filter, because a mobile client can be
  modified.
- Writing the filter anyway would be worse than useless — it would imply the
  filter is what keeps centres apart, and the next person would rely on it.

Adding a table? Copy the convention at the bottom of
[`0001_tenancy.sql`](supabase/migrations/0001_tenancy.sql). Both `USING` and
`WITH CHECK` are required: `USING` alone lets a caller insert rows into a centre
they cannot read, and the row then vanishes from their own view, so the bug is
invisible in testing.

## The second boundary: guardianship, not just tenancy

Everything above concerns one boundary — centre against centre. Phase 1 introduced
a second one that lives *inside* a single centre, and it is the more dangerous of
the two, because `parent` is a role within the tenant.

A parent at Little Pearls Mt Albert is a legitimate member of that centre. They
must see their own child's allergies and must never see the child sitting next to
them. A policy keyed on `centre_id` alone satisfies every test written before
Phase 1 and hands one family another family's medical records.

Three predicates carry it, all `SECURITY DEFINER` for the same reason
`caller_centre_ids()` is — they read tables that are themselves under RLS:

| Predicate | Answers |
|---|---|
| `caller_staff_centre_ids()` | centres where the caller is owner/manager/educator |
| `caller_ward_ids()` | children the caller is a guardian of |
| `caller_guardian_ids()` | the caller's own guardian records |

**Each one joins to a live membership.** Revoking a parent's access therefore
closes their own child's record immediately. Guardianship is recorded on the
guardian row and would otherwise outlive the access — it reads as obviously
handled and is not, so the suite asserts it.

Three decisions inside that model are worth not re-litigating:

**Custody arrangements are their own table.** They could have been a column on the
whānau record. They are not, because the visibility rule runs the opposite way to
everything around it: a custody arrangement is a record *about* the guardians, so
it must not be readable *by* them — including the guardian it concerns. "Father is
not to collect, parenting order in place" is information the centre needs and the
other parent must not read in the app. A policy cannot restrict some columns of a
row to one role and other columns to another, and a column-level `GRANT` cannot
vary by role either. A separate table says it once and cannot be got wrong by
somebody adding a field later. Educators cannot read it either — what they need is
on the collection list.

**A parent sees only their own guardian record, not co-guardians.** Not tidiness:
in a domain where separated parents and protection orders are ordinary, an app that
hands one parent the other's current phone number and address on request is a
safety problem. Staff see the whole list, which is who needs it.

**Consent is events, not state.** "Do we have photo consent" and "did we have photo
consent in March, when we published that newsletter" are different questions, and
only the second matters once somebody complains. So `consent_events` is append-only
— withdrawal is a new row — with `current_consents` as the view and
`has_consent(child, kind)` as the check. That function is `security invoker`, so a
caller who cannot see the child gets `false` and the write is refused. Failing
closed is the only safe direction for a question about a photograph of a child.

Consent is also **three-state in the UI**, because "refused" and "never asked" are
both falsy and are completely different facts: one is a decision to respect, the
other is an enrolment that is not finished. And `photo_internal` is separate from
`photo_public` — families who agree to the private journal routinely refuse
Facebook, and one flag forces the centre to either over-collect or over-share.

## Auditing is a trigger, not a convention

`0003` gave the audit log its guarantees and a `record_audit()` helper for the
application to call. That was the weak part: an audit entry the application has to
remember is one that will eventually not be written, and the omission is invisible
— the screen works, the data saves, only the log is wrong. Which is discovered
during a licensing review.

So `0005` records writes with a trigger on every consequential table. `packages/api`
contains no audit calls at all, deliberately.

`detail` holds column **names, never values** — `{"changed": ["severity"]}`. A
generic trigger logging `to_jsonb(NEW)` would copy every allergy and every custody
order into a table nobody thinks of as holding them, and audit rows outlive the
records they describe. Asserted both ways in the suite: that the trigger fired
without being asked, and that no medical value reached the log.

Not applied to the high-volume append-only tables Phase 2 adds. An audit row per
attendance event doubles the write volume of the busiest table in the product to
record something the table already records; append-only data is its own audit trail.

## RLS is the second check, not the first

Postgres tests the table privilege before it evaluates any policy. So there are
two layers, and they fail in opposite directions:

- **No `GRANT`** → `permission denied for table x` for every real caller. The
  policies are perfect and unreachable.
- **`GRANT` wider than the policies contemplate** → writes nothing checks.

Both migrations therefore state their grants explicitly, including for
`service_role`, rather than relying on the `ALTER DEFAULT PRIVILEGES` a stock
Supabase project ships with. That dependency is invisible in the migration files
and disappears the moment the schema is recreated — which is exactly how it was
found: `drop schema public cascade` took the default ACLs with it and every
policy in `0001` became unreachable at once.

Two places where the grant does work a policy cannot:

- **Column-scoped grants.** A policy restricts which *rows*; only a grant
  restricts which *columns*. An owner may change their centre's name and Ministry
  number, but not its `slug` (it appears in URLs) or `archived_at`. A member's
  `role` and `revoked_at` are updatable; `centre_id` and `user_id` are not, which
  makes "move this membership to another centre" impossible to express rather
  than merely refused.
- **`audit_events` withholds UPDATE and DELETE from everybody**, including
  `service_role`. The service key otherwise defeats every protection in this
  schema — it can read every centre's children in one query. It does not also
  have to be able to rewrite the record of what it did. The only credential that
  can alter that table is the database owner, which is in no application's
  environment. That is the difference between a log and evidence.

## The service-role key is the one thing that breaks all of this

It bypasses RLS entirely — it can read every centre's children in one query. It
exists for tenant onboarding and scheduled jobs.

- Never in the mobile workspace. Expo inlines every `EXPO_PUBLIC_*` value into
  the shipped binary.
- Never in a browser bundle.
- In the web app it is `serviceDb()` in `apps/web/src/lib/supabase.ts` —
  deliberately not the default export and not wrapped in anything convenient, so
  every use is visible in review.

## Decisions worth not re-litigating

**Expo 57 / React Native 0.86 / React 19.** Expo 55 and 56 peer-require React
18, which cannot coexist with Next 15 in one hoisted workspace. Sharing a query
layer between the two apps is only worth having if both agree on React.

**Expo modules are versioned `57.x`, matching the SDK major.** Not the
independent `~14.2.4` / `~0.31.5` scheme used up to SDK 53 — StoreDash predates
the change, so don't copy its version ranges.

**`expo-secure-store`, not AsyncStorage,** for the auth session — following
StoreDash. AsyncStorage is an unencrypted file, and this token authorises reads
of children's names, health notes and custody arrangements. SecureStore caps a
value at 2048 bytes and Supabase sessions can exceed it, so
[`secureStorage.ts`](apps/mobile/lib/secureStorage.ts) chunks across numbered
keys and writes the count last, so an interrupted write forces a clean re-login
rather than reconstructing a truncated token.

**`metro.config.js` needs `watchFolders` and `nodeModulesPaths`.** Metro does not
look outside the app directory, and without both, `@ece/core` fails at bundle
time with an error that never mentions workspaces.

**A person can belong to several centres.** A manager of a two-site operator, or
a parent with children at two services. So `activeCentreId` is explicit state
and is never inferred when there is more than one choice — guessing is how
somebody posts a notice to the wrong centre.

## The web app

```
/login            password sign-in
/no-access        signed in, no membership yet — a waiting room, not an error
/select-centre    shown only when a person belongs to more than one centre
/                 overview
/children         the roll for staff; a parent's own child only, from the same query
/children/new     enrol a child
/children/[id]    the record: details, health, whānau, enrolment, consent, custody
/members          roster: change role, revoke
/settings         centre name and Ministry service number
```

`/children` is one route serving three quite different readers. A manager
maintains it, an educator reads it, a parent checks their own child — and each sees
a different amount without the page filtering for any of it. A parent who reaches
another family's URL gets a 404, because `getChild` returns null; "cannot see" and
"does not exist" are deliberately indistinguishable, since confirming that a child
exists at a centre you cannot see is itself a disclosure.

**The allergy flag is on the list row, not inside the record.** An educator
scanning a roll of forty needs to see "this one could stop breathing" without
opening anything, and a flag you have to click is a flag nobody reads. Every flag
carries a symbol *and* a word, never colour alone (WCAG 1.4.1) — about one man in
twelve cannot reliably separate the red from the green, and on a sun-washed tablet
in a playground nobody can.

Everything under `(app)` runs `requireCtx()` in the layout, so there is one place
that decides "who is this and which centre are they looking at" rather than a
check per page — which is how one page ends up rendering for a signed-out user.

**The active centre lives in a cookie, and the cookie is a preference, never a
grant.** Every request re-checks it against live memberships and discards an
unrecognised value. RLS would refuse the queries regardless; failing here just
produces a comprehensible screen instead of an empty one.

**Two guards worth keeping.** You cannot demote or remove the last owner: a
centre with no owner cannot be administered by anyone, including nobody who can
promote a replacement, so it needs service-role intervention to recover. Both
paths check `countOwners` first.

**Onboarding is a script, not a screen.** There is no INSERT policy on `centres`
and no INSERT grant on `memberships`, so a signed-in user cannot create a tenant
or add themselves to one. `npm run onboard` does it with the service role:

```bash
npm run onboard -- --name "Little Pearls Mt Albert" \
                   --slug little-pearls-mt-albert \
                   --owner manager@example.co.nz
# second site for the same person — "already registered" is a normal path
npm run onboard -- --name "Little Pearls Mt Roskill" \
                   --slug little-pearls-mt-roskill \
                   --owner manager@example.co.nz
```

It never sets or prints a password; it issues a single-use link and the person
chooses their own. It uses `generateLink` rather than `inviteUserByEmail` because
that returns the user id directly (there is no admin get-user-by-email, and
`listUsers` is a paginated search that returned a bare 500 on this project) and
because it does not require SMTP to be configured.

**An in-app invitation flow is still not built.** That is a separate thing from
the script above: it needs single-use tokens with expiry, because the self-serve
version of "add a person" is how a stranger joins a centre.

## The database

Supabase project `qdgforljvddgrxxymtug`, Postgres 17.6. It previously held an
unrelated application ("Zelva" — halal food scanning, Shariah stock screening,
zakat calculation, a community forum) which was dormant and is not coming back.
The `public` schema was dropped and rebuilt from these migrations.

Two things to know about that:

- **A pre-wipe backup exists** at `.backups/zelva-pre-wipe-2026-08-04.json` — 34
  tables, 6,184 rows, mostly curated reference data. It is gitignored and must
  stay that way: it contains user emails and forum posts, i.e. personal data.
- **`auth.users` was not touched**, and still holds six accounts from that
  project. They were left deliberately: deleting an account is the most
  destructive operation available here, the backup captured ids and emails but
  not password hashes, and a stale account is harmless — it signs in and lands on
  `/no-access` with no membership. Worth clearing before this database sees real
  centres, as a separate deliberate act.

Auth config was repointed off Zelva's Railway domain, and `disable_signup` is on:
nobody self-registers into this product, and an account with no membership is a
dead end.

## Decisions made while building this

**Mobile stays in this repo.** The shared `packages/api` is the reason. Split the
repos and the queries get written twice; a duplicated query diverges, and the
copy that diverges is the one that forgets a filter. StoreDash is standalone
because it has no web counterpart sharing logic — it calls shop-platform's API.
The cost here is fiddlier EAS builds, paid once; the cost of splitting is a
correctness risk paid forever.

**`dotenv-cli` wraps the Next scripts.** Next only reads `.env.local` from the
app directory, so in a monorepo the root file is silently ignored — and the
failure is delayed, because `next build` succeeds and only a real request fails.
`loadEnvConfig()` in `next.config.ts` is not enough: it populates `process.env`
while the config is evaluated but does not survive into the request path under
`next start`.

**Server actions that report errors need a client component.** A form `action`
must return `void`, so an action returning `{ error }` will not typecheck against
it. The roster and settings forms use `useActionState` — worth it, because "this
is the only owner" is the difference between a refused click and an unreachable
centre.

**`centre_members` needs two objects, not one view.** A view runs as its owner by
default, which over `memberships` returns every membership in the database to any
caller — the whole tenant boundary defeated by a helper written to display an
email address. So it declares `security_invoker = on`.

That alone does not work, and the first run of the RLS suite is what proved it:
with `security_invoker` the join to `auth.users` also runs as the caller, who has
no privilege there, so the view threw `42501` for everybody. Supabase's hint is
`GRANT SELECT ON auth.users TO authenticated` — which fixes the error by handing
every authenticated caller every email in the project.

The two requirements genuinely conflict: rows must be filtered as the *caller*, so
RLS is the boundary; the email must be read as the *owner*, because the caller has
no privilege on `auth.users` and must not be given one. So the single privileged
read is pushed into `member_email(uuid)`, a `security definer` function narrow
enough to audit in one screen, which re-checks the caller's membership itself
rather than trusting its call site — PostgREST exposes every public function over
RPC, so it is reachable without going through the view.

The alternative — a view without `security_invoker` filtering on
`caller_centre_ids()` in its own `WHERE` clause — also works and is worse: the
tenant boundary would then live in a `WHERE` clause somebody can delete while
simplifying a query, instead of in a policy.

**PostgREST bulk inserts do not apply column defaults.** It builds one `INSERT`
from the *union* of keys across the array, so a key present in one object and
absent from another is sent as an explicit `NULL`. Omitting `is_primary` on one row
of a three-row batch failed with "null value in column is_primary violates not-null
constraint" — which reads like a schema problem and is a client one. Give every
object in a batch every key. Found by `scripts/seed-demo.ts`, which was also
swallowing the returned error, so what actually surfaced was "the parent cannot see
their own child" two steps later.

## Demo data

```bash
ECE_ALLOW_DEMO_SEED=yes npm run seed:demo            # five children across both sites
ECE_ALLOW_DEMO_SEED=yes npm run seed:demo -- --purge # remove exactly what it made
```

Guarded, because it writes invented children into whatever database `.env.local`
points at and that database holds real records. Everything it creates is tagged
`Demo-Seed`, and the emails use the `.invalid` TLD, which RFC 2606 reserves and
which cannot resolve — so a stray notification can never reach a real person.

It seeds one anaphylaxis case with a response plan, one custody arrangement, a
parent account holding one child at a centre where another family is also enrolled,
and a mix of granted, refused and unanswered consents — which is the set needed to
see all three consent states and to check that the parent cannot reach the family
beside them.

## Open questions

- **Professional indemnity insurance is the remaining gate on real data.** The
  services agreement with Little Pearls is in place; the insurance is not. The
  schema and the screens exist and hold nothing but `Demo-Seed` rows, which is
  fine — writing the code puts nobody's information anywhere. The line not to
  cross without the cover is a real child's allergies being typed into it.
  Under-5 records are among the most sensitive personal information in the
  country, and a breach is notifiable under the Privacy Act 2020.
- **Retention and deletion are not built.** Children are archived, never deleted,
  and consent and audit rows are append-only by design — which means there is
  currently no answer to "delete everything about this child", and the Privacy Act
  gives a right to request it. The tension is genuine: retention obligations and
  audit integrity point one way, principle 6 and 7 requests the other. It needs a
  documented retention schedule and a deletion path that is deliberate rather than
  an `UPDATE` somebody discovers.
- **`photo_public` consent is recorded and not yet enforced anywhere**, because
  there is no media pipeline until Phase 4. `has_consent()` exists so that
  enforcement can live in SQL when it arrives, rather than in a check somebody
  remembers to write.
- **Whether mobile should be its own repo.** StoreDash is a separate repo.
  Keeping it here buys one shared query layer; splitting it would simplify EAS
  builds. Reversible either way.
- **Stage 0 of the product plan was never run.** The plan in the `salix` repo
  (`llm-wiki/wiki/possible-projects/ece-early-learning-app.md`) called for ten
  conversations with centres before any code, and argued for a licensing-evidence
  tool ahead of enrolment on the grounds that Ministry ELI integration is closed
  to new vendors and Storypark anchors price at NZ$1.89/child/month. Phase 1 built
  enrolment anyway, on the strength of one pilot customer. That is a defensible
  call for a free pilot and a weak basis for pricing.
