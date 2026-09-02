# Incident register

One table with two audiences, where the boundary runs *inside* a centre — and the draft that a
family must not see.

## Overview

Phase 8's first table. An injury, an illness sending a child home, a near miss with the gate:
the most-used form in a centre, the first thing a reviewer asks for, and absent from this
product for eight phases. It lived on paper, which is also where the evidence that a parent had
been told about it lived.

The machinery is small. The difficulty is entirely in who may read what, and when.

## Key Points

- **A guardian cannot read a draft.** `caller_may_see_child` is true for staff *and* guardians,
  which makes it the wrong predicate here and the easy mistake.
- **Final freezes.** An amendment is a new row carrying `supersedes`, not an edit.
- **The acknowledgement is the one fact in the table the centre does not author**, so staff
  cannot record it and a guardian cannot record it as somebody else.
- **The transition trigger decides by what changed, not by who called** — because an educator
  whose own child attends is both.
- **Nobody can DELETE, including `service_role`.** A centre that can make a report disappear
  cannot use the register to prove anything.
- Four tables were rejected in favour of four tables. See below — the generic one was the
  obvious design and it breaks the audit log.
- **`room_id` was added in 0066** and `location` stays beside it. Not redundant: an incident
  happens on the front path, at the park, in somebody else's car park, and a room picker can say
  none of that. The room is for the cases a filter should group.
- **`/incidents/[id]/print` renders one report as a document** (2026-08-28), replacing the PDF
  icon on every row of 1Place's incident list. Same mechanism as the compliance binder — a print
  stylesheet, no headless browser, no second rendering of the truth that could drift from the
  screen. **It carries no signature line**, deliberately: this product has no signature on an
  incident, and printing a blank one would invite a centre to treat the paper as the record, at
  which point everything this schema does about immutability is decoration. A draft prints with a
  banner saying so, because a manager reviewing one before it goes final wants it on paper and
  refusing would push that reading somewhere this product cannot see.

## What 1Place does that this does not, and why that is the right way round

Little Pearls' 1Place runs two independent status axes where this has `draft → final`,
`parent_notified_at`, `acknowledged_at` and `supersedes`: a Pending → Open → Resolved workflow,
and a separate Signature Status driving the *Unsigned* queue — their record 2461 is Signed and
Pending at once. The migration off it keys on signature status alone: *Unsigned* → `draft`,
*Signed* → `final`; the workflow state has no counterpart here and does **not** become a mutable
status column. (Corrected 2026-08-29 — this page previously called the status "flat" and mapped
*Pending* → `final`, which conflicts with the *Unsigned* rule on an unsigned Pending record.)

Their "Incident Category" field is populated on most rows — with the value *Incident*, on rows
whose Type is already Incident — and `incident_kind` — injury, illness, behaviour, near_miss,
other — covers the Type/Category split more usefully than an enum that echoes the type.
(Corrected 2026-08-29 — this page previously said the field was blank on every row. Redundant,
not unused; the conclusion stands.)

Two things their incident module had that this did not, seen 2026-08-29: an **Investigation
tab** — closed the same day by 0074, see below — and **drawn signatures**, where staff,
witness, management and parent all sign on the centre's device. The parent's squiggle carries the
"family saw it" fact their Parent Notification fields leave blank on the same record;
`acknowledged_at` written by the guardian's own account is the same fact with attribution, which
is one more reason the no-signature-line stance above stands. The signatures stay unbuilt,
deliberately. See [[checklists]].

## The investigation (0074), and the ratio it refuses to ask for

`incident_investigations` is a 1:1 sibling of `incidents`, not columns on it, because a
finalised report freezes and an investigation happens *after* the report is finished —
WorkSafe is advised days later, the hazard register the following week. Columns would force a
choice between breaking the freeze and freezing the follow-up half-written.

- **A row is a decision.** `required` is NOT NULL with no default: a row with `false` records
  "considered, not required"; no row records that nobody has considered it. The
  [[asking-for-consent]] third-state argument, third outing.
- **Staff-only, on the same incident a guardian can read.** The asymmetry is the point and the
  suite asserts it on one row: Priya acknowledges the final report, then reads not one line of
  its investigation.
- **The ratio is computed, never typed.** 1Place asks staff to remember "Staff : Child Ratio in
  the child's room at the time" into a text box. `/incidents/[id]` replays the attendance
  register instead — `replayDay` plus the new `snapshotAt` in `ratioHistory.ts` — and states its
  limits on screen: centre-wide because attendance does not know rooms, and null (rendered as
  "cannot be computed") when the register holds nothing before that moment, because "0 children"
  would be a fabrication. A computed figure is a measurement; a remembered one is an assertion.
- **WorkSafe is a yes/no and a date, never a rule.** Nothing decides when WorkSafe *must* be
  advised — that is a regulatory claim nobody has sourced, the 0069 risk-band refusal again.
- **"Hazard register updated" is `hazard_id`, a pointer.** The link is the yes; a boolean beside
  a nullable pointer would be two answers to one question.
- **No investigator picker.** `investigated_by` exists for the 1Place import; the UI does not
  set it, because the audit log already attributes every write and tasks set the precedent of
  shipping without assignment UI.
- Mutable like [[checklists]]' hazards and tasks, not draft→final like the report: it is the
  centre's own working document. No DELETE for anybody.

## Photos (0075) — on the report, not of the family

`evidence_photos` hangs off a draft incident (or an incomplete checklist run — one table, two
parents, `num_nonnulls = 1`) and freezes with it: once final, no photo can be attached or
removed, enforced in the policies' USING/WITH CHECK rather than a trigger. Storage is the
second bucket in the schema's history, staff-only by folder, and an object is deletable only
while no row references it — so the app deletes the row first, the reverse of `deleteMedia`'s
order, and a frozen photo's object is beyond reach by construction. Not media, no consent, per
the 2026-08-29 correction above; the generic-table objection this page makes about
`child_register_events` does not apply because there is no payload and the audit trigger
attributes by the row's own `centre_id` — the reasoning is in 0075's header.

**Open decision, recorded not taken:** whether the child's own guardian sees the photos on a
final report. 1Place prints them on the PDF the parent signs. Today the answer is no —
staff-only, and the print page that carries photos is itself staff-only. Widening later is one
policy line; narrowing later is a disclosure.

## Details

### Why not one `child_register_events` table with a `jsonb` payload

Incidents, medication administration and sleep checks are the same shape: a child, a time, a
person, a note. One table with a `kind` enum and a `jsonb detail` is the obvious design and it
is wrong *here* for a reason specific to this schema.

`audit_events.detail` holds **column names and never values**. That is the only thing that lets
a child's record be purged while the evidence it existed survives, and the suite asserts it — no
name and no medical detail reaches the audit trail. A `jsonb` payload defeats it in both
directions: the audit row would either name one column, `detail`, and record nothing useful, or
it would carry the text of a child's injury into the table that deliberately outlives the
child's record.

Two lesser reasons that would not have been decisive alone: per-kind `CHECK` constraints are
unwritable against `jsonb` (a medication row needs a dose, a sleep check needs a position), and
the RLS differs — a guardian reads their own child's incident report, which is not true of a
sleep check, and policies are per table.

### The draft, which is the assertion this table exists to get right

A draft is working material. A teacher types "Ana fell — checking whether it's broken" and then
finds out it is a graze. Streaming that to a parent's phone as it is typed is worse than
telling them nothing for ten minutes, and it is what using `caller_may_see_child` on this table
would have done.

```sql
for select using (
  public.caller_is_staff_for_child(child_id)
  or (status = 'final' and child_id in (select public.caller_ward_ids()))
)
```

Mutation-tested rather than trusted: the policy was replaced with
`caller_may_see_child(child_id)` against the live database, the suite failed on *a parent
CANNOT READ a draft incident about their own child*, and the correct policy was restored and the
catalogue re-read to confirm it matched the migration character for character.

Guardianship, not tenancy: another family at the same centre cannot read the report even once
final. That assertion is the one that would pass if the policy keyed on `centre_id`.

### The trigger decides by what changed, not by who called

RLS decides *who* may update a row. It cannot say "and only these two columns" — and this table
has two audiences with completely different rights over it, while a column-level `GRANT` is per
role rather than per policy. So the grant opens every column either audience might touch, and
`enforce_incident_transition` works out which audience the caller was.

The obvious implementation branches on `caller_is_staff_for_child`. It is wrong for a real and
not-rare person: **an educator whose own child attends the same centre**. They are staff by that
predicate, so the guardian branch would never run for them and they could never acknowledge a
report about their own child. Keying on the changed columns instead means the same statement is
judged the same way whoever sends it.

So: if the only columns that moved are `acknowledged_at` and `acknowledged_by`, this is an
acknowledgement — the row must already be final, unacknowledged, and the guardian named must be
the caller's own and a guardian of that child. Anything else is a staff edit — the caller must be
staff for the child, the row must still be a draft, and they may not touch the acknowledgement.

### What the column grant does before any of that runs

`id`, `centre_id`, `child_id`, `reported_by` and `created_at` are absent from the `UPDATE`
grant, so moving a report to a different child is refused by Postgres before a policy or trigger
is consulted — the cheapest possible place to refuse it. The trigger compares those columns
anyway, because a privilege can be widened by a later migration and the trigger is what would
notice.

### Rejected: correction-as-a-new-row

`attendance_events` corrects a scalar by appending; a sign-in time is one value and the later
row simply supersedes it. An incident report is a paragraph written in a hurry, and the
attendance idiom does not carry. `custody_arrangements` already had the right shape —
supersession — so this follows it. Editing a report after a family has been shown it is not a
correction, it is a different document wearing the same name, which is the argument
[0021](../../supabase/migrations/0021_integrity.sql) makes about an issued invoice.

### The grant that was missing, and the check that caught it

0030 applied cleanly, the suite went 219/219, and `review:security` immediately dropped to
15/16: `enforce_incident_transition` is `SECURITY DEFINER` and, like every function, was created
with `EXECUTE` granted to `PUBLIC` — a function running as the table owner, reachable by `anon`.

Low severity in its current form, since called directly it gets no trigger context and fails at
once. Fixed in 0031 anyway, because "harmless in its current form" is the argument that stops
being true after the next edit. **A trigger function does not need `EXECUTE` granted to the
caller at all** — PostgreSQL checks `TRIGGER` on the table, not `EXECUTE` on the function — so
revoking it from `PUBLIC` costs nothing, which the suite confirmed by still passing 219/219.

The interesting part is how it was found. 0030 was read twice before being applied and this was
in neither reading, because **the grant is not written anywhere in the file**. It is what
`create function` does when you say nothing. A check against the live schema sees what the file
does not say; a code review cannot.

### The screen, and the two-step it refuses to collapse

`/incidents` is staff-only, behind `recordDailyPractice` so educators can file — they are the
people who witness these. That is a nav decision, not the boundary; 0030's policy is.

Two things on it are deliberate and would both be "improved" away by somebody optimising the
flow:

- **There is no "save and send".** The submit button says *Save as draft* and has no sibling.
  Final is the version a family reads and nobody can edit afterwards, and a one-press path to it
  gets pressed by somebody standing up holding a crying child.
- **The draft state says so on screen** — *Draft — whānau cannot see this*. A teacher who
  believes they have told the family and has left the report in draft is the exact failure this
  column exists to surface, and no policy will tell them.

The summary counts what is **outstanding**, not how many incidents occurred, so a centre with
forty resolved reports reads the same as one with none. Same argument as `summarise().clean` in
the compliance code.

Every time is formatted on the server in the centre's zone. `toLocaleString` in the browser uses
the *device's* zone, and an incident time that shifts depending on who opens the page is worse
than useless in a review.

### The family's side, and the wording on the button

A guardian never visits `/incidents`. They read their own child's reports on the child record,
in a panel beside Consent — the two things on that page a family reads, and the two a family
writes.

**The panel does not filter drafts out.** `incidents_select` returns a draft only to staff, so a
guardian's query never contains one. If the component filtered, the filter would be the thing
keeping a family out of a half-written injury report, and it would be one careless edit from
failing. The same panel serves staff, who *do* see drafts, labelled — a manager reading a child
record should see the report still sitting unfinished.

The button says **"I have read this"**, not "Acknowledge". The second invites the reading that
the family agrees with the centre's account; the first is the claim actually being recorded, and
it is the one a review asks about.

The offer is gated on *having a guardian record*, not on `role === 'parent'`. An educator whose
own child attends the same centre is staff by every predicate in the schema and is still that
child's parent — which is exactly why 0030's trigger decides by what changed rather than by who
called. Gating the button on the role would have locked them out of a report about their own
child, and nothing would have shown it: the trigger would have accepted the write.

`acknowledgeIncidentReport` uses `requireCtx`, not `requireCapability`, and there is no
capability for this. Acknowledging is the one act on a child's record that only a guardian may
perform, and a capability gate would suggest the app decides. It does not — staff, including an
owner, are refused by the trigger whatever the app thinks.

### Amending, and what happens to the report a family already holds

A finalised report freezes, so the only way to change one is a new row carrying `supersedes`.
Until this existed the freeze was a dead end: correct in principle, and in practice worked
around with a second unlinked report that nobody could tie to the first.

**The original stays on the register, marked "Replaced by a later report".** Hiding or deleting
it would undo the point of having frozen it — the version a family was actually sent is the one
a review asks about.

The amendment reuses the whole form rather than offering a "what changed" patch, because an
amendment *is* a full report: the family reads it on its own, not side by side with the original.
It starts as a draft and goes through finalise → notify → acknowledge like any other.

Two refusals. A report that has already been superseded cannot be amended again — two live
corrections of one original leaves nobody able to say which the family holds. And a draft cannot
be amended, because a draft is editable in place; amending one would produce two rows where an
edit was meant.

`?amend=` is resolved against the incidents already fetched rather than by a lookup, so an id
outside the window or belonging to another centre simply does not match and the form opens as an
ordinary new report. That is the safe direction, and it means the query parameter cannot be used
to confirm that an incident exists somewhere the caller cannot see.

**`summariseIncidents` had to learn about supersession**, and this is the part that would have
been missed. A final report that was never sent, then amended, sat in "whānau not told" forever —
chasing a document that had been replaced. Superseded incidents are now excluded from the
outstanding counts entirely, while the amendment is counted normally, so an amendment nobody
finalised still surfaces. Mutation-tested: removing the exclusion fails two unit tests and the
browser assertion.

### Editing a draft, which is not the same act as amending

A draft has not been shown to anybody, so correcting one is an edit and leaves no trace worth
keeping. Once final, the same typo costs a superseding report that marks the original as
replaced *forever* — right for a correction a family has seen, absurd for a missing letter
nobody outside the centre ever read.

`updateIncidentDraft` had existed in `@ece/api` since the query layer was written and **nothing
called it**, so until now the only way to fix a word in an unsent draft was to finalise it and
amend — permanently marking a report as replaced for no reason. Found by grepping the package's
exports for callers rather than by using the product, which is the same class of gap as
[[mobile-app]]'s eleven defects in code that had never executed.

One form serves all three acts, with an explicit `mode` rather than one inferred from the source
report's status. The fields are identical and the acts are not, and inferring would make that
distinction an accident of state. Each mode refuses the other's rows, in the page and on screen:
a draft offers **Edit** and no Amend, a final report offers **Amend** and no Edit. Asserted both
ways, because a control that is merely absent for the wrong reason is one refactor from
appearing.

`saveDraft` does not accept `status`. Finalising is its own action for the reason that one
records: a patch that happens to carry a status is how a report gets sent to a family as a side
effect of fixing a word.

#### Both incident writers could report a success that never happened — fixed 2026-09-03

`updateIncidentDraft` and `finaliseIncident` did `.update(…).eq('id', …)` and inspected only
`error`. **Under RLS a refused update matches no rows, and PostgREST reports that as success with
an empty result** — so `error` was null, the function returned, the action called
`revalidatePath`, and the screen said the correction was saved. On an incident report.

`updateCentre`, `updateStaffMember` and `linkStaffRecord` have carried a zero-row check since they
were written, each with a comment explaining exactly this. These two never did.

**And looking for other instances found that it is the majority, not the exception.** A scan of
every write statement in `packages/api` on 2026-09-03 came back **20 guarded, 34 unguarded** — so
the pattern is not "somebody forgot the check twice", it is that a write in this package is unable
to tell success from refusal *by default*. Recorded as [[unverified-claims]] item 49 with the list,
because fixing 34 call sites is its own change and several of them are legitimately allowed to
match nothing.

`finaliseIncident` was the worse of the two. A silent no-op there leaves a report the centre
believes it has filed sitting as a draft **the family cannot see**, which is the precise state this
page's whole draft/final argument exists to make legible.

Found by the e2e suite, six days late, because the suite had stopped running — see
[[unverified-claims]] item 41.

#### Correcting a draft never worked at all, from 0066 until 0082

**And a correction to what this page said hours earlier.** It claimed *"the write provably
succeeds: the new error does not fire, so no policy is refusing"*. **That was wrong.** The
zero-row branch does not fire because the **error** branch fires first — the write was raising
`42501 permission denied for table incidents` all along, and the screen was showing that sentence
while the test failed three lines later on "row not found". Reading a passing zero-row check as
evidence of a successful write was the mistake; it only ever meant *the update did not silently
match nothing*.

The cause, found by instrumenting the flow rather than reasoning about it. **`0066` added
`incidents.room_id` and never added it to the column-scoped UPDATE grant `0030` created.**
`updateIncidentDraft` always sends `room_id`, because the correction form has a room picker and a
patch omitting the field could not clear one — so **every attempt to correct a draft failed from
2026-08-28 until `0082` on 2026-09-03.** Filing a report with a room always worked, because the
INSERT grant is table-wide; `finaliseIncident` always worked, because it writes only `status`,
which `0030` did grant.

`0066` was not careless about it either, which is the part worth keeping: it stopped and reasoned
about grants, checked the **INSERT** grants on all three tables it touched, and never looked at the
**UPDATE** grants. See [[conventions]], *Adding a column to a table with COLUMN-level grants* —
this is that section's second instance, five migrations after it was written.

**What was missing was the assertion, in two places.** `rls_isolation.sql` now performs the exact
column set `updateIncidentDraft` sends and asserts it succeeds — a functional check rather than a
catalogue one, because the catalogue can say which columns are granted and only a write can say
whether that set is the one the application needs. It fails with `42501` against a database without
`0082`, which is the mutation test for free. And `incidents.spec.ts` now asserts `.error` is empty
immediately after saving, which the conventions page already named as *"the only thing in the repo
able to tell 'refused' from 'did not persist'"* — the sibling settings spec had it and this one did
not.

The honest summary is unflattering and worth leaving in place: the edit path was designed, built,
documented on this page, and covered by a test — and it had never once worked, because the test
that guarded it was disabled by the same commit that broke the feature.

### The React trap this hit on the way

Clicking **Amend** navigates to `/incidents?amend=…` — the same route with different search
params. Next re-renders the client component rather than replacing it, so
`useState(Boolean(amending))` kept its original `false` and the form stayed collapsed while its
props said otherwise. Every `defaultValue` inside it has the same problem, so an effect that only
opened the form would have left the fields showing the previous report.

Fixed with `key={amending?.id ?? 'new'}`, which is the idiomatic answer: reset state when
identity changes. Worth recording because the symptom — a link that visibly navigates and
appears to do nothing — reads like a routing bug and is not one.

### The guard caught the new page, which is the point of having it

`/incidents` needed "fourteen days before today" and wrote the arithmetic out inline —
`Date.UTC(y, m - 1, d - n).toISOString().slice(0, 10)`. Legitimate, and identical to what
`lastSevenDays` in `dayWindow.ts` already did.

`localDates.test.ts` failed on it, because the allowlist is keyed by file and the new page was
not in it. **The fix was not a second allowlist entry.** It was `shiftLocalDate` in
`dayWindow.ts`, which both callers now use: one exemption with one argument beats two of each,
and the duplication the guard exposed was a real one. A guard that only ever gets appeased is a
guard being ignored slowly.

## See Also

- [[tenancy-and-rls]] — the two boundaries, and why the one inside a centre is the hard one
- [[privacy-and-retention]] — why `on delete cascade` on `child_id` is load-bearing
- [[compliance-and-evidence]] — where this register will feed the binder
- [[conventions]] — the new-table checklist this followed

*Last updated: 2026-09-03*
