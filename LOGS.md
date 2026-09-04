# Session logs

Narrative record of what happened, what broke, and what was found. Newest first.

Distinct from [`llm-wiki/wiki/log.md`](llm-wiki/wiki/log.md), which records changes to the wiki
itself, and from the wiki pages, which hold the durable *why*. This file is the story.

---

## 2026-09-04 (eleventh) — `0088`, and a proxy that flatters the occupancy figure

The operating calendar. Built before the absence rules it enables, because it turned out four
separate things were waiting on it and three of them are already written.

### Why this one came first

Most tables here serve one screen. This one is a prerequisite for:

1. **§6-6**, which suspends the Three Week Rule while a service is closed for two weeks or more —
   never transcribed, while the funding disclaimer claimed to cover "§6-4 to 6-7".
2. **RS7's `AdvanceMonthCounts`**, forward operating days by service model.
3. **ELI's `EceServiceClosure`**, which has mapped to nothing since the schema was first read.
4. **`averageOverOpenDays`**, which decides a day was open by `d.children > 0`.

### The fourth one is a defect, not a gap

`d.children > 0` is a proxy for "the service was open" and it cannot tell a closed day from an open
day nobody attended. The direction matters: a centre that opened on a snow day and had nobody turn
up is dropped from the denominator, so the average is **flattered**. A figure that is too high is
the one that gets quoted in a board paper.

Three consumers go through that one function — the occupancy report's average, and both of
`attendanceTrend.ts`'s summaries.

**`0088` makes it fixable and does not fix it**, which is a decision rather than an omission.
Changing that average changes a number somebody may already have quoted, so it needs its own commit,
its own assertions and a sentence on the screen saying what the average is now over. Item 59 holds
it open so the migration landing is not mistaken for the fix. [[reporting]]'s own section said "a
day nobody signed in looks identical here to a day the centre was closed" — that was true until
today, and it is now a choice rather than a limitation, so the page says so.

### Three shape decisions

**A period, not a day, and not `booking_status`.** The XSD had already specified the shape: start,
end, reason. `bookings.booking_status = 'closed'` stays exactly as it is and is a different
statement — *this child had no place on this day* versus *the service did not operate*. A service
can be open while one child's booking is closed, and deriving either from the other would make a
child-level record answer a service-level question.

**`ends_on` is nullable.** A flood on Tuesday and nobody knows for how long. Recording that as a
one-day closure would be false; refusing it until the end is known loses the fact. So null is "not
yet known", the same three-state treatment `enrolments.end_date` gets. The cost is real and named:
`EceServiceClosure` carries a `ClosureEndDate`, so an open closure cannot be serialised — a gap for
the sender to report, not a date for this table to invent.

**The reason code ships unresolvable.** `ClosureReasonCode` is a `LookupCode` the schema leaves
unenumerated, and the Ministry has not said where the lists are published. `0080` reserved a
`closure_reason` domain and left it empty. So: `text`, with the `LookupCode` length bound, and **no
foreign key to `codes`** — the same call `0081` made for the census, because a foreign key would
make the column unwritable until a list exists, and an unresolvable code belongs on a readiness
report rather than in a rejected write.

### Sixteen assertions, and the one worth drilling

686 → 702. The tenancy ones are routine by now. The two that earn their place:

- **The inclusive range bound.** A closure from Monday to Friday includes Friday, so `[]` rather
  than the `[)` the enrolment ranges use — an enrolment's successor may start the day its
  predecessor ends, but two closures cannot share a day. Mutation-drilled by moving the second
  closure onto the first one's end date, which makes it fail.
- **A parent can read them.** The widening is the thing worth asserting, not the restriction: a
  family needs to know the centre is shut next Thursday, and hiding that behind a staff role would
  be perverse. Almost everything else on the child side keys on guardianship; this keys on
  membership.

And the dates in every assertion are **fixed literals**, not `current_date` — the lesson from this
morning's e2e failure, applied the same day it was learned.

## 2026-09-04 (tenth) — §6-1 becomes completable, and item 58 closes the day it opened

`0087` landed schema-only. This makes it writable, which is a different claim.

### What shipped

Five fields on `Enrolment` in `@ece/core` plus `enrolmentRecordGaps()`; the reader and both writers
in `packages/api/src/children.ts`; the schedule signature in `bookingSchedule.ts`;
`completeEnrolmentRecord` beside `fileEnrolment`; a guardian picker and the §6-1 fields on both
panels; a **Record incomplete** flag naming what is missing.

### The trap: reachable at creation time is not reachable

Wiring the fields into `fileEnrolment` would have looked finished. It would also have left every
enrolment already on file **permanently incomplete**, because re-filing an enrolment is not
something a service can do — `enrolments_no_overlap` refuses it, correctly, since two overlapping
enrolments double-count funded hours.

So a new required field on a long-lived row needs two writers, and the second is the one that makes
the rule satisfiable. The completion form is offered on **every** row rather than only on incomplete
ones: a signature recorded against the wrong parent has to be correctable, and a control that
disappears on success makes the one thing this panel writes the one thing it cannot fix.

### `Number('')` is zero, and that is the whole three-state problem

§6-1 wants the other-service hours *"including none if appropriate"*, so **null and 0 are different
answers** — nobody asked, versus the parent attested none. An empty form field converts to `0` and a
null column converts to `0`, so both the server action and the row mapper test emptiness *before*
converting. Mutating `enrolmentRecordGaps` from `=== null` to a falsy check fails two unit tests,
which is the check that the distinction is actually load-bearing rather than merely written down.

### The picker is a picker because Postgres made it one

`signed_by` is a `guardians` reference, and `0087`'s trigger requires a **current guardian of that
child**. A free-text name could not satisfy that; a picker listing every guardian at the centre would
offer choices the database refuses. `listGuardiansOfChild` already filters revoked links — the same
condition the trigger applies — so the list is exactly what will be accepted.

**Nothing preselects a guardian**, and that is deliberate rather than lazy. A signature is a claim
that a named person signed something. A picker defaulting to the first guardian manufactures that
claim from a page load, which is the same failure as a date entered to clear a warning.

**And with no whānau linked, the panel says so** rather than showing an empty dropdown: there is
nobody who *could* sign, and an empty control reads as a broken control rather than as the missing
prerequisite it is. That is the state every existing child is in, so the e2e asserts it first.

### What is deliberately not enforced

Signatures are optional on the way in, on both panels. Refusing to store a change to the days and
times until somebody has signed would mean either losing the change or backdating a signature. So
unsigned blocks are stored and flagged, and every block written before `0087` carries that flag
permanently — a signature nobody gave is not backfillable, and a flag that can never clear is a
truthful record rather than a defect.

### The run found a defect in a test, not in the code

The `0085` schedule test ends a block and asserts it is **not in force**. It filled the last day
with `new Date().toISOString().slice(0, 10)` — a **UTC** date — while the panel decides in force
against the **centre's** date, which is NZ. Those agree only from NZ noon onward; before noon UTC is
still yesterday.

So in the morning the block ended *yesterday* and the assertion held. In the afternoon it ends
*today*, and `coversDate` is inclusive of `effectiveTo`, so the block is still current and the
assertion is false. **It passed at NZ 10:50 and failed at 12:29 on the same day**, with nothing
between the two runs but an unrelated column added to that table.

I spent the first few minutes assuming my own change had broken it, which is the natural reading and
was wrong. What settled it was the page snapshot: the row read `2026-09-04 to 2026-09-04 ✓ current`,
which is *correct* behaviour for a block ending today — so the assertion was the thing that was
wrong, and had been since it was written.

Fixed by moving the dates away from the boundary rather than by weakening the assertion: a block
running from a week ago until two days ago is not in force today in any timezone. Third time this
UTC-versus-centre boundary has cost something here — `enrolChild` once refused a baby born that
morning as "in the future", and `test:rls` failed at 00:13 because `now() - interval '1 hour'` was
yesterday — so it is now a convention rather than three separate war stories.

### And one that was mine

My own §6-1 test failed on its last assertion: after recording the signature, the record was still
incomplete. Correctly. I had filed the enrolment without an enrolment type and without any days, and
both are §6-1 requirements — so `enrolmentRecordGaps` was reporting two things the test had never
supplied. The gap function working exactly as intended, catching the test rather than the code.

### Not built

A centre-wide readiness list. Gaps are named on each child's record; a manager wanting to know which
of eighty children have incomplete records has no screen. That is reporting rather than compliance,
and it is written down so it is not mistaken for done.

## 2026-09-04 (ninth) — `0087`, and a foreign key that could not say what it meant

The last two things §6-1 requires an enrolment record to contain, plus a correction to my own `0084`
from three commits earlier.

### What landed

`enrolments.hours_at_other_service_per_week`, `signed_on` / `signed_by` on `enrolments` and on
`child_booking_schedule`, the `0084` correction, and one trigger.

**Why the other-service hours are not administrative.** The 6-hour daily and 30-hour weekly caps
follow the **child**, so a child enrolled at two services can exceed them between the two — and this
product applies both caps as though each service were the only one. §7-7 rests on the same fact. It
is also **unenforceable from here**: `enrolments_no_overlap` already refuses two overlapping
enrolments *within this database*, and an enrolment at another provider is invisible. The attestation
is the only instrument, which is presumably why the Handbook asks the parent rather than the service.

**Null is not zero**, and the column exists to hold that difference: §6-1 wants the figure
*"including none if appropriate"*, so "attested as none" and "nobody has asked" cannot collapse.

### The finding: a foreign key cannot express a tenant

`signed_by uuid references public.guardians(id)` looks complete and is not. A foreign key has no idea
what a tenant is, so it accepts **any** guardian row in the database — including one belonging to
another centre. An owner could record another centre's parent as having signed this child's enrolment
record and nothing in the schema would object: a cross-tenant reference stored on a compliance field.

A CHECK cannot express the rule, because a CHECK cannot query another table. So it is a trigger, and
it asks the stronger question: is this person a **current guardian of that child**? Being a guardian
of the child implies the same centre, so one predicate answers both the tenancy question and the
"is this even the right family" question.

Three things about its shape, each a decision rather than a default:

- **Generic over the column.** `TG_ARGV` carries the column names and the value comes out of
  `to_jsonb(new)`, so one body serves `enrolments.signed_by`, `enrolments.twenty_hours_attested_by`
  and `child_booking_schedule.signed_by`. Three near-identical function bodies is the duplication
  this schema keeps catching.
- **It validates only when the signatory is set or changed.** Without that guard, revoking a
  guardianship would make every later update of an unrelated column on that row fail — a row nobody
  could edit because of something true about a person who signed it last year. There is an assertion
  for the guard, not just for the rule.
- **It raises `23514`.** It *is* a check violation; that a CHECK cannot express it is a fact about
  Postgres, not about the rule, and callers already branching on `23514` should not need a second.

**It deliberately does not require `child_guardians.is_authorised_signatory`**, which is sitting
right there and is tempting. That flag (`0061`) means "may verify the child's **attendance** record",
which is §6-3 criterion 4 — a different authority under a different rule. §6-1 asks for "at least one
parent/guardian" with no qualifier, and requiring the flag would be this product inventing an entry
condition the Handbook does not state.

### The correction to `0084`, and why it was cheap

`twenty_hours_attested_by` referenced `auth.users`. The 20 Hours attestation is signed by a **parent**
— `0004`'s own comment on `twenty_hours_ece` says "an attestation the parent signs" — and a guardian
may have no account at all, since `guardians.user_id` is nullable precisely so a grandparent on the
collection list can exist. So the column could only ever have held the staff member who ticked the
box, recorded as though they were the attesting party.

**Measured before changing it**, not assumed from the wiki: both attestation columns counted zero
rows against the live database. Had either been non-zero this would have needed a mapping from
`auth.users` to `guardians` and a decision about rows with no mapping — a much larger migration.

### The suite went red, and that was the right outcome

An assertion written for `0084` set the attestation signatory to `11111111-…`, the **owner's user
id**. Valid under the old reference. Refused under the new one. The suite failed on a message raised
by a trigger several hundred lines away from the assertion at fault, and I bisected my own new block
first before finding the stale one three hundred lines further down and three commits old.

That is the failure mode to want. The one to fear is the assertion that keeps **passing** against a
world that no longer exists — `drill:rowcap` carried one for two days asserting that the funding caps
did not apply, which was the defect being fixed, in the file whose whole job was catching it. So the
uuid was not silently corrected: the assertion now carries a paragraph saying what changed under it
and why.

Thirteen assertions, 673 → 686. The cross-tenant one was mutation-drilled — replacing the other
centre's guardian with Ana's own mother makes it fail on its own label.

### Still schema only

Nothing writes these columns. Item 58 stays open, and the reason is worth stating rather than filing
under "next commit": an enrolment record a service **cannot complete** is not a complete enrolment
record. The screens need a guardian picker now that the signatory is a reference rather than a name,
which is the next piece of work.

## 2026-09-04 (eighth) — the address becomes reachable, and what an `upsert` is under RLS

`0086` landed schema-only, which left `child_addresses` with no reader or writer — the exact
condition I had criticised `0085` for one commit earlier. This commit closes it, and the interesting
part is not the form.

### What shipped

`ChildAddress` and `ADDRESS_KINDS` in `@ece/core`; `packages/api/src/childAddresses.ts` with
`listChildAddresses`, `saveChildAddress` and `deleteChildAddress`; `saveChildAddress` and
`removeChildAddress` server actions gated on `manageEnrolment`; and `AddressPanel` on the child
record's **Whānau** tab.

Not the Documents tab where the enrolment and the booking schedule live. §6-1 puts the address inside
the enrolment record, so Documents is the defensible answer — but a person looking for this is
thinking *"where does this child live"*, not *"what does the enrolment say"*, and the guardian
addresses are already on Whānau. Somebody comparing the two should not have to change tabs, and the
case `0086` exists for is only obvious next to them: a child living with a grandparent while the
first contact is a parent somewhere else.

### The finding: an `upsert` is a third statement under RLS

`0086` shipped with fourteen RLS assertions and I described them as thorough. They cover a plain
INSERT by an owner and a plain UPDATE by an educator and a guardian. **The application issues
neither.** `saveChildAddress` upserts on `(child_id, kind)`, and `INSERT .. ON CONFLICT DO UPDATE`
must satisfy the insert policy's `WITH CHECK` *and*, on conflict, the update policy's `USING` and
`WITH CHECK`. Nothing had exercised that combination, so the one route a person actually takes to
this table was unasserted while the suite reported eleven passes on it.

Three assertions added, 670 → 673:

- an owner **replaces in place** through the upsert rather than hitting `23505`
- the replacement leaves **exactly one** primary row, with the new city — mutation-drilled by
  asserting the pre-upsert value, which fails on its own label
- an educator's upsert is **refused**

That last one carries a detail worth keeping. It fails with **42501 — an error, not zero rows**,
unlike the refused UPDATE two assertions above it. So it is the API's `error` branch that catches an
educator here, and not the zero-row guard that catches every other refusal in the package. I
expected 42501 and asserted it directly rather than capturing whatever came back; it was right, but
the honest note is that asserting a guessed sqlstate is a coin toss and the alternative — record
what happens, then pin it — is the better habit.

### A default that does not fire

`recorded_at timestamptz not null default now()` is correct on the insert and frozen forever
afterwards, because **a column default does not fire on the UPDATE half of an upsert**. Left alone,
the column would report when the child's first address was typed in while the address changed
underneath it — a timestamp that is wrong in the direction that looks plausible. It goes in the
payload instead. `saveCensusDetails` already did exactly this for `updated_at`, which is why there
is no trigger: the precedent existed and adding a second mechanism would have been the duplication
this repo keeps catching.

### Both writers key on the pair, and the reason is not elegance

`saveChildAddress` upserts on `(child_id, kind)` and `deleteChildAddress` deletes on it. Neither
takes the `id`, and the rule is not "prefer natural keys" — it is that **the two writers have to
agree**, because the failure when they disagree is quiet: a screen that replaces a row its own delete
button cannot find, with every save-and-read-back test still green.

Which key to pick follows from the shape. `child_booking_schedule` rows are a **list** — several
blocks on one weekday — so the `id` is the only thing telling one Tuesday from another. Addresses are
**named slots**: there cannot be two of a kind, so nothing needs to tell two apart. The e2e assertion
that earns its place is therefore not that saving works, it is that **removing the second household
leaves the first one standing** — a delete predicate that dropped `kind` would empty both rows and
pass everything else on the panel.

### A defect found by writing the assertion, not by running it

Removing the second household left the panel reading "No second household recorded" above a form
still holding the address that had just been deleted. The inputs are uncontrolled; `revalidatePath`
re-rendered the server component with an empty `defaultValue` and React ignored it, because
`defaultValue` seeds an input on mount and never again.

This is the worse of the two possible failures. A stale read-back looks like a bug; a stale **form**
looks like the delete did not work, which is what somebody would then try again. And nothing here
would have caught it — the read-back assertion passes, the error assertion passes, the accessibility
audit passes. I found it by asking what the next assertion should be, and the answer was "the field
is empty", which it was not.

Fixed with `key={existing?.id ?? 'none'}` on the form: keyed on the id rather than the slot, so
replacing an address does not remount the inputs under the cursor while deleting one clears them.

### The mistake: a heading that broke the accessibility audit without breaking accessibility

I headed the section `<h2>Where {child.firstName} lives</h2>`, which reads better than the
alternative. It also matched `getByRole('heading', { name: /Tāne/ })` alongside the record's own
`<h1>`, so the shared a11y test for the whānau tab failed on a **strict-mode locator violation
before `auditPage` ran a single accessibility rule**. A red cross that reported nothing at all about
the page — and had it been a `.first()` instead of a strict locator, it would have reported a green
one just as uninformatively.

Fixed at both ends rather than one. The heading is now a generic noun phrase, which every other
section on this record already was — mine was the only one interpolating a name. And the shared
locator says `level: 1`, which is what it always meant: *the record loaded for the right child*.
That way the next section heading is free to say whatever reads best without silently disabling an
audit of four screens.

### And one error that no tool would ever have found

The panel's warning said a guardian's *"address below is not the same fact"*. The guardian section
renders **above** it. No assertion touches that sentence, no check reads English, and it would have
shipped as a small piece of nonsense in the one paragraph whose whole job is to explain why two
similar things are different. Found by reading the file back rather than by running anything, which
is the only method available for this class of mistake and the reason the read-back is worth doing.

Corrected before the commit, and the full suite re-run afterwards rather than inferring that a
one-word prose change could not matter — 122/122 both times.

## 2026-09-04 (seventh) — Phase 2B: the address, and why the schema made it five columns

`0086` adds `child_addresses`, closing the last ELI event blocker in the child data and one of
§6-1's three missing required fields.

**Two independent sources demanded it**, which is what promoted it from an ELI-only gap: §6-1
requires an enrolment record to contain *"the child's official name, date of birth, and
home/residential address"*, and `ChildEnrolment` carries `PrimaryResidentialAddress` as a required
element. Until today addresses lived only on `guardians.address`, so a child living with a
grandparent while the primary contact was a parent elsewhere had no recorded address at all.

### The design I was going to write would not have serialised

`guardians.address` is one free-text column, and copying it onto the child was the obvious move. I
read `ChildEnrolmentAddress` in the XSD first:

    Address1Line     String100   required
    Address2Line     String100   optional, nillable
    AddressCity      String100   required
    AddressCountry   String100   optional, nillable
    AddressPostCode  String100   optional, nillable

**Two of the five are required and separate.** A free-text address would have to be split into
street and city at the boundary, and splitting a New Zealand address by guesswork puts the suburb in
the street field — on a return that then validates perfectly. So the fields are stored as the
interface asks for them, and the `String100` bounds are enforced in the database rather than at
serialisation, because a 140-character paste should be refused while somebody is looking at the form.

`guardians.address` is left alone: it is not on the wire, and it is a postal address for a
newsletter rather than a funding field.

### Three decisions with their reasons

**A table, not ten columns on `children`.** Two addresses × five fields, eight of them nullable, on
the most-read table in the product — `listChildren` is called from thirteen places including the
roll and the ratio surfaces, and none of them want an address. Ten nullable columns to express "up
to two of something" is also the shape that invites an eleventh.

**Replaced in place, not superseded** — deliberately unlike `child_booking_schedule` a commit
earlier. A funding claim is computed against the days and times the agreement stated at the time. It
is not computed against an address. So `unique (child_id, kind)` plus an UPDATE, and the history an
address needs is the audit log, which already records who changed which column and when.

**`caller_may_enrol` reused rather than a new predicate**, even though its name says "enrol" on a
table about addresses. Its body is exactly the question — owner or manager at the child's own centre
— and §6-1 puts the address *inside* the enrolment record, so the name is less of a stretch than it
looks. A second predicate with an identical body would be the duplication this schema already avoids
by making its predicates genuinely different questions.

### The two assertions worth the space are not about tenancy

Fourteen RLS assertions, and the tenancy ones are routine by now. The two that matter guard the
**wire**:

- **A required element that is present and blank.** `not null` accepts a single space, which
  serialises to a present-but-empty required element: valid XML, and a Crown return saying the child
  lives at `" "`. Refused by a trim check.
- **A value over `String100`.** Refused here so it cannot be silently truncated later.

Both would have passed every check this repo had before today. The blank-address one was
mutation-drilled — replacing `'   '` with a real address made it fail on its own label — and the
diff is 158 insertions with zero deletions.

### Two mistakes, both cheap

**I used a child id that does not exist.** The constraint assertions inserted against
`a2222222-…`, and the suite failed with `42501` rather than the `23514` I expected — the policy
refused it before any CHECK could fire, because the fixture's centre-A children are `a1111111` (Ana)
and `b2222222` (Beau). Worth noting because `42501`-instead-of-`23514` is a *useful* signal: it says
the write never reached the constraint, which is a different bug from the one being tested.

**And I mispredicted the assertion count for the third time** — said 13, wrote 14, suite says 670.
The suite has been right every time and the habit of estimating has not.

## 2026-09-04 (sixth) — Phase 2A: the schedule becomes reachable, and a drill catches what I missed

`child_booking_schedule` was migrated, secured, RLS-tested and left with **zero readers or writers**
this morning. It now has `packages/api/src/bookingSchedule.ts`, three actions on the child record,
a `BookingSchedulePanel` on the Documents tab, and an e2e test covering add → read back → end.

### The thing worth reading: a drill found a fourth stale assertion

`drill:rowcap` failed — *1 of 7 checks*. It was not from 2A. It was
`fundedHours === attendedHours`, labelled *"funded equals attended, since no attestation means no
caps"* — **the fourth assertion encoding the defect Phase 2b fixed, and 2b's commit said it had
found them all.**

Three had been found: two unit tests and `reconcile-funding.ts`. This one was invisible because 2b
changed no multi-row read, so `drill:rowcap` was not in its conditional gate list and never
executed. Adding one read in 2A triggered it.

**The reconciliation was the right instinct pointed at the wrong set.** I asked "what already
asserts this figure?" and looked in the unit tests and the script with *funding* in its name. The
drills were not in the set I searched, and one of them asserts a funding figure. A grep for the
number would have found it; a grep for the files I expected to hold it did not — which is the same
shape as the item-49 audit that checked 14 of 48 guards because it matched one phrasing of a
message.

Fixed as a **bound plus a deterministic side-effect** rather than an equality: `cappedDates.length
=== DAYS` is exact (each day is 6.25 hours against a 6-hour cap), while the funded total is not,
because eight consecutive days straddle ISO weeks differently depending on the weekday the drill
runs. Asserting a fixed number would make the gate pass on some days and fail on others.

The drill's header note also had to be corrected, and its reasoning is worth keeping: it explained
that caps **compress** the difference the drill measures, which is why `attendedHours` — uncapped —
is the load-bearing assertion and 50.00-against-41.67 is a sharper instrument than any funded
figure.

### The extraction, and a behaviour change I nearly smuggled into it

`weekdayBlock.ts` now holds `WeekdayBlock`, `blocksOn`, `timeToMinutes`, `blockMinutes` and
`coversDate` — shared by `staff_contact_hours` (0081) and `child_booking_schedule` (0085), which are
the same shape because 0085 reused 0081's idiom deliberately. Deferred yesterday because there was
one consumer; done today because there are two. The census keeps `ContactHoursBlock` and
`contractedMinutes` as aliases, because they read correctly in its own vocabulary — but the function
that filters by date has exactly one name, since one behaviour with two exported names is what a
reviewer would object to.

**My first draft changed behaviour.** It relaxed `timeToMinutes` from `hours > 23` to allow
`24:00` — a session ending at midnight, which Postgres accepts and both tables' CHECKs would store.
The existing test rejects `'25:00'` and **never exercises `'24:00'`**, so it would have passed.
Reverted with the reasoning in the file: an extraction that changes behaviour is not an extraction,
and that question deserves its own commit, its own test and a source.

**And `coversDate` turned out to have a second consumer** I had not looked for: `codes` rows in
`census.ts`, where `0080` treats a set imported with no dates as *"not dated"* rather than *"always
valid"*, and this predicate is what lets an undated set pass. So it is a general effective-window
rule, not a block-only one — exported and imported rather than copied.

### Three smaller decisions

**`manageEnrolment`, not the `manageCentre` the plan specified.** The agreement is what funded hours
derive from, and `EnrolmentPanel` two sections up the same page already uses `manageEnrolment`. The
database predicate is independent and narrower either way — `caller_may_enrol` is owner-or-manager
at the child's own centre — so an educator reads the agreement and cannot rewrite it.

**The empty table is handled visibly rather than preferred silently.** The panel ships against an
empty table, so when there is no schedule it says what the enrolment holds instead — *"The enrolment
above records Mon, Tue, Wed with no times"* — rather than implying the child attends none. That is
item 53's duplication shown rather than prematurely resolved.

**A re-export dropped rather than duplicated.** `census.ts` and `bookingSchedule.ts` are both
`export *` in the API barrel, so a second `export { blocksOn }` is an ambiguous export — it would
have surfaced as a confusing error a long way from either file. Screens take it from `@ece/core`.

**The e2e test is scoped to the panel's section**, because `getByLabel('Day')` would otherwise match
the enrolment form's *"Days attending"* on the same page — accessible-name matching is substring by
default. That is the same class of near-miss as the three selector collisions in yesterday's test,
caught before running it this time rather than after two nine-minute suites.

## 2026-09-04 (fifth) — The place cap gets reported, and my own conclusion needed correcting first

The previous entry ended by saying Phase 2 needed the calculation restructured from per-child to
per-place. **That was an overstatement and the arithmetic disproves it**, which is worth leading with
because it made this piece of work about a fifth the size.

A per-child cap is **exact** whenever a day's children do not outnumber the licensed places:
`sum(min(hᵢ, 6)) ≤ 6N ≤ 6P`. It can only over-state when N > P, which happens in a sessional service
where a morning child and an afternoon child share a place, and on a day carrying conditional
enrolments — which the Glossary defines as being *above* the licensed maximum. So every all-day
service that is not over-subscribed already had correct figures, and what was needed is an
**additive aggregate cap**, not a rewrite.

I had reasoned from "the cap is on a different unit" straight to "the calculation must change unit",
without checking when the two units actually diverge. They diverge in one identifiable case, and the
product now records which services are in it — `centres.service_model` from two days ago.

**What was built.** `placeCapExceedances` in `packages/core/src/funding.ts`: given the period's
children and the centre's licensed places, it returns the days where the total claimable hours exceed
6 × places, with the claimed and allowed amounts. Reported on `/funding` in a card that says plainly
that the figures are **not** reduced. Six tests.

**Three states, and the drill was on the one that matters.** `null` means the centre has not stated
its licence — the question was not asked — and `[]` means checked and every day is inside it. The
screen renders null as a sentence pointing at Settings rather than as silence, because silence reads
as reassurance. Mutating `return null` to `return []` failed the suite on exactly the assertion that
names the distinction, which is what I wanted to know: that test is the only thing standing between
this and a later tidy-up that turns "not asked" into "no problem found" on a funding figure.

**What was deliberately not built: applying the cap.** Trimming the excess needs an attribution rule
— which child's hours go — and nothing read so far supplies one. RS7 needs the surviving hours split
by age band and 20 Hours status, so an invented trim would propagate into a Crown return rather than
staying a display choice. Naming the day and the amount is the same treatment a broken attendance day
already gets: excluded from any claim of correctness, and handed to the person who can act on it.

**A naming decision worth recording.** The day-level check needs per-date hours, so `ChildFunding`
gained `dailyCappedByDate`. The tempting name is `fundedByDate`, and it would be wrong: when the
**weekly** cap bites, the Handbook states the maximum and does not say which days lose the excess. So
per-date *funded* hours are not a defined quantity, while per-date *daily-capped* hours are. The
consequence is that `sum(dailyCappedByDate) === fundedHours` only when no week was capped — an
invariant that will look like a bug to the next reader, and a test asserts it in both directions with
the reason. A single plausible `fundedByDate` would have hidden an invented allocation behind a
number that looked fine.

## 2026-09-04 (fourth) — Absence funding was not built, and the reason is the point

Phase 2c was next. The previous entry said to read §9-2's worked examples first, because three things
in 2c depended on them. Those examples are **images**, so the page cannot answer anything — but the
Handbook's Glossary can, and it answered more than I went looking for.

**A funded child hour is a place-hour, not a child-hour.** Verbatim: *"An occupied child-place that
is funded for 1 hour"*; services may be funded *"for up to 6 FCHs per child-place per day, to a
maximum of 30 FCHs per child-place per week"*; and a child-place is *"each place for a child for
which a service is licensed. Child-places may only be used by 1 child at a time but **may be used by
more than 1 child during the course of a day**."*

So two children each attending four hours may share one place: eight hours occupied on a place that
yields six. This product, having just had its caps corrected to 6 and 30, applies them **per child**
and would claim 4 + 4 = 8. Two hours nobody was entitled to — and completely invisible from inside
`childFunding`, which receives one child and cannot see the other.

The approximation is exact for an all-day service where each child holds a place all day, and wrong
for a sessional one where a morning child and an afternoon child share it. Which is precisely the
distinction `centres.service_model` started recording yesterday.

**It also settled something I had recorded as unresolvable a day earlier.** §9-2 says *"per licensed
child-place"*, §9-3 says *"per child"*, and I had noted both and applied the per-child reading
because that was what the code could see. The Glossary is the tie-break; §9-2 was accurate and §9-3
is loose phrasing.

**And it sharpened yesterday's enrolment types more than I expected.** *Conditional* is *"Enrolments
of children who are on a waiting list and that are above the service's licensed maximum number of
child-places"*. It does not mean *provisional* — it means **over capacity**, which is suddenly why
§6-4 funds those children on attendance only: the service is not licensed for the place they would
occupy. *Permanent* is *"within the service's licensed maximum … and entitled to attend for the
enrolled hours"*. Both carry capacity conditions nothing here enforces. And *enrolment record* is
*"the formal written agreement … that a specific child will attend that service **at specified
times**"*, which is the clearest corroboration yet that the booking schedule had to be a pattern with
times rather than a weekday array.

**So I did not build absence funding, and that is the deliverable.**

§6-4 had already told me something I noted and did not act on: *"Funding must not be claimed for both
an absent permanently enrolled child under an absence rule and for the conditional or casual child
who fills the absent child's place."* That is a statement about a **place**. The FCH definition says
the cap is on a **place**. Two rules, read four days apart from different chapters of the same
document, both saying the unit of funding is not a child.

Implementing §6-5 to §6-7 per child, on a per-child cap that should be per-place, would have stacked
one wrong unit on another. The result would be a plausible figure that is harder to correct than the
one it replaced, because the error would be spread across three new rules instead of sitting in one
constant. **The next step for Phase 2 is moving the calculation from per-child to per-place-per-day,
not the absence rules.**

**What that restructuring needs, so the next person does not have to rediscover it:**
`childFunding` takes one child and would need the day's other children; `readFundingPeriod` does not
fetch `centres.licensed_places` at all; and that column is **nullable**, so for a centre that has not
stated its licence a per-place cap cannot be computed — the missing-denominator problem `0050`
documented for the occupancy report, arriving somewhere it changes a funding figure rather than a
percentage.

**A note on how this went.** Four days of this phase have produced one arithmetic change and six
register entries. That ratio looks bad and is, I think, right: every entry is a defect found by
reading the source document against the code, and three of them were things the code asserted
confidently in a comment. The one arithmetic change I did make — the caps — is the one I could
source completely, and it has now itself been found to be on the wrong unit. That is an argument for
reading the whole chapter before touching a money path, not for having touched it faster.

## 2026-09-04 (third) — Phase 2b: the caps were wrong in both directions

`maxHoursPerWeek` was 20. §9-3 says the subsidy runs to 30, and 20 is the cap on the 20 Hours ECE
*component* inside it. And because the caps were gated on the 20 Hours attestation, an unattested
child was capped at nothing at all, where §9-2 caps the subsidy at six hours a day whether or not a
child is attested.

So the same number was wrong twice: under-claiming hours 20–30 for an attested child, over-stating
for an unattested one. Fixed together, because they are one model rather than two bugs — 6 a day and
30 a week for every child, with an attested child's week splitting into `twentyHoursHours` (up to 20)
and `plusTenHours` (the rest). Those are the two figures RS7 asks for by name, so they are carried
on `ChildFunding` rather than derived at a call site, given a column each in the CSV a manager keys
from, and shown in the funded cell on screen where there is a remainder to show.

**The part worth writing down is how many assertions had encoded the defect.** Three, and one of
them was in the verification script:

- *"does not cap a child without the attestation"* — expected 8 from an eight-hour day. Now 6.
- *"does not cap weekly for a child without the attestation"* — expected 40 from a five-day week.
  Now 30.
- `scripts/reconcile-funding.ts`: *"funded is 16.00 — the caps must NOT apply without the
  attestation."* **Hand arithmetic, in a file whose entire purpose is catching a wrong funding
  figure, confirming a four-hour over-statement across two days.**

That last one is the sharpest thing in this phase. A reconciliation script exists precisely because
a suite can be green against the wrong model; this one had been recruited into the wrong model. The
fixture child is still called "Uncapped", and I left the name, because it now records what the script
used to believe.

**Two disclaimer sentences came out, and a test asserts their absence.** They described Plus 10 not
being computed and the figure possibly running high — both true this morning, both false by
afternoon. Deleting a warning is honest only once the warning has stopped being true; `ratios.ts` and
`DEFAULT_CAPS.basis` have each already had a stale caveat removed for teaching people to skip the
disclaimers. Asserting the *absence* is the only way to stop one quietly surviving its own fix.

**A good side effect.** `reconcile-funding` asserted `fundedHours <= 28` as a **bound**, because with
a 20-hour weekly cap the answer depended on which ISO week each relative day landed in. At 30 the cap
cannot bite on 28 hours however they fall, so it is now an equality. Raising the cap to the figure the
Handbook actually states removed the source of the nondeterminism — better than a looser assertion
covering for it.

**What I deliberately did not decide.** §9-2 computes the RS7 two-and-over figure *"less any hours
for children claimed as 20 Hours ECE"*, and whether that deduction covers the Plus 10 hours or only
the first twenty is not settled by anything I have read. §14-4 lists both under the heading *"20
Hours ECE Funded Hours"*, which is suggestive — and a heading is not a rule, and this repo has
already been wrong once by treating a suggestive shape as one (item 50, where the XSD's shape said
contract and the Handbook said actuals). It changes an RS7 aggregate rather than the per-child split,
so it belongs to `rs7.ts`, which does not exist. New item 56, with the cheapest route to closing it:
§9-2 names two worked examples, an all-day service and a sessional one, which would show the
arithmetic directly.

**And the drill was not run.** `reconcile-funding` needs `ECE_DRILL_PASSWORD` — the demo centre
owner's own login — which is not available here. The hand arithmetic is updated and it typechecks;
nobody has watched it pass. `design-system.md` has already had to make the same disclosure for the
same reason, so there is a precedent for recording it rather than quietly omitting it. To run it:
`ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=… npm run reconcile:funding`.

## 2026-09-04 (second) — Phase 2a: the figure can be too high, which nothing here had allowed for

Phase 2 starts with transcription, and my own repeated lesson said not to build on the "Plus 10"
wording I had quoted earlier — that came from a multi-page search summary rather than from a page.
So I read §9-2 and §9-3 directly, and both were worth reading.

**The verbatim caps.** §9-3: *"A maximum of 6 hours per day and 30 hours per week of funding can be
claimed per child"*, *"20 Hours ECE hours must only be claimed for up to 20 hours per week for each
child"*, *"The remainder (up to 30 hours) may be claimed as Plus 10 ECE hours."* §9-2: *"a maximum
of 6 hours can be claimed each day for each licensed child-place"*. The unit differs between the two
sections — per child in one, per licensed child-place in the other — and that is recorded rather
than reconciled.

**Then the finding I was not looking for.** Our caps are gated on the 20 Hours attestation: an
unattested child is capped at nothing. The comment justifying it said *"there is nothing to cap
without the entitlement, and pretending otherwise would understate an ordinary fee-paying
enrolment"* — which conflates 20 Hours ECE with the ECE Funding Subsidy. The subsidy is claimable
for an unattested child, at 6 a day and 30 a week. So a nine-hour day shows **nine** funded hours
where six are claimable.

**That matters more than its size**, because every other gap in this file runs the other way and the
disclaimer says so: *"the total may be lower than what you are entitled to claim."* True about the
gaps somebody had thought about, false about this one — and a manager told the figures only ever run
low has been handed a reason not to check the long days. The disclaimer now names both directions,
with the over-statement in its own sentence because the action differs: an under-claim means *you may
be owed more*, an over-statement means *do not key this in as it stands*.

**And a second finding that reframes the phase.** §9-2 step 1 for the subsidy is *"List the daily
number of hours of **enrolment** for each permanently enrolled child"*. Attended hours appear only in
the separate step for casual and conditional children. So the source of the number depends on the
enrolment type, and this product derives everything from attendance. That is not the absence rules
wearing a different hat: starting from the agreement and deducting unclaimable absences diverges from
starting at attendance and adding claimable ones the moment a child attends *more* than their
agreement. It also means `0085` was more load-bearing than the rule it was built for — until
yesterday the product had no record of enrolment hours at all.

**What I did not do:** change any arithmetic. Both findings are money, and a money figure changes
with worked-example tests and a `scripts/reconcile-funding.ts` run beside it, not as a drive-by while
correcting a comment. So Phase 2a is the flags, the citations, the corrected comments and two new
register entries; Phase 2b is the caps model.

**One thing I nearly left standing as an endorsement.** There is an existing test, *"does not cap a
child without the attestation"*, asserting `fundedHours` is 8 — with a comment repeating the wrong
reasoning. Changing the expectation without changing `childFunding` would turn the suite red for an
unfixed defect, so it stays; but its title now warns that it pins a known defect, and its comment
says what the right number is and when it changes. **A test that pins wrong behaviour with a
confident comment is worse than no test**, because the next reader takes it as the decision rather
than the symptom.

**`FUNDING_RULES_VERIFIED` is now derived.** Eight named flags, each with the source that would have
to be re-read to flip it, and the boolean is `every(r => r.verified)` — the `ratios.ts` lesson from
the previous day, where one flag stood for one of four ratio schedules. A test asserts the roll-up
is genuinely derived, so it cannot drift from the detail the way a hand-maintained boolean did.

**Item 52's open question is closed** by the same reading: child hours round *"to the nearest whole
number"* like staff hours — but §9-2 rounds the **daily total across children**, not each child's
hours, which is not what a per-child calculation would naturally produce.

**And the heredoc hazard bit for the third time today** while writing these entries, which is the
last time it will: `CLAUDE.md` says to prefer the editing tools for anything long, and I had been
piping long Python through `bash <<'EOF'` because it batches nicely. It broke on an unbalanced quote
bash could see and Python could not. This script was written to a file instead.

## 2026-09-04 — Phase 1c: the enrolment agreement, and asking the contract question before cloning the shape

`0085` adds `child_booking_schedule` — effective-dated ISO-weekday blocks with times, more than one
block per weekday permitted. It is the table §6-5 and §6-7 need and the one ELI calls
`ChildBookingSchedule`, and it was the clearest remaining structural gap in the child data.

**The valuable part was a question, not the code.** `unverified-claims` item 50 exists because the
staff side got this exact decision wrong: `0081` built `staff_contact_hours` as a *contracted*
pattern because the XSD's `ContactHoursDetailList` has that shape, and §14-2 then turned out to ask
for *"actual contact hours"*. So before cloning the shape I went and read what the Handbook says
about the child side. It answers the **other way**, and quotably: §6-5 claims for sessions a child
was *"enrolled to attend"*; §6-7 compares attendance *"against their enrolment agreement"*. Both
concern what was agreed, and the actuals they are measured against already exist in
`attendance_events`. A contract is correct here — and that is now a citation in the migration header
rather than an assumption nobody wrote down.

**Two independent reasons picked the key, which is the sort of agreement worth noticing.** The
agreement intuitively belongs to an enrolment. But the XSD keys `ChildBookingSchedule` on the child
(`ChildEntityId`, no enrolment reference), *and* `audit_trigger()` can only resolve a centre from a
fixed column set containing `child_id` and not `enrolment_id` — so keying on the enrolment would
have required a new branch in that function plus a new entry in the attributability class assertion.
`0081` chose `staff_member_id` for precisely that second reason. Message format and audit
infrastructure pointing the same way is a good sign you have the grain right.

**A new predicate, because reusing the read-side one would have been the bug.**
`caller_may_enrol(child)` is owner-or-manager at the child's centre, shaped exactly like
`caller_may_roster` (0041). `caller_is_staff_for_child` is the read predicate and is too broad: an
educator legitimately reads the agreement — they run the room and need to know who is expected — and
must not be able to rewrite the thing the child's absence funding is derived from. That is the single
assertion this table's policy exists for.

**And the mutation drill caught a flaw in my assertion before it caught anything about the policy.**
Weakening the write policy to `caller_is_staff_for_child` turned the suite red, but with
`conflicting key value violates exclusion constraint` — not on the named assertion. The educator's
attempted UPDATE targeted *every* block for the child and pushed `to_time` later, so the moment the
policy permitted it, two weekday-3 blocks overlapped and the constraint raised before `expect` was
reached. Red is red, but **a negative assertion has to fail for its own reason when the thing it
guards is removed**, or it is testing the wrong mechanism. Narrowed to one block shrinking — which
cannot collide with anything — re-drilled, and it now fails on exactly its own label naming the
predicate. Restored, and `migrate --status` confirms the file is still byte-identical to what was
applied, which is the real check that a hand-restored migration is intact.

**13 assertions, and I predicted 12.** Second time today I have estimated an assertion count instead
of counting one. The suite reports 656 and the arithmetic works out; the habit does not.

**The duplication is recorded rather than tidied away.** `enrolments.days` also records which days a
child attends. Measured before shipping the second one: it is **display-only** — `formatDays()` in
two screens, and nothing in funding, ratios, the roll or the forecast computes from it. So the rule
is stated (a schedule block is authoritative where it exists) and the collapse is deliberately
deferred, because `child_booking_schedule` is **empty** on the day it ships and a reader preferring
it would show every existing child as having no days. That is the same argument that keeps `0080`'s
code sets empty rather than seeded: a mechanism with no data must not overwrite the answer that does
exist. New item 53, which also names the part that will make the backfill awkward — `days` carries
no times and the new table requires them, so it cannot be lossless.

**Committed as schema-only, following the census's own precedent** of landing schema+core first and
api+screen second. And one thing deliberately *not* done: `contactHoursOn` and `ContactHoursBlock` in
`census.ts` are structurally identical to what a child-schedule reader needs, so the no-duplication
rule says extract a neutral `WeekdayBlock`/`blocksOn`. But today there is exactly **one** consumer,
and renaming a working function across a test file to prepare for code not yet written is
speculative refactoring. The extraction happens in the next commit, when the second consumer exists
and justifies it.

---

## 2026-09-03 (tenth) — Phase 1b: the absence-funding axis exists, and null must not mean permanent

`0084` adds `enrolments.enrolment_type` — `permanent`, `casual`, `conditional` — plus
`twenty_hours_attested_on` and `_by`. `funding.ts` has named this exact column as the blocker on
absence funding since 2026-08-18, so this is the schema catching up with a comment that was right.

**Transcribed from the Handbook, not the schema.** §6-4's own words are *"permanently enrolled
child"*, *"casual"* and *"conditional"*. The XSD is the natural place to look and the values are not
there — `ChildEnrolment` carries two entity ids, a primary and optional secondary address, and the
start and end dates, **and no enrolment type element at all**. So this is a funding concept used to
compute the counts; it is never serialised. Worth writing into the migration header, because the
next person will look for it in the XSD and conclude it was missed.

**The decision that matters is what null means.** Every enrolment filed before today is not-stated,
and `createEnrolment` writes `null` rather than defaulting to permanent. Absence funding may only be
claimed for a *permanently* enrolled child, so defaulting an unknown would let it be claimed for
children nobody has classified — **over**-claiming, the one direction this product's funding figures
promise they never go. There is an RLS assertion pinning null as a storable value precisely so a
later "sensible default" has something to break.

**A tick is not an attestation.** ELI's `TwentyHoursSchedule` wants an `AttestationDate`;
`twenty_hours_ece` is a boolean. The two new columns are paired by a CHECK in the shape 0036 uses,
because a date with nobody's name against it reads, in an audit, as though somebody attested and we
lost who. Deliberately not a history: recording one attestation properly beats recording none, and a
chain of re-attestations is its own append-only table if anyone ever needs it.

**A trap avoided rather than fallen into.** The obvious guard on the attestation date is
`check (… <= current_date)`, refusing a future date. That is exactly the defect `0078` existed to
undo — six time-relative CHECKs made the roll, sleep, medication and staff attendance
**unrestorable** beyond a fortnight, because a dump recreates constraints before it inserts rows. So
no such constraint here, and the migration says why so nobody adds one back.

**And the opposite mistake to 0083's.** `0083` needed a column grant because `centres` is
column-scoped. `enrolments` is not — measured first: table-level SELECT, INSERT, UPDATE, DELETE, and
column-privilege counts equal to its column count in every verb. After 0047/0048 and 0066/0082 the
reflex is now to add a grant line everywhere, and one here would be harmless **and misleading** — it
would imply the table is column-scoped and send the next reader hunting for the rest of the list.
Check, then write what is true.

**Mutation-drilled, and the diagnostics were better than 0083's.** Weakened both negatives in turn —
the unlisted type swapped for an allowed one, the half-attestation given a signatory — and each gave
a clean named failure: *"an unlisted enrolment type is refused, got none (the update SUCCEEDED)"*.
Better than the grant case, which aborts with `permission denied for table centres` and never
reaches its label at all. Restored, and confirmed with `git diff --stat` showing insertions only —
82 lines added, nothing removed — rather than trusting the restore.

**Wired all the way through**, because a column nobody can set is the trap I refused to build in
Phase 1a: core type and constant, the API row/mapper/columns, `createEnrolment` and
`updateEnrolment`, a select on the enrolment form defaulting to *Not stated*, a flag on the enrolment
row shown only when a type has been stated, and an e2e test that files an enrolment as permanent and
asserts **the flag** rather than the select — because reading the select back would only prove the
form remembered its own state.

### The new test failed twice, and I diagnosed it wrong the first time

Worth writing down because the mistake was in how I read the evidence, not in the code.

**The actual cause: the enrolment panel is on the child record's DOCUMENTS tab**, and my test looked
for its button on the overview. The record's tabs are *routes* rather than state — a deliberate
decision in `tabs.ts`, so a manager can send a colleague a link — so the button genuinely was not on
the page, and Playwright waited sixty seconds against a page that was working perfectly.

**And the first error report said so.** Its page snapshot contained `- text: No enrolment on file`
with the tab list immediately beneath it. I had the answer before the first re-run and did not read
it. Instead I reasoned about my selectors, found three plausible collisions, and fixed those:

- the child's surname was `Permanent-${tag}`, so `getByText('Permanent', { exact: true })` had the
  child's own name as a candidate;
- the select contains `<option>Permanent</option>`, a second candidate that exists whether or not
  anything was stored;
- there was no `.error` assertion before the flag lookup, so a refused write and an unrendered flag
  produced the same symptom.

**Those three fixes were all correct and none of them was the bug.** The first two matter more than
the failure did: either one could have made this test pass with the column completely broken, which
is the [[conventions]] problem of a test that cannot fail, arrived at from a different direction. The
flag is now located as `span.flag` matching `/^Permanent$/`, the child is `Enrolled-${tag}`, and the
error assertion comes first.

**The cost was two nine-minute suite runs**, plus one destroyed set of artefacts: I ran
`npx playwright test -g …` directly to get a faster signal, which overwrote `test-results/` — and
could not have worked anyway, because it does not load `.env.local`. Two mistakes in one command,
and the second one is already documented in `playwright.config.ts`.

**The rule, and it is not about Playwright:** when a check fails, read what the check *reported*
before reasoning about what it might have meant. A page snapshot is a description of reality; a
theory about selectors is not. Hardening a test against imagined causes while the real one sits in
the output is how two runs become four.

### And then the RLS suite went red for a reason that only exists between midnight and 1am

With e2e finally at 121 passing, a confirming `test:rls` failed on *"a centre defaults to declared,
so the typed count is the answer"* — a message that reads like a broken ratio source. It had passed
643/643 forty minutes earlier and I had touched nothing near it.

**It was 00:13 in New Zealand.** The block seeds a typed adult count with
`now() - interval '1 hour'` and asserts `adults_present_now` returns it; that function filters
`at >= centre_day_start(...)`. An hour before 00:13 is **yesterday**, so the row was correctly
excluded and the assertion read 0. The product was right, the test was wrong, and it had been wrong
for one hour in every twenty-four since the block was written — nobody had run the suite at that
hour before.

**Checked my own rule first**, the one written this morning: zero leftover `audit-%` centres, and
every centre's `ratio_source` was `declared`. So not leftovers, and not mine.

**This repo had already learned this and filed it somewhere it could not be reused.**
`recentlyToday()` in the e2e tenant fixture exists for precisely this, with the comment *"an hour
before 00:07 is yesterday"*. August's lesson, never carried into the SQL suite.

**The fix had to be a fraction of the elapsed day rather than a clamp**, because this block seeds
five *ordered* events across three hours and at 00:13 there are not three hours of today to place
them in — clamping collapses the ordering the assertions depend on, and anchoring to
`day_start + 3 hours` puts them in the future. So `pg_temp.today_at(centre, fraction)`, which
preserves order at any hour and never produces a future timestamp.

**Verified by causation while still inside the failing window**, which is the part I would not get
another chance at for 23 hours: fix applied → 643/643 at 00:13; that one timestamp reverted → the
same failure returned; restored → green again. And `git diff` confirms five deletions, all of them
the five timestamp lines, nothing else.

**One near-miss worth recording.** The restore failed its own assertion — `found 2` — because my
mutation had created a second copy of `now() - interval '1 hour',` with identical indentation, and
line ~3882 already had one. Anchoring on it would have edited an unrelated block. The
`assert count == 1` discipline caught it and nothing was written; I restored with a two-line anchor
instead. This is the same failure mode as the item-49 guard that landed in the wrong function, and
the same check stopped it this time.

**What I did not do, deliberately:** fix the other twenty-two relative timestamps. Most are
deliberately old for expiry tests, but roughly nine are small and may feed day-scoped reads. They are
named with line numbers in [[conventions]] and left alone, because rewriting assertions whose
mechanism I have not read is how a suite quietly stops testing what it claims to. Any of them could
be the next 00:13 failure.

**Two more line-ending failures, and then a fix rather than a lesson.** The first scripted edit
failed on `packages/core/src/children.ts` for the same CRLF reason as this morning. So the helper now
detects each file's own newline and rewrites the anchors to match — and it immediately proved the
point by reporting `children.ts (CRLF)` in core and `children.ts (LF)` in api. **Two files with the
same name, in the same repo, with different line endings.**

**Done, having been flagged as pending an hour earlier:** `funding.ts`'s header claimed the
blocker was that `enrolments` has no permanent/casual distinction. Corrected, and while correcting
it the missing pieces got enumerated properly - the three-week window, **the 6-6 suspension the
header never knew about**, the frequent-absence check against an enrolment agreement that does not
exist, a reconfirmation that is a dated act rather than a boolean, and 6-4's cross-child rule that
no per-child calculation can express.

---

## 2026-09-03 (ninth) — Phase 1a: two columns instead of one, and my argument against building them was wrong

`0083` gives `centres` a `licence_type` and a `service_model`. Until now the product could not say
what kind of early learning service it was, at all — which blocked the RS7 advance-month counts, the
50-service capability answer, three of the eight mandatory functionalities, and the ratio-schedule
selection.

**Two columns, and that is the whole design.** A kindergarten and a full-day education-and-care
centre hold the **same licence** and run differently. One column would have forced a choice between
answering the licensing question and answering the funding question, and answered neither well.

**The second column has a better source than the first, which I did not expect.** `service_model`'s
values — `all_day`, `sessional`, `parent_led` — are taken from the ELI schema's own
`RS7AdvanceMonthCounts`, which enumerates `AllDayDaysCount`, `SessionalDaysCount` and
`ParentLedDaysCount`. Those element names *are* the classification the Ministry's machine-readable
contract uses, which is stronger than a web page. `licence_type` is the weaker one: three values
from the licensing page, while the Ministry's own regulatory-framework page names four and treats Te
Kōhanga Reo separately. That disagreement is recorded in the migration header, in a
`comment on column`, in the `@ece/core` constant and in the settings hint — and an unlisted licence
is refused by a CHECK, so it stops and gets looked at rather than being filed under a neighbour.

**I argued against this column yesterday. The owner overrode me and was right.** My first reason was
that it "would not enable anything", because the sessional and home-based ratio tables are not
transcribed, so knowing the service type would only let the product *refuse* to state a ratio. That
argument scoped the column's usefulness to a single consumer and then rejected it for failing to
serve that one — ignoring three other consumers that need exactly this axis. The wrong argument is
kept in `unverified-claims` item 51 with the flaw named, because deleting it would lose the reason it
was wrong. My second reason — the values are not settled — survived, and is now built *into* the
constraint instead of being used to avoid having one.

**The grant, for the third time in this repo's life.** `centres` carries column-scoped UPDATE
grants, and `updateCentre` builds one statement from every changed field, so a column missing from
that grant breaks the entire settings card rather than its own feature. I measured the existing
grants **per verb** before writing a line — nine columns — and put the new grant in the same
migration. 0047 added `ai_features` without it and broke the whole form; 0066 added
`incidents.room_id`, checked the INSERT grants, missed the UPDATE grants, and no incident draft could
be corrected for six days. The rule is not "check the grants", which 0066 did. It is per verb.

**Guarded three ways, on purpose.** A catalogue positive in the RLS suite (an owner *can* write both
columns — a negative would pass just as happily if they were unwritable by everybody), two CHECK
assertions that an unlisted value is refused rather than stored, and an e2e test asserting `.error`
is absent **before** the reload. That last one is the only assertion that can tell a refusal from a
write that never happened, and its absence from `incidents.spec.ts` is precisely why 0066 survived
six days of green runs.

**The mutation drill found something about the shape of this failure.** Pointing the new assertion at
`slug` — SELECT granted, UPDATE deliberately not — turned the suite red with
`permission denied for table centres`. Not a `FAIL` on the label: a missing column grant **raises**,
so the block propagates and the suite aborts before `expect` records anything. Red is still red, so
the gate holds; but the label is documentation, not the message anyone will see. And that message is
the reason 0047 was hard — Postgres names the **table**, not the column, so it reads like a policy
problem and is a grant problem.

**Two encoding failures in one sitting, both documented hazards, both mine.** The mutation anchor
failed twice before it worked: once because an em dash did not survive a bash heredoc into Python,
and once because `rls_isolation.sql` is CRLF while `funding.ts` is LF, so a `\n` anchor found
nothing and reported `found 0` with no hint as to why. Written up in `conventions.md` with the
one-liner that checks a file's line endings, and the narrower rule that follows: **anchor on ASCII,
check the endings first, and prefer the editing tools** — the scripted route only earns its keep for
a drill that must be applied and reversed mechanically.

**Noticed, not fixed:** `settings/actions.ts` carries two pre-existing comment typos — "New Zealand'
largest services", "a fact about today' market" — where apostrophes were eaten by exactly the
encoding hazard above, at some earlier point. Unrelated to this change, so left alone and mentioned
rather than silently tidied.

---

## 2026-09-03 (eighth) — Phase 0: the RS7 figure count was never sourced, and a rounding rule would have biased the return

Owner approved a five-phase plan to close the ELI gaps, funding chain first. Phase 0 is the cheap
one — no schema, no new behaviour, just stop quoting things nobody checked. It turned up more than
expected.

**Research first, and it overturned three of my own assumptions.** I had told the owner RS7 was
spec-blocked. It is not: the specification is public (ECE Funding Handbook ch. 9 and §14-4), and
`funding.ts:9-12` had recorded since August that the Ministry supplied it directly. I also expected
`ChildEnrolment` to carry an enrolment-type element — it does not, confirmed against the XSD, so
permanent/casual/conditional is a **Funding Handbook** concept needed to compute the counts
correctly and never serialised. And I had planned the booking schedule and RS7 as competing
priorities; `funding.ts:38-39` already says the schedule and enrolment type are **prerequisites**
for RS7 being correct, which forced the phase order.

**The count.** Three documents said RS7 wants *"eleven figures"*. A fourth said **thirteen**. No
document listed eleven items. Against the XSD: **six** per-date counts, **three** advance-month
counts over four months, **six** declaration fields. The likeliest origin of "eleven" is nine
counts plus two envelope fields, and that reconstruction is recorded as a reconstruction. This is
the failure AGENTS.md §5 is about, and it had reached a Crown-facing draft — so it is corrected in
all four places with the correction stated, not silently amended.

**`Declaration` was missing half its fields** in the wiki: `SubmitterName`, `ContactNumber` and
`Designation` were never transcribed. They match §14-4's *"name, contact number, designation"*
exactly, which independently corroborates that the public XSD and the published Handbook describe
the same return — worth having while item 47 is still open on whether the served schema is
normative.

**The rounding conflict, which is the finding I would keep if I could keep only one.** `RS7DayCount`
is `xs:int` bounded 0–9999, and §9-4 rounds to the **nearest** hour. Our `toHours()` floors, always,
deliberately, so a preparation figure never overstates a claim. Right there, wrong for RS7. **Anyone
implementing RS7 will reach for `toHours` because it is the obvious helper, every test they write
will pass, and the resulting bias will be invisible** — the figure will look exactly like a correct
one. New `unverified-claims` item 52, written before a line of RS7 code exists, and it explicitly
rules out the tempting compromise of one helper with a `mode` parameter: that moves the choice to
the call site, where it gets made wrong once, quietly, on a Crown return.

**Two self-contradictions inside the funding code.** `FundingCaps.maxHoursPerDay` still said
*"Unverified"* while `DEFAULT_CAPS.basis` — the string actually rendered on screen — had said
*"Confirmed 2026-08-18"* for a fortnight. And `/funding` printed *"The caps have not been verified"*
immediately followed by that basis string. Both fixed by keeping the true half.

**A second under-claim nobody had named.** `maxHoursPerWeek: 20` caps the 20 Hours ECE *component*;
the Ministry allows up to **30 hours a week** of subsidy per child, and the difference is "Plus 10",
which RS7 requests by name and which appears **nowhere in this repository**. So the product discards
hours 20–30 each week on top of the funded absences, while `exportDisclaimer` named only the
absences — a manager could reasonably have read that and concluded the figure was complete once
absences were handled by hand. It now names both. Real money, owed now, independent of the
application.

**A dead ternary, and the reason it is worth a paragraph.** `summariseFunding` ended with
`capsBasis: (children[0] ? DEFAULT_CAPS : DEFAULT_CAPS).basis` — identical branches. Nothing was
wrong on screen, because no caller passes custom caps; but `childFunding` accepts a caps override,
so the first caller to use it would have printed a false provenance directly beneath a total
somebody keys into ELI Web. Fixed by giving `summariseFunding` the caps it is describing.

The suite then passed first try, which per our own rule is a reason for suspicion rather than
comfort: adding a defaulted parameter is behaviourally identical for every existing caller, so 678
green tests said nothing about the fix. Wrote the regression test, then **mutation-drilled it** —
baseline green at 42, reintroduced the ternary, and it failed on exactly the named assertion, 1
failed / 41 passed. Reversed and re-verified. That one assertion is the only thing in the file that
can speak to this fix.

**Also cleared:** `/census` had never been registered in `roles.spec.ts`'s `NAV`/`NAV_GROUPS` label
lists. Those assertions are directional — `shown` must be visible, `hidden` must be absent — so an
omitted label is silently unchecked rather than failing. `'ECE Return'` is now in all four role
entries.

**Then I transcribed Chapter 6 from source instead of trusting the paraphrase, and found a rule
neither the wiki nor the code had.** §6-6, *"Three Week Rule: extension for extended non-operation"*.
`funding.ts` transcribes 6-4, 6-5 and 6-7 while its disclaimer says *"sections 6-4 to 6-7"* — reading
as coverage of four rules where three had been read. The mechanism is a **suspension, not an
extension**: a service closed for two weeks or more suspends the Three Week Rule on the child's last
session before closing and restarts it on the first day they are enrolled to attend after
re-opening. So a naive three-week window over calendar dates would **expire during the Christmas
break** and stop funding a child whose entitlement is suspended rather than spent. That makes absence
spells depend on the centre's operating calendar — the thing `EceServiceClosure` wants and which
`booking_status = 'closed'` does not provide, being per child-day.

**And §6-7's "reconfirmed" is not a boolean.** The Handbook gives two acceptable forms and both carry
a signature: the agreement *"signed and dated by the child's parent/guardian, confirming that the
enrolment agreement remains valid"*, or changed *"to include new days and times"* and also signed. So
it is a dated act by a named person — the same shape as the 20 Hours attestation gap — and a
`reconfirmed boolean` would be the wrong schema.

**A correction to something I said an hour earlier.** I reported the cross-child rule — *"funding
must not be claimed for both an absent permanently enrolled child under an absence rule and for the
conditional or casual child who fills the absent child's place"* — as a rule nobody here had. Wrong:
`funding-and-billing.md` already records it. It is `funding.ts`'s header that omits it. What stands
is the *implementation* consequence, which neither document draws out: every funding figure in this
product is computed **per child in isolation** — `childFunding` takes one child and cannot see the
others — and this rule is about two children competing for one place. A per-child implementation of
absence funding would violate it and **over-claim**, which is the direction `exportDisclaimer`
currently promises cannot happen.

**One deliberate deviation from the approved plan.** It listed *"`readFundingPeriod` never
forwarding `caps`"* as a defect to fix. I did not fix it, because it is not one:
`readFundingPeriod` passes no caps, so `DEFAULT_CAPS` is the truth there, and adding a parameter no
caller sets is configurability nobody asked for (Karpathy rule 2). The trap was never the missing
plumbing — it was `summariseFunding` printing a basis it had not been given, and that is closed.
Recorded here rather than quietly skipped.

---

## 2026-09-03 (seventh) — The RLS suite owns the database while it runs, and nobody had written that down

Ran `test:rls` after the e2e suite went green and it **failed**: *"ONE notification exists for this
report — two overall, counting 0051's"*. A failure whose text reads exactly like a broken tenancy
policy, which is the worst possible thing for it to be wrong about.

It was not a policy. `rls_isolation.sql` asserts **absolute** row counts — `count(*) from
public.notifications where kind = 'attendance'` must equal 2, read as `postgres` so it counts every
tenant's rows. That is deliberate, with a comment explaining that the counts start at one rather
than zero, and it is the right choice: an absolute count catches a policy leaking rows *from
anywhere*, which a delta would miss. The cost is that **the suite owns the database while it runs**,
and that prerequisite had never been written down anywhere.

**I got the mechanism wrong first, and the correction is the useful part.** My first explanation was
that a local e2e run had still been going. I wrote that into a CI comment and a wiki entry before
checking it. The timestamps then killed it outright: audit tenant created 06:10:50Z, notifications
06:12:58Z, e2e reported `119 passed` and finished ~06:20Z, failing RLS run started ~06:24Z. Nothing
was concurrent. Both places are now corrected and separate what was observed from what is inferred.

**What was actually wrong needs no race.** The e2e teardown reported `ok` — `cleanup.teardown.ts:18
› drop the audit tenant (1.5s)` — and left both audit centres in the database with their two
notifications. `sweepStaleAuditTenants` has a two-hour grace period so a run in progress elsewhere
is never touched, so nothing reclaims a tenant that young. **The RLS suite is broken by e2e
leftovers for up to two hours after a run, in any job order.**

**Three hypotheses, two of them mine, all three eliminated.** *Concurrency* — dead on the
timestamps. *A silent zero-row delete in `destroyAuditTenant`* — this was my strong prior, because
line 762 is `.delete().in('id', […])` inspecting only `error`, which is item 49 exactly, in the
function whose whole job is preventing leftovers. It would have been a very satisfying find. It is
also **wrong**: replaying that call with the service key against those two ids returned
`error: null` and **matched 2 rows**, and both centres went. No FK blocks it, and `service_role`
holds DELETE on `centres`. *An early return on an unreadable `TENANT_FILE`* — doesn't fit either:
`.artifacts/tenant.json` is absent while `owner.json` and `parent.json` remain, which is the state
*after* `rmSync`, so `destroyAuditTenant` was reached.

So the question of why that teardown removed nothing while reporting success **is left open in
[`unverified-claims`](llm-wiki/wiki/unverified-claims.md) item 41 rather than closed with a guess.**

**The experiment ran and did not reproduce.** Database cleared to zero `audit-%` centres, then a
full run: `119 passed (8.6m)`, teardown ok in 1.6s, **zero centres and zero notifications left
behind**. A completed run does clean up correctly. One trial is one trial, though — *not reproduced*
is not *cannot happen* — so the entry stays open. The best-fitting candidate is an earlier run
disrupted mid-flight; a `taskkill //F //IM node.exe` was issued in this session while chasing a port,
which is precisely what `sweepStaleAuditTenants` exists for and precisely what its two-hour grace
period declines to handle promptly. Consistent with the timestamps, not established, and the run
whose tenant survived reported `119 passed` with a green teardown, which is *not* what an interrupted
run looks like.

The tempting fix — a zero-row check on line 762 — is explicitly the wrong move: it would guard a
failure mode demonstrated not to occur, and would make the entry look closed. Shortening the sweep's
grace period is wrong for the same reason it exists: two hours protects a run on another machine
against the same single project.

**The cheap operational takeaway.** Before trusting a red `test:rls`, run
`select count(*) from public.centres where slug like 'audit-%'`. Non-zero means the suite is
measuring leftovers, not a policy failure.

**One thing that did come out of it is a real CI defect, found by reading rather than by running.**
`ci.yml` had **no `needs:` anywhere** — all three jobs ran in parallel. `checks` is safe there
(typecheck, lint, unit, build, budgets, `expo export`, no database). The other two both write to the
**one** Supabase project, because AST06 wants three environments and this project has one, which is
production. `tenant-isolation` asserts absolute counts and runs `drill:restore`, which extracts
every row in `public` and compares counts against a shadow reload; `audit` seeds a tenant and drives
119 browser tests through it. Those cannot share a database concurrently.

Fixed with `needs: [tenant-isolation]` on `audit` — isolation first, because AGENTS.md §5 calls the
RLS suite *"the one that matters"* and there is no point spending ten minutes on browser tests when
it is red. **Nothing in CI had ever exposed this and nothing could have**, because those are exactly
the two jobs gated on the secrets item 41 is waiting on: the sequence would have been add the
secrets, watch the RLS job go red, and go hunting for a tenancy bug that does not exist. The comment
beside the `needs:` says to delete it when the e2e job gets its own project, and not before.

**The generalisable lesson, and it is not about YAML.** An absolute-count assertion is a claim about
the whole database, not about the rows the test made. That is a deliberate, well-argued choice in
`rls_isolation.sql`. Its consequence — exclusive access — was never stated, and **a prerequisite
that lives only in the author's head is indistinguishable from a bug** the first time somebody
violates it. Which today was me, twice, with two different wrong theories about why.

---

## 2026-09-03 (sixth) — Item 49 closes, and the script that closed it broke two things

Twenty-seven writes still could not tell a refusal from a success. Twenty-three of them were
guarded by a script, and the script was wrong in a way that four of six gates could not see.

**It anchored on the wrong scope.** For each target: find the function, find its write, append
`.select('id')`, then insert the check after the `if (error) throw` that follows. That last anchor
searched *forward* from the write, and the replacement was applied to the first match **in the
file** rather than in the function.

`updateEnrolment` is the one writer in the sweep with a multi-line error handler — it translates a
`23P01` exclusion violation into a sentence about overlapping enrolments. So the forward search ran
straight past it and matched the handler of the next function down, `listHealthConditions`. A guard
labelled `updateEnrolment` was inserted into a **read**.

Every newly enrolled child's record page then threw, because a new child has no health conditions
and the guard treats an empty list as a refusal.

**What did not catch it.** `typecheck` — the code is valid. `lint` — a read genuinely uses `data`,
so nothing was unused *there*. `test`, `test:rls`, `review:security` — all blind to it. **118 of
119 e2e tests passed.** The single failure was `journey.spec.ts:47`, the enrolment journey, which
is the only test that creates a child from scratch and then opens its record: the only path where
that list is guaranteed to be empty. The error surfaced as the app's own boundary saying *"This
failed while reading, not while writing"* — which was exactly true and exactly the clue.

**Then the second one, which nothing caught at all.** With the misplacement fixed I audited every
guard against its enclosing function and got `0 mismatched`, and very nearly stopped there. The
audit was matching only the phrase `nothing was`, and the generated messages come in variants
(*no room was updated*, *nobody was updated*, *no hazard was updated*). It had inspected **14 of 48
guards** and reported nothing about the other 34.

Counting instead of inspecting found the rest: **54 `update`/`delete` statements** in the package,
against 49 guards and 4 documented exceptions — one short. The missing one was `setEnquiryStatus`,
which had received its `.select('id')` and no check whatsoever. A select that did nothing, on the
writer that moves an enrolment enquiry through its pipeline and stamps who moved it. Lint had no
opinion because the destructuring stayed `const { error }` — no unused variable — and a mismatch
audit cannot inspect a guard that was never inserted.

**The signal I had and threw away.** Lint *did* report one thing during the batch pass: an unused
`data` in `updateEnrolment`. That was half of defect one, announcing that the edit had gone wrong
somewhere. I fixed the unused variable by hand and carried on without asking why the script had
missed that function — and the answer to that question was a guard sitting in a read. **One
warning out of a batch edit is a report about the edit, not about the line.** Reading it as a local
annoyance cost a full suite run and hid the second defect for another hour.

Three things are written down as a result, in [`conventions.md`](llm-wiki/wiki/conventions.md):
never anchor a batch edit on the first match in a file; reconcile totals rather than only checking
the items you can see, because every guard present can be correct while one that should exist is
missing; and check an audit's own reach before quoting it as evidence.

**Final tally, measured rather than asserted.** 54 `update`/`delete` statements, **50 guarded, 4
deliberately not** — `moderateComment` (zero rows means losing a moderation race), `markThreadRead`
(bulk, and nobody is told it happened), and the superseding updates inside `recordImmunisation` and
`createInvitation` (both match nothing on a first record). Each of the four carries a comment
saying so. `INSERT` and `UPSERT` are excluded from that denominator — the package has 115 writes
all told — because a policy refusal on an insert fails its `WITH CHECK` and returns an *error*; it
cannot match zero rows and report success. That asymmetry is the whole reason this bug class exists
on one half of the writes and not the other.

Also corrected: item 49's closing line in `unverified-claims.md` had said *"lint caught the one
function it could not fit."* It caught neither defect. The correction is a new paragraph rather than
an edit, per this repo's rule.

---

## 2026-09-03 (fifth) — The enquiry went out, and the last red gate was a translation layer nobody uses

Owner sent the enquiry. Recorded it in `eli-ministry-enquiry.md` as sent, with the five answers
now outstanding and the note that nothing in this repo may read an unanswered question as a yes.

Then the item I could do alone: **attribute the 7.0kB `check:bundle` overage**, red since
2026-08-14 and recorded as *"pre-existing and unattributed"* — the sole reason no CI job in this
project had ever passed.

**It was `next-intl`.** `NextIntlClientProvider` is a client component and it was in
`app/layout.tsx`, the root layout for every route — so `use-intl` plus the whole `@formatjs` ICU
MessageFormat parser sat in the first-load bundle of every page, `/login` included, in a product
whose only non-English message file is `[mi] `-prefixed English.

**Attributed by fingerprinting rather than bisecting.** Six first-load chunks: two are React 19 and
the App Router runtime at 97.7kB — precisely the *"~98kB"* the budget's own note predicts — leaving
one 11.7kB chunk unaccounted for. Its string literals name it beyond argument: `MISSING_MESSAGE`,
`INVALID_MESSAGE`, `selectordinal`, `DUPLICATE_PLURAL_ARGUMENT_SELECTOR`,
`EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE`, `EXPECT_DATE_TIME_SKELETON`. A complete ICU pluralisation
and skeleton parser.

**Fixed by scope, not removal.** Exactly two components call `useTranslations` —
`ChangePasswordForm` and `LocaleSwitcher` — and both are under `/account`, so the provider moved to
that route's layout. `getLocale()` stays in the root because `<html lang>` needs it and
`next-intl/server` is server-only. **113.0kB → 101.1kB against a 106kB budget, within 0.5kB of the
4 August baseline** — so this one import was the entire regression. `getMessages()` moved with it,
which also stopped the full message catalogue being serialised into every page's HTML, a cost the
budget does not even measure.

**Then I ran the step hiding behind the gate**, because clearing a blocker is not the same as the
thing behind it working. `Bundle mobile` (`expo export --platform android`) sits immediately after
the budget in CI and had therefore never executed in the project's life — the gate written
specifically to catch a monorepo resolver failure had never once run. Exit 0, 3.3MB Hermes bundle.
A budget fix that merely exposed a broken step would have been worse than the budget failing.

**So the CI position is now: job 1 should pass, which no job ever has.** Jobs 2 and 3 still fail on
their credential guards, and that is the owner's decision rather than an engineering one — putting
a database credential into a public repository's secrets is not mine to make.

**Two lessons, neither of them about i18n.** A provider in a root layout is a decision about every
page in the product, and at the call site it looks like three lines of setup. And an unattributed
budget failure is worse than a red gate: the number sat in `unverified-claims` for three weeks
under the word *"pre-existing"*, which means *not mine to explain*. It was one chunk and one grep.
Nobody had looked.

**Stated honestly rather than as a clean sweep.** Three full e2e runs today. One had a single
intermittent failure — `medication.spec.ts`, *"a second dose … not swallowed as a duplicate"* —
which passes in isolation and passed in the other two runs. The suite is green **with a known
intermittent**, which is not the same as reliably green, and after this week I would rather write
the weaker true sentence.

**Where the gates stand:** typecheck, lint, `tokens:check`, `check:docs`, 678 unit tests,
`test:rls` 634/634, `review:security` 16/16, `drill:restore` 6/6, `build`, `expo export`, and
**`check:bundle` within budget for the first time since 14 August**. `test:e2e` 118/118 on two of
three runs.

## 2026-09-03 (fourth) — Searched for the enquiry's answers before sending it, and the most important question was already answered

Owner's instruction: before sending the enquiry, search online for the answers. Four of the nine
were published. One of them was the question this whole application was said to turn on.

**§3 of the tranche document was wrong, and it was my error.** It argued the Ministry contradicted
itself — *"must already be developed to the ELI integration specifications"* set against a template
asking for development-and-testing durations — and called resolving that the question that decided
whether applying this tranche was possible at all.

The page says no such thing:

> *"Your application must already be fully developed and ready for the National Student Index (NSI)
> and ELI integration work to be **added**, tested and verified."*
>
> *"**After we have accepted your application, you will need to develop the NSI and ELI integration
> components.** This includes the interface to NSI and creation of events and transmission of
> events to ELI."*

Functionality complete at application; interface work after acceptance; process starts late 2026
and runs 12–18 months. Exactly the reading I had called "most likely" and then declined to trust.

**The fragment I built the section on came from a summary of the page, not the page.** A
summariser compressed *"must already be fully developed and ready for the … integration work to be
added"* into *"must already be developed to the ELI integration specifications"*, dropping the six
words that carry the meaning and inverting it. This repo already says a paraphrase is not a source
— it is `unverified-claims` item 36's whole complaint about a tool reading a regulation — and I did
not apply it to a tool reading a procurement page. It cost nothing because the question was drafted
and never sent, which is the only reason this is an anecdote.

**The reading also produced a better question than any it removed**, and this one touches code I
shipped yesterday. §14-2 of the Handbook lists the census staff fields in the Ministry's own words,
and the XSD had misled me about three of them:

- **`ContactHoursDetailList` is weekday + start + end with no dates — the shape of a contract.**
  §14-2 calls the same field *"**Actual** contact hours for teachers/staff (start and end dates and
  **actual** contact start and finish times spent teaching children)"* and asks separately for
  *"Total Hours worked during the ECE Census week"*. Those are measurements. `0081` built a
  contract, and `census.ts` derives the hours total from it. **If the Handbook's word is the
  operative one, the source is `staff_attendance_events` for the census week** — and a centre that
  has not adopted per-person staff sign-in cannot answer it at all, which would make the derived
  ratio a prerequisite for the Return rather than a refinement of it. Now `unverified-claims`
  item 50 and enquiry question 1.
- **Two pairs of staff dates.** §14-2 wants *"working at service"* **and** *"in role at service"*.
  The schema carries one pair, inside the role block. I had mapped it to employment dates in the
  `AST47` table; it is more likely the in-role pair, and we hold no in-role dates at all.
- **Three flags are "(permanent staff only)".** The schema marks them merely optional, which is a
  weaker statement than the Handbook's, and we collect all three unconditionally.

**The rule that generalises**, now written into `eli-integration.md`: an XSD bounds what a field may
*contain*; only the Handbook says what it *means*. Every field mapped from the schema alone carries
an unread requirement behind it. That is uncomfortable given the census was built from the schema —
so the fields are now flagged rather than trusted.

**Also answered without asking:** which page holds the development criteria (the integration page,
under *Intended functionalities*); the closing date (30 October — the form's *"September 2026
tranche"* is stale wording); and whether Waha Rumaki/PITA applies to a standard education and care
service — **no**, §14-5 names only Puna Reo, Reo Rua, and Leo o Fanau Moana immersion or bilingual,
monthly. That last one survives in narrowed form, because §14-5 answers the *service's* obligation
and the open question is the *vendor's*: must an applicant build it to be approved even serving none
of those types? Chapter 6's lesson, third outing.

**Genuinely still open, and the enquiry is now these seven:** the contracted-versus-actual hours,
the two date pairs, the security and assurance evidence, whether the public XSD is normative, where
the staff-role / wait-time / closure-reason code lists live and whether they carry machine-readable
effective dates, the Waha Rumaki vendor question, and how the 50-service capability is evidenced.
Two of the nine dropped entirely; one replaced by something sharper.

One thing worth noting in the code sets: the Ministry states that a system *"approved as meeting
the specifications … for integration to the Early Learning Information system must capture at least
Level 3"* ethnic groups. That is a concrete, citable vendor requirement, and it is now in the
application rather than a question.

## 2026-09-03 (third) — Seven of item 49's thirty-four, and the lesson was in the second order

Took the access-control and evidence writes first, because a silent refusal on those is a false
statement to somebody deciding who may read children's records: `setMemberRole`, `revokeMember`,
`revokeInvitation`, `markSighted`, `archiveStaffRecord`, `archiveEvidence`,
`supersedeCustodyArrangement`. **27 guarded, 27 not**, from 20/34.

The judgement for each was the same question: *can this legitimately match nothing?* All seven name
one row by id, and an UPDATE matches its row whether or not the value changes — setting a role to
the value it already holds still matches — so zero rows can only mean a wrong id or a refusal.

**One I deliberately did not touch, and it justifies the whole per-site approach.** The superseding
update inside `createInvitation` withdraws any live invitation for a mailbox before issuing a new
one. It matches nothing in the ordinary case, because most mailboxes have never been invited. A
check there would turn the common path into an error. It now carries a comment saying so, because
the next person reading item 49 will see an unguarded write and reach for the pattern.

**The part I did not anticipate, and the reason this took longer than seven edits.** A zero-row
check makes a function *able to throw*. `changeRole` and `revoke` had no `try`/`catch` — they never
needed one, because their writers never threw. So the guard on its own would have swapped a silent
lie for an unhandled server-action error, which is not obviously better. Adding the `catch` then
widened the action's inferred return union and broke a loosely-declared `Result` in a **client
component two files away**: `type Result = { error?: string; ok?: boolean } | null` had been
accepting anything and letting `state?.error` compile against a branch with no `error`.

Fixed by declaring the contract in the actions file and importing it in the component, with a
narrowing helper — one declaration imported by both, which is the same argument `help/tabs.ts`
makes for one array. **Each remaining site is therefore a guard, a handler, and possibly a type**,
not a one-line change, and that is now written into `conventions.md` as *a guard has to arrive with
somewhere for its failure to go*.

`typecheck`, `lint`, 678 unit tests, `test:rls` 634/634, `review:security` 16/16, `check:docs`, and
`test:e2e` **118 passing, 0 failing** — including the role-boundary test that revokes a membership
and asserts access ends immediately, which is what would have caught a guard firing on a write that
was supposed to succeed.

## 2026-09-03 (second) — Correcting an incident draft had never once worked, and I had the diagnosis backwards

Took the one failure left from the e2e recovery. It was not a stale read. It was a missing grant,
and the feature had never worked in its life.

**The cause.** `0066` added `incidents.room_id`. `0030` had granted UPDATE **by column, on
purpose** — so that moving a report to another child is refused by Postgres before any policy runs
— and `room_id` was never added to that list. `updateIncidentDraft` always sends it, because the
correction form has a room picker and a patch that omitted the field could not clear one. So every
attempt to correct a draft raised `42501 permission denied for table incidents`, from 2026-08-28
until `0082` today. Filing a report with a room always worked (the INSERT grant is table-wide) and
finalising always worked (it writes only `status`, which was granted). Fixing a typo in an unsent
draft never did — and the only route to it was to finalise and amend, permanently marking a report
as replaced, which is the exact outcome the edit path exists to avoid.

**Where I was wrong, and I would rather write this down than the bug.** Yesterday I recorded that
the write "provably succeeds — the new zero-row check does not fire, so no policy is refusing". The
zero-row branch was silent because the **error** branch fired first. A passing zero-row check means
only *the update did not silently match nothing*; it is not evidence that a write happened. I read
the absence of one failure mode as the presence of success — the same shape as reading a gate that
has stopped running as a gate that passes, which I had written up the day before. Twice in two
days, from opposite directions.

Found by instrumenting the flow instead of reasoning about it: a throwaway spec that dumped the
form's own `FormData` before and after filling, the POST status, and every `[role=alert]` /
`.error` on the page afterwards. The answer was one line of output — `updateIncidentDraft:
permission denied for table incidents` — sitting on screen the whole time, in a test that asserted
on the table row instead.

**`0066` was not careless, which is why this went in `conventions` and not just here.** It stopped
and reasoned about grants; its comment explains why adding a column to `safety_checks` is safe
because that table's **INSERT** grant is not column-scoped. It checked INSERT on all three tables
and never looked at UPDATE. `hazards` has table-wide UPDATE and `safety_checks` has none, so
`incidents` — the one whose grant is narrow on purpose — was the only table exposed. **The lesson
is not "check the grants". It is check them per verb**, and `information_schema.column_privileges`
returns `privilege_type` for exactly that reason.

**Two assertions were missing; both now exist.** `rls_isolation.sql` performs the exact column set
the app sends and asserts it succeeds — functional rather than catalogue-based, because the
catalogue can say which columns are granted and only a write can say whether that set is the one
the application actually needs. **It fails with 42501 against a database without `0082`**, so the
mutation test came free. And `incidents.spec.ts` now asserts `.error` is empty immediately after
saving — which `conventions.md` already named as *"the only thing in the repo able to tell
'refused' from 'did not persist'"*. I added it before noticing the page recommends it, which is a
point in the page's favour and not in mine. The sibling `settings.spec.ts` had it; this one did
not, which is why the same defect class was caught in `centres` in a day and in `incidents` in six.

**And the detail that ties the last three days together: one commit introduced the defect and
disabled the test that guards it.** `0066` and the `SyncStatus` health probe shipped together on
2026-08-28.

`test:rls` **634/634**, `review:security` 16/16, `drill:restore` 6/6, 678 unit tests, and
**`test:e2e` 118 passing, 0 failing** — green for the first time since 2026-08-27.

## 2026-09-03 — The census gets a screen, and the interesting part is what it will not let you type

Yesterday's migrations gave the census a schema and no way to fill it in. `packages/api/src/census.ts`
and `/census` close that.

**The API layer reuses rather than re-reads.** `listStaffMembers` and `listStaffRecords` already
exist and are already paged, so the census reads neither table again — which matters beyond
tidiness: the registration flag comes from the same `practising_certificate` row the licensing
binder reads, so **the Return and the binder cannot disagree about the same person.** What is new
is `staff_census_details`, `staff_contact_hours` and the code sets, all paged with `fetchAll`. The
contact-hours read is deliberately *not* filtered to a date in SQL: a screen that lets somebody
supersede a contract has to show the history being superseded, and `contactHoursOn` in `@ece/core`
is the one place the effective-date rule is written down.

**The screen refuses six of its sixteen fields, and the refusal is not in the markup.** Gender,
staff role, qualification, playcentre qualification, ethnicity and iwi are unenumerated
`LookupCode` values with no published list loaded, so each renders as a disabled select reading
*"No Ministry code list loaded"* — **and the server action does not accept those fields at all.**
The `disabled` attribute is a courtesy to the reader; the action ignoring them is the guard. A
screen whose only protection is an HTML attribute has no protection, and this repo has said so
about the capability map since Phase 0.

What it *does* offer is what the schema itself enumerates: five role kinds, twelve age bands, five
leaving destinations, seven weekday codes. The leaving destinations show as raw codes — `D01` to
`D04`, `UNK` — because the schema lists them without definitions and a label would be this product
inventing one.

**Three selects instead of three checkboxes.** Paid, permanent, full time are *Not recorded / Yes /
No*. A checkbox cannot express the difference between *unpaid* and *nobody has said*, `0081` made
those columns nullable so the difference would survive, and a blank posts `null`. Getting this
wrong would submit an unanswered question as a fact about somebody's employment.

**Zero new CSS, and that was forced rather than chosen.** `first-load-css` is 3.7kB against a 4kB
budget — 0.3kB of headroom — so a per-screen stylesheet would have breached a gate to style one
form. My first draft invented nine class names (`panel`, `chip chip-ok`, `muted`, `warn`,
`census-person`…) and **not one of them exists in this codebase.** Reading what `/funding` and
`/staff` actually use — `card`, `flag flag-ok`, `flag flag-warn`, `sub`, `inline`, `empty`,
`small secondary` — replaced all nine. Worth recording because inventing a parallel vocabulary is
how two design systems end up in one app, and it took two minutes to check.

**Two checks caught things I had not.** `launcherCoverage.test.ts` went red — a *second*
derived-coverage test I did not know existed, parsing `layout.tsx` and requiring a launcher card
for every rail link, the same technique `helpCoverage.test.ts` uses for the help page. Adding a
nav link therefore costs three entries, and the tests say so rather than leaving the overview
quietly incomplete. And the typecheck failed *inside* `fetchAll`: a column list built with `+`
across several lines is typed `string` rather than a literal, and supabase-js infers the row shape
from the literal, so every column became `GenericStringError`. One line to fix, with the reason
written above it so the next person does not start in `paging.ts`.

**Deliberately not built, and named so it is not mistaken for an oversight:** a person's own view
of their own census record. `0081`'s policy permits it — owner, manager, *or the person
themselves*, because IPP 6 gives someone a right of access to their own information — but a screen
showing somebody their employer's record of their ethnicity and age band wants its own thinking
about **correction** under IPP 7, not a read-only block bolted onto a management page. Until it
exists, that access is a request to the centre. Lawful, and not complete.

**What this does and does not do to the application.** `AST47`'s data-source table went from *"this
table cannot be completed"* to a completed first draft, with six cells honestly marked as awaiting
a Ministry list. The tranche document's verdict said *"three of eight functionalities are absent"*
and now says the census is built but blocked on a published code list. **The declaration still
cannot be signed** — what moved was the reason, and a gap table that improves faster than the
product does is one nobody should trust, so that caution is now written into the document itself.

### The one line that had broken the whole e2e suite for six days

**Resolved the same day.** The suite went from 42-plus failures to **117 passing, 1 failing**, and
the mechanism is worth more than the number.

The trace's network log records only *completed* resources, so a hanging request cannot appear in
it. A throwaway spec that listened to `request`/`requestfinished`/`requestfailed` and printed what
was still outstanding answered it on the first run:

```
30 started, 29 settled, 1 OUTSTANDING
  OUTSTANDING GET fetch 25s http://127.0.0.1:3210/api/health
networkidle: NEVER REACHED
```

One request. **`SyncStatus` never read the response body.** `await fetch(…)` resolves when the
headers arrive; the body is a stream, and a stream nobody reads leaves the request in flight in
Chromium's accounting. That component sits in `(app)/layout.tsx`, so it happened on every
authenticated page, and `networkidle` waits for the in-flight count to hit zero. The route itself
was innocent — 5ms by `curl`, 200 every time — which is exactly why it took a while: everything I
could measure server-side said the app was healthy.

`await res.text().catch(() => {})`. 29/30 settled and never idle became 30/30 settled and idle.
**A product defect, not only a test artefact:** a leaked response per page load, every two minutes,
on a tablet that stays open all day.

### What six days of silence had been hiding

This is the part I would want somebody to read. Once navigation worked, five failures remained and
four of them were real:

- **Three strict-mode collisions from the launcher** (2026-08-30). It names every screen the rail
  names, so `getByRole('link', { name: 'Attendance' })` started resolving to two elements. Scoped
  those three locators to `#side-nav`, which is what they always meant.
- **A test contradicting a shipped feature.** `journey.spec.ts` asserted the funding banner reads
  *"Incomplete"*. `periodPrecedesRecord` (2026-08-29, commit `d39a178`) added a third and stronger
  state — *"Records do not cover this period — do not use"* — which is what a fresh fixture
  actually produces, because its child signs in today and the period starts before the record. The
  feature and its guard disagreed for five days and nothing could say so. Now asserts the intent:
  the banner must refuse, and either refusal counts.
- **Two incident writers with no zero-row check.** `updateIncidentDraft` and `finaliseIncident` did
  `.update(…).eq('id', …)` and inspected only `error`. Under RLS a refused update matches no rows
  and PostgREST reports success — so both could report a saved correction, or a finalised report,
  that had not happened. On a compliance record. `updateCentre`, `updateStaffMember` and
  `linkStaffRecord` have had this check all along, each with a comment saying why; these two never
  did.

**And one failure I did not fix, deliberately.** `incidents.spec.ts` — *"a draft is corrected in
place"*. With the zero-row check added, the write **provably** succeeds (the new error does not
fire, so no policy is refusing) and `revalidatePath('/incidents')` is called — yet the list still
renders the pre-correction text. So a correction to an incident draft may not reach the screen that
tells somebody it saved. That is a different feature from anything I was building, it is on a
compliance record, and it belongs in its own change rather than bolted onto this one. Recorded in
[[unverified-claims]] item 41 so it cannot be lost in a commit message.

**What the census work got out of it**, which was the original point: `/census` passes the axe
audit at WCAG 2.2 AA with all six tags, and its row in the roles matrix passes — an educator and a
parent are both refused, and the whole roles spec is green.

### And the thing I could not verify at the time, which turned out to be the bigger finding

AGENTS.md §5 says a new route with a capability guard means `test:e2e`. So I added `/census` to the
roles matrix and the axe audit and ran it. **32 accessibility tests and 10 role-boundary tests
failed, every one timing out after 60 seconds** in the `visit()` helper, which waits for
`networkidle`.

**It is not mine**, and that was settled by experiment rather than by argument. I reverted the one
shared file the change touches — `layout.tsx`, a single nav link — rebuilt, and re-ran the
`/attendance` audit, a screen the census work does not reach. **Identical failures.** Then restored
the link.

Ruled out cheaply: PostgREST answers in 130–310ms, so the project is not throttled despite a day of
migrations, two restore drills and two RLS runs against it; the portal mount is unset locally, so
`basePath` is not fighting the tests' `baseURL`; and **the pages render** — the failure snapshots
contain the whole accessibility tree, shell, centre name and role. It is the waiting that fails,
not the app. `SyncStatus` polls from the layout on mount and every 120s, which is the obvious
suspect, but its fetch is caught and 120s is longer than the 60s timeout. **Cause not yet known.**

Two consequences worth separating.

**For the repo:** `unverified-claims` item 41 said the consolation for a red CI was that *"every
gate this repo runs is run locally, by hand"*. For this gate that is no longer true, and
`production-readiness` records the axe audit at **30/30 green** on a past date — so something
regressed and nothing noticed. That is item 41's failure mode one level up: not a claim that went
stale, a **gate that stopped running.** Extended item 41 with what was ruled out, and with the
instruction not to "fix" it by widening the timeout.

**For the application:** my own `AST18` answer cited *"19 screens against WCAG 2.2 AA, 30/30
green"*. Those figures describe the suite's design and a past result, not its present state, and
`roles.spec.ts` — the check that proves an educator cannot open the office screens — is among what
cannot currently be run. Corrected in place, with the disclosure written out rather than softened.
The Postgres-side boundary is not unverified: the RLS suite covers the same ground and is green at
632. What is unverified is the guard in front of it.

**What was verified for this change:** typecheck, lint, `tokens:check`, `check:docs`, 678 unit
tests, `test:rls` 632/632, `review:security` 16/16, `drill:restore` 6/6, and `check:bundle`
unchanged at 113.0kB with CSS still 3.7kB. `test:e2e` was red for reasons that turned out to have
nothing to do with this change — **now 117 passing, 1 failing**, with the census screen's axe audit
and roles row both green. See the two sections above.

## 2026-09-02 (second) — Phase 10's census, a mutation harness that lied, and a credential aimed at the wrong database

Owner's call: start the staff/census build rather than wait for the Ministry. Two migrations, one
core module, and three findings that were not in the plan.

**0080 — the code sets, and they ship empty.** Nine domains — gender, ethnicity, iwi, language,
staff role, qualification, playcentre qualification, wait time, closure reason — each effective-dated
the way `AST55` demands, with `source` mandatory as in `criteria_sets`. **Not one code is seeded.**
Every list is a published Ministry classification nobody here has read, and seeding a plausible one
is forbidden by name in AGENTS.md §7. This is the `criteria` decision a second time and for the same
reason: an empty table stops a screen, a wrong code reaches a funding return looking like a fact.

The only two things transcribed from the public schema are the 10-character `LookupCode` bound and
the domain list itself.

**0081 — the census, and the table's whole reason is one read.** The ECE Return wants fifteen fields
per person and eleven had no column anywhere in 79 migrations. The obvious build is columns on
`staff_members`; it is wrong, because `staff_members_select` is centre-staff-wide — right for a
roster, wrong for a colleague's ethnicity — and **no policy could fix it**: a policy restricts rows,
only a grant restricts columns, and a column grant applies to `authenticated` as a whole so it
cannot tell an educator from a manager. So it is its own table with `staff_records`' predicate:
owner or manager, **or the person themselves**, because IPP 6 gives someone access to their own
information. They cannot edit it — reading your own vetting result is not maintaining it.

Three things it deliberately does not hold. **Registration and the Teaching Council number**, which
already sit on a `practising_certificate` record — so the census and the licensing binder read the
same row and cannot disagree. **A date of birth**, because the schema wants one of twelve age bands
and a band is the minimum that answers the question; this product already refuses a birth date on
the job-application form on that reasoning. **Any code value at all.**

`isRegistered` came out three-state, and it is the sharpest thing in the module. The schema types
`IsRegistered` as a required boolean, so the wire has no third value — but *"we hold no practising
certificate"* is not *"this person is not registered"*, and 0038 leaves every certificate link null
on purpose. Sending `false` asserts something about a named individual's professional standing on
the strength of a missing row. So it returns `null`, the return cannot be sent, and the report names
who needs linking.

**The mutation harness lied, and that is the most useful thing that happened today.**

47 unit tests passed first run. AGENTS.md says distrust that, so I mutated. The harness reported
**sixteen of seventeen mutations caught** and every result was worthless: it had been measuring
against a baseline that was itself already mutated. I had "restored" the file behind
`if ! git diff --quiet` — and `git diff` is *silent on an untracked file*, so the guard took the
else branch, printed "file is clean", and restored nothing. Every subsequent run was three
assertions red before it began, so any mutation looked caught.

The tell was there and I nearly missed it: every mutation reported the same uniform failure count.
Rewritten, the harness now refuses to run unless the baseline is green, and ends with a
comment-only control edit that **must** survive. Second run: **24 of 24 caught**, failure counts
varying 1 to 8, control survived.

**The RLS suite went 607 → 632, and the fifth policy mutation was the interesting one.** Four
behaved: widening the census read to any colleague fails *"reads EXACTLY their own"*; dropping the
IPP 6 branch fails *"an educator CAN read their OWN"*; dropping the overlap constraint fails the
overlap assertion; letting an educator edit fails the edit refusal. The fifth — granting `insert`
and `update` on the code sets to `authenticated` — left the suite **green**, because with a grant
but no policy Postgres still raises `42501` and my `insufficient_privilege` handler cannot tell the
two layers apart. Defence in depth working exactly as 0003 argues, *and* a test blind to which
mechanism is holding. Fixed by asking the catalogue directly: `authenticated` holds no write
privilege on either table. Now 5 of 5.

**Two defects the standing checks caught before I claimed done.** `review:security` went HIGH on
the new tables having no audit trigger — correct, they are national reference data and belong in
the exemption list, and **there are two exemption lists** that have to agree. And the contact-hours
constraint refused an insert my own test expected to succeed: an open-ended contract blocks an
overlapping later one *until it is closed*, because a null `effective_to` is infinity. Superseding
contracted hours is two statements, close then open, and a screen offering only "add hours" will
show a manager a `23P01`. Both halves asserted now.

**Then, asked to find a direct Postgres URL in the sibling `salix` repo: a near-miss.**
`SUPABASE_DB_URL` here is empty, which is why every command falls back to the account-wide PAT.
`salix/.env.local` has an `ECE_SUPABASE_ACCESS_TOKEN` (byte-identical to ours) and an
`ECE_SUPABASE_PROJECT_URL` — **byte-identical to `CHARITY_SUPABASE_PROJECT_URL` two lines above
it.** The API says that ref is `charity-platform`. Pointing `npm run migrate` at the variable named
for this project would have applied 79 migrations to another live database, and an account-wide
token would not have refused.

CLAUDE.md already warns that a PAT is account-wide and that one was once handed over pointing at
the wrong project. This is the second instance, so the rule is now specific rather than cautionary:
**do not read a project ref out of a file — ask the API which project it is, and check the name.**

**And the same API call closed a question that had been open for a month.** The project is in
`ap-southeast-2` — **Sydney**. `privacy-statement.md` had carried the region as an explicit blank
since 2026-08-06, phrased as *"Sydney, Singapore or Oregon"*: three guesses standing in for one
call, and a failed `AST03` of the vendor assessment for as long as it stood, since the Ministry
expects offshore storage to be *"communicated and accepted by each service"*. Both regions are now
named in the document a centre reads. Disclosure is done; **acceptance is not** — that needs the
service to acknowledge it in writing.

**Gates.** typecheck, lint, `tokens:check`, `check:docs` clean. Unit tests **678 in 46 files**.
`test:rls` **632/632** against live Postgres. `review:security` **16/16**. `drill:restore` **6/6**,
now 76 tables and 12,990 rows, with no time-relative CHECK reintroduced. `check:bundle` still over
by exactly 7.0kB — 113.0kB, byte-identical to the documented pre-existing overage, so nothing here
reached the client bundle. **The census has no screen**, deliberately: a form collecting a person's
ethnicity wants its own thinking about who sees it, not just who may read the row.

## 2026-09-02 — The ELI door is open for eight weeks, there is one place, and we do not qualify

Went looking for how to build an ELI integration and answer the Ministry. Found that the question
had changed underneath the repo.

**Applications are open.** The Ministry's integration page was last updated on 1 September 2026 —
the day before this session — and it now says *"We are now accepting applications from new early
learning student management system (SMS) vendors to undergo an assessment for the 2026 tranche."*
Closes **5pm, Friday 30 October 2026**. **One** commercial applicant will be supported, decided on
a *"readiness"* assessment, with integration then taking 12–18 months.

On 18 August the Ministry told us the review was still under way with no published end date, and
this repo recorded that accurately and then stopped checking. Fifteen days. Nothing here was
watching the page, and nothing here should have needed to be told.

**The mandatory schema was public the whole time.** `https://eli.minedu.govt.nz/eli.xsd` — 200,
`text/xml`, 23,665 bytes, no authentication. 26 root elements, nine event families, every
enumeration and every length bound. Two weeks of this repo's writing treats the ELI message format
as locked inside a password-protected attachment.

And the attachments are **not on this machine.** Searched the whole user profile to six levels:
nothing. They were decrypted and read on 18 August, the age-band rule came out of them and improved
the product — and every fact about the *interface* evaporated when that session ended, because only
what changed got written down, not what the documents said. That is now the opening argument of a
new wiki page, because it is a more useful mistake than the one item 38 recorded.

**One good thing fell out of it.** The schema restricts the RS7 period start to
`[0-9]{4}-(02|06|10)-01`. `ministryFundingPeriods` returns February, June and October starts,
written on 18 August from the document nobody can now open. **It is the first funding figure in this
product with two independent sources**, and that is the pattern worth copying: a figure sourced once
well decays when its source does.

**Then measured the product against the Ministry's own mandatory list, and it does not pass.**

Of eight required functionalities, three are absent: the annual ECE census, the RS7 return and the
Waha Rumaki/PITA return. The census is the bad one — not incomplete, *absent*: eleven of the fifteen
staff fields have **no column anywhere in 79 migrations**. No staff gender, no ethnicity, no role
code, no paid/unpaid, no permanent/temporary, no full-time/part-time, no qualification of any kind,
no registration number, no years of experience, no hours per year, no FTE. The word
"qualification" appears in this repo in prose comments and one test fixture's job title. And the
roster is one row per calendar date, so there is no weekday contract to derive contact hours from.

RS7 wants **daily** counts by age band and funding type plus daily staff hours split by
qualification; this product produces funded hours per child per period. Right arithmetic, wrong
shape, and two of the eleven figures need the column that does not exist.

Home-based and sessional are unmodelled, kindergarten is unmodelled, and `centres` has **no
service-type column at all** — so the product cannot record the distinction the "50 services across
the relevant licence types" capability requirement is stated across.

Three assessed items fail on infrastructure rather than function, and they fail harder than any of
that: `AST06` expects a minimum of three environments and there is **one, which is production**;
`AST09` expects production data isolated and **local development runs against the production
project**; and against `AST18`'s testing question the suites are genuinely strong — 607 RLS
assertions, ~579 unit tests, 104 e2e checks, four drills — attached to a **CI that has never passed
in 137 runs**, where four of the six gates have never executed at all.

**So the form's first declaration cannot be signed.** *"Your SMS meets the SMS Development
Criteria"* is a statement to the Crown, and it would be false. That is now item 48 on
`unverified-claims` — the only entry on that page which is a measurement rather than a claim, and
it is there because the failure mode is the page's own with a form in place of a screen: the
Ministry prints its expectation beside every one of the 56 assessed questions, which makes the
answer it wants very easy to write.

**Found a contradiction in the Ministry's own material** that has to be resolved before anything is
signed: the page says the SMS *"must already be developed to the ELI integration specifications"*,
while the template asks for development-and-testing durations for all five interface components and
says go-live waits until each has been built and tested. Those cannot both mean what they say. The
likely reading is that functionality precedes application and interface work follows selection —
but "likely reading" is the phrase that produced the 50-services error, where one page was read
pessimistically for four months and the Ministry answered the other way in four days when somebody
asked. So it is question 1 of a nine-question enquiry, and the form itself requires questions to be
raised before submitting.

**Also found, all of it disclosed rather than filed away:** the Supabase at-rest region is still
undocumented, which `AST03` asks about directly and which our own privacy statement carries as a
blank; encryption at rest is asserted nowhere; the audit trail has **no interface at all**, so
"available to Ministry auditors" is true of the compliance binder and not of the audit log; the
privacy statement tells families "176 automated assertions" when the suite is at 607; six accounts
from an unrelated application still sit in the project's auth schema; the service key and the
migration token have never been rotated; and the retention runbook documents a function call
missing the argument that carries its owner check.

**Wrote four things and corrected five.** New: `docs/eli-integration-2026-tranche.md` (the facts,
the gap table, the verdict), `docs/eli-application-answers.md` (draft answers to all 56 assessed
items, marked `[OWNER]`, `[BLOCKED — spec]`, `[GAP]` or `[FIX FIRST]`, with an eleven-item
pre-submission list), `docs/eli-ministry-enquiry.md` (nine numbered standalone questions — shaped
that way because the last enquiry bundled two questions into paragraphs and both came back
unanswered or answered sideways), and `llm-wiki/wiki/eli-integration.md`. Corrected the "still
closed" claim in `funding-and-billing`, the ELI line in the roadmap's *deliberately does not do*
list, and the same stale assertion sitting in two code comments in `funding.ts` and `billing.ts`.

**Nothing has been sent and nothing has been submitted.** The enquiry is a draft in the repo for
the owner to send, and question 1 decides whether this tranche is ours at all.

## 2026-08-18 (sixth) — The absence rules, and the discovery that the funding export under-claims

Third trip to a primary source today, and the third one to find something. Chapter 6 sections 6-4,
6-5 and 6-7 of the ECE Funding Handbook, at the URL the Ministry named in its second email.

**The sentence that matters:** *"Absence rules allow services to claim funding for hours that
permanently enrolled children do not attend, providing that certain conditions are met."*

The rules, sourced:

- **6-5, Three Week Rule.** Claim every enrolled-but-absent session within three weeks of the FIRST
  day of absence; nothing from the fourth week on; funding resumes when the child returns. It stops
  the moment a parent says the child is not returning — **even mid-window** — and anything claimed
  after that point is recovered.
- **6-7, Frequent Absence Rule.** Attendance must match the enrolment agreement for at least half of
  each calendar month. Flagged month 1, agreement reconfirmed month 2, month 3 claimable only if
  reconfirmed, month 4 not claimable and the agreement must change.
- **6-4** also forbids claiming for both an absent permanent child and the casual child filling their
  place, and requires subsidy rather than 20 Hours funding where a fee-paying casual child fills an
  absent 20 Hours child's place.

**This product claims none of it, and the split matters.** Funded hours come from attendance events,
so an absent day is zero. For a **casual or conditional** child that is exactly what 6-4 requires —
the calculation is already right. For a **permanently enrolled** child it **under-claims**, and
losing a centre funding it is owed is the same class of failure as over-claiming.

**The blocker is the schema.** `enrolments` has no permanent/casual distinction — "casual" appears
nowhere in this repo — and 6-4 turns on exactly that axis. Not built, deliberately: absence funding
needs an enrolment type, a three-week window per absence spell, a monthly frequent-absence check and
a record of reconfirmations. A feature with decisions in it, not a patch.

**A framing correction.** "Invoices come from bookings, funding from attendance" is incomplete rather
than wrong — funding for an absent day comes from the *booking*, since there are no attended hours.
`bookings` and the `absent` status with its reason already hold the input the Three Week Rule needs,
so the data is closer to this than the model is.

**The disclaimer was narrowed rather than removed.** It said the caps had not been checked against
the Handbook; they have been, and that sentence was on its way to being the same false caveat the
ratio banner was just rid of. It now says the figures count attended hours only and the total may be
lower than what the service is entitled to claim. A test that asserted the old wording is corrected
with the reasoning written into it, and it now also asserts the *direction* of the error, so nobody
can later reword this into implying an over-claim.

`FUNDING_RULES_VERIFIED` stays `false` — for a precise, documented reason now instead of a vague one.

Gates: typecheck ×5, lint, 458 core tests, check:docs.

## 2026-08-18 (fifth) — The app ran on a phone, and found a defect three hours old

`eas build --platform android --profile production` produced versionCode 4 (the remote counter
incremented 3 → 4). The AAB was **inspected before installing**, because the 12 August artefact
passed every gate and could not have run:

| Check on `base/assets/index.android.bundle` | Result |
|---|---|
| Supabase URL inlined as a literal | present |
| Anon key JWT inlined | present |
| The string `EXPO_PUBLIC_SUPABASE_URL` | **absent, 0 occurrences** |
| `service_role` anywhere in the shipped bundle | absent |

The third row is the decisive one and the exact inverse of last time, when the variable *name* was
in the bundle and neither *value* was — the signature of a computed `process.env[name]` Metro cannot
see. Not claimed: whether the `required()` guard's throw branch survived. The grep for its message
came back empty, which is consistent with the value being inlined *and* with the pattern missing a
template concatenation, so it is left unasserted rather than reported either way.

**Then it was installed, and it ran.** Booted, signed in, resolved the tenant, rendered the Roll
screen for Little Pearls Mt Albert with an empty roll and "✓ Within ratio · 0 kaiako · 0 tamariki".
Item 15 is partially closed: module load, auth, tenant resolution and the ratio bar are executed
code for the first time in the project's life.

**The first run found a defect introduced three hours earlier, and it was mine.** The mobile ratio
bar's caveat was gated on `!ratio.verified`. Flipping `RATIO_TABLES_VERIFIED` for item 1 silenced it
as a side effect — seven *web* surfaces were given the replacement caveat and the mobile bar was
not. The screen an educator reads in the room went quiet while the office screen said more, which is
backwards, and no gate could see it: typecheck, lint, 564 unit tests and 117 e2e checks all pass
without ever rendering a React Native component.

Fixed by calling `ratioInputCaveat()` on the mobile bar too, muted rather than warn-coloured. The
structural fix is that the caveat is unconditional on any flag, so a decision about the *tables*
can no longer switch off a statement about the *inputs*.

**One finding deliberately left undiagnosed.** Every tab label carries a missing-glyph box above it.
`StaffTabs` sets no icons on purpose, the installed `BottomTabItem` does `if (icon === undefined)
return null`, and `✓` and `·` render correctly on the same screen — so it is neither a JS
placeholder nor a font gap. Suspected native Android tab bar via `react-native-screens` 4.x.
Suspected is what it is recorded as; the cheap test is an explicit `tabBarIcon: () => null` and a
rebuild.

**Item 16's first store blocker is cleared** — and cleared the way that entry demanded rather than
the way it warned against: Schedule 2 was read and the bands were correct, instead of the flag being
flipped to remove the notice.

What the run did **not** do: the roll was empty, so nothing was signed in, nothing was queued, and
`expo-sqlite` has still never executed. The airplane-mode drill needs a child against this tenant
first. Every gap listed under "specifically unverified" in item 15 stands.

Gates: typecheck ×5, lint, check:docs. No web code changed; the mobile workspace has no test runner,
which item 20 already records and which this session has now paid for once.

## 2026-08-18 (fourth) — test:rls 505/505, and a measurement that had been lying since 6 August

Two verification jobs, one of which turned into a correction.

**`npm run test:rls` — 505/505 against live Postgres.** Nothing in the three commits earlier today
touched a migration, a policy or a grant, so this was expected to pass and did. Expected is not the
same as run, which is why it was run.

**The sign-in timing was wrong, and it had got wrong by getting faster.** The e2e suite recorded
"~930ms, click to present on the roll, including the server action, RLS and the re-render", and
README and [production-readiness](llm-wiki/wiki/production-readiness.md) both quoted it as an honest
round trip. `751837a` gave the web app the outbox on 6 August: a tap enqueues locally and repaints
from local state, so the assertion the measurement ended on started being satisfied by the
optimistic paint. `apps/web/e2e/.artifacts/timings.txt` keeps every run and shows it as a step, not
a drift — 26 consecutive samples between 894 and 971ms, then everything after between 68 and 130ms.

**Twelve days, and nobody looked, because the number improved.** The test's own header had warned
that conflating the web figure with the mobile optimistic budget "would let a fast web action stand
in for an untested tablet". That is exactly what happened, to the file carrying the warning.

Split into two, each named for what it contains:

| | Measured |
|---|---|
| sign-in **paint** — click to present on the roll, no network | 97–122ms |
| sign-in **confirmed** — click until "Waiting to send" clears, so the flush reached Postgres | **320–480ms warm, ~3.1s first write after a cold start** |

The first sample was 3088ms and the next three were 340, 476 and 323ms — so the three seconds is a
cold connection, and quoting the single sample would have recorded a three-second round trip as
typical. Four samples, one developer machine, live Supabase project; treat it as an order of
magnitude.

**The cold-start number is the one worth keeping, and it vindicates a decision already made.** The
first sign-in of the morning takes about three seconds to reach Postgres. The educator never waits
for it: the paint is immediate, the write is queued, and the badge says "Waiting to send" until it
lands. An app that disabled the button on that round trip would feel broken at 8am at the door.
That is the argument for the outbox, restated as a number, on a *connected* morning.

Sign-out gets a paint figure and no confirmed one — once the row leaves "Here now" there is no badge
left to watch. Named as a gap rather than filled in with the paint number under a round-trip label,
which is the mistake being corrected.

Gates: typecheck (including the e2e project), lint, unit tests, **test:rls 505/505 live**, and
`journey.spec.ts` run four times plus one full-suite run of **117 passed**.

## 2026-08-18 (third) — Item 1 closed: the bands were right, and Schedule 2 had a row the product did not

The repo's headline open item since Phase 2, closed on the boring outcome. Schedule 2 was read
from legislation.govt.nz — version as at 29 June 2026, which includes the 23 February 2026
amendment — and transcribed row by row against `UNDER_TWO_TABLE` and `TWO_AND_OVER_TABLE`. **Every
published row matched.** `RATIO_TABLES_VERIFIED` is now `true`.

**The reading paid for itself on a row that was missing, not on one that was wrong.** Schedule 2
says *"Up to 3 children of mixed ages … 1"*. Two infants and a three-year-old need one adult; the
product summed the bands and asked for two, reporting a breach on a room that is legal. That is the
failure direction that costs an indicator its credibility — an educator told they are
non-compliant while standing in a compliant room learns to dismiss the banner, and the banner's
whole job is the morning it is right. `roll.test.ts` had the wrong behaviour written in as an
assertion, complete with a comment explaining the wrong reasoning; both are corrected, and a
companion test now proves queued sign-ins still produce a breach once the allowance runs out — so
the correction cannot be satisfied by a ratio that quietly stopped counting them.

**A second correction, to something this repo said in three places.** The two bands are computed
separately and summed, which the README, item 1 and `ratios.ts` all called "the conservative
reading", on the assumption that the schedule published different tables depending on whether
under-2s were present. It does not. Summing is the rule, stated in the schedule in as many words.
The guess was right and the reason given for it was invented — a safety margin claimed and never
held.

**Seven surfaces moved together, and three of them were tripwires.** The e2e suite asserted the
"not been checked against the regulations" caveat and said in its own comment that flipping the
flag was *supposed* to break it, so the caveat could not be deleted from the code and left in the
UI or the reverse. It fired exactly as designed. What replaced it is `ratioInputCaveat()`, which
does not expire: Schedule 2 counts every person present aged under 6 — including a staff member's
own child, who is on no roll and in no attendance event — and an adult does not count while at
lunch, on a break, or on non-contact time. This product counts enrolled children who signed in.
Leaving the old notice up would have been a false caveat, and a false caveat teaches people that
the warnings on that screen are decoration.

**One mutation survived the first attempt.** Changing the mixed-age rule's `underTwo > 0 &&
twoAndOver > 0` to `||` broke nothing at all: both published tables give 1 adult for 1–3 children,
so "mixed only" and "any small group" agree on every input the stock tables can produce. A
condition no test can observe is one somebody deletes while simplifying. A fixture table stricter
than the regulation now makes it observable — which is what `assessRatio` taking its tables as
arguments was always for, and the real case is a centre operating under a licence variation. Four
mutations, four failures, after that.

Left as `TODO(ratios)` in the file: sessional tables (they differ for two-and-over — 1–8→1,
9–30→2, …), home-based ratios, the regulation 44A spare-capacity set-off, the regulation 54(4)
sibling rules, and a second pair of human eyes on the transcription. The two regulations both make
the requirement *lower*, so omitting them asks for more adults than the law does, never fewer.
Little Pearls is all-day centre-based, so the sessional gap is the next customer's, not this one's.

Gates: typecheck ×5, lint, 458 core tests (+17) plus 106 across the other workspaces, tokens,
docs links, both builds. **`test:e2e` not run** — it needs a production build, a browser and a
seeded tenant, and the three assertions it owns were edited in this change, so they are the least
verified part of it. That is the honest state and it is the first thing to run next.

---

## 2026-08-18 (second) — The specifications were opened, and item 6 turned out to be half right

The follow-up email went to the Ministry, and the seven specification documents were decrypted and
read the same day. The caps this repo had guessed at were **correct**. What was missing was a rule
nobody had thought to look for.

**The 20 Hours entitlement is age-bounded and nothing checked it.** The Ministry states 6 hours a
day and 20 a week *for a child aged 3 or older and under 6*. `DEFAULT_CAPS` had the hours;
`twenty_hours_ece` is a boolean a centre ticks on the enrolment and it was trusted without
question. Tick it on a two-year-old and `/funding` produced capped 20 Hours figures for a child
with no entitlement — against a rule the Ministry runs automated checks on and raises with vendors.
Low severity today, because the output is a preparation figure a human keys in, and it takes a
mis-tick to trigger. It is still exactly the class of thing this product exists to catch.

`childFunding` now returns `ineligibleDates`. The three decisions inside it are in
[funding-and-billing](llm-wiki/wiki/funding-and-billing.md): the age is computed as at each day and
never as at today; the hours are still counted, because only the entitlement is in doubt and the
attestation belongs to the centre; and an unknown date of birth flags nothing, which is not the
same as eligible. It surfaces in the cell that is actually wrong — the 20 Hours column, symbol and
word, never colour alone — and as dates rather than a count in the CSV, for the same reason the
unresolved-days column carries dates.

**Mutation-tested, because nine new tests passed first try.** `>=` → `>` on the sixth birthday
failed 1; `<` → `<=` on the third failed 3; and computing the age at `period.from` instead of the
day being counted failed 3. That third one is the point: it is the same failure `replayDay` exists
to prevent, where today's ages rewrite history in the centre's favour.

**Also landed:** `ministryFundingPeriods()` — February–May, June–September, October–January,
offered rather than imposed, so a manager stops inventing date ranges on an official-looking total.

**`FUNDING_RULES_VERIFIED` is still `false`, deliberately.** Item 6 is now narrowed rather than
closed: the Frequent Absence and 3-Week Continuous Absence rules decide when a recorded absence is
claimable, and this product does not model them at all. A flag reading "verified" over a
calculation missing a whole class of claimable day would be worse than one that admits nothing has
been read end to end. The flip is a separate, deliberate act by the person who reads those
provisions.

Gates: typecheck ×5, lint, 450 core tests (+9) plus 106 across the other workspaces, tokens, docs
links, build. `check:bundle` reports first-load JS at **113.0kB against a 106kB limit** — the
pre-existing 7kB overage recorded on 2026-08-14, unchanged and still unattributed; this work is
route-scoped and the funding page is 495 B. `test:rls` not run: no migration, no policy, no grant.

**The seven specifications are marked [SENSITIVE] / In confidence.** The decrypted text lives
outside this repository and no extract of it has been committed. What is recorded here and in the
wiki are derived facts that are independently public — the caps, the age band and the period dates
are in the ECE Funding Handbook and on the RS7 form. The password remains uncommitted.

---

## 2026-08-18 — The Ministry answered, and the answer cost this repo a claim it had made six times

Three emails from the Ministry's Early Learning Information team, replying to the enquiry the owner
sent on 2026-08-14. No code was written; five documents were corrected.

**The finding: "50 services" is a capability requirement.** *"The product must be capable of
supporting a minimum of 50 services across the relevant licence types."* This repo had read the
Ministry's page in the pessimistic direction and asserted, in `README.md`, `packages/core/src/funding.ts`,
`packages/api/src/billing.ts`, the funding page and the roadmap twice, that approval requires fifty
services *already using* the system before a vendor may apply. That is wrong, and it was not a
harmless wrong: it is the sentence that put an ELI integration under the roadmap's "what this plan
deliberately does not do", on the reasoning that a two-centre pilot could never reach the threshold.
There is no threshold. All six are corrected in place, each keeping the wrong sentence visible —
the same treatment the Privacy Act erasure claim got.

The Phase 5 entry further down this file still carries the wrong claim, and stays that way on
purpose: this file is a dated narrative, and a correction is a later entry saying so — which is
this one. The same applies to the 2026-08-14 entry, which recorded the ambiguity and guessed the
right way without being able to prove it.

The practical position is nonetheless unchanged: applications are **still closed**, *"currently
still in the review phase"*, with no end date given. What changed is the shape of the barrier, and
that is worth knowing before anyone plans around it.

**The finding that matters more is a non-answer.** The enquiry's last question was the product's own
premise: may a licensed service keep its Chapter 6 enrolment, attendance and absence records in
software that is not a Ministry-approved SMS, provided it meets Chapter 6 including the §6-3
criteria, and submits through ELI Web? The reply — *"To integrate with ELI, a vendor must be an
approved Student Management System (SMS) provider"* — answers a question about vendor integration.
This product does not integrate with ELI and does not propose to; it prints figures a manager keys
in by hand, which is what a paper roll does. So the premise is **unconfirmed**, and
[unverified-claims item 37](llm-wiki/wiki/unverified-claims.md) now says so, explicitly refusing
both the optimistic and the pessimistic reading. It has to be re-asked in wording that cannot be
answered as a vendor question.

Also unanswered: the security, privacy and assurance requirements for approval. The question named
a security assessment, penetration testing and a privacy impact assessment; the reply covered fees
(there are none) and stopped.

**Seven specifications arrived, password-protected, and nobody has read them** — NSI GINS 6.19, ECE
NSI GINS Appendix 1.41, InfoHub Specification 1.3, ELI Data Collection Specification 11, ELI Event
10.0 (the mandatory XSD schema), RS7 Return Specification 6.0, Teacher Data Collection Specification
1.1. Item 38 exists to stop the next reader citing a document nobody has opened. **The password is
not written down in this repository**, and that is deliberate. Two facts did come out of the
covering email without opening anything: RS7 returns are described as **four-monthly**, and the
"vendor integration and operational support approach document" turns out to be the vendor's *own*
proposed integration design submitted for Ministry approval — not a specification handed down, so
producing it is work rather than reading.

Gates: no schema change, no policy change, no runtime behaviour change — the edits are prose and
comments. `typecheck`, `lint`, `test`, `tokens:check`, `check:docs` and `build` were run; `test:rls`
was **not**, because nothing it asserts was touched, and that is stated here rather than implied by
its absence.

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
**zero children, guardians or health records** — which was, at the time, held to be the correct
state while professional indemnity insurance was outstanding. *(That gate was removed by owner
decision on 2026-08-29; see `docs/tenant-little-pearls.md`. The roll is still empty, but nothing
now requires it to be.)*

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
