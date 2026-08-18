# ece

Multi-tenant platform for New Zealand early learning services. One web app, one
mobile app, one deployment serving every centre.

```
apps/web        Next.js 15 — admin and staff web
apps/mobile     Expo 57 / React Native — whānau and educators
packages/core   types, roles, capabilities. No Node, no Next, no React Native.
packages/api    the only place either app talks to Supabase
packages/ai     the only place anything talks to an external model. Server-only.
supabase/       migrations. RLS is the tenant boundary.
docs/           what a centre reads, plus the runbooks: privacy, retention, breach, deploy
llm-wiki/       why decisions were made, and what is asserted but unverified
```

**Working on this with an agent?** Start at [AGENTS.md](AGENTS.md), then
[llm-wiki/wiki/unverified-claims.md](llm-wiki/wiki/unverified-claims.md) — the register of
everything this product asserts that nobody has checked. [LOGS.md](LOGS.md) is the
session-by-session narrative.

```bash
npm install
cp .env.example .env.local     # fill it in first

npm run migrate                # apply pending migrations
npm run dev:web                # http://localhost:3000
npm run dev:mobile             # Expo

npm run typecheck              # four workspaces, plus the e2e project
npm run lint
npm test                       # unit tests
npm run test:rls               # tenant isolation — 176 assertions
npm run test:e2e               # e2e + WCAG 2.2 AA audit + the role matrix, 44 checks
npm run tokens:check           # generated CSS matches the shared tokens
npm run check:docs             # every documentation link resolves
npm run check:bundle           # performance budgets, in gzipped bytes
npm run review:security        # 16 checks against the live schema
npm run build                  # web

npm run onboard                # create a centre and its first owner
npm run sweep:audit            # drop audit tenants a killed test run left behind
npm run drill:restore          # extract every table, reload it, compare
npm run drill:rowcap           # 1,200 events: prove the funding read is not truncated
npm run deploy:auth            # point Supabase Auth at the deployed app
```

CI runs all of those on every push. `.github/workflows/ci.yml` keeps the RLS suite in
its own job, because a red cross there means something different from a failing unit
test: it means one centre can reach another centre's children.

## Migrations

```bash
npm run migrate                  # apply anything pending
npm run migrate -- --status      # show state, change nothing
npm run migrate -- --baseline    # record as applied WITHOUT running (adopting an existing db)
```

Applies each file once, in order, and records a checksum. **If a migration changed
after it was applied it refuses to continue** rather than guessing — that means the
database and the repo disagree about the schema, and only a person knows which is
right.

The runner is also what proved the migrations replay cleanly against a populated
database. It found one that did not: 0004 recreated `current_consents` with
`create or replace`, and once 0006 had added a column to that view, replaying 0004
died with "cannot drop columns from view". Both now drop and recreate.

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
/attendance       present roll, live ratio, sign in and out, time corrections
/posts            pānui, daily updates, learning moments; media, consent-gated
/messages         threads between kaiako and whānau, append-only
/compliance       staff records, ratio history, criteria gaps, evidence
/funding          RS7 preparation figures — preparation only, never a submission
/compliance/binder  one dated document for a reviewer
/members          roster, invitations
/applications     applications for employment — owner and manager only
/invite/[token]   accepting an invitation — outside (app), no membership yet
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

**Adding the fifth educator is a form, not a script.** `/members` issues an
invitation; the person sets their own password and joins. A manager should be able to
do that on a Tuesday without anybody's laptop.

**Only the SHA-256 of each token is stored.** A leaked backup, an errant service-role
query or a support person with dashboard access then yields nothing usable, because
the tokens themselves exist only in the emails they were sent in — the same reasoning
as never storing a password. The consequence is that a link cannot be recovered:
losing it means issuing a new one, which supersedes the old.

The manager who created an invitation cannot read the hash back either. That is a
column-level `GRANT`, and it is the only mechanism that can express it — there is no
reason for a browser to hold those values.

Three checks on acceptance, none optional:

- **The token matches something live** — not accepted, not withdrawn, not past seven
  days.
- **The signed-in email is the invited one.** Without this the link is a bearer token
  for access to children's records, and a forwarded email — or one sitting in a shared
  inbox — becomes a way in. The cost is that somebody who signed up under a different
  address has to be re-invited, which is the right way round.
- **It has not already been used.** Claiming and creating the membership are two
  statements, so the claim is written first and made conditional on the row still
  being unaccepted. Two simultaneous clicks cannot both win.

Signups are disabled on the project, so an invited educator cannot create an account
for themselves — which makes the invitation the authorisation. Possessing a token
sent to a mailbox is proof of holding that mailbox, exactly what an email
verification link proves, so acceptance creates the account with the address already
confirmed. The account is created *before* the invitation is claimed: the other order
leaves a failed signup with a spent invitation and somebody locked out.

**No email is sent**, because no mailer is configured. The link is shown to the
manager once, to pass on however they already talk to their staff. Saying that
plainly beats a "we've sent an email" that never arrives; wiring a mailer changes one
function.

## The database

Supabase project `qdgforljvddgrxxymtug`, Postgres 17.6. It previously held an
unrelated application ("Zelva" — halal food scanning, Shariah stock screening,
zakat calculation, a community forum) which was dormant and is not coming back.
The `public` schema was dropped and rebuilt from these migrations.

Two things to know about that:

- **A pre-wipe backup existed** at `.backups/zelva-pre-wipe-2026-08-04.json` — 34
  tables, 6,184 rows, six user accounts and their forum posts. **Deleted 2026-08-05.**
  It was gitignored, so it never reached git, and it never left local disk either:
  an earlier version of this note claimed it sat in a OneDrive folder and had
  therefore been copied to Microsoft, which was wrong — this repository is at
  `C:\dev\ece`. `.gitignore` still covers `.backups/` so the next one is also
  kept out of git.
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

## Attendance, and the ratio

The feature that makes the app open every morning, and the reason the offline design
exists.

**Append-only, for a different reason than the audit log.** `audit_events` is
append-only so it cannot be doctored. `attendance_events` is append-only because it
makes offline sync tractable: a sign-in is an event that happened at a moment, so two
tablets in the same room cannot produce a conflict. There is nothing to merge, only to
order and de-duplicate — which is the entire reason PowerSync, ElectricSQL and
WatermelonDB are not in this project. Conflict resolution is the expensive part of
offline, and append-only data has no conflicts. A correction is a new row pointing at
the one it corrects, with a reason.

**`client_uuid` is the whole idempotency contract.** Generated on the device *before*
the first attempt and reused on every retry. A flush whose response was lost retries
the same key, and the unique constraint turns the second attempt into a no-op rather
than a second sign-in. `recordAttendance` uses `ON CONFLICT DO NOTHING` and reports
`duplicate` instead of throwing, so the device never has to parse an error message to
work out whether its write landed.

**`at` comes from the client, and has to.** A sign-in made in the carpark with no
signal and flushed forty minutes later happened at 8:05, not 8:45 — and attendance
times decide funded hours. So the device states the time and the database sanity-checks
it: two hours of clock skew tolerated, the future refused, backdating past a fortnight
refused.

**Nothing is stored as "present".** There is no `children.is_present` and there will
not be one. A counter drifts on a missed sign-out or a failed write, and drift in a
ratio does not report itself as broken — it reports itself as compliant. The roll is
derived from the events on every read, scoped to today in the *centre's* timezone.

### Merging the queue with the server

[`buildRoll`](packages/core/src/roll.ts) is pure and tested, because it is the part of
offline that is easy to get subtly wrong. The rule: for each child, whichever event is
**latest by its own timestamp** wins, server or queued.

Neither obvious shortcut works. "Queued wins" leaves a child signed in offline at 8:05
showing present all evening after they were signed out on a working tablet at 15:00.
"Server wins" loses the offline sign-in entirely. Ordering by the event's own time is
also what the database does deriving `attendance_today`, so the device and the server
*converge* rather than merely resemble each other — asserted directly.

**Queued sign-ins count toward the ratio.** Not a UI nicety: if an offline sign-in were
invisible to the ratio, an educator would see fewer children than are in the room,
which is wrong in the dangerous direction.

### The outbox

[`apps/mobile/lib/outbox.ts`](apps/mobile/lib/outbox.ts), on `expo-sqlite`. Three
properties matter, and the third is the one that gets forgotten:

1. The key is generated once, at enqueue — never per attempt.
2. Queued events are readable, so the ratio can count them.
3. **A permanently refused write is not retried forever.** A queue re-sending something
   the server will always refuse is a jammed queue that blocks everything behind it.
   Postgres says which kind of failure it was: `23514` (aged past the time window),
   `42501` (membership revoked) and `23503` (the child was purged) are permanent and get
   set aside for a person; anything else is transient and stays queued. Discarding one
   takes a deliberate act, because attendance silently going missing is the failure this
   whole mechanism exists to prevent.

A tap writes locally and returns — no spinner, no disabled button. On a bad connection
those make a working app feel broken, and the write has genuinely already succeeded
locally; the card carries a "not sent yet" badge instead. A flush runs on mount, on
return to the foreground, and after each tap. There is no connectivity library, because
the flush attempt *is* the connectivity check.

### Ratios: verified 2026-08-18, and the reading found a missing row

**`RATIO_TABLES_VERIFIED` is `true`.** The bands in
[`ratios.ts`](packages/core/src/ratios.ts) were checked row by row against Schedule 2 of
the Education (Early Childhood Services) Regulations 2008 as at 29 June 2026, and **every
published row matched**. This was the repo's highest-priority open item for four months,
and it closed on the boring outcome.

What it was not boring about: Schedule 2 carries a row this product did not have — *up to
3 children of mixed ages need one adult*, not the sum of the two bands. Two infants and a
three-year-old were being reported as a breach in a room that is legal. A unit test had
the wrong behaviour written into it as an assertion; both are corrected. An indicator that
calls a compliant room non-compliant is one people learn to dismiss, and dismissing it
costs precisely the morning it is right.

A second correction, to this file: the two bands are computed separately and summed, which
this README used to call "the conservative reading". Summing is not a reading — the
schedule states it outright. The guess was right and the reason given for it was invented.

**The blanket notice is gone and a narrower one replaced it.** Leaving "these figures have
not been checked" on screen after they had been checked would be a false caveat, which
teaches people that the warnings on that screen are decoration. What stays true is about
the *inputs*: Schedule 2 counts every person present aged under 6 — including a staff
member's own child, who is on no roll — and an adult does not count while on a break. The
product counts enrolled children who signed in. `ratioInputCaveat()` says so wherever a
ratio appears, and it does not go away by checking a number.

Sessional and home-based tables are still not modelled, and neither are the regulation 44A
set-off nor the regulation 54(4) sibling rules — all tagged `TODO(ratios)`. The last two
make the requirement *lower*, so omitting them asks for more adults than the law does,
never fewer.

The maths is tested independently of the numbers, and the tests say so: a green suite
means the bands are *applied* correctly. What says they are *right* is the transcription
in the commit, plus a test that reproduces every printed row of the schedule.

Three states, because two are not enough. `breach` reports the shortfall, since "you
are non-compliant" is not actionable. `at-limit` is the one worth building — **the
warning has to arrive while the parent is still at the door**, not after the child is in
the room. An empty, unstaffed room is `ok` rather than `at-limit`: it satisfies "one
more child would need an adult" trivially, and an indicator that cries wolf on a closed
centre is one people learn to ignore.

The two age bands are computed separately and summed. Schedule 2 publishes different
tables depending on whether under-2s are present at all, so summing is the conservative
reading — if verification finds the combined figures lower this becomes generous rather
than wrong, which is the right direction for the error to run.

### How many adults

[`0010`](supabase/migrations/0010_staff_present.sql) records it as an append-only event
rather than holding it in a cookie, and that is deliberate. Phase 3 treats ratio history
as licensing evidence, and a ratio you cannot reconstruct for 10:40 last Tuesday —
because half of it was in somebody's browser — is not evidence of anything.

It is a count entered by a person, not derived from staff sign-in. Individual staff
attendance means rosters, qualifications and who counts while on a break: a real feature
belonging with centre operations rather than smuggled in here. An unrecorded count reads
as **zero**, which makes the room show a breach — the failure direction somebody notices
and fixes, rather than silently assuming yesterday's staffing.

### The offline drill

```bash
ECE_ALLOW_DEMO_SEED=yes npm run drill:offline
```

No credential needed. The drill provisions its own `.invalid` educator account on the demo
centre and sets a fresh random password each run — it used to demand `ECE_DRILL_PASSWORD`, a
named person's real account password, which cannot be recovered from Supabase (passwords are
bcrypt hashes) and could never have run in CI. Set `ECE_DRILL_PASSWORD` and `ECE_DRILL_EMAIL` to
drill as a real person instead.

Replays what the outbox does — keys fixed up front, the same keys reused, a flush
repeated — against the real database, and checks that exactly three events land, keep
the time they happened, that two devices agree, and that a 20-day-old event is refused
with a code the outbox classifies as permanent.

**It does not exercise `expo-sqlite`.** That needs a device, and a real airplane-mode
drill on a tablet is still required before Little Pearls uses this.

Writing it turned up something worth keeping. The script's first version began by
deleting the day's events with the service role and silently did nothing, because 0009
grants `service_role` select and insert only — attendance is append-only against the
application's most privileged credential too. The fix was to assert on the run's own
keys, not to widen the grant.

## Compliance and licensing evidence

```
/compliance          staff records by exposure, ratio history, criteria gaps, evidence
/compliance/binder   one dated document to hand a reviewer
```

### This ships with no licensing criteria in it, on purpose

The criteria for a centre-based service run to several dozen numbered items and were
renumbered in 2026. This repo does not contain them, and **nothing seeds them**. Inventing
plausible criterion numbers would produce the worst available outcome for this feature: a
centre assembling an evidence binder against a list that looks official and is not.

So the machinery is built and the content is loaded from a file somebody has checked:

```bash
npm run import:criteria -- criteria.json --make-current
```

The file must carry a `source` — where the criteria came from and when — because a set
with no provenance cannot be relied on in a binder, and the importer refuses without one.
Each entry can carry `supersedesCode`, the old-to-new mapping. The plan called that
mapping the actual moat and it is: a centre with three years of evidence filed against the
previous numbering needs it to stay findable.

**The empty state says so, loudly.** A gap list with no rows reads as a clean bill of
health, which is the exact wrong message, so the dashboard explains what is missing and how
to load it. Same reasoning as `RATIO_TABLES_VERIFIED`, applied more strictly — there is no
defensible approximation of a criterion number.

### Ratio history is the evidence this product generates

Everything else in a binder is a document the centre already had. This is the one thing the
software produces by being used: Phase 2's attendance and adult counts replay into a ratio
record, so "we maintained ratios" becomes answerable from data a centre generated by
signing children in. That is the whole argument for building attendance before compliance.

[`replayDay`](packages/core/src/ratioHistory.ts) is a **replay, not a sample**. Checking
the ratio every fifteen minutes and storing the result is wrong twice: it stores derived
data that can drift from the events, and it misses breaches shorter than the interval —
which are exactly the ones that happen, because somebody notices and fixes it. The ratio is
a step function, so replaying the events in order produces every distinct state with no
gaps.

Three details that matter more than they look:

- **Ages are computed as at the date replayed.** A child who turned two in March was in the
  under-2 band in February, and a report using today's ages rewrites history in the
  centre's favour.
- **A breach still open at the last event stays open.** `minutesInBreach` is `null` rather
  than a total that silently omits it, because a total that omits an open breach reads as a
  clean day.
- **A child with no date of birth is still counted**, banded as over 2. Omitting them would
  understate the roll and flatter the ratio; the weaker band is the honest direction for an
  assumption.

The day window is converted through `Intl`, not a fixed offset — New Zealand moves between
+13 and +12, and [the tests](apps/web/src/lib/__tests__/dayWindow.test.ts)
assert a 23-hour day in September, a 25-hour day in April, and no gap or overlap between
consecutive days across both transitions. Getting that wrong attributes a whole morning to
the previous date.

### Staff records: expiry, and whether anyone looked at the document

No validity periods anywhere in the schema. Each record carries the `expires_on` printed on
the actual document, because how long a certificate lasts depends on the issuer and the
course, and hard-coding a duration would silently overwrite what the paper says.

What *is* configured is the **warning lead time**, per kind — and it differs because
*renewal* takes different amounts of time, not because certificates last different amounts
of time. Police vetting goes to NZ Police and takes weeks, so a 30-day warning arrives too
late to act on; a first aid course can be booked in a fortnight.

**Sighting is a separate axis from expiry.** "We have a certificate number" and "somebody
looked at the original" are different claims, and only the second survives a review. So a
current-but-unsighted record shows two flags and sorts with the problems.

Sorted by **exposure**, which the plan asked for and which is not the same as by date: an
expired police vetting outranks a first aid certificate lapsing next week, even though the
date is further away.

**An educator can read their own record and nobody else's.** Not a convenience — a vetting
result is personal information about the person it concerns, and IPP 6 gives them a right of
access to it. A policy that hid it from them would put the product in the way of a statutory
right. They cannot edit it, which is a different question.

No `DELETE` on staff records or evidence. A lapsed certificate quietly removed is
indistinguishable from one that never existed, and "we held a current first aid certificate
in March" is what a review asks.

### The binder is a print stylesheet, not a PDF library

Every browser prints to PDF, which is what was asked for, and this costs no dependency, no
headless Chrome in the deployment, no font bundling, and no second rendering path that
drifts from the screen. `puppeteer` would add a few hundred megabytes to a container to
re-render HTML the browser already has. What it gives up is server-side generation — nobody
can email this on a schedule — and when that is wanted, this page is the thing to render.

**It does not say "compliant" anywhere.** It opens by stating what it is derived from and
what it cannot show: that ratio history comes from sign-in events, so a child who was
present but never signed in does not appear; that adult counts are figures entered by staff;
and that the ratio thresholds have not been verified. A binder is read by somebody deciding
whether to believe the centre, and a document that overstates its own evidence is worse than
one honest about the gaps — the gaps are what a reviewer finds anyway.

## Consent-gated media

Phase 1 recorded consent decisions. Phase 4 is where they decide whether a photograph of a child may
exist. `media.audience` picks which consent applies — `journal` needs `photo_internal`, `public`
needs `photo_public` — which is what finally makes the two-kind split earn its place.

**Two mechanisms, not one.** A trigger on `media_children` refuses the attachment with a message that
names the child and says what to do. A **restrictive** policy on `media` re-checks on every read, so
withdrawing consent hides existing media immediately and retroactively, with no cleanup job and no
cache to invalidate. Either alone fails: a trigger lets a withdrawal do nothing, and a policy alone
leaves a silent gap and a file in storage.

**It applies to staff as well as whānau.** A photo a family has withdrawn consent for is not one an
educator should be browsing either.

**The gate reaches the file.** The bucket is private and reads go through short-lived signed URLs, so
after a withdrawal a signed URL cannot be *issued* — verified for both staff and the parent. A public
bucket would serve any object to anybody holding the path, which for photographs of children is a
disclosure rather than a setting.

### The RLS trap this uncovered

The first version put the consent check inside the permissive `media_select` and separately declared
`media_write` as `FOR ALL`. `FOR ALL` covers SELECT, and permissive policies are **OR-ed** — so
staff matched the write policy and the consent condition never had to be satisfied. It hid correctly
from whānau and not at all from educators, which is exactly why it survived a first review.

`0015` splits the write policy and moves consent to a restrictive policy, which is AND-ed with every
permissive one and cannot be routed around by adding another. **The rule for this schema: a condition
that must hold for every reader belongs in a restrictive policy; a condition about which readers
belongs in a permissive one.** Every other `FOR ALL` policy was re-read; all are narrower than their
matching select policy, so `media` was the only one with the dangerous shape.

The restriction is SELECT-only on purpose — staff must be able to *delete* media they can no longer
read.

### Push notifications are built and have never run

The model, the preferences and the quiet-hours arithmetic exist and are tested, including the case
usually written wrongly: a window that wraps midnight (20:00 → 07:00), evaluated in the centre's
timezone across both sides of the daylight-saving switch. **No notification has ever been delivered**
— that needs an EAS build, a device, and a worker reading the queue. Listed in
[unverified-claims](llm-wiki/wiki/unverified-claims.md).

Queue rather than send-inline, so publishing a pānui to forty families does not make an educator wait
on Expo's API and cannot half-succeed — and so a notification held until 7am has somewhere to live.

## Funding: nothing is estimated

Hours become a claim on the Crown, so the organising rule of this phase is that the calculation never
guesses.

A day with a missing sign-out is **excluded and named**, not estimated up (a false claim) and not
silently zeroed (which loses the centre funding it is owed and hides the record error). The export
lists the dates so a manager can fix them and re-run, and shows what resolving each is worth without
claiming it. Every rounding decision floors: `toHours(59)` is `0.98`, because a hundredth of an hour
per child per day is still over-claiming.

Two orderings that are easy to get backwards:

- **The daily cap is applied before the weekly one.** An 8-hour Monday and a 4-hour Tuesday give
  `min(8,6)+min(4,6)=10`, then `min(10,20)=10`. Weekly-first gives 12 — two hours nobody was entitled
  to, because Monday's excess is not transferable.
- **Corrections are resolved transitively.** A correction supersedes what it corrects; without that,
  a fixed sign-in time is counted twice.

`FUNDING_RULES_VERIFIED` is `false` and the export says so. **There are no funding rates anywhere in
this product** — a rate is a number the Ministry publishes and changes, and inventing one would let a
centre budget against a figure this product made up.

### RS7 preparation, never submission

Submitting a funding return requires being a Ministry-approved student management system integrated
with ELI, and the Ministry is not accepting integration applications — still under review as at
2026-08-18, on the Ministry's own word, with no published end date.

**A correction, 2026-08-18.** This paragraph used to end: *"and approval requires supporting 50
services before applying. That is the one thing the regulatory position genuinely forecloses."* The
Ministry has now answered the question directly: **the product must be *capable* of supporting a
minimum of 50 services across the licence types.** It is a capability requirement, not a customer
count, so nothing here is foreclosed by having one pilot centre — the barrier is a review with no
end date, which is a different thing from an unreachable threshold. The wrong reading is recorded
rather than erased because it is why an ELI integration sits under "deliberately not doing this" in
[docs/roadmap-phases-8-13.md](docs/roadmap-phases-8-13.md).

What is still **unconfirmed** is the premise underneath all of this: whether a licensed service may
keep its Chapter 6 enrolment, attendance and absence records in software that is not an approved
SMS and key its figures into ELI Web itself. That was asked and was not answered — the reply
addressed vendor integration instead. See
[unverified-claims item 37](llm-wiki/wiki/unverified-claims.md).

So every label says "preparation" and none say "return", "submit" or "file". A screen that looks like
it filed something is a screen after which nobody files anything. Funding *periods* are chosen by the
operator, because the Ministry's boundaries are published figures this product does not know and a
guessed date range on an official-looking total is worse than asking.

### Invoices come from bookings, funding from attendance

Two sources pulling opposite ways, which is why they are separate tables. A family is charged for the
days they **held**, because a centre cannot resell a Tuesday somebody did not turn up for. The Crown
pays for hours **delivered**.

**Stripe is not built, deliberately.** The pilot is free, so payment collection is speculative work
against an unknown flow; most centres already collect through their accounting system or bank; and
Stripe's real decisions — disputes, refunds, a live account in the centre's name — are not decidable
while the price is NZ$0. `payments` records money that arrived; wiring Stripe later adds a source
column and a webhook.

An issued invoice **freezes**: the write policy on lines requires `status = 'draft'` on insert,
update **and delete**, **and** a trigger refuses to put the status back — because changing what a family was billed after they were
billed it is a different invoice, not an edit. The trigger is the half that was missing until the
Phase 6 security review; the line policy alone was defeated by three ordinary statements. A credit is
a negative line rather than a second table, so the total is a sum and cannot disagree with itself.

```bash
ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=... npm run reconcile:funding
```

Writes a fortnight whose answer is hand-arithmetic in the script's comments and compares. 13/13.

## Retention and deletion

**A correction first.** This README previously said the Privacy Act 2020 "gives a
right to request" deletion. It does not. The Act gives a right of **access** (IPP 6)
and a right to request **correction** (IPP 7). There is no general right to erasure
in New Zealand law — that is GDPR Article 17 and it does not apply here.

What the Act does impose is **IPP 9**: personal information must not be kept for
longer than it is required for the purposes for which it may lawfully be used. That
is an obligation on the centre discharged by following a retention schedule, not an
endpoint an individual triggers. The design follows from that distinction.

```sql
select * from children_due_for_purge(7);           -- the scheduled sweep
select purge_child('<uuid>', 'reason, recorded');   -- the exception
select purge_orphaned_guardians('<centre uuid>');   -- contacts with no children left
```

`purge_child` is the most destructive thing in the product, so: **owners only**,
**archived children only**, and **a reason is required** and written to the audit log
before anything is deleted. The archived-only rule is the important one — it is the
guard against "delete this child" being used to remove a record that has become
inconvenient while they still attend, which after an incident is the scenario worth
designing against.

**Retention periods are a parameter, not a constant.** The default is seven years
from the date a child leaves, on the assumption that funding-relevant records have to
survive a Ministry funding audit. That figure needs checking against the current ECE
Funding Handbook before it is used on real records, which is exactly why it is an
argument rather than a compiled-in number.

**Why purging is possible at all, given an append-only audit log.** Because of the
decision in 0005 to record column names and never values: the audit trail holds no
personal information about a child, only "somebody changed `health_conditions` on this
date". So a record can be destroyed while the evidence that it existed — and that it
was deliberately deleted, by whom, and why — survives. Had the trigger logged
`to_jsonb(NEW)`, this would be impossible without also destroying the audit trail.
The suite asserts both halves: that the purge is recorded, and that no name or
medical detail survives in it.

## Error tracking

Sentry, and **inert without `NEXT_PUBLIC_SENTRY_DSN`** — nothing sent, nothing
queued, and `report()` still writes to the log so an unconfigured integration never
makes errors quieter than they were before it was added.

Two things about it are specific to this product rather than boilerplate.

**Scrubbing is not optional here.** An error report is a copy of whatever state the
app was in when it broke, and this app holds children's names, allergies, medication
doses and custody arrangements. Postgres is helpful in exactly the wrong way: a
constraint violation quotes the offending value back, so "Key (moe_nsn)=(123456789)
already exists" carries a Ministry identifier into the report. So `sendDefaultPii` is
off, breadcrumbs and request bodies are dropped, stack-frame locals are stripped, and
`beforeSend` redacts emails, phone numbers, dates of birth and quoted row values.
UUIDs are kept — they identify a row without describing a person, and they are what
makes a report actionable. [The scrubbing has its own
tests](apps/web/src/lib/__tests__/observability.test.ts), because a bug there does not
produce a wrong screen; it sends a child's medical information to a third party.

The same scrubbing runs on messages shown to the *user*, via `actionError` — same
rules for the screen as for a third party. Every action used to return `e.message`
raw, which put constraint values on screen and recorded the failure nowhere.

**The SDK is dynamically imported, and there is no `instrumentation.ts`.** Both are
measured decisions, not style. A static import put 75 kB into the shared client
bundle — every page, every visit, including a parent checking an allergy on mobile
data — for an integration doing nothing without a DSN. And Next's instrumentation
hook bundles into the **edge** runtime, which is what middleware runs: 91 kB → 176 kB
on every single request. The `NEXT_RUNTIME` guard does not help, because it is a
runtime check and the bundler still follows the import. Initialisation happens on
first `report()` instead. Net cost of adding error tracking: about 1 kB.

What that gives up is `onRequestError`, which forwards Next's own nested server render
errors. Those are still logged by Next, and the boundaries in `global-error.tsx` and
`(app)/error.tsx` report the cases a user actually sees. Worth revisiting if
middleware moves to the Node runtime.

## Design tokens have one source

`packages/core/src/tokens.ts` is it. The mobile theme reads it as data;
`apps/web/src/app/tokens.css` is **generated** from it by `npm run tokens`, and
`npm run tokens:check` fails CI if the committed file drifts.

That check exists because the duplication was not hypothetical. `globals.css` kept its
own copy and the two had already diverged: the page background was `#fafaf9` against
`#faf9f7` in the tokens, and the muted grey was `#6b6b6b` — about a full contrast
point worse than the `#605d58` the contrast test was actually asserting. The tests
passed and the screens rendered the other values.

The generated file also carries the measured contrast ratios as a comment,
recomputed each time, so a change that breaks conformance shows up in that file's
diff as well as in a failing test.

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

## Production readiness

Three of Phase 6's deliverables are exercises rather than opinions: you cannot audit
accessibility by reasoning about it, verify a backup by believing in it, or delete a tenant
by intending to. Two of the three failed the first time.

### A centre could not be deleted. By anyone. Ever.

The end-to-end fixture creates a throwaway centre and drops it afterwards. The drop failed:

```
insert or update on table "audit_events" violates foreign key constraint
"audit_events_centre_id_fkey"
```

An *insert* failure, while deleting. Deleting a centre cascades to `children`, each of which
fires the audit trigger, which inserts a row whose `centre_id` points at the centre that has
just been removed — so the foreign key rejects it and the transaction aborts. Not by an
owner, not by the service role, not by hand in the SQL editor.

Five phases had shipped with no way to offboard a customer. Nothing in the type system, the
policies or the RLS isolation suite could have surfaced it, because none of them tries to
delete a tenant.

`0020_offboarding.sql` drops the foreign key, and that is a correction rather than a
workaround: `audit_events` is an append-only ledger and **a ledger has to outlive its
subject**. It was also a genuine standoff — nobody may delete an audit row, not even
`service_role`, so no legal sequence of statements could have unblocked it. The column,
index and policy stay, so a surviving row names a centre that no longer exists and is
invisible to every authenticated caller.

No `purge_centre()` and no button: removing a tenant is a runbook
([docs/offboarding.md](docs/offboarding.md)), because a self-destruct control in a product
used by tired people at 5pm is a support incident with a countdown on it.

### The accessibility audit runs on loaded screens, not empty ones

```bash
npm run test:e2e     # builds, then 44 checks: 19 screens, four roles, the journey
```

19 screens, two roles, a production build, in a real browser — including the new-child form
*showing its validation errors* and the login form *showing its error*, because error states
are where labelling breaks and they are never audited if the audit only sees a pristine form.

The fixture seeds its own tenant, and it seeds it **loaded**: a child with an anaphylaxis
plan and one consent withheld, one signed in an hour ago so the ratio bar has something to
assess, three staff records covering expired / due-soon / current so all three flag colours
are measured, a thread with messages, a live invitation. axe cannot find a contrast failure
in a table with no rows, and every screen here has an empty state that passes trivially.

Two centres rather than one, because `requireCtx()` auto-selects with a single membership
and `/select-centre` would never be audited. **Media is deliberately not seeded** — that
would mean writing to storage and cleaning it up, and a failed clean-up leaves a child's
photo in a bucket. So the images on `/posts` are not covered.

The gate is WCAG 2.2 AA, all six axe tags (2.2 AA does not imply the earlier ones, and
listing five silently narrows the audit). `best-practice` findings print but do not fail —
a gate nobody can satisfy is a gate somebody disables. Currently none of either.

**What it found:** `select-name`, critical. The role selector on the People screen had no
accessible name, and neither did its Save or Remove buttons. A sighted reader takes the
person's name from the cell to the left; a screen reader user heard "combo box, educator",
"Save, button", "Remove, button" — once per person, with nothing to say whose row it was. On
the screen that decides who can administer a centre.

What it does **not** cover is in [unverified-claims](llm-wiki/wiki/unverified-claims.md)
item 12: no screen reader, no keyboard-only pass. axe finds a third to a half of WCAG
failures.

### Performance is governed in gzipped bytes

```bash
npm run check:bundle
```

| Budget | Measured | Limit |
|---|---|---|
| First-load JS | 100.6kB gzip (342kB raw) | 106kB |
| First-load CSS | 2.0kB | 4kB |
| Middleware, **on every request** | 89.3kB | 94kB |

A Lighthouse score measures the machine that ran it. Bytes are deterministic and
attributable to a commit. The first-load figure agrees with what `next build` prints, which
is a check that the script measures the right files.

It is **not** a small number, and almost none of it is this app: React 19 and the App Router
runtime are ~98kB, and each page adds 142B–3kB. Movement means a dependency reached the
client. The middleware budget has history — a static Sentry import took it from 91kB to
176kB raw, on every request including 404s, to catch errors in a file that never throws.

The e2e suite measures the web sign-in round trip: **~930ms** click-to-present, including
the server action, RLS and the re-render. Honest, and slower than it should be. The plan's
100ms budget is a different number — the *mobile* optimistic write, which paints before the
network is involved and cannot be measured without a device build.

### The restore drill, and why the mutation test is the point

```bash
npm run drill:restore     # 35 tables, 2864 rows, 4/4
```

Enumerates every table **from the catalogue**, so a table added by a future migration is
covered without anyone remembering. Extracts every row as JSON to a file, sends it back,
reloads into a shadow schema built with `like … including all`, compares row counts and a
content fingerprint per table. Reloading uses `jsonb_populate_recordset` — handing Postgres
its own JSON back — so there is exactly one escaping rule in the file instead of a quoting
rule per type for timestamptz, `text[]`, jsonb, seven enums and a daterange.

Then it was mutated:

| Mutation | Result |
|---|---|
| A character appended to a **timestamptz** | Rejected at load, `22007`. Caught by the *type system*, not by the comparison |
| A character appended to **`attendance_events.note`** | Loaded, then **failed the comparison**, naming the table — one character, one column, one row, out of 485 |

The second is the one that mattered. Without it the comparison might have been comparing
something with itself, and a green run would have meant nothing.

What it does not prove is longer than what it does, and it is all in
[docs/backup-and-restore.md](docs/backup-and-restore.md): not Supabase's own backup files,
not `auth.users`, not Storage, and not the policies — which come back from the migrations,
a *stronger* guarantee, because a restored dump gives the policies that were in place while
the migrations give the ones that are supposed to be.

### The documents a centre actually needs

| | |
|---|---|
| [docs/privacy-statement.md](docs/privacy-statement.md) | Every column that holds personal information, who can see it, and what is *not* collected. A template, because the **centre** is the responsible agency and Salix holds the data as its agent |
| [docs/retention.md](docs/retention.md) | The schedule, the purge procedure, and why the seven-year figure is an assumption in both directions — too short breaches IPP 9, too long destroys evidence |
| [docs/breach-response.md](docs/breach-response.md) | The first hour. Contain without destroying evidence, establish the facts, decide notifiability, notify. Never exercised |
| [docs/backup-and-restore.md](docs/backup-and-restore.md) | What exists, what the drill proves, and the seven steps of a real restore — step 4 (`test:rls`) being the one that will be skipped under pressure and must not be |
| [docs/offboarding.md](docs/offboarding.md) | Export, archive, revoke, wait, purge, delete — and the defect that made the last step impossible |
| [docs/store-listing.md](docs/store-listing.md) | Listing copy, the Play Data Safety declaration and Apple's privacy questionnaire, both drafted from the schema rather than typed into a web form at midnight |

The listing copy says, in the store, that this product cannot submit a funding return. A
manager who buys expecting RS7 submission is a refund and a bad review; better to lose the
install than to mislead the sale.

## Security review

```bash
npm run review:security      # 16 checks against the live schema
```

Written as SQL against the database rather than as a reading of the migrations, because a
review of the files is a review of what somebody *intended* — and in every finding below,
the code said the right thing and the database did not enforce it.

### Four findings

**An issued invoice did not freeze**, although this README said it did. The line policy
required `status = 'draft'`; nothing required the status to stay put, and `invoices.status`
carries a column UPDATE grant because an owner must be able to issue one. Three ordinary
statements — back to draft, edit the line, re-issue — and the amount a family was billed
differs from the amount they were shown. There was no audit trigger on `invoices` either.
`0021` adds a transition trigger: no return to draft, no reinstating a void, and the
reference, recipient, period and issue date fixed at issue. A CHECK could not do it, because
a CHECK sees one row and cannot see the row it replaced.

**The audit log stopped keeping up with the schema in April.** `0005` covered ten tables;
Phases 3–5 added twelve more and nothing extended it. A missing audit row looks exactly like
a quiet day. The serious one was `staff_records` — the table that *is* the licensing evidence
— where an expiry date could be edited or a "sighted by" cleared with no trace. `0021`
extends the trigger to twelve tables, and the suite now asserts audit coverage as a rule
with the exclusions named, so the next table added without one fails the build.

**There were no security headers at all**, and fixing that broke every write in the app.
`Referrer-Policy: no-referrer` was correct reasoning — these URLs contain child UUIDs — and
Next's server-action origin check falls back to `Referer` when `Origin` is absent, so it
parsed the string `"null"`. Every server action is a write: the roll rendered, the ratio
rendered, and signing a child in did nothing. `same-origin` keeps the privacy property and
the header Next needs. `typecheck`, `lint` and `build` were all clean.

**Fourteen tables carried the shape that leaked in Phase 4** — an `x_select` policy plus an
`x_write` policy declared `FOR ALL`, where `FOR ALL` covers SELECT and permissive policies
are OR'd. All fourteen were narrow, so nothing was leaking; that is luck about how they were
written. `0022` splits them into `insert`/`update`/`delete` so **adding a write policy can no
longer widen a read**, copying `qual` and `with_check` out of the catalogue rather than
re-typing fourteen predicates. `0023` then drops the six policies the split created for verbs
that are deliberately not granted, because a policy is a statement about what is allowed and
if the answer is never, the absence is the design.

### The review's own false positives are the more useful lesson

Four of the first version's findings were wrong, all from one cause: it read
`role_table_grants`, which shows **table-level** grants, while this schema does most of its
write control with **column-level** grants — a policy restricts rows, and only a grant can
restrict columns.

It reported `messages` as fully append-only (`read_at` has a column UPDATE grant), flagged
`invitations.token_hash` as HIGH (INSERT only, which the invite flow needs), called an
unreachable `schema_migrations` CRITICAL, and called nine working features broken. A review
that cries critical at something nobody can reach trains its reader to skim, which is worse
than not running it. Severity is now a function of reachability.

### What was already clean

No service-role key or `service_role` string in any client bundle or the mobile workspace.
No `dangerouslySetInnerHTML`, no `eval`. All 18 `SECURITY DEFINER` functions pin
`search_path` — one unpinned function would be the entire tenant boundary, since every
predicate here is a definer function. `auth.users` granted to nobody. One storage bucket,
private. `anon` has no table grant at all — and since 0024 it holds EXECUTE on exactly one function,
`submit_job_application`, which is the public careers form and is covered by an allowlist in
the review so a second one cannot appear quietly. All four views run as the invoker.

### Every route, every role

```bash
npm run test:e2e     # 44 checks, including the capability matrix
```

`apps/web/e2e/roles.spec.ts` walks all eleven authenticated routes as **owner, manager,
educator and parent** and asserts each either renders or redirects, against a table that
states the guard for each. Plus the second boundary, which the RLS suite proves in SQL and
this proves through the app: a parent cannot open a child who is not theirs *even by URL*, an
educator sees an allergy but not a custody order, a forged `ece_centre` cookie does not open a
centre the caller is not a member of, and revoking a membership ends access on the next
request.

Mutation-tested: widening `manageMembers` to include `educator` in the capability matrix fails
both the route check and the navigation check, naming the route.

A four-row matrix tested at two rows is a matrix nobody has checked, which is why all four are
there. `educator` is the row where a mistake is least visible — it needs real access to the
daily screens and must reach no office screen.

## The first tenant

Little Pearls Educare Centre, two sites, created 2026-08-05. Details, sources and what is not
verified: [docs/tenant-little-pearls.md](docs/tenant-little-pearls.md).

| | Mt Albert | Mt Roskill |
|---|---|---|
| Slug | `little-pearls-mt-albert` | `little-pearls-mt-roskill` |
| MoE service number | `46365` | `47407` |
| Children, guardians, health records | **0** | **0** |

Zero is the correct number until the insurance gate is closed. The owner is the platform
operator, not the centre — the manager gets an account through the invitation flow when they
are ready, which is one command and a link they open themselves rather than an account created
for a real mailbox before anybody asked for one.

The service numbers come from two Ministry directories that agree (Education Counts and ERO),
read from URL parameters because Education Counts returns 403 to an automated fetch. **They
print on the evidence binder and get keyed into a funding return**, so they need confirming
against a document the centre actually holds. Nothing about licensed capacity, ratios, fees or
opening hours from third-party directories was entered — one of them contradicts the centre's
own site about its opening time, which is a useful reminder of what those sources are worth.

### The trap this uncovered

The demo centres were created with **the real customer's slugs**, because when they were
written there was no real customer — only a plan naming Little Pearls as the first one. And
`seed-demo.ts` found its centres with `slug like 'little-pearls-%'`.

So the first demo seed after this tenant existed would have inserted seven invented children —
including a fabricated peanut anaphylaxis plan — into a live service's roll, and the next run's
`purgeAll()` would have deleted them again, which is worse: it would have looked like nothing
happened.

Caught by the unique index on `slug` refusing the insert. That is luck — a constraint doing a
job nobody asked it to do. Demo data now lives under `demo-`, and the seed script **refuses to
run** if its pattern matches a centre whose slug does not start `demo-`. A prefix convention
alone is a convention; the assertion is the rule.

### And a leak in the test harness

Onboarding also turned up **six orphan audit centres and fifty-six orphan accounts**. The e2e
fixture drops its tenant in a project teardown, which runs when tests fail but not when the
*process* dies — and the Playwright CLI has exited on a Windows libuv assertion mid-run more
than once here. The pre-0020 defect that made a centre undeletable accounts for the rest.

Two fixes. The teardown no longer looks accounts up through `auth.admin.listUsers`, which
intermittently returns a 500 with an empty body on this project — it deletes by the ids the
fixture already knows, so a teardown cannot fail for that reason. And it now sweeps any
`audit-` tenant older than two hours before doing its own work, so a killed run heals on the
next one. `npm run sweep:audit` does the same plus the accounts, which need SQL for the same
reason.

## Deploying

**One service serves every centre — it is not a per-customer deploy.** Nothing about a centre
is in the build: no tenant in an environment variable, no centre id in the bundle, no hostname
that means anything. A second customer is a row in `centres` and a row in `memberships`, which
is what `npm run onboard` does. So do not name the Railway service or a custom domain after the
first customer — `ece-web`, not `little-pearls`. See [Why this is pooled and not
siloed](#why-this-is-pooled-and-not-siloed) for why mobile forces this.

Railway, web app only — the mobile app ships through EAS and talks to Supabase directly.
Full procedure and the post-deploy checks: [docs/deploy-railway.md](docs/deploy-railway.md).
`railway.json` and `.nvmrc` are committed, so the build and start commands live in the repo
rather than in somebody's browser.

**Migrations are not part of the deploy, deliberately.** A build that migrated would run on
every redeploy, in parallel across replicas, with no way to stop half way. So the rule is
**migrate first, then deploy**, and `npm run migrate -- --status` is how you find out whether
the schema and the code agree.

Three things that were verified rather than assumed, because each would have been a deploy
failure:

- **`dotenv-cli` exits 0 on a missing file**, so `dotenv -e ../../.env.local` in the web
  scripts is harmless on a host that has no such file. Tested; the scripts needed no change.
- **`next start` reads `PORT`** (commander `.env('PORT')`) and binds `0.0.0.0` by default.
  Tested with `PORT=3999`; it served on 3999.
- **`npm ci` under `NODE_ENV=production` omits devDependencies**, which here means
  `typescript` and the `@types` packages that `next build` needs. Hence `--include=dev` in the
  build command; without it the failure reads as a TypeScript error in the app.

### The health check is about configuration, not liveness

`/api/health` returns `{"ok":true}`, or 503 naming the missing variable. It does **not** touch
Supabase: a health check that did would turn a blip in a third-party service into a container
restart, making a dependency's outage into an outage of the deploy's own making. What it
catches is the actual likely failure — a missing or misspelled variable — before the host
routes traffic, instead of as a 500 on whichever page somebody opens first.

### The deploy's real cost: a service-role key in the container

The invitation flow calls the GoTrue admin API to create an account, and no Postgres function
can stand in for that. So `SUPABASE_SERVICE_ROLE_KEY` has to be a Railway variable — and that
key **bypasses every policy**. The blast radius of the Railway environment is therefore the
whole database, every centre. Keep the project's member list as short as the list of people
who should be able to read every child's medical record, because they are now the same list.

### Two things the deploy changed on the Supabase side

`site_url` was `http://localhost:3000`, and **every invitation and recovery link this product
issues lands on `site_url`** — so until `npm run deploy:auth -- --domain https://…` is run
after the first deploy, a staff member clicks their invitation and their browser tries to open
a server on their own laptop.

And `password_min_length` was **6**, already raised to **10**. The invitation form has always
refused anything shorter, so the product was promising a stronger minimum than the service
enforced, and any route that set a password without going through that form was held to the
weaker rule.

## The 1000-row cliff

PostgREST is configured with `max_rows: 1000`, so an **unbounded `select()` returns at most a
thousand rows with `error` set to null.** Nothing in the response says anything was left behind.

That was a live bug in the money path, measured rather than reasoned about. With 1,200 attendance
events for one child, `readFundingPeriod` reported **72 hours instead of the true total** and
**invented two unresolved days**, because the cut landed mid-day and left sign-ins with no
sign-out. Under-reporting the claim and fabricating broken records at once — the exact inverse of
the design principle that nothing is estimated.

[`fetchAll`](packages/api/src/paging.ts) pages with `.range()` until a short page and **throws**
at a ceiling rather than returning a partial result, because a partial answer is what caused the
bug. A larger `.limit()` would only move the cliff somewhere nobody is watching. Every paged
query also orders by `id` as a tiebreaker: paging over a non-unique order can return one row on
both pages and another on neither.

```bash
npm run drill:rowcap     # 1,200 events, expects exactly 50.00 hours
```

The expected total is hand arithmetic in the script's comments (8 days × 75 sessions × 5
minutes), not a snapshot, and it is mutation-tested — raising the page size above the server cap
makes it report 41.66. Worth noting what that shows: with tidy day-bounded data, truncation
produces **no warning at all**, just a plausible wrong number.

[`bounded-queries.test.ts`](packages/api/src/__tests__/bounded-queries.test.ts) reads the source
of every query in `packages/api` and requires each to be paged, provably small, or listed with
the **structural** reason its row count cannot reach a thousand. "A licence caps the roll"
qualifies; "it probably will not get that big" does not.

## Open questions




- **A centre could not be deleted until 2026-08-04.** Migration 0020 fixed it; the
  procedure for removing a tenant is [docs/offboarding.md](docs/offboarding.md) and it has
  never been run end to end against a real centre. Step 6 has been run several hundred
  times, by the e2e fixture, which is the only reason it works at all.
- **No screen reader has ever been used on this product.** The axe audit passes on 19
  screens in both roles with no advisory warnings either, which is a floor rather than a
  pass — axe finds perhaps a third to a half of WCAG failures and cannot tell whether a
  focus order makes sense or whether an error message helps anybody.
- **Point-in-time recovery is not enabled**, so the recovery point is up to 24 hours old —
  for a centre, up to a day of attendance, messages and consent decisions. It costs money
  and the decision has not been taken. It is the right thing to buy before a second centre
  is onboarded; see [docs/backup-and-restore.md](docs/backup-and-restore.md).
- **Nothing has been submitted to a store and no build exists.** `apps/mobile/eas.json` has
  the profiles chosen and commented, and has never been executed. The privacy statement also
  has to be *hosted* before either store will accept a submission — the only blocker on that
  list that is hosting rather than writing. See [docs/store-listing.md](docs/store-listing.md).
- **The breach runbook has never been exercised**, and two of its legal citations are
  unchecked. So is the citation for the agent rule that makes the centre the responsible
  agency. The substance of both is sound; see items 10 and 11 in
  [unverified-claims](llm-wiki/wiki/unverified-claims.md).
- **Professional indemnity insurance is the remaining gate on real data.** The
  services agreement with Little Pearls is in place; the insurance is not. Their two
  centres now exist as tenants and hold **zero** children, guardians or health records —
  everything else in the database is either `Demo-Seed` or an audit fixture, which is
  fine, because writing the code puts nobody's information anywhere. The line not to
  cross without the cover is a real child's allergies being typed into it.
  Under-5 records are among the most sensitive personal information in the
  country, and a breach is notifiable under the Privacy Act 2020.
- **The retention period is a guess that needs checking.** Seven years from the date
  a child leaves, on the assumption that funding-relevant records must survive a
  Ministry funding audit. It is a parameter rather than a constant precisely so it can
  be corrected, but it should be confirmed against the current ECE Funding Handbook
  before it decides what gets destroyed.
- **No scheduled sweep runs the purge.** `children_due_for_purge()` lists what is
  due and `purge_child()` does it, but nothing calls them on a timer — so retention is
  currently a thing somebody has to remember. That is a cron job and a decision about
  whether deletion should ever be automatic without a human looking at the list first.
- **No licensing criteria are loaded**, and nothing seeds them. This is deliberate (see
  above) and it means the criteria-gap section of the dashboard cannot do its job until
  somebody imports a checked set. It is the largest piece of remaining work in Phase 3, and
  it is content work rather than code.
- **The ratio bands are verified** as of 2026-08-18, against Schedule 2 as at 29 June
  2026. What is not modelled: sessional and home-based tables, the reg 44A set-off, the
  reg 54(4) sibling rules, and any person present aged under 6 who is not on the roll.
- **No real airplane-mode drill has been run.** `npm run drill:offline` proves the
  contract the outbox depends on against the real database, but not the `expo-sqlite`
  queue itself — that needs a tablet, before a centre relies on it.
- **Staff attendance is not modelled**, so the adult count is a human assertion rather
  than a derived figure. Deliberate for now (see 0010), and it means the ratio is only
  as good as somebody remembering to update the count when two people go to lunch.
- **Mobile has no crash reporting.** `@sentry/react-native` needs native
  configuration through an Expo config plugin, and there has been no EAS build yet, so
  wiring it now would be configuring something unbuildable. It belongs with the first
  real build.
- **`photo_public` consent is recorded and not yet enforced anywhere**, because
  there is no media pipeline until Phase 4. `has_consent()` exists so that
  enforcement can live in SQL when it arrives, rather than in a check somebody
  remembers to write.
- **The RLS suite runs against the live project.** It ends in `ROLLBACK` so it leaves
  nothing behind, and safe is not the same as appropriate — it should get its own
  database before this one holds a real child's record.
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
