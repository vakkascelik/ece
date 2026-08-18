# Roadmap — Phases 8 to 13

Implementation plan for the feature gaps identified against the New Zealand ECE market.
Written 2026-08-07. **Nothing here is built.** This is a plan, and several parts of it argue
against building the thing that was asked for.

Read [AGENTS.md](../AGENTS.md) first. Every phase below is subordinate to the five rules; where
a feature and a rule collide, the rule wins and the feature gets smaller.

---

## 0. Prerequisites — three of these phases depend on things already flagged as unverified

This is the most important section and it is first for that reason. Three dependencies of the
plan are recorded in [unverified-claims](../llm-wiki/wiki/unverified-claims.md) as never having
been executed. Building on them means building on an untested floor.

| Blocker | Claim | Blocks |
|---|---|---|
| §21 | The web outbox has never been through `drill:offline` | Phase 8 — sleep checks and medication logs are the most offline-dependent writes in the product |
| §15 | The mobile app has never run on a device | Phases 8, 9, 11 — registers are used on a tablet, not a laptop |
| §5 | Push notifications are built and have never been executed | Phase 8 (incident notification), Phase 12 (emergency broadcast) |

**Do these before Phase 8, not during it.** Generalising `apps/web/src/lib/outbox.ts` from
attendance to four more event kinds is a refactor of code whose behaviour under real failure is
unknown. Refactoring untested code is how you get a bug you cannot attribute.

### Two defects found while writing this plan

Unrequested, unfixed, reported rather than quietly patched:

1. **`packages/api/src/billing.ts:424` violates [AGENTS.md §4.3](../AGENTS.md).**
   `recordPayment` defaults `paid_on` to `new Date().toISOString().slice(0, 10)` — the exact
   expression the rule names as forbidden. For the whole New Zealand morning UTC is yesterday,
   so a payment recorded at 9am Auckland is dated the previous day. Fix is
   `todayInZone(centre.timezone)`, which needs the centre in scope at that call site.
2. **Three `default current_date` columns remain in the schema**:
   `medication_authorities.starts_on` ([0004](../supabase/migrations/0004_children.sql)),
   `fee_schedules.active_from` and `payments.paid_on`
   ([0019](../supabase/migrations/0019_billing.sql)). `children_due_for_purge` in
   [0008](../supabase/migrations/0008_retention.sql) also does date arithmetic against
   `current_date`. [0006](../supabase/migrations/0006_corrections.sql) fixed this class of bug
   for `children.date_of_birth` and did not sweep the rest. The medication one is the one that
   matters: an authority to administer a prescription medicine becomes valid a day early.

Neither is in scope for the phases below. Both should be closed first because Phase 8 writes
medication records and Phase 13 touches billing.

---

## 1. The checklist every new table in this plan must satisfy

Twenty-plus tables follow. Rather than repeat this per table, it is stated once and each phase
below only names its exceptions.

1. **Policy, grant, and an assertion in
   [`rls_isolation.sql`](../supabase/tests/rls_isolation.sql), in the same commit.**
   [AGENTS.md §4.2](../AGENTS.md). RLS is the second check; the grant is the first.
2. **Both halves.** A narrowing condition in `WITH CHECK` only is *not enforced on DELETE* —
   this cost five phases of a silently mutable issued invoice. The suite now asserts the class:
   every `_write_delete` policy's `USING` must equal its `_write_insert` counterpart's
   `WITH CHECK`. A new table either satisfies that or is added to the exemption list **with a
   reason**, not because it is failing.
3. **Audit trigger or exemption.** The suite asserts that every non-append-only, non-reference
   table carries a `<table>_audit` trigger. A new table must be added to the trigger loop in
   [0005](../supabase/migrations/0005_audit_triggers.sql) *or* to the exemption array in the
   suite. Adding it to the exemption array to make the suite pass is the failure mode this
   assertion exists to catch.
4. **Child-linked means `on delete cascade`.** `purge_child` deletes the `children` row and
   relies entirely on cascade. A new child-linked table with `on delete set null` or `restrict`
   either survives a purge (a privacy failure) or blocks it (an operational failure). Neither is
   discovered by any existing test — **add a purge assertion per new table**.
5. **Append-only means revoking the verbs from `service_role` too**
   ([AGENTS.md §4.4](../AGENTS.md)). Cascade deletes still work: `purge_child` is
   `SECURITY DEFINER` and referential actions run as the table owner, which is why a child can
   be purged out of `attendance_events` today.
6. **Never `current_date`.** `public.centre_day_start(centre_id)` in SQL,
   `todayInZone(centre.timezone)` in TypeScript.
7. **Reads go through `fetchAll`** (`packages/api/src/paging.ts`). PostgREST truncates at a
   thousand rows and reports no error — see [reading-every-row](../llm-wiki/wiki/reading-every-row.md).
   Then run `npm run drill:rowcap`.
8. **Enum additions are their own hazard.** `ALTER TYPE … ADD VALUE` is permitted inside a
   transaction on PG 12+, but the new value **cannot be used in the same transaction**. Adding a
   `notification_kind` and inserting a row that uses it must be two migrations, or the second
   statement fails at runtime in a way that looks like a typo.
9. **Mutation-test the new assertion.** Weaken the policy on purpose, confirm the suite fails on
   the assertion you just wrote. A test that passes first try on something subtle is suspect.
10. **Wiki page before the commit, not after** ([AGENTS.md §5](../AGENTS.md)).

Verification for every phase is the full gate: `typecheck`, `lint`, `test`, `test:rls`,
`tokens:check`, `check:docs`, `check:bundle`, `review:security`, `build`, plus the drills the
phase touches.

---

## Phase 8 — The daily register (child-linked)

**The largest gap in the product and the least interesting to build.** These are the forms a
centre fills in every day and the ones a reviewer asks for first. All four are absent.

### Design decision: four tables, not one

The tempting shape is one `child_register_events` table with a `kind` enum and a `jsonb detail`.
Rejected, for three reasons specific to this schema:

- `audit_events.detail` holds **column names and never values**, which is the only reason a
  child's record can be purged while the evidence it existed survives. A `jsonb` payload
  defeats that: the audit row would either name one column (`detail`) and record nothing
  useful, or contain medical text and become un-purgeable.
- Per-kind `CHECK` constraints in `jsonb` are unwritable in practice. A medication row needs
  `dose_given` present; a sleep check needs a position. One table means neither is enforced.
- RLS differs per kind. A guardian must read their own child's incident report. Whether they
  read the internal note attached to it is a different question, and column-level grants are
  per table.

Four tables, one shared column vocabulary (`child_id`, `at`, `recorded_by`, `client_uuid`,
`corrects`, `note`), is more surface and less rope.

### 0029 — `incidents`

```
incident_kind enum: injury | illness | behaviour | near_miss | other
incident_status enum: draft | final

incidents (
  id uuid pk, centre_id uuid not null → centres cascade,
  child_id uuid not null → children cascade,
  kind incident_kind not null,
  occurred_at timestamptz not null, location text, description text not null,
  first_aid_given text, treated_by uuid → auth.users set null,
  witness_name text,
  reported_by uuid not null → auth.users,
  status incident_status not null default 'draft',
  parent_notified_at timestamptz, notified_by uuid,
  acknowledged_at timestamptz, acknowledged_by uuid → guardians set null,
  supersedes uuid → incidents set null,
  created_at timestamptz not null default now(),
  constraint incidents_final_has_description check (...),
  constraint incidents_ack_complete check ((acknowledged_by is null) = (acknowledged_at is null))
)
```

**Draft → final, and final does not edit.** An amendment is a new row carrying `supersedes` —
the pattern already used by `custody_arrangements` (`superseded_at`) and attendance corrections
(`corrects`). The correction-as-new-row idiom works cleanly for a scalar; for a paragraph,
supersession is the honest version. Enforced by a `BEFORE UPDATE` trigger modelled on
`enforce_invoice_transition`, because a column grant alone cannot express "these two columns
only, and only by a guardian".

**RLS — the trap.** `caller_may_see_child` is true for staff *and* guardians. Using it for the
staff write path hands a parent the ability to write an incident report. Use
`caller_is_staff_for_child` for insert and for the staff update path, and
`caller_may_see_child` only for select.

**A guardian must not see a draft.** A half-written injury report arriving on a parent's phone
is worse than a ten-minute delay. Select policy for the non-staff case requires
`status = 'final'`. Assert it. This is the single assertion most likely to be got wrong.

Guardian acknowledgement is a column-limited UPDATE grant on `acknowledged_at, acknowledged_by`
with a policy requiring the caller to be a guardian of that child. Column grants are already
asserted separately from policies in the suite — follow that section's shape.

Audit trigger: **yes** (mutable). Add `incidents` to the 0005 loop.

### 0030 — `medication_administrations`

Append-only. `medication_authorities` records permission to give; nothing records the giving.

```
medication_administrations (
  id bigserial pk,
  authority_id uuid not null → medication_authorities cascade,
  child_id uuid not null → children cascade,     -- denormalised: RLS predicate and purge cascade
  given_at timestamptz not null,
  dose_given text not null,
  given_by uuid not null → auth.users,
  witnessed_by uuid → auth.users,
  client_uuid uuid not null unique,               -- offline idempotency, exactly as attendance
  corrects bigint → medication_administrations,
  note text, created_at timestamptz not null default now(),
  constraint medication_admin_not_future check (given_at <= now() + interval '2 hours'),
  constraint medication_admin_correction_has_note check (corrects is null or length(coalesce(note,'')) >= 3)
)
```

`child_id` is denormalised deliberately: without it every policy evaluation joins to
`medication_authorities`, and `purge_child` would depend on a two-hop cascade. State the reason
in the migration comment or somebody will normalise it away.

A `CHECK` that `given_at` falls inside the authority's `starts_on`/`expires_on` window **cannot
be a table constraint** (it references another table). It belongs in a `BEFORE INSERT` trigger,
and it must be a hard refusal — administering outside an authority is the licensing breach the
authority table exists to prevent.

**Do not hard-code a two-staff witness rule.** Whether a second signature is required is a
centre policy and possibly a licensing expectation; it is not sourced. `witnessed_by` is
nullable, `centres.medication_requires_witness boolean` drives the UI, and the claim goes in
[unverified-claims](../llm-wiki/wiki/unverified-claims.md).

Append-only: revoke `update`/`delete` from `anon, authenticated, service_role`. Add to the audit
exemption list in the suite **with the reason** ("the row is its own record").

### 0031 — `sleep_checks`

```
sleep_position enum: back | side | front | awake | not_observed

sleep_checks (
  id bigserial pk, child_id uuid not null → children cascade,
  at timestamptz not null, position sleep_position not null,
  breathing_observed boolean not null,
  checked_by uuid not null → auth.users,
  client_uuid uuid not null unique, note text, created_at ...
)
```

Append-only, same grants.

**The check interval is not in the schema and not in the code.** This is the
`RATIO_TABLES_VERIFIED` precedent applied a third time: the commonly cited 5–10 minute interval
is not sourced in this repo. Ship `SLEEP_CHECK_INTERVAL_VERIFIED = false` in
`packages/core/src/registers.ts`, let the centre configure `centres.sleep_check_minutes`, render
elapsed-time-since-last-check, and have the UI say the interval is the centre's own setting and
unverified. **Never render "compliant".**

### 0032 — `notification_kind` additions

`incident` and `medication`. Per checklist item 8, adding the values and using them are two
migrations. Guardian notification on incident finalisation depends on unverified-claims §5.

### Code

- `packages/core/src/registers.ts` — pure: `minutesSinceLastCheck`, `overdueChecks`,
  `summariseIncidents`, `administrationsWithinAuthority`. Tests in `__tests__/registers.test.ts`.
  No I/O, no dates from the system clock — pass `now` in, as `ratios.ts` does.
- `packages/api/src/registers.ts` — reads via `fetchAll`, writes mirroring
  `packages/api/src/attendance.ts` including the `client_uuid` idempotency contract.
- Web: `/incidents`, and sleep + medication surfaced on `/attendance` (they are the same
  physical moment — a tablet in the room). Nav entries behind `can(role, 'recordDailyPractice')`.
  Parent-visible incidents render on `/children/[id]`.
- Mobile: the same three, and this is where they will actually be used.
- Outbox: sleep checks and medication administrations must queue. This is the generalisation
  gated by §21 above.

### Wiki

New page `daily-registers.md`. Update [privacy-and-retention](../llm-wiki/wiki/privacy-and-retention.md)
(four new categories of health information), [conventions](../llm-wiki/wiki/conventions.md)
(the supersession idiom), and the index.

### Risk

The guardian-visibility policy on `incidents` is the highest-risk RLS change since consent-gated
media, and for the same structural reason: the boundary is *inside* a centre. Budget for the
first version being wrong and for the suite to be what finds it.

---

## Phase 9 — Centre-level registers

Same shape, no child link, therefore no purge exposure and a much simpler boundary: everything
is centre-scoped and staff-only.

| Migration | Table | Shape | Notes |
|---|---|---|---|
| 0033 | `drills` | kind (fire/earthquake/lockdown/tsunami), `held_at`, duration, adults/children present, issues_found, recorded_by | Mutable + audit trigger. **The required frequency is not sourced** — no "overdue" badge without a configured interval and an unverified flag |
| 0034 | `hazards` | description, area, risk_rating, control, identified_at, reviewed_at, resolved_at | Mutable + audit trigger |
| 0034 | `safety_checks` | area enum, passed boolean, note, checked_by, at, client_uuid | Append-only |
| 0035 | `visitors` | name, organisation, purpose, visiting, signed_in_at, signed_out_at, recorded_by | Mutable + audit trigger. Rejected alternative: in/out events like attendance — a visitor has no persistent identity to hang a second event on, so the nullable sign-out is simpler and equally honest |
| 0036 | `excursions`, `excursion_children`, `excursion_headcounts` | plan, destination, from/to, adults, transport; headcounts append-only with expected vs counted | See consent note below |
| 0037 | `immunisation_records` | child_id, status enum, sighted_by/at, next_due_on, note | Child-linked — cascade applies |

**Excursion consent already half-exists.** `consent_kind` includes `'excursion'`, but that is a
*standing* consent recorded in `consent_events`. A specific outing needs a specific decision. Do
not overload the enum. `excursion_consents (excursion_id, child_id, given_by, granted, at)`
append-only, and the standing consent stays what it is: a precondition, not a substitute. The
excursion screen should show both and never treat the standing one as covering the specific one.

**Immunisation: model status, not the schedule.** This is the [criteria-ship-empty](../llm-wiki/wiki/compliance-and-evidence.md)
argument exactly. Encoding the National Immunisation Schedule would produce a product that tells
a centre a child is "due" against a table nobody in this repo has checked, and the centre would
act on it. Store what was sighted and when; render no due-date arithmetic until the schedule is
sourced. Add to unverified-claims: **the enrolment-record immunisation requirement wording has
not been read against the regulation.**

---

## Phase 10 — Staff as people rather than a number

The binder currently admits that "adult counts are figures entered by staff, not derived from
individual staff sign-in" ([compliance-and-evidence](../llm-wiki/wiki/compliance-and-evidence.md)).
That admission is honest and it is also the gap. This phase closes it — and it is the phase most
likely to break existing behaviour, because it changes what a ratio *is*.

### The identity problem, which must be solved first

There are already three overlapping notions of a person: `memberships` (an app account with a
role), `staff_records.person_name` (a name on a certificate, deliberately without an account, for
relievers), and `auth.users`. Adding shifts and staff attendance needs a fourth thing — a person
who works here, whether or not they log in.

**0038 — `staff_members`**: `centre_id`, `full_name`, optional `user_id`, `role_note`,
`started_on`, `finished_on`. Then `staff_records.staff_member_id` is added **nullable**, and
existing rows are backfilled **by hand through a UI**, not by a name-matching migration.
Auto-merging people by name is how two relievers called Sarah become one person holding somebody
else's police vetting result. Say that in the migration comment.

### 0039 — `staff_attendance_events`

A near-copy of [0009](../supabase/migrations/0009_attendance.sql): append-only, `kind in|out`,
client-supplied `at` with the same skew tolerance, `client_uuid` unique, `corrects`,
`recorded_by`. Copying it deliberately rather than abstracting a shared table — the two have
different RLS (a guardian may sign their own child in; no guardian may see staff attendance) and
merging them would put staff hours under a predicate written for children.

### The ratio now has two sources, and they must not blend

`adults_present_now()` reads `staff_count_events`. After this phase there are two candidate
answers, and silently preferring one produces a compliance figure nobody can attribute.

- `centres.ratio_source enum ('declared','derived')`, defaulting to `'declared'` so no existing
  centre's history changes meaning on deploy.
- **`replayDay` must record which source produced each snapshot.** Without it, a binder printed
  after a centre switches sources is ambiguous about every day before the switch. This changes
  the `DayReplay` type in `packages/core/src/ratioHistory.ts` and its tests — the largest
  breaking change in this plan.
- Never average, never fall back. If a centre is `derived` and nobody signed in, the answer is
  "no adults recorded", which is a visible problem, not zero.

### 0040 — `shifts` and `leave`

`shifts (staff_member_id, on_date, from_time, to_time, role_note, status planned|confirmed|cancelled)`,
`leave (staff_member_id, from_date, to_date, kind, status)`. Mutable, audit triggers. An
exclusion constraint against overlapping confirmed shifts for one person, in the style of
`enrolments_no_overlap`.

### Certificated teacher percentage — derived, and stated without a funding claim

Derivable today: `staff_records` of kind `practising_certificate` with `expires_on` in the
future, intersected with people on shift. What must **not** be stated is the funding
consequence. That NZ funding rates step at certificated-teacher thresholds is not sourced in this
repo. Render "7 of 9 staff rostered on 14 March hold a current practising certificate; 2
certificates lapse before then" — a fact the centre can act on — and put the funding-band claim
in unverified-claims. A screen that says "your funding band drops on 14 March" and is wrong about
the threshold is exactly the confidently-wrong tool [AGENTS.md §4.5](../AGENTS.md) forbids.

### Timesheet export

CSV from `staff_attendance_events`, floored the same way `toHours` floors funding — for the
opposite reason, and say so in the comment: under-claiming the Crown is conservative,
under-paying staff is not. **Round staff hours to the nearest minute, not down.** Payroll API
integrations (PayHero, Smartly, iPayroll) are each a separate OAuth surface; CSV first, and only
integrate one after a centre asks by name.

---

## Phase 11 — Forward ratio forecast, and the kiosk

### The forecast — the one thing in this plan no competitor has

Everything it needs exists after Phase 10: `bookings` (planned children, with dates of birth for
the under-2 band) and `shifts` (planned adults).

`packages/core/src/forecast.ts`: `forecastDay(bookings, shifts, bands, date)` → the same breach
shape `replayDay` produces, over planned data instead of observed. Reuse `ratios.ts`; do not
reimplement the bands.

**It inherits the unverified flag.** The bands are `RATIO_TABLES_VERIFIED = false`. A forecast
built on unverified bands is an unverified forecast, and laundering the flag by putting it on a
new screen would be the most subtle version of the thing the flag exists to stop.

Web: a week view on `/attendance` showing planned ratio per session with the shortfall named
("Tuesday 1–3pm: 4 adults rostered, 5 needed for 12 under-2s"). This is a manager's Friday
afternoon problem and nothing in the NZ market solves it.

### The kiosk — a new trust boundary, and the riskiest change here

Today `attendance_insert` requires `recorded_by = auth.uid()`. A shared door tablet means every
parent logging in and out as themselves, which nobody will do.

Three options considered:

| Option | Verdict |
|---|---|
| A `SECURITY DEFINER` function granted to `anon`, like `submit_job_application` | **Rejected.** That function's whole defence is "insert one row, learn nothing, return void". An attendance kiosk must *show a roll*, which is a read of children's names in a centre by an unauthenticated caller |
| Parent's own phone only, no kiosk | Cheapest and best for privacy. Loses the door tablet, which is how centres actually operate. Keep as the fallback if the below proves too costly |
| **A dedicated kiosk membership role, plus a guardian PIN verified in Postgres** | Recommended |

Shape of the recommendation:

- A `kiosk` role in `memberships`, holding a long-lived session on a device the centre controls.
- `guardian_pins (guardian_id, pin_hash, failed_attempts, locked_until)` — **hash only**, the
  [invitations](../llm-wiki/wiki/invitations.md) precedent, with attempt limiting counted in the
  table rather than in process (an in-process limiter does not survive a restart and does not see
  a second instance — the `submit_job_application` reasoning).
- `attendance_events.attested_by uuid → guardians` — who pressed the button, distinct from
  `recorded_by` (the kiosk). **This modifies an append-only, funding-critical table.** Adding a
  nullable column is safe; changing the insert policy is not. Assert the old attribution rule
  still holds for non-kiosk callers.
- The kiosk role must not be able to read children's records beyond name, photo and present/absent.
  That is a **restricted view plus a role**, not a filtered query in the app —
  [AGENTS.md §4.1](../AGENTS.md).

Expect defects. This phase touches the funding-claim table and adds an authentication factor;
those are the two most consequential surfaces in the product.

---

## Phase 12 — Parent self-service

### 0044 — `enrolment_applications`

A parent-completed enrolment is **a stranger's claim, not the centre's record**, and the
distinction is already argued in [0024](../supabase/migrations/0024_recruitment.sql) for
`job_applications` versus `staff_records`. Same treatment: a separate table, staff promote it to
`children` + `guardians` + `enrolments` by hand, and nothing auto-creates a child.

The public write path reuses the `submit_job_application` design exactly: one `SECURITY DEFINER`
function granted to `anon`, resolving the centre from a slug so a forged call cannot choose a
tenant, rate-limited by a count against the table, returning void.

**`scripts/security-review.ts` check 8 will fail.** Its allowlist names exactly one
anon-executable definer function today, and its message is precise about why that one is safe.
Extend the allowlist and **rewrite the message** so it stays true of both. A check whose
explanation has quietly stopped applying is worse than no check — that is the review's own
recorded lesson.

### Smaller items

- **Annual details re-confirmation**: `detail_confirmations` append-only (`guardian_id`,
  `child_id`, `confirmed_at`). Answers "when did this family last confirm the emergency contacts
  were right", which is a question a reviewer asks and nothing currently answers.
- **Parent absence notice**: a guardian-scoped insert/update policy on `bookings` limited to
  `status = 'absent'` and to their own ward's rows, future dates only. Small, and it is the most
  requested parent feature in this market.
- **Emergency broadcast**: a `notification_kind` and a fan-out. Build on push and email first.
  SMS means a vendor, a cost, a phone-number column that is a new PII surface, and a change to
  [privacy-statement.md](privacy-statement.md). Do it behind a flag, with the vendor named.

### Translation — refuse the obvious implementation

Auto-translating posts into a family's home language is a genuine differentiator in Auckland and
the obvious implementation is a privacy problem: sending a post about a named child to an
overseas translation API is a **cross-border disclosure of personal information** (IPP 12), made
by default, on behalf of a family that consented to a learning journal and not to that.

If built: an explicit per-centre consent decision, the provider named in
[privacy-statement.md](privacy-statement.md), a `consent_kind` for it, and translation refused
for any post whose children have not got that consent — the trigger-enforced pattern from
[consent-gated-media](../llm-wiki/wiki/consent-gated-media.md), not a UI check.

Recommendation: defer. The consent surface costs more than the feature returns until a centre
asks for it.

### Te reo Māori interface

There is **no i18n layer**; strings are inline in components. This is mechanical work touching
every component in `apps/web` and `apps/mobile`, and it is not a feature so much as a week of
tedium plus an ongoing translation obligation on every future string. Scope it honestly, and if
it is done, do it before the UI surface doubles in Phases 8–11 rather than after.

---

## Phase 13 — Money and platform

- **Xero / MYOB export.** Start with a CSV in Xero's sales-invoice import format — no OAuth, no
  token storage, no refresh handling, and it works on day one. A real OAuth integration stores a
  per-centre refresh token, which is a new secret surface in a database that currently holds no
  third-party credentials. Do not add that until a centre asks.
- **Arrears.** A view over `invoice_totals` minus `payments`, aged. No new table.
- **Funding paid versus claimed.** *Correction to the earlier framing:* `npm run
  reconcile:funding` already exists, but it reconciles the **calculation** against figures worked
  out by hand in the script's comments. It does not compare a claim to what the Ministry actually
  paid. That needs `funding_receipts (centre_id, period, amount_cents, received_on)` and a
  variance report. A centre that finds an under-claim renews without a conversation.
- **Reporting.** Occupancy, attendance trends, waitlist conversion. Every one of these is a
  many-row read: `fetchAll`, then `drill:rowcap`.
- **Importers.** `scripts/import-storypark.ts`, `scripts/import-discover.ts`. Follow
  `import:criteria` and **refuse a file without a stated source**. Migration tooling is how
  switchers switch, and it is cheap relative to everything above it.

---

## Tier 4 — pedagogy, deliberately scoped down

**Do not build a portfolio product.** Storypark holds years of learning stories for most NZ
centres; portfolio data is the stickiest asset in this market and a centre will not abandon it
for a better attendance screen. Building an inferior portfolio against an incumbent holding the
data is a losing fight, and it is the largest surface in the whole plan.

Build two things instead:

1. **`post_strands`** — tag a post to a Te Whāriki strand so the evidence binder can show
   curriculum coverage. That is compliance, which is this product's ground. Seed the five strands
   with a `source` field naming Te Whāriki (2017); **leave the goals and learning outcomes
   empty**, exactly as `criteria` ships empty, until somebody sources them.
2. **The Storypark importer**, above.

---

## Sequencing and effort

Estimates are engineering-days for one developer who knows this codebase, and they are estimates.

| # | Phase | Days | Depends on |
|---|---|---|---|
| 0 | Prerequisites: `drill:offline`, a device run, one real push, two date defects | 3–5 | — |
| 8 | Child-linked registers | 12–18 | 0 |
| 9 | Centre-level registers | 8–12 | — (parallelisable with 8) |
| 10 | Staff as people, derived ratio, roster | 15–20 | — |
| 11 | Forecast + kiosk | 10–15 | 10 |
| 12 | Parent self-service | 10–15 | — |
| 13 | Money and platform | 10–15 | — |
| — | Te Whāriki tagging + importer | 5–8 | — |

**Build order if the goal is 50 services** (**corrected 2026-08-18** — this used to call 50 "the
ELI application threshold, and therefore the only number that changes the product's strategic
position". It is not a threshold: the Ministry requires the product be *capable* of supporting 50
services, not that fifty use it. The build order below still stands on its commercial merits, which
is why it is unchanged): **10 → 11 → 8 → 9 → 13 → 12**. Staff
sign-in and the forward forecast are what a multi-site not-for-profit or a kindergarten
association buys, and one association is fifty services. The registers are table stakes that stop
you losing a deal; the forecast is the thing that wins one.

**Build order if the goal is not losing Little Pearls**: 8 → 9 → 12 → 10 → 11 → 13. The
registers are what they use every day.

---

## What this plan deliberately does not do

- **An ELI integration.** Not possible today, because the Ministry is not accepting applications
  — still under review as at 2026-08-18, with no published end date. **Corrected 2026-08-18:**
  this line used to say "Foreclosed: approval requires supporting 50 services before you may
  apply." That was wrong — the 50 is a capability requirement, not a customer count, confirmed
  by the Ministry. "Foreclosed" was too strong and it was the word doing the work here. See
  [funding-and-billing](../llm-wiki/wiki/funding-and-billing.md).
- **Stripe.** The reasoning in the wiki still holds while the price is NZ$0.
- **A portfolio product.** See Tier 4.
- **The National Immunisation Schedule, drill frequencies, sleep-check intervals, or funding
  bands** as data in this repo. Every one of them is a figure nobody here has sourced, and each
  would make the product assert something it cannot support.

Every phase above adds at least one entry to
[unverified-claims](../llm-wiki/wiki/unverified-claims.md). If a phase ships without one, that is
a signal something was asserted rather than checked.
