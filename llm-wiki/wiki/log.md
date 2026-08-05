# Change log

*Append-only record of all wiki changes. Correcting an earlier entry means a new entry that
says so.*

---

2026-08-04 — Wiki initialised, following the pattern in `salix/llm-wiki`. Eight pages written
from the four sessions that built Phases 0–3, rather than from a fresh read of the source:
[[tenancy-and-rls]], [[attendance-and-ratios]], [[offline-outbox]],
[[compliance-and-evidence]], [[invitations]], [[privacy-and-retention]], [[conventions]] and
[[unverified-claims]]. Deliberately **not** a second copy of the root `README.md` — that holds
how to run it and the decisions a contributor needs before touching code; these pages hold why
decisions were made, what was tried and rejected, and what is asserted without a source. Two
additions to the salix page template, both earned by this domain: rejected alternatives are
part of a page rather than a footnote, since most of the expensive knowledge here is "the
obvious thing was tried and here is how it failed"; and any claim about a regulation, duration
or threshold carries its source inline or does not go on a topic page at all.

2026-08-04 — No `wiki.py` copied, and the reason recorded in the README. The salix script's
pages are edited by hand rather than produced by `ingest`, so shipping the CLI here would imply
the pages are generated and can be regenerated. It also needs pip, a requirements file and an
API key to do a job an agent with file access already does directly. Noted where to copy it
from if a scripted ingest is ever wanted, including that its `wiki/*.md` glob is non-recursive
and cannot see subfolders.

2026-08-04 — [[unverified-claims]] created as the entry point of the whole wiki, and linked
first from the index. Seven items: the ratio bands (highest priority — `RATIO_TABLES_VERIFIED`
is false and both the web banner and the mobile bar say so); the absent licensing criteria;
the seven-year retention default; the missing device drill; the per-kind warning lead times;
the regulatory timing claims inherited from the salix product plan and never re-checked here;
and the fact that Phase 1 built enrolment on one customer's word after the plan's Stage 0 —
ten conversations, zero code — was skipped. The pattern to keep: if a claim cannot be sourced,
make the *product* say so in a machine-readable flag, and put it on that page. Two of the
seven already work that way.

2026-08-04 — Recorded in [[privacy-and-retention]] a correction to a claim this repo made
earlier: the Privacy Act 2020 does **not** give a right to request deletion. It gives access
(IPP 6) and correction (IPP 7); there is no general right to erasure in New Zealand law, which
is GDPR Article 17. What it imposes is IPP 9, a retention limit on the agency — an obligation
discharged by following a schedule, not an endpoint an individual triggers. The design follows
from that: a scheduled sweep is the mechanism and ad-hoc purging is the restricted exception.
Also noted that IPP 6 is the reason an educator can read their own police vetting result, which
reads like a convenience and is a statutory right.

2026-08-04 — [[conventions]] collects the traps that have already cost time: `current_date`
under a UTC session being yesterday for the whole New Zealand morning (which rejected a baby
born that morning as born in the future); PostgREST bulk inserts sending explicit `NULL`
instead of taking column defaults; the 1000-row cap on an unbounded select; `upsert` without
`ignoreDuplicates` needing `UPDATE` privilege and therefore failing `42501` before any `CHECK`
runs, which made one test pass for the wrong reason; and `create or replace view` refusing to
change a column list, which made the migrations un-replayable until both offending views were
switched to drop-then-create.

2026-08-04 — Added [[consent-gated-media]] for Phase 4. The page exists mostly to record one bug
and one rule. The bug: the consent check was written inside the permissive `media_select` policy
while `media_write` was declared `FOR ALL` — and `FOR ALL` covers SELECT, and permissive policies
are OR-ed, so staff matched the write policy and the consent condition never had to be satisfied. It
hid correctly from whānau and not at all from educators, which is why it survived a first review: the
retroactive half looked like it worked for the caller most likely to be tested. The rule that came
out of it: a condition that must hold for *every* reader belongs in a **restrictive** policy, which
is AND-ed with all of them and cannot be routed around by adding another; a condition about *which*
readers belongs in a permissive one. Every other `FOR ALL` policy in the schema was re-read
afterwards and all are narrower than their matching select policy, so `media` was the only case with
the dangerous shape.

2026-08-04 — Recorded in [[unverified-claims]] that push notification delivery has never run once.
The model, the preferences and the quiet-hours arithmetic are built and tested — including a window
that wraps midnight, evaluated in the centre timezone across both sides of the daylight-saving switch
— but no notification has ever reached a device, and there is no worker reading the queue. Listed
alongside the airplane-mode drill for the same reason: a thing that looks finished and has never
executed is worth naming rather than discovering.

2026-08-04 — Added [[funding-and-billing]] for Phase 5. The organising rule: hours become a claim on
the Crown, so **nothing is estimated**. A day with a missing sign-out is excluded and named rather
than guessed up (a false claim) or silently zeroed (which loses the centre funding it is owed and
hides the record error), and every rounding decision floors. Two orderings that are easy to get
backwards are recorded with their arithmetic: the daily cap must be applied before the weekly one,
because Monday's excess is not transferable to Tuesday; and corrections must be resolved
transitively, because a fixed sign-in time otherwise counts twice.

2026-08-04 — Recorded the deliberate omissions in [[unverified-claims]]: the funding caps, the fact
that funding *periods* are a parameter rather than a guess, and that there are **no funding rates
anywhere in the product** — a rate is a number the Ministry publishes and changes, and inventing one
would let a centre budget against a figure this product made up. Also recorded why Stripe was not
built: the pilot is free, most centres already collect through their own systems, and none of Stripe's
real decisions are decidable while the price is NZ$0.

2026-08-04 — Added [[production-readiness]] for Phase 6, the phase whose job was to find out what is
not true. Three of its five deliverables are exercises rather than opinions — you cannot audit
accessibility by reasoning about it, verify a backup by believing in it, or delete a tenant by
intending to — and two of them failed the first time.

2026-08-04 — Recorded the defect the audit fixture found by needing to clean up after itself: **a
centre could not be deleted, by anybody, ever.** Deleting a centre cascades to children, whose audit
trigger inserts a row referencing the centre that has just been removed, so the foreign key rejects
it and the transaction aborts. Five phases had shipped with no way to offboard a customer, and neither
the type system nor the RLS isolation suite could have surfaced it, because none of them tries.
Migration 0020 drops the foreign key — a correction rather than a workaround, because `audit_events`
is a ledger and **a ledger has to outlive its subject**.

2026-08-04 — Recorded why the accessibility fixture seeds loaded screens rather than using empty ones:
axe cannot find a contrast failure in a table with no rows or an unlabelled control in a form nobody
rendered, and every screen in this product has an empty state that passes trivially. The audit found
one critical failure — the role selector on the People screen had no accessible name, so a screen
reader announced "combo box, educator" once per person with nothing to say whose row it was.

2026-08-04 — Recorded in [[unverified-claims]] (items 10–12) that two legal citations in the new
user-facing documents are unchecked, and that **no screen reader has ever been used on this product**.
axe passes on 19 screens in both roles with no advisory warnings either, which is a floor and not a
pass: it finds perhaps a third to a half of WCAG failures and cannot tell whether a focus order makes
sense or whether an error message helps anybody.

2026-08-04 — Recorded that the restore drill was **mutation-tested**, and why that matters more than
it passing. A character appended to a timestamptz was caught by the type system, not by the
comparison; a character appended to a free-text column loaded successfully and then failed the
comparison, naming the table — one character, one column, one row, out of 485. Without the second
mutation the comparison might have been comparing something with itself.

2026-08-04 — Added [[security-review]]. Sixteen checks written as SQL against the live schema rather
than as a reading of the migrations, which is the only reason four findings surfaced: in every one the
code said the right thing and the database did not enforce it. An issued invoice did not freeze though
the README said it did; the audit trigger had covered ten tables since April while the schema grew to
twenty-two, `staff_records` among the uncovered; there were no security headers at all; and fourteen
tables still carried the `FOR ALL` shape that produced the Phase 4 consent leak.

2026-08-04 — Recorded that fixing the missing security headers **broke every write in the
application**. `Referrer-Policy: no-referrer` was correct reasoning — these URLs carry child UUIDs —
and Next's server-action origin check falls back to `Referer` when `Origin` is absent, so it parsed the
string "null". Every server action is a write, so the roll rendered and signing a child in did
nothing, with typecheck, lint and build all clean. Kept as a worked example of a security control that
fails by disabling the product rather than by permitting something.

2026-08-04 — Recorded in [[unverified-claims]] as item 14 the four claims this repo made in writing
that were not true, including one about where a file lived that was wrong for two weeks. The pattern:
each was a claim about a mechanism derived from reading the code that implements it. Two were caught by
asking the database and one by running `pwd`; none was caught by review. A claim about what the product
enforces now belongs next to a test that fails when it stops being true.

2026-08-05 — Recorded the first real tenant. Little Pearls Educare Centre, two centres, real Ministry
service numbers from two agreeing government directories, and **zero children** — the insurance gate
is still open and the tenant holds nothing but a name, a number and a timezone precisely so that line
has not been crossed. Third-party directory claims about licensed capacity and opening hours were left
out; one of them contradicts the centre's own site about its own hours, which is a fair measure of what
those listings are worth.

2026-08-05 — Recorded the trap onboarding uncovered: the demo centres held the **real customer's
slugs**, and `seed-demo.ts` selected its centres with `slug like 'little-pearls-%'`. The first demo
seed after the real tenant existed would have written seven invented children — including a fabricated
peanut anaphylaxis plan — into a live service's roll, and the following run's `purgeAll()` would have
removed them again, so it would have looked like nothing happened. Caught by a unique index refusing
the insert, which is luck rather than design. Demo data now lives under `demo-` and the script refuses
to run if its pattern matches anything else.

2026-08-05 — Recorded that the e2e harness leaked six centres and fifty-six accounts, because the
teardown runs on a failing test but not on a dying process, and because it looked accounts up through
`auth.admin.listUsers` — which returns a 500 with an empty body on this project, a fact `onboard.ts`
had documented and this code had ignored. It now deletes by known ids and sweeps stale tenants before
its own work, so a killed run heals on the next one.

2026-08-05 — Added [[reading-every-row]]. PostgREST is configured with `max_rows: 1000` and returns a
truncated result with `error` set to null, which was under-reporting a funding claim by 28% **and**
fabricating unresolved days that were not broken — wrong in both directions at once, in the
calculation whose entire principle is that nothing is estimated. Measured against the live database
rather than reasoned about. The page keeps three things: that a bigger limit moves the cliff rather
than removing it; that paging over a non-unique order is its own silent corruption, so every paged
query gained `id` as a tiebreaker; and that the guard test lied twice before it was honest — most
instructively when a fixed line lookahead bled into the next function and declared the unbounded
query bounded, which is the same shape of silent wrongness the guard exists to catch, inside the
guard.

2026-08-05 — Recorded in [[reading-every-row]] that the first row-cap probe was a **bad instrument**.
Its ten-minute cadence ran through midnight, so `pairDay` correctly reported orphan sign-outs at
every date boundary; the fix improved the number from 72 to 84 against an expected 100, and 84 was
tempting to accept. The expectation was wrong, not the fix. Rebuilt with hand arithmetic in the
script's comments so the expected total is checkable without running anything.

2026-08-05 — **Corrected [[offline-outbox]], which was wrong in writing.** It listed two failure
verdicts and put every check violation under `permanent`. `attendance_not_future` is a check violation
that fires when a device clock runs more than two hours fast — and it is self-healing, because real
time advances. Classified permanent, a drifted tablet would have its sign-ins marked dead on the first
attempt: child off the roll, ratio wrong all day, day missing from the funding record, over a clock.
There are three verdicts now, and the two clock constraints look almost identical and behave in
opposite directions, which is how one rule came to swallow both.

2026-08-05 — Recorded in [[offline-outbox]] the finding that decided the whole shared-tablet story and
was missed until a design review: `recordAttendance` stamps `recorded_by` at **flush time**. So
leaving one educator's queued sign-ins for the next person's token files their observations under the
wrong name, permanently, in a table with no UPDATE grant — and if that person is not a member of the
centre, RLS refuses it, the flush loop breaks, and every later sign-in jams behind it for the rest of
the day. The queue now carries a `user_id`. Also corrected `clearAll()`'s docstring, which claims
sign-out is its caller: it is not, and the first sign-out implementation followed it and would have
destroyed attendance records.

2026-08-05 — Added [[mobile-app]]. For five phases the app rendered the words "Not signed in." and
offered nothing — no email field, no password field, no `signInWithPassword` anywhere in the
workspace. It typechecked, linted, bundled through Metro in CI, and had components with careful
accessibility labels, and none of those checks can tell you the product has no front door. The page
records the three independent walls that make sign-up, invitation acceptance and password reset
structurally impossible on mobile, so nobody tries to move them there.

2026-08-05 — Added [[deployment]], written because two questions were asked that nothing in the repo
answered: whether the deployment is per-customer (it cannot be — you cannot publish one App Store
binary per childcare centre, and once that is true for mobile, a different web model means two
tenancy models), and what putting the container on the internet costs (a service-role key that
bypasses every policy, because the invitation flow calls the GoTrue admin API and no Postgres
function can substitute). Also kept as a worked example: `Referrer-Policy: no-referrer` was correct
reasoning about child UUIDs in a `Referer` header, and it made **every write in the product fail**
while every page rendered perfectly, with typecheck, lint and build all clean.

2026-08-05 — Recorded in [[unverified-claims]] as items 15–17: the mobile app has never run on a
device, three store blockers are not code, and — found while designing the account deletion Apple
asks for — deleting an `auth.users` row would **erase attribution in licensing evidence**, because
`audit_events.actor_id`, `attendance_events.recorded_by` and `staff_records.sighted_by` are all
`on delete set null`. That attribution is the evidence the compliance feature exists to produce, and
an account-deletion feature built the obvious way would quietly destroy it.

2026-08-05 — Recorded in [[conventions]] that **the wiki is updated before the commit, not after** —
a standing instruction from the owner, promoted from a soft bullet in `AGENTS.md`'s standing
constraints to a gate in its verification section, because as a bullet it was exactly what got
skipped: four commits shipped and the wiki update was batched behind them.

The clause that matters most is the one about contradictions: if a change contradicts something a
page already says, **correct that page first**. A wiki that is wrong is worse than no wiki because
it is trusted, and there is a precedent rather than a hypothetical — [[offline-outbox]] spent a day
asserting that every check violation was a permanent failure, which was the exact opposite of the
fix just made, on the page somebody would read before touching the offline path.

Also removed the assertion count from `AGENTS.md`'s verification checklist. It said 119 and the
suite is at 176; a number in a checklist is a number that goes stale, and the counts live in the
tools that print them.

2026-08-05 — Recorded in [[deployment]] that Railway's workspace detection offers **two** services,
`@ece/web` and `@ece/mobile`, because `apps/mobile/package.json` has a `start` script — which is
`expo start`, a development bundler rather than a server. The mobile service must be deleted: a
container running it costs money, serves nothing reachable, and fails the health check forever. Worth
writing down because it does not look like a mistake in the dashboard — it has a name, a green badge,
and sits beside the real one.

The same detection sets the root directory to `apps/web`, and that failure is the silent one.
`railway.json` lives only at the repository root, so from `apps/web` Railway never sees it and
guesses the build command, the start command and the health check path — a deploy that looks
configured and is not.

*Log last updated: 2026-08-05*
