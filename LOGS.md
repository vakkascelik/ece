# Session logs

Narrative record of what happened, what broke, and what was found. Newest first.

Distinct from [`llm-wiki/wiki/log.md`](llm-wiki/wiki/log.md), which records changes to the wiki
itself, and from the wiki pages, which hold the durable *why*. This file is the story.

---

## 2026-08-04 — Phases 0–3, in one day

The repo went from empty to a working platform across four pieces of work. Everything below
happened on 2026-08-04; the ordering is by commit.

### Scaffold and auth (`0af24a0`, `d244032`)

Multi-tenant scaffold: `centres`, `memberships`, `caller_centre_ids()`, RLS policies, a shared
query layer, and a web app with login, centre switching and roster management.

**Pooled, not siloed** — unlike `shop-platform` and `charity-platform`. You cannot publish one
App Store binary per childcare centre, so one app serves every centre and isolation has to live
where the client cannot reach it.

Things that fought back: Expo 52 peer-requires React 18, which cannot coexist with Next 15 in one
hoisted workspace (resolved on Expo 57 / RN 0.86 / React 19); guessed Expo module versions
(`~0.33.0`) 404'd because modules are now versioned to the SDK major; and every authenticated
route 500'd despite a clean typecheck because **Next ignores a monorepo root `.env.local`** —
fixed with `dotenv-cli`.

### The RLS suite, and the database it runs against (`f5a8fda`, `6b1feb0`)

Design tokens, an append-only audit log, and the isolation suite.

The Supabase project handed over turned out to hold **Zelva** — a dormant halal-food/zakat app
with 34 tables and 6,184 rows. Inventoried before dropping anything, backed it up to
`.backups/`, then wiped `public` and applied the ECE schema. `auth.users` was left alone: six
accounts, and deleting an account is the most destructive operation available.

**The suite failed three times in a row on its first ever execution, each on a real bug.**

1. `centre_members` was unreadable by any authenticated caller. `security_invoker = on` makes the
   `auth.users` join run as the caller, who has no privilege there. Supabase's own hint is
   `GRANT SELECT ON auth.users TO authenticated`, which fixes the error by publishing every email
   in the project to every signed-in user.
2. `centres`, `memberships` and `audit_events` had policies but **no grants**. The whole of `0001`
   was unreachable. It had been relying on the `ALTER DEFAULT PRIVILEGES` a stock Supabase project
   ships with — ambient, invisible in the migration file, and gone the moment the schema is
   recreated.
3. Same again for `service_role`, which bypasses RLS but not grants, so `onboard.ts` failed with
   "permission denied for table centres".

All three were invisible to `typecheck`, to `next build`, and to reading the migrations. The suite
also had no *positive* assertion on the view, which is why bug 1 could have shipped — a view
returning nothing at all would have passed.

### Phase 1 — children and whānau (`73efd3c`)

The services agreement arrived, which unblocked it. Children, guardians, custody arrangements,
enrolment, health conditions, medication authorities and consent.

**The hard part was a second boundary.** `parent` is a role *inside* the tenant, so a policy keyed
on `centre_id` alone passes every existing test and hands one family another family's medical
records. Three `SECURITY DEFINER` predicates carry it, each joining to a live membership so
revoking a parent closes their own child's record immediately.

Three decisions that look odd and are not: custody arrangements are their own table (a record
*about* the guardians must not be readable *by* them); a parent sees only their own guardian
record, not co-guardians (separated parents and protection orders are ordinary); and consent is
append-only events, because "did we have permission in March" is the only question that matters
once somebody complains.

The suite passed 63/63 first run, which was not trusted. **Mutation-tested it**: weakened the
child policy to centre-only, the suite failed on "a parent sees exactly one child", restored,
green again.

Then live verification caught what SQL could not: **PostgREST bulk inserts do not apply column
defaults.** One `INSERT` is built from the union of keys, so a key absent from one object is sent
as explicit `NULL`. Omitting `is_primary` on one row of three failed with a not-null violation —
and because the seed was ignoring returned errors, what surfaced two steps later was "the parent
cannot see their own child", which looks exactly like an RLS bug and was not.

### Review of Phase 1 (`8010bc2`)

Seven issues, worst first.

**The timezone bug broke enrolment every New Zealand morning.**
`check (date_of_birth <= current_date)` reads as obviously correct. `current_date` uses the
session timezone, PostgREST connects as UTC, and NZ is 12–13 hours ahead — so for the whole New
Zealand morning `current_date` is *yesterday*, and a baby born that morning failed the constraint.
The form rejected them as born in the future, at exactly the hours a centre does its admin.

`todayISO()` was itself part of the problem: its comment said "local, not UTC", which is right on
a tablet and wrong in a Next server component. Replaced with `todayInZone(timeZone)` and the
centre's own timezone threaded through.

Also: two roll queries doing two round trips with an `in.(…)` URL that grew with the roll;
`medication_authorities` granting DELETE against its own reasoning; `archive` written and never
wired to a button; guardians addable and removable but a phone number not correctable; and three
real accessibility gaps — no `:focus-visible` anywhere, no `role="alert"` so a screen-reader user
got silence when a form was refused, no skip link.

**ESLint had never run.** `next lint` with no config drops into an interactive prompt, which in CI
hangs rather than fails. Once configured it immediately found a real bug: the middleware matcher
had `\.` inside a *string*, which collapses to a bare `.`.

### Filling the gaps (`7ced21c`)

Six things, four of which turned up a defect while being built.

**There was no migration runner** — migrations had been applied by pasting SQL. The new runner
found that they were not replayable: `create or replace view` refuses to change a view's column
list, so once `0006` had added a column, replaying `0004` died with "cannot drop columns from
view".

**Invitations**, with only the SHA-256 of each token stored, email-match required on acceptance,
and the account created *before* the invitation is claimed (the other order strands somebody with
a spent link).

**Retention and purging**, plus a correction: the Privacy Act 2020 does **not** give a right to
request deletion. It gives access (IPP 6) and correction (IPP 7); there is no general right to
erasure in New Zealand law. What it imposes is IPP 9, a retention limit on the agency. Purging
works at all only because `audit_events.detail` holds column names and never values.

**Error tracking, measured rather than assumed.** A static Sentry import cost 75 kB of shared
client bundle for something inert without a DSN. And Next's `instrumentation.ts` bundles into the
**edge** runtime that middleware executes: 91 kB → 176 kB *on every request*. The `NEXT_RUNTIME`
guard does not help — it is a runtime check and the bundler still follows the import. Net cost
after restructuring: ~1 kB.

**The design tokens had already drifted.** Background `#fafaf9` in CSS against `#faf9f7` in the
tokens, and the muted grey a full contrast point worse than the value the contrast test was
asserting. Tests passing, screens rendering something else. Now generated, with CI failing on
drift.

And a claim of mine in the code was wrong: the state-chip borders were commented as satisfying
WCAG 1.4.11 at 3:1. Measured, they are ~1.3:1. That is acceptable — 1.4.11 governs boundaries
that carry information, and these carry none because every chip states its meaning as a symbol
and a word at AA contrast — but the comment was false and is now the measurement.

### Phase 2 — attendance and ratios (`a80e723`)

Append-only sign-in events with a device-generated idempotency key, a derived present roll, live
ratios that warn *before* a breach, and an offline outbox on `expo-sqlite`.

**Append-only for a different reason than the audit log**: it makes offline sync tractable. A
sign-in happened at a moment, so two tablets cannot conflict — which is the whole reason no sync
engine is in this project.

The ratio bands are **unverified** and the product says so. `RATIO_TABLES_VERIFIED` is `false`,
`assessRatio` returns the flag, and both the web banner and the mobile bar render a notice. The
maths is tested independently of the numbers and the tests say a green suite means the bands are
*applied* correctly, not that they are right.

A test caught a design question: an empty, unstaffed room was reporting "at the limit". True —
one more child would need an adult — and useless. An indicator that cries wolf on a closed centre
is one people learn to ignore.

**The offline drill's first version could not clean up after itself.** It began by deleting the
day's events with the service role and silently did nothing, so a count read 8 instead of 3 —
because `0009` grants `service_role` select and insert only. Attendance is append-only against
the application's most privileged credential too. The fix was to assert on the run's own keys,
not to widen the grant.

### Phase 3 — compliance and evidence (`2ae6127`)

Staff records with expiry, ratio history replayed from Phase 2's events, criteria and evidence,
and a printable binder.

**The most consequential decision was what not to build.** The licensing criteria run to several
dozen numbered items, were renumbered in 2026, and are not in this repo. Inventing plausible
criterion numbers would let a centre assemble an evidence binder against a list that looks
official and is not — a worse outcome than an empty feature, because the binder would be used. So
`0012` builds the machinery and seeds nothing, `import-criteria.ts` demands a `source`, and the
empty state says so loudly rather than rendering an empty table.

Ratio history is a **replay, not a sample**: sampling stores derived data that can drift *and*
misses breaches shorter than the interval — which are exactly the ones that happen, because
somebody notices and fixes it.

The binder is a print stylesheet rather than a PDF library (every browser prints to PDF, at the
cost of no dependency and no second rendering path), and it never says "compliant" — it opens by
stating what it is derived from and what it cannot show.

### Phase 4 — parent engagement (`pending`)

Pānui, learning moments, consent-gated media, messages, and a notification model.

**The consent gate is the whole phase.** `has_consent()` had been a function nobody called since
Phase 1; from here it decides whether a photograph of a child may be attached at all. Two mechanisms:
a trigger that refuses the attachment, and a restrictive policy that re-checks on every read so a
withdrawal is retroactive. Verified 18/18, including that restoring consent brings the media back
because consent is events rather than a flag.

Then 14/14 on storage: a private bucket, an actual 1x1 PNG uploaded and fetched through a signed URL,
another centre's folder refused, a parent unable to upload, a disallowed mime type refused — and, the
strongest form of the guarantee, **after withdrawing consent a signed URL cannot be issued at all**,
for staff as well as the parent.

**The bug of the phase.** The consent check was written inside the permissive `media_select` while
`media_write` was `FOR ALL`. `FOR ALL` covers SELECT and permissive policies are OR-ed, so staff
matched the write policy and the consent condition never had to be satisfied. It hid correctly from
whānau and not at all from educators — which is precisely why it would have survived review, because
the caller most likely to be tested behaved correctly. Fixed by splitting the write policy *and*
moving consent to a **restrictive** policy, which cannot be routed around by adding another. Every
other `FOR ALL` policy in the schema was then re-read; `media` was the only one with the dangerous
shape.

Also: the orphan sweeper found a real orphan on its first run — a post cascade removes the media row
but not the storage object — and correctly declined to delete it for being under an hour old.

Push delivery is built and has never executed. Said plainly rather than discovered later.

### Phase 5 — bookings, billing, and funding preparation (`pending`)

The phase where attendance turns into money, and where the organising rule is that **nothing is
estimated** — hours become a claim on the Crown, so a guess is a false claim.

A day with a missing sign-out is excluded and *named*, not estimated up and not silently zeroed. All
rounding floors. Two orderings that are easy to get backwards are tested with their arithmetic
written out: the daily cap before the weekly one (weekly-first claims two hours nobody was entitled
to, because Monday's excess is not transferable), and corrections resolved transitively (otherwise a
fixed sign-in time counts twice).

**RS7 preparation, never submission.** Submission needs Ministry approval as an ELI-integrated SMS,
which is closed to new applicants and requires supporting 50 services before you may apply. So every
label says "preparation" and none say "return", "submit" or "file" — a screen that looks like it
filed something is a screen after which nobody files anything. Funding periods are chosen by the
operator, because the Ministry's boundaries are figures this product does not know.

**Stripe deliberately not built.** The pilot is free, most centres already collect through their own
systems, and none of Stripe's real decisions are decidable while the price is NZ$0. `payments`
records money that arrived; wiring Stripe later is a column and a webhook.

The reconciliation writes a fortnight whose answer is hand-arithmetic in the script's comments and
compares — 13/13. Two things it turned up:

- Its first assertion expected `unresolvedChildCount === 1` and got **4**, because other demo
  children carried unpaired events from earlier probes that **cannot be deleted** — attendance is
  append-only against the app and the service role alike. The fix was to assert on the child under
  test rather than loosen the schema, and it incidentally proved the calculation correct on genuinely
  messy data.
- Re-running would double the figures, so the script now refuses and says how to get a clean slate.
  The append-only guarantee protecting a test from itself.

Moving `dayWindow` out of the compliance folder (two pages needed it) left a stale link in the
README, which `check:docs` caught — the second real link it has found.

### Phase 6 — production readiness (`pending`)

The phase whose job was to find out what is not true. Three of its five deliverables are
**exercises rather than opinions** — you cannot audit accessibility by reasoning about it,
verify a backup by believing in it, or delete a tenant by intending to — and two of the three
failed on the first attempt.

**A centre could not be deleted. By anyone. Ever.** The end-to-end fixture drops its throwaway
tenant on the way out, and the drop failed with an *insert* error while deleting: cascading
from `centres` to `children` fires the audit trigger, which inserts a row referencing the
centre that has just been removed, so the foreign key rejects it and the transaction aborts.
Not an owner, not the service role, not by hand in the SQL editor. Five phases had shipped
with no way to offboard a customer, and neither the type system nor the 164-assertion RLS
suite could have surfaced it, because none of them tries. `0020` drops the foreign key — a
correction, not a workaround: `audit_events` is an append-only ledger and a ledger has to
outlive its subject. It was a genuine standoff, too, because nobody may delete an audit row,
so no legal sequence of statements existed.

**The audit runs on loaded screens.** 19 screens, both roles, a production build, in a real
browser — including the enrolment form *showing its validation errors* and the login form
*showing its error*. The fixture seeds a child with an anaphylaxis plan and a withheld
consent, one signed in an hour ago, three staff records covering all three expiry states, a
thread with messages, a live invitation. An audit of an empty page measures nothing, and every
screen here has an empty state that passes trivially. Two centres, because `requireCtx()`
auto-selects with one and `/select-centre` would never be audited.

It found a critical failure: `select-name` on the People screen. The role selector and its
Save and Remove buttons had no accessible name, so a screen reader user heard "combo box,
educator", "Save, button", "Remove, button" — once per person, with nothing to say whose row
it was, on the screen that decides who can administer a centre. Fixed with `aria-label`
naming the person. Two smaller ones went with it: visually-hidden headers for every action
column, and the attendance page's three sections became named regions so a screen reader can
jump between them instead of walking the roll.

**Two findings were the tests, not the app**, and both would have produced a false green. The
setup asserted on the centre's name after choosing a centre — text that is *also* on
`/select-centre`, so the assertion passed against the page being left and the session state
was captured before the cookie arrived. And a run reused a server from before a fix, so a
corrected page still reported the old violation.

**The restore drill was mutation-tested, which matters more than it passing.** A character
appended to a timestamptz was caught by the type system rather than by the comparison; a
character appended to a free-text column loaded fine and then failed the comparison, naming
the table — one character, one column, one row, out of 485. Without the second mutation the
comparison might have been comparing something with itself.

**Performance in gzipped bytes, not a Lighthouse score.** 100.6kB first-load JS, 2.0kB CSS,
89.3kB middleware on every request. The first agrees with what `next build` prints, which is a
check that the script measures the right files. It is not small, and ~98kB of it is React and
the App Router — so movement means a dependency reached the client. The web sign-in round trip
measures ~930ms, which is honest and slower than it should be; the plan's 100ms budget is the
*mobile* optimistic write and is still unmeasured.

Six documents in a new `docs/`: privacy statement (a template, because the **centre** is the
responsible agency), retention, breach response, backup and restore, offboarding, and store
submission — the last containing the Play Data Safety declaration and Apple's privacy
questionnaire drafted from the schema rather than typed into a web form at midnight. Three new
entries on the unverified register: two legal citations, and the fact that **no screen reader
has ever been used on this product**.

### Security review and the four-role path audit (`pending`)

The Zelva pre-wipe dump is deleted. And a correction that matters more than the deletion: it was
described here and in two other places as sitting inside OneDrive and therefore as having been copied
to Microsoft. **That was wrong.** This repository is at `C:\dev\ece`, which is not synced; the
OneDrive repository on this machine is a different one. The file never left local disk. Corrected in
both documents rather than quietly removed, because "we believed data had left the machine and it had
not" is exactly what a runbook should record it got wrong.

**Every route, every role.** `roles.spec.ts` walks all eleven authenticated routes as owner, manager,
educator and parent against a table that states each route's guard, and asserts each either renders or
redirects. A four-row matrix tested at two rows is a matrix nobody has checked — `educator` is the row
where a mistake is least visible, since it needs real access to the daily screens and must reach no
office screen. Mutation-tested: widening `manageMembers` to include `educator` fails both the route
check and the navigation check.

Plus the second boundary, proved through the app rather than only in SQL: a parent cannot open a child
who is not theirs **even by URL**, an educator sees an anaphylaxis plan but not a custody order, a
forged `ece_centre` cookie does not open a centre the caller has no membership in, and revoking a
membership ends access on the next request.

**The security review is sixteen SQL checks against the live schema**, not a reading of the
migrations — which is the only reason any of it surfaced, because in each finding the code said the
right thing and the database did not enforce it.

An **issued invoice did not freeze**, though the README said it did. The line policy required
`status = 'draft'`; nothing required the status to stay put, and `invoices.status` carries a column
UPDATE grant because an owner must be able to issue one. Back to draft, edit the line, re-issue: three
ordinary statements, and no audit trigger on `invoices` to record it. A CHECK could not fix it — a
CHECK sees one row and cannot see the row it replaced.

The **audit log stopped keeping up with the schema in April**. Ten tables covered, twenty-two existing.
The serious one was `staff_records`, the table that *is* the licensing evidence: an expiry date could
be edited or a "sighted by" cleared with no trace, and a centre could have handed a reviewer a binder
assembled from records that had been quietly adjusted. A missing audit row looks exactly like a quiet
day, which is why nothing surfaced it.

**There were no security headers at all**, and fixing that broke every write in the application.
`Referrer-Policy: no-referrer` was correct reasoning — these URLs carry child UUIDs — and Next's
server-action origin check falls back to `Referer` when `Origin` is absent, so it parsed the string
"null". Every server action is a write: the roll rendered, the ratio rendered, and signing a child in
did nothing. `typecheck`, `lint` and `build` were all clean. `same-origin` keeps the privacy property
and the header Next needs.

**Fourteen tables carried the shape that produced the Phase 4 consent leak** — an `x_select` policy
plus an `x_write` policy declared `FOR ALL`. All fourteen were narrow, so nothing was leaking, which
is luck about how they were written rather than a property of the design. 0022 splits them so adding a
write policy can no longer widen a read, copying the expressions out of the catalogue rather than
re-typing fourteen predicates. 0023 drops the six policies the split created for verbs that are
deliberately not granted: a policy is a statement about what is allowed, and if the answer is never,
the absence is the design.

**Four of the review's own first findings were false**, all from reading `role_table_grants`, which
shows table-level grants only — while this schema does most of its write control with column-level
grants, because a policy restricts rows and only a grant can restrict columns. It called an
unreachable table CRITICAL and nine working features broken. A review that cries critical at something
nobody can reach trains its reader to skim, so severity is now a function of reachability.

### The first tenant (`pending`)

Little Pearls Educare Centre exists as two tenants: `little-pearls-mt-albert` (MoE 46365) and
`little-pearls-mt-roskill` (MoE 47407), both Pacific/Auckland, owner the platform operator, and
**zero children, guardians or health records** — which is the correct state while professional
indemnity insurance is still outstanding.

The facts came from the centre's own site (two addresses, two phone numbers, weekdays 7.30am to
6.00pm, three months to five years, not-for-profit and community established). The service
numbers came from two Ministry directories that agree — Education Counts and ERO, whose
institution number matches the `ece=` parameter in both cases. Read from URL parameters, because
Education Counts returns 403 to an automated fetch, so they still need confirming against a
document the centre holds: **those numbers print on the evidence binder and get keyed into a
funding return.**

Nothing from third-party directories was entered — licensed capacity (65 and 53 FTE), an earlier
opening time that **contradicts** the centre's own site, an opening date. One source disagreeing
with the service about its own hours is a fair measure of what those listings are worth. And no
fee schedule, because the site publishes no fees and an invented rate is a rate a family gets
billed.

**The trap this uncovered.** The demo centres had been created with the real customer's slugs,
because when they were written there was no real customer — only a plan naming Little Pearls as
the first one. `seed-demo.ts` found its centres with `slug like 'little-pearls-%'`. So the first
demo seed after this tenant existed would have inserted seven invented children, including a
fabricated peanut anaphylaxis plan, into a live service's roll — and the next run's `purgeAll()`
would have deleted them again, which is worse, because it would have looked like nothing
happened.

It was caught by the unique index on `slug` refusing the insert. That is luck: a constraint doing
a job nobody asked it to do. Demo data now lives under `demo-`, and the seed script refuses to
run at all if its pattern matches a centre whose slug does not start `demo-`. A prefix convention
alone is a convention; the assertion is the rule.

**And a leak in the harness.** Onboarding also turned up six orphan audit centres and fifty-six
orphan accounts. The e2e teardown runs when tests fail but not when the *process* dies, and the
Playwright CLI has exited on a Windows libuv assertion mid-run more than once here; the pre-0020
undeletable-centre defect accounts for the rest. Two fixes: the teardown deletes accounts by the
ids the fixture already knows rather than through `auth.admin.listUsers` — which on this project
intermittently returns a 500 with an empty body, something `onboard.ts` had already documented and
this code had ignored — and it now sweeps any `audit-` tenant older than two hours first, so a
killed run heals on the next one. A full run now leaves nothing behind, verified.

### Where the day ended




176/176 RLS assertions, 156 unit tests, 44/44 end-to-end checks across four roles, 16/16
security checks against the live schema, a 4/4 mutation-tested restore drill over 34 tables,
23 migrations, lint, tokens, doc links and performance budgets clean, both apps building.
Seven things now need a person rather than more code: **set the GitHub secrets so CI can actually
run** (every result above is local, on one machine, at a moment I chose), **import a checked criteria
set**, **verify the ratio bands against Schedule 2**, **verify the funding caps**, **get an EAS build**
(which unblocks both the airplane-mode drill and push delivery), **use a screen reader on the daily
screens**, and **host the privacy statement** so a store submission is possible at all. Every one is
in [`llm-wiki/wiki/unverified-claims.md`](llm-wiki/wiki/unverified-claims.md).

*Log last updated: 2026-08-04*
