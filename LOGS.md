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

### Where the day ended

119/119 RLS assertions, 104 unit tests, 12 migrations, lint and tokens clean, both apps building.
Four things now need a person rather than more code: **import a checked criteria set**, **verify
the ratio bands against Schedule 2**, **run a real airplane-mode drill on a tablet**, and **set
the GitHub secrets so CI can actually run**. All four are in
[`llm-wiki/wiki/unverified-claims.md`](llm-wiki/wiki/unverified-claims.md).

*Log last updated: 2026-08-04*
