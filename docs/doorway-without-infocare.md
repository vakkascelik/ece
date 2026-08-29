# Doorway without Infocare — implementation plan

Making every replacement work while Infocare keeps the SMS job. Phased by **what blocks what**,
not by module, because the three tracks below have entirely different blockers and only one of
them can start today.

Written 2026-08-29. The strategy is in
[`importing-infocare.md`](importing-infocare.md) §0; this is how it gets built.

Companion documents: [`replacing-1place.md`](replacing-1place.md) (done, 2026-08-28),
[`importing-infocare.md`](importing-infocare.md) (the roll copy), [AGENTS.md](../AGENTS.md) §4.2
for the table checklist and §4.3 for dates.

**A note on the estimates.** The 1Place plan's estimates were wrong in both directions — one phase
needed no migration at all, another needed five tables. Sizes below are stated so the *order* can
be argued with, not because they will hold.

---

## The shape of the problem

| Track | What | Blocked on | Can start |
|---|---|---|---|
| **1 — Groundwork** | The funding guard and the integration key (the date-defaults phase turned out to be already fixed — §Phase 2) | **nothing** | now |
| **2 — The roll** | The Infocare importer, and running it | Infocare's export — and nothing else since 2026-08-29 | build now, run later |
| **3 — Parity** | VisTab and Educa, and the 1Place leftovers | screenshots; one decision about photos | assessment now |

**Track 1 waits for nobody and contains the only item that can produce a wrong number on a
return to the Crown.** That is the entire argument for this ordering. The natural instinct is to
start with the importer, because it is the visible piece and the one somebody asked for; the
importer is Phase 5.

---

## Phase 0 — Four asks, today, none of them code

These go out first because every one of them has somebody else's latency in front of it, and
three of the phases below are blocked behind them.

| Ask | To | Blocks |
|---|---|---|
| **The Infocare export, per module — and the partnership conversation**, in one message ([`importing-infocare.md`](importing-infocare.md) §11) | Infocare | Phases 5, 6, 7 |
| **Screenshots of VisTab and Educa**, the way the 1Place ones were taken | the centre manager | Phases 9, 10 |
| **The room list and the twelve checklist templates** | the centre manager | nothing — but 1Place is not actually replaced until this is entered, and the screens read as broken while empty |

**This list was four items and is now three.** The fourth was *"is the professional indemnity
insurance in place?"*, which blocked the entire import run. The owner removed that gate on
2026-08-29 after it was traced to a bullet in a day-one list of open questions rather than to any
external requirement — see [`tenant-little-pearls.md`](tenant-little-pearls.md), *The gate that was
lifted*. Nothing in this plan waits on it any more.

Of the three that remain, one has been outstanding since 2026-08-28. Sending them again with a
deadline is cheaper than any code in this document.

---

# Track 1 — groundwork, starts now

## Phase 1 — The funding record-start guard

**The only item here that can put a wrong number on a return to the Crown.** Do it first.

Under the copy arrangement Doorway's attendance record begins at the cutover date. Verified in
[`packages/core/src/funding.ts`](../packages/core/src/funding.ts): `childFunding` with no events
in the period yields an empty `inPeriod`, so `complete` and `unresolved` are both empty —
`fundedHours: 0`, `unresolvedDates: []` — and `summariseFunding` then reports
`unresolvedChildCount: 0` and **`complete: true`**. A period before cutover renders as zero hours,
final. RS7 is four-monthly, so the first return after cutover necessarily spans such a period.

**Build:**

- `@ece/core` — `FundingSummary` gains `recordStartsOn: string | null` and a derived
  `periodPrecedesRecord: boolean`. `summariseFunding` takes the centre's earliest attendance date
  as an argument. **Null is not false**: null means "not supplied", and the summary must render
  that differently from "the record covers the period" — the `overdue: null` contract, its sixth
  outing.
- `exportDisclaimer` — a new leading sentence when `periodPrecedesRecord`, ahead of the existing
  unresolved-children sentence. The export leads with completeness; this belongs at the top.
- `@ece/api` — the earliest `attendance_events.at` for the centre, converted in the centre's
  timezone, never `toISOString().slice(0,10)`.
- `apps/web` `/funding` — a banner, and `complete` must not render as final while this is true.

**Verify:** unit tests over `summariseFunding` with (a) no events at all, (b) events starting
mid-period, (c) events covering the period. Mutation-test it — flip `periodPrecedesRecord` to
constant `false` and confirm a named assertion fails. AGENTS.md §4.2: anything that passes first
try gets mutated.

**No schema. No RLS. Size: small.** Blocked on nothing. The cutover date is *not* a dependency —
the guard reads the record, not a configured date.

## Phase 2 — ~~The three `default current_date` columns~~ **Already fixed. Corrected 2026-08-29.**

**This phase was wrong and is struck out rather than deleted, because the mistake is more
useful than the phase was.**

I reported three columns carrying `default current_date` —
`medication_authorities.starts_on`, `fee_schedules.active_from`, `payments.paid_on` — and
sourced it by grepping the migrations that *create* those tables (0004 and 0019). Migration **0029**, applied 2026-08-07, altered all three to `(now() at time zone 'Pacific/Auckland')::date` and added a
catalogue guard that reads `information_schema.columns` for exactly this pattern, with no
exemption list. That guard passes against the live database, which is proof rather than
inference: the defects are not there.

**The error is the same class as 0068's.** That one re-declared a function from a prose
header instead of its source; this one read a column's creating definition instead of its
current state. A migration file is not the schema. The schema is what `information_schema`
says, and there is already a check that asks it.

What survives, and it is much smaller than a phase: 0029's defaults hardcode
`Pacific/Auckland` rather than the centre's timezone, which its own header defends —
*"the per-centre-correct value is not expressible as a default at any price"*, and a caller
holding a centre should pass `todayInZone(centre.timezone)` instead. The same residual sits
in `billing.ts:575`, which calls `todayInZone()` with no argument and so takes the NZ
default. Both are correct for every tenant while this is a New Zealand product, and both are
latent for the first one elsewhere. **Worth a comment, not a migration**, and there is
nothing here for the importer to trip over.

**What the importer still needs from this area** is unchanged and is the part worth keeping:
it will be a new writer against `medication_authorities`, and it must pass `starts_on`
explicitly from the file rather than lean on any default — because the default answers "when
was this typed in", and the file is answering "when did the authority begin".

## Phase 3 — The integration key

`source_system text` and `source_ref text`, nullable, on `children` and `guardians`, unique per
`(centre_id, source_system, source_ref)`.

Generic rather than `infocare_id`: a vendor name in a schema outlives the vendor. Now rather than
with the integration: the manual import is the only moment when a human is looking at both systems
and can establish the correspondence cheaply. After that it is archaeology, and guardians have no
natural key at all — a mother with two children and a changed surname is not identifiable by
anything the schema currently holds.

**Build:** one migration. Columns on an existing table inherit its policies, but AGENTS.md §4.2
still wants the grant checked and an assertion written — specifically that a parent cannot read
another family's `source_ref`, which falls out of the existing `children` policy and should be
pinned anyway.

**Verify:** `test:rls`. **Size: small.**

---

# Track 2 — the roll

Build order matters here: the dry-run path is worth having before the file arrives, which is the
deliberate inverse of the 1Place mistake where the plan waited on files that turned out to be empty.

## Phase 4 — The ownership contract, written down

Before any code: [`importing-infocare.md`](importing-infocare.md) §2's field table becomes the
importer's specification and, later, the API sync's. This is a review step, not a build step, and
it exists as its own phase because getting it wrong is invisible until a re-import flattens
something.

**Deliverable:** the table, confirmed against the real export's columns once Phase 0 returns them.
**Size: an hour.** Blocked on the export for confirmation, not for drafting.

## Phase 5 — `scripts/import-infocare.ts`, dry run only

**No write path in this phase at all.** Parse, validate, match, refuse, report.

Follows [`import-storypark.ts`](../scripts/import-storypark.ts) and
[`import-discover.ts`](../scripts/import-discover.ts): Doorway's own JSON shape, never a parser for
Infocare's format; `source` required; `--commit` required to write, and here there is nothing to
write yet.

The refusals are the substance, and every one is exercisable against a handwritten fixture with no
real data and an empty roll:

- refused keys — photos, consent, custody, sightings, invoices, funded hours
- NSN matching, and the name-disagrees-with-NSN refusal
- name fallback: zero or several matches refuses the row
- a child with zero guardian links
- overlapping enrolments (`enrolments_no_overlap`)
- `can_collect` absent — required, no default
- the before/after report for every field the re-import would overwrite

**Verify:** unit tests over the matching and refusal logic in `@ece/core` where it can live
without a database; the script itself run against fixtures. **Size: medium.** Blocked on Phase 0
only for the real column names — the shape is Doorway's, so it can be built against the documented
file format now.

## Phase 6 — The write path

Behind `--commit`, implementing Phase 4's ownership table: overwrite what Infocare owns, never
touch what Doorway owns, report every change, and **never revoke a guardian link** that is absent
from the file.

**Verify:** run against a seeded scratch centre — `seed:demo` exists — including a second run
after editing the file, which is the case the ownership table exists for. **Size: medium.**
Depends on 3, 4, 5.

## Phase 7 — Run it

**Blocked on the export arriving, and nothing else** — the insurance gate that used to sit here
was removed on 2026-08-29. Dry run, read the guardianship report end to end, fix the file, repeat,
then `--commit`.

**Size: a morning, mostly reading.** Not a code phase.

## Phase 8 — Forward bookings

`bookings` carries no `not_ancient` constraint, so the current term's bookings can be imported and
the cutover date has a roll behind it. Attendance history stays in Infocare —
[`importing-infocare.md`](importing-infocare.md) §5.

**Size: small**, an extension of Phase 6. Depends on 7.

---

# Track 3 — parity

## Phase 9 — VisTab: assess, then fill

`visitors` (0035) holds `full_name`, `organisation`, `purpose`, `visiting`, `signed_in_at`,
`signed_out_at`, `recorded_by`, and `/visitors` renders it.

**Parity has never been assessed and this repo has never seen VisTab.** I am not going to list
what it does from general knowledge — that is precisely the
[`unverified-claims`](../llm-wiki/wiki/unverified-claims.md) failure mode, and the 1Place exercise
is the evidence that it is unnecessary: one afternoon of screenshots produced a module-by-module
gap table and found two structural gaps that no amount of reading our own code would have
surfaced.

**Phase 9a — assessment.** Screenshots → a gap table in `docs/replacing-vistab.md`, same shape as
`replacing-1place.md` §2. **Size: an afternoon.** Blocked on Phase 0.

**Phase 9b — fill the gaps.** Unknowable until 9a. The one thing predictable from the schema: a
visitor sign-in book on a tablet at the door wants the offline queue, which is the same deferred
item as checklist runs — see Phase 11.

## Phase 10 — Educa: assess, then fill

`posts`, `post_children`, `post_strands`, Te Whāriki tagging (0058),
[`import-storypark.ts`](../scripts/import-storypark.ts) for historical stories, and `/posts`.

Same treatment, same reason. **Phase 10a — assessment** into `docs/replacing-educa.md`.

The one gap predictable from the schema without seeing Educa: **learning stories with photographs**
runs straight into `0015_consent_gate_restrictive`, exactly as checklist photos do. If both land,
they are one piece of thinking, not two — which is an argument for doing 9a and 10a *before*
Phase 11 decides anything.

## Phase 11 — The two 1Place deferrals

**Checklist photos.** Deferred 2026-08-28 with a written reason: `media` is consent-gated because a
photo may contain a child, *a photo of a broken latch with a toddler in the background is child
media*, and neither the person taking it nor a column default can tell the difference. Its own
migration and its own thinking. **Do this after 9a and 10a**, because visitor photos and learning
story photos are the same question and deciding it three times separately is how three different
answers happen.

**The offline path for checklist runs.** `checklist_runs.client_uuid` exists and is unique; the
value is still generated server-side. Gated on `drill:offline`, which
[`unverified-claims`](../llm-wiki/wiki/unverified-claims.md) §21 says has never been run against
the web queue. **Phase 11b is: run the drill first**, then decide. A queue nobody has tested is not
a queue to add a second writer to.

---

## Sequencing

```
Phase 0  ────────────────────────────────────────────────  (asks, today)
         │           │              │
Track 1  1 ── 2 ── 3 │              │        starts now, blocks nothing
Track 2       4 ── 5 ── 6 ── 7 ── 8 │        7 blocked on the export only
Track 3                    9a ── 9b │        9a/10a blocked on screenshots
                          10a ──10b │
                             11a, 11b        after 9a + 10a
```

**If only one thing gets built this week, build Phase 1.** It is small, blocked on nothing, and is
the only item on this page that can prevent a wrong figure reaching a funding return.

**If Infocare never sends an export, Track 2 stops at Phase 6** and that is fine — the importer
sits finished and tested against fixtures until a file arrives, and a hand-built file in the §9
shape would drive it just as well for a first roll. Track 1 and Track 3 are unaffected.

**If Infocare grants the partnership**, Phases 5–8 do not become wasted: Phase 4's ownership table
is the sync contract, Phase 3's `source_ref` is the join key, and the importer becomes the fallback
path for when the API is down. What changes is the transport, not the meaning.

---

## What this plan deliberately does not do

- **Compete with Infocare.** No funding return, no parent billing, no ELI integration. Phase 1
  exists to make Doorway's funding page *less* confident, not more.
- **Guess at VisTab or Educa.** Phases 9 and 10 are assessments first and builds second, because
  the 1Place exercise showed the gap table is the valuable artefact and it cannot be written from
  here.
- **Touch the `check:bundle` overage.** apps/web is 113.0kB against a 106kB budget, measured
  identical on a clean `main` — pre-existing, unrelated, still unattributed. It needs a deliberate
  session, not a phase appended to this one.
- **Set the cutover date.** That is the centre's decision and it belongs in
  [`importing-infocare.md`](importing-infocare.md) §12 with a date beside it.

---

*Written 2026-08-29. Nothing here is built.*
