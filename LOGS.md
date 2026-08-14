# Session logs

Narrative record of what happened, what broke, and what was found. Newest first.

Distinct from [`llm-wiki/wiki/log.md`](llm-wiki/wiki/log.md), which records changes to the wiki
itself, and from the wiki pages, which hold the durable *why*. This file is the story.

---

## 2026-08-14 — §6-3 attendance verification: built, tested, and stopped at the door of the database

The session that turned competitor research into a migration. Little Pearls' manager listed the
five systems the centre actually runs (Infocare, VisTab, KindyNow, Educa, 1Place); chasing what
"MoE-accredited" really means led to ECE Funding Handbook §6-3 and its twelve criteria for
electronic attendance verification — and to the finding that this product records attendance but
has never once recorded that a family agreed with it. That is the legally load-bearing gap, so it
went first.

### What was built (`0061`, uncommitted)

`is_authorised_signatory` on `child_guardians` (default **false**, criterion 7's reasoning
applied to criterion 4), `caller_signatory_ward_ids()`, and `attendance_verifications` —
append-only, no `centre_id`, dispute-requires-comment, paper-requires-evidence. Status is
**derived, not stored**: `summariseVerification()` in `@ece/core`, which is what makes
`superseded` expressible — an approval the record has moved under. Juniorlogs, the approved SMS
whose EAV flow is the published parity bar, stores its status and structurally cannot say that.

Wiki first, per the standing rule: new page `attendance-verification`, item 36 in
unverified-claims (the criteria wording came through an automated extraction, not a person's
eyes), item 3 narrowed (the 7 years is now sourced to §6-3; the *anchor date* is still an
assumption), and a dated correction in funding-and-billing — the "Ministry is not accepting
applications" claim had quietly expired: the page it came from promised a capacity review in
July 2026, which is now behind us, and "50 services" reads at least as naturally as capability
as it does customer count. An enquiry to `ELI.queries@education.govt.nz` was drafted to resolve
both instead of re-reading the same sentence harder.

### What fought back

**Three tests passed while proving nothing.** `isAfter()` compares ISO timestamps as instants
because Postgres renders `+00:00` where JavaScript renders `Z`. The first tests for it used
timestamps whose *date parts differed* — the date dominates a string comparison, so mutating the
implementation back to `>` changed nothing. 19/19 green, and vacuous. Caught only because AGENTS
§4.2 says mutation-test anything that passes first try. Rewritten with `+12:00` offsets (what a
Pacific/Auckland session actually emits) chosen so string and instant comparison give opposite
answers; the mutation now fails 3 tests, each on the right assertion. The episode is written into
the wiki page because it is the repo's clearest demonstration yet that a green suite is a claim
about the tests, not the code.

**The chase-window boundary mutation** (`>=` → `>`) failed 2 tests on the right lines.

### What could not run, and why nothing was asserted about it

`SUPABASE_DB_URL` is unset and the PAT in `.env.local` answers **401 to `GET /v1/projects`** —
dead token, not wrong scope. So: migration not applied, `test:rls` not run, `review:security`
not run, and the live mutation test (drop the signatory predicate, watch Quinn's assertion fail)
not run. Everything that does not need the database is green and is listed as such —
typecheck ×5, lint, 419 core tests (19 new), tokens, docs links, web build.

**Nothing is committed.** AGENTS §5 says a change is done when the gates pass; the gate that
matters most here has not run. The tree holds the work; the commit waits for a live PAT or a
`SUPABASE_DB_URL`.

### Same day, second commit — 0062: the PIN becomes a signature

The portal path shipped in the morning was honest and useless to most families: they will
never hold a login, and they already authenticate at the door twice a day. `0062` gives the
0044 PIN a second job as the §6-3 electronic signature — two definer functions, because
criterion 6 forbids signing what was never displayed: `kiosk_week_attendance` (PIN-gated,
returns the week plus the centre's timezone) then `kiosk_verify_attendance` (records the
outcome). The PIN is held in component state between the two calls — entered once, used
twice, never persisted — and that trade is argued in the migration header rather than made
silently.

The check-and-count logic moved into `kiosk_pin_gate`, EXECUTE granted to **no role** —
callable only from inside another definer body, because as a public function it would be a
PIN oracle unscoped by `caller_kiosk_centre_id()`. One lockout budget across the door and
the review. `kiosk_sign_child` keeps its proven inline copy untouched.

The suite's sharpest new case is not Quinn but **Ana's grandmother**: live guardian of the
*right* child, working PIN, never named a signatory. A lazy predicate passes her. The live
mutation drill — the weakened body derived from the migration file itself, not hand-copied —
deleted the signatory line and the suite failed on exactly her assertion (*"and cannot sign
it either, got recorded"*), then restored and passed. 474/474 after fourteen new assertions.

The office half shipped in the same commit because without it the whole feature is dormant:
an "Attendance signatory" checkbox on the whānau tab, beside "May collect" and deliberately
not it — taking a child home and signing off funded hours are different authorities.

Gates: typecheck ×5, lint, 424 unit tests, RLS 474/474 live, security 16/16, build, docs,
tokens. The kiosk e2e spec ran against the production build — 6/6, including the
accessibility audit, so the PadGrid extraction regressed nothing. **Not covered by e2e:**
the review flow itself, because the e2e fixture names no signatory; the function paths are
covered by the RLS suite, and driving the two-step UI end-to-end is recorded as the gap it
is. First-load bundle re-measured: 113.0kB, identical — the kiosk work is route-scoped and
added zero first-load bytes; the pre-existing 7kB overage stands, still unattributed.

### Third commit — 0063: the absence the centre finally hears about

0051's absence button had been writing rows nobody read: no notification, no staff surface,
one day per tap, no reason. KindyNow — the online system Little Pearls actually pays for
this — is, at its core, the notification. 0063 closes the loop: `absence_reason` on the
booking (optional, 500 chars, CHECK-tied to `absent` status so a reason cannot outlive the
state it describes), an office notification per submission, a per-day-honest range for the
sick week, and a "Reported away today" strip at the top of /attendance.

The split that matters: `report_absence_core` (the flip) and `notify_absence` (the telling),
both EXECUTE-granted to nobody — notify writes into other people's inboxes, and the range
must tell the office ONCE for five days, because five letters for one sick week is a muted
inbox and the mute takes 0057's emergency channel with it.

Two assertion lessons, now written into the wiki page because both will recur. A delta
counted from the reporter's seat read zero — the notifications policy correctly hiding the
owner's inbox, mistaken for the feature failing. And the counts still failed after that fix,
reading 2 for 1: the 0051 assertion block six migrations upstream became a WRITER the moment
the migration added the telling — an old test producing new side effects, which incidentally
proves two-argument callers resolve against the new three-argument function.

Mutation-drilled live: audience weakened to 0057's everyone-fan-out (`role != 'kiosk'`, the
plausible copy-paste) — suite failed on the first audience assertion because even the
reporter got their own letter; restored, green. 493/493 (+19). One TS slip caught by
typecheck (missing import), fixed. All gates green; bundle unchanged.

### Fourth commit — 0064: the screens, and the function that refuses to restate the boundary

`needsAttention` had been built, tested and called by nobody; a parent with a login had no
verify button — the kiosk was the only writer. 0064 adds `verification_overview`, SECURITY
INVOKER on purpose: every caller is a person, so the tables' policies answer who sees which
child and the function restates nothing — the exact opposite trade from the kiosk definers,
argued in the migration header. The suite asserts all three scopings (educator = centre,
guardian = wards, other centre = nothing, non-Monday = empty), and the live drill flips
invoker→definer and fails on "a guardian's overview holds their ward and nobody else's
child" — Priya saw another family's child under definer. Restored, green. 500/500 (+7).

On top of it: the staff chase card on /attendance (superseded → overdue-with-offer-paper →
in-review, awaiting as a count not rows, and "Nothing needs the office" stated rather than
an absent card) and the portal verify panel on the child's attendance tab (times above the
buttons — criterion 6 again; buttons only for signatories; `superseded` worded as "the
record changed after you confirmed it", not as an expiry). The portal write is a plain
INSERT under 0061's policy — no definer, no second copy of the conditions.

One SQL slip caught by the migration run itself: `generate_series` over dates yields
timestamptz, and `timestamptz + 6` is not an operator. Also recorded: the owner sent the
MoE ELI enquiry today — funding-and-billing's correction now says "sent, reply pending".

### Fifth commit — 0065: the repo's first scheduler, and the judgement it refuses to hold

The §6-3 rhythm — release the week, remind weekly, stop at three and offer paper — as
`scripts/run-scheduled.ts` plus a committed Railway cron (`railway.scheduler.json`). The split
is the design: the runner holds the service key and `service_role` bypasses RLS, so the
per-centre loop is the tenant boundary, and code that IS a boundary judges nothing — the
decision lives in `planVerificationChase` in core, pure, 7 tests, both rules mutation-killed
(cap `>=`→`>` and the calendar-week bucket, each failing exactly its own test). Calendar-week
bucketing rather than seven-elapsed-days, so a Tuesday catch-up run cannot slide the rhythm.

`verification_notices` is the chase's memory: append-only including service_role, NO insert
policy on purpose — the only writer bypasses policies, so the grant is the boundary and the
suite proves even the owner's hand-written notice gets 42501. Families read nothing. Counting
sends from notifications titles was rejected: the first reworded title silently resets every
count. 505/505.

Two of my own defects caught before commit this time, both by reading: a helper that
committed the forbidden `toISOString().slice` (again! — deleted in favour of the
`shiftLocalDate` that already existed) and a tautological window expression. The live dry
run against the real project planned zero notices — correct twice over: no live guardian
carries the signatory flag yet, and the Railway service itself is config-only until somebody
creates it in the dashboard. Recorded in the wiki as exactly that, not as "deployed".

### Found along the way

The under-2 ratio table in `ratios.ts` **matches** the myece.org.nz reproduction of Schedule 2
(1–5→1, stepped, thereafter 1:5) — the "1:3" figure circulating in search results is staged
future policy, not current law. Item 1 stays open (that was a secondary source), but the bands
survived their first contact with one. Also: `ratios.ts` models all-day centre-based only, and
the sessional over-2 table (1–8→1, 9–30→2, 31–45→3) is required the moment the ELI capability
reading matters — data, not logic, because `RatioTable` was parameterised from the start.

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
with no way to offboard a customer, and neither the type system nor the RLS isolation
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

### Preparing the Railway deploy (`pending`)

Three things that would each have been a deploy failure were checked rather than assumed, and
two of them needed no change at all — which is the useful result. `dotenv-cli` exits 0 on a
missing file, so `dotenv -e ../../.env.local` in the web scripts is harmless on a host that has
no such file. `next start` reads `PORT` through commander's `.env('PORT')` and binds `0.0.0.0`
by default, verified by starting it on 3999. The third does need handling: `npm ci` under
`NODE_ENV=production` omits devDependencies, which here means `typescript` and the `@types`
packages `next build` requires, and the failure reads as a TypeScript error in the application
rather than as a missing dependency — hence `--include=dev` in the build command.

`railway.json` and `.nvmrc` are committed rather than configured in the dashboard: a build
command that exists only in somebody's browser cannot be reviewed and cannot be restored.

**The health check is about configuration, not liveness.** `/api/health` returns 200 when the
three required variables are present and 503 naming the missing one — verified in both
directions. It deliberately does not touch Supabase, because a health check that did would turn
a blip in a third-party service into a container restart, so a dependency's outage would become
an outage of the deploy's own making. What it catches is the failure that is actually likely: a
missing variable, before the host routes traffic, rather than as a 500 on whichever page
somebody opens first.

**The deploy's real cost is a service-role key in the container.** The invitation flow calls the
GoTrue admin API to create an account and no Postgres function can substitute, so the key has to
be a Railway variable — and it bypasses every policy. The blast radius of the Railway
environment is the whole database. Recorded plainly in the runbook, along with the consequence:
the project's member list is now the list of people who can read every child's medical record.

**Two findings on the Supabase side.** `site_url` was `http://localhost:3000`, and every
invitation and recovery link GoTrue issues lands on it — so without the post-deploy step a real
staff member clicks their invitation and their browser tries to open a server on their own
laptop. And `password_min_length` was **6** while the invitation form has always refused
anything under ten: the product was promising a stronger minimum than the service enforced, and
any route that set a password without going through that form was held to the weaker rule.
Raised to 10 immediately; the URL change waits for a domain.

Also noted for before it goes public: `seed:demo` prints a parent password, and once the app is
on the internet that password reaches a login page. The data is fabricated so the harm is
bounded, but reseeding or purging is one command and leaving a known password on a public login
page is not a state to be in.

### A logic audit before deploying (`pending`)

Four findings. The first was in the money path and had no error attached to it.

**The funding export was reading the first thousand attendance events.** PostgREST is configured
with `max_rows: 1000` and returns a truncated result with `error` set to null. Measured rather
than reasoned about: 1,200 events for one child produced a report of 72 hours instead of the true
total, and two fabricated unresolved days, because the cut landed mid-day and left sign-ins with
no sign-out. Under-reporting the claim and inventing broken records simultaneously — the exact
inverse of the rule that nothing is estimated. Fixed with a pager that throws rather than
returning a partial result, since a partial answer is what caused it.

The first verification of that fix reported 84 hours where I expected 100, and the honest answer
was that **my probe was the wrong instrument** — its ten-minute cadence ran through midnight, so
`pairDay` was correctly reporting orphan sign-outs at every date boundary. Rebuilt as a drill
whose expected total is hand arithmetic (8 days × 75 sessions × 5 minutes = 50.00 hours), which
now passes exactly and fails at 41.66 when mutated. The lesson is that an improvement is not a
fix, and 72 → 84 was tempting to accept.

**`listChildren` would have produced an anonymous funding export.** The current roll is capped by
a licence, but `includeArchived` returns every child who ever attended — and that is the option
the funding page uses to turn an id into a name. A truncated read renders "a former child"
instead, on the one document whose purpose is to be keyed into a Ministry system per child. No
error, correct totals.

**The outbox buried sign-ins over a clock.** Every check violation was classified permanent,
including `attendance_not_future`, which fires when a device's clock is more than two hours ahead.
A drifted tablet would have its sign-ins marked dead on the first attempt — child off the roll,
ratio wrong all day, day missing from the funding record. It is self-healing, because real time
advances; but it also must not stop the flush, or one such event blocks every later sign-in behind
it. Three outcomes now, and the judgement moved to `@ece/core` where it can be tested without a
device — the most consequential logic in the offline path, and the only part of it that is
testable at all in this repo.

**`nextInvoiceReference` had a six-year fuse.** It took the highest reference by text order, which
matches numeric order only while the padding holds: `INV-10000` sorts below `INV-9999`. At ten
thousand invoices the sequence walks backwards and every insert collides.

The guard against the whole class took three attempts, and the middle failure is the instructive
one: a fixed line lookahead bled into the next function, so the unbounded query was declared
bounded by the following function's `.single()` and the suite passed with the bug still there —
the same shape of silent wrongness the guard exists to catch, inside the guard.

### Where the day ended




176/176 RLS assertions, 185 unit tests, 44/44 end-to-end checks across four roles, 16/16
security checks against the live schema, a 4/4 mutation-tested restore drill over 34 tables,
23 migrations, lint, tokens, doc links and performance budgets clean, both apps building.
Seven things now need a person rather than more code: **set the GitHub secrets so CI can actually
run** (every result above is local, on one machine, at a moment I chose), **import a checked criteria
set**, **verify the ratio bands against Schedule 2**, **verify the funding caps**, **get an EAS build**
(which unblocks both the airplane-mode drill and push delivery), **use a screen reader on the daily
screens**, and **host the privacy statement** so a store submission is possible at all. Every one is
in [`llm-wiki/wiki/unverified-claims.md`](llm-wiki/wiki/unverified-claims.md).

*Log last updated: 2026-08-04*
