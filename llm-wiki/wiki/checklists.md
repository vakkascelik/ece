# Rooms, tasks and checklists

Replacing 1Place: a room list the whole product hangs off, a work queue, and a
versioned checklist engine whose completed runs cannot be edited.

## Overview

Little Pearls pays for [1Place](https://1placeonline.com) and uses four of its modules:
checklists, tasks, incidents and hazards. Two of those already existed here and were
ahead of it; two did not exist at all. Migrations 0066–0072, planned in
[`docs/replacing-1place.md`](../../docs/replacing-1place.md).

1Place is a generic multi-site health-and-safety auditing product — its vocabulary is
`franchise → franchisee → site` and Little Pearls is one franchisee with two sites. A
large part of it is franchise scaffolding they do not use, and none of that was rebuilt:
no third tenancy tier, no tags, no favourites, no per-level dashboards. What was
rebuilt is what they open it for daily.

The two structural gaps were **rooms**, which did not exist as an entity anywhere in
this schema, and **a checklist engine**, for which `safety_checks` — a fixed eight-value
enum with one boolean — is not a substitute. `safety_checks` records *whether* an area
was looked at. A checklist is a form somebody filled in.

## Key Points

- **`rooms` is readable by a parent, and it is the only table in this phase that is.**
  Deliberately unlike [[centre-registers]], and the reasoning is in Details below. There
  is an assertion in `rls_isolation.sql` that fails if somebody "fixes" it to match its
  neighbours.
- **A run points at a template *version*, never at a template.** Otherwise the first
  wording change rewrites last year's evidence.
- **A completed run is frozen and a published version is immutable**, both enforced in
  the `USING` clause rather than by revoking `UPDATE` — the row has to stay updatable
  right up until the moment it does not.
- **Completing requires an answer to every required item**, enforced by a trigger,
  because "complete" must mean the form was filled in rather than that somebody pressed
  the button.
- **A "no" must carry a note.** The direct descendant of
  `safety_checks_failure_has_note`, which [[centre-registers]] called the single most
  useful constraint in 0034.
- **There is no scheduler.** "Due" is computed from the template's stated interval and
  the last completed run — the `drill_interval_days` shape, with the same null contract.
- **No photos yet**, and the reason is the consent gate. See below.
- **Finishing a task requires saying how**, the `hazards` constraint moved one table
  across.
- Enrolment enquiries are **not** tasks, though 1Place files them as tickets.

## Details

### Why a parent can read `rooms`

[[centre-registers]] established the house rule for anything belonging to the building:
`caller_staff_centre_ids()`, because a parent *is* a member of the centre and the
obvious predicate hands them the hazard register. That rule is right, it is one file
away, and it is wrong for this table.

`incidents.room_id` is the reason. An incident is readable by the guardian of the child
it is about — that is what `acknowledged_at` is for. A staff-only `rooms` table means
the family reads "your child was hurt" with the place blanked out, because the join is
refused: the record would be **less informative to its intended audience than the paper
form it replaced**.

And the thing disclosed is "Toddler Room" — a label the family says on the phone every
morning. The hazard register is a list of risks the centre has recorded about itself; a
room name is a noun. So reads use `caller_person_centre_ids()` (the four human roles,
kiosk excluded) and writes are owner/manager, because a room list is configuration and
a room created by accident pollutes every picker in the product until somebody notices.

**Rejected:** denormalising the room name onto every row that references one. The name
then freezes at write time, renaming a room forks the history into two labels for one
place, and the same string lands in five tables.

### Versioning, and the second opinion nobody asked for

`checklist_runs.version_id` points at `checklist_template_versions`, never at
`checklist_templates`. A completed checklist has to render as the form that was in front
of the person who signed it; point a run at its template and every past run silently
acquires a question nobody was asked.

1Place's own offline store is keyed `++localId, versionId, checklistId, …` — recovered
from the Dexie export's table schema. They hit this and solved it the same way, which is
the closest thing to a second opinion available.

Editing a published version is impossible rather than discouraged: the `UPDATE` policy's
`USING` clause tests `published_at is null`, so the row leaves the update's view at
publication. PostgREST reports zero rows rather than an error, which every writer in
`@ece/api` already treats as a refusal.

Revising means forking: `forkChecklistVersion` copies the items into a new draft. A blank
draft was rejected — changing one word in a twelve-item form would be a retyping
exercise, and a centre that has to retype will instead not change it, which is how a
checklist ends up describing a building that was renovated two years ago.

### The three refusals a CHECK cannot express

`checklist_run_guard()` is a `before insert or update` trigger holding what constraints
cannot reach:

1. The run's denormalised `centre_id` must match its template's. Without this a run
   could claim centre A while rendering centre B's questions, and the policies — which
   read `centre_id` — would serve it. The tenant key is duplicated for policy
   performance, and this is the only thing that makes duplicating a tenant key
   acceptable.
2. The version must be published. A draft is a form somebody is still writing.
3. Completing requires an answer to every **required** item.

The third is the trigger's reason for existing. Asserted in `rls_isolation.sql`
including the case that makes `required = false` mean something: a run completes with an
optional item left blank.

### No photos, and it is the consent gate

1Place attaches photos to checklist answers. This does not, yet, and the reason is
`0015_consent_gate_restrictive`: `media` is gated on consent because a photo may contain
a child. A photo of a broken latch is not child media; **a photo of a broken latch with
a toddler in the background is**, and neither the person taking it nor a column default
can tell the difference.

Routing checklist photos into `media` opens a path into the gated table from a
staff-only screen. That gets its own migration and its own thinking rather than being
appended to one introducing five tables. Recorded here rather than left as a silent gap.

### No scheduler, deliberately

Nothing creates a run in advance. `checklist_templates.recur_days` plus the date of the
last completed run answers "what is due today", computed by `checklistStatuses()` in
`@ece/core`.

Null `recur_days` means the centre has not stated an interval, and the screen then shows
how long it has been **without calling it late** — the fifth outing of the
`drill_interval_days` argument, and `overdue: null` is rendered differently from
`overdue: false` at every call site. A green tick against an unmeasured gap is how a
product talks a centre into a breach.

Materialising future runs was rejected: it puts rows in the database for work nobody has
done, and every screen then has to filter them out.

### What did not come across from 1Place's tasks

Their three categories are Enrolment Enquiry, Hazard Identification and Maintenance.
Only the last two are tasks here.

An enrolment enquiry is already first-class in this product — `enrolment_applications`,
`/enquiries`, `/applications`, an age band, a waitlist and a conversion report. Importing
enquiries as generic tasks would fork a workflow that exists and is better, and would
put a family's contact details in a table with no guardianship boundary on it.

`tasks.hazard_id` points one way only: a hazard may spawn a task, a task does not own a
hazard. Pointing it the other way would make closing the task look like closing the
hazard — exactly the conflation `hazards.control` and `hazards.resolution` were split
apart to prevent.

### Two defects the checks caught, both mine, both the same class

**`audit_trigger()` was overwritten with a stale body.** 0068 needed three more branches
so the checklist chain could be attributed to a centre, and re-declared the whole
function from 0059's *prose header* rather than from 0059's source. Three things had
moved: the column is `actor_id` not `actor`, `entity_id` is
`coalesce(id, guardian_id, post_id)` and not a uuid cast, and an UPDATE that changed
nothing returns early. Every audited write in the product raised 42703 from the moment
0068 landed. `npm run test:rls` caught it on the first run after the migration; fixed
forward in 0070, because `npm run migrate` refuses a file whose checksum changed after it
was applied and that rule is working as intended.

The lesson is [AGENTS.md §5](../../AGENTS.md)'s, already written down: *read the file
before editing it*. A comment describing a function is not the function. Re-declaring a
shared function is the one edit where that shortcut is guaranteed to be expensive,
because the blast radius is every table carrying the trigger.

**The EXECUTE grant was left at its default.** `checklist_run_guard` is `security
definer` and every function is created with EXECUTE granted to PUBLIC, so
`review:security` check 6 went from clean to HIGH. Fixed in 0072, which is a copy of
0031 — the identical omission, eleven days earlier, in the migration that added
`enforce_incident_transition`.

0031's header ends by noting it was found by a check rather than by review, and that the
grant "is not written down anywhere in the file". That was true again. A lesson recorded
in a migration header is only read by somebody already reading that migration; the check
is what caught it both times.

### The trigger name that made a table invisible

0068 named the audit trigger on `checklist_template_versions` after the table's short
name — `checklist_versions_audit`. Both audit-coverage guards match on
`tgname = relname || '_audit'`, so the table reported as *missing* its trigger, which it
was not. Renamed in 0071.

The convention is not cosmetic: it is the only thing that lets a catalogue query answer
"is every consequential table audited" without a hand-maintained list, and a
hand-maintained list is what let `shifts` and `staff_leave` go unaudited from 0041 to
0059.

## Rejected

- **A `riskBand(score)` helper.** See [[unverified-claims]] item 40. Likelihood ×
  consequence is stored; nothing bands it, because no grid is sourced.
- **1Place's mutable incident status.** [[incident-register]] already has
  draft → final, parent-notified, guardian-acknowledged and `supersedes`, with no DELETE
  grant for anybody. Matching a flat "Pending" would be a regression.
- **`person_types` as a table.** 1Place hangs checklists, incident types and task
  categories off a person's type. This product models children, guardians and staff
  separately and with different policies, which is the correct shape where guardianship
  is a boundary.
- **The franchise tier, tags, favourites, per-level dashboards, an Intercom widget.**

## See Also

- [[centre-registers]] — hazards, drills and safety checks, and the staff-only rule this
  phase deliberately breaks for one table
- [[incident-register]] — the register 1Place's Incidents/Sickness module maps onto
- [[offline-outbox]] — the queue `checklist_runs.client_uuid` is waiting on
- [[unverified-claims]] — item 40, the risk-matrix banding that is not sourced
- [[tenancy-and-rls]] — the two boundaries, and why `packages/api` filters nothing

*Last updated: 2026-08-28*
