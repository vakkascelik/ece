# Replacing 1Place

What Little Pearls uses 1Place for, what Doorway already does, and the gap between them.

Written 2026-08-28 from a set of screenshots of `app.1placeonline.com` (version 1.91.0, signed in
as `taner@littlepearls.org.nz`) and two export files.

**UPDATED 2026-08-28, the same day: phases A–F are built and applied.** Migrations 0066–0072,
`@ece/core/worklist.ts`, `@ece/api/worklist.ts`, and the screens listed in §4. What this document
now records is the plan *and* what happened to it — including the two phases that turned out
smaller than estimated and the one deferral that stands. Phase G (migration) is untouched and
blocked on §0. The build notes live in [llm-wiki/wiki/checklists.md](../llm-wiki/wiki/checklists.md);
this file keeps the reasoning that produced the shape.

**UPDATED 2026-08-29: a third batch of screenshots — §7.** It answers §6's Q1 (partially) and Q3,
corrects two claims this document made from the earlier batches, and surfaces a module the plan
had not seen at all: the Investigation tab.

Read [AGENTS.md](../AGENTS.md) first. Every table proposed below is subordinate to §4.2 — a
policy, a grant and an assertion in `rls_isolation.sql`, in the same commit — and to §4.3, which
forbids computing a local date as UTC. Both bite hard in this plan: it adds five tables and a
great many dates that a person entered while standing in a building in Auckland.

---

## 0. The exports are empty, and that is the first problem to solve

Both files parse. Both contain zero records.

```
draftexport20260828T203019.json   243 rows claimed   0 rows exported
imageexport20260828T203023.json     6 rows claimed   0 rows exported
```

Every one of the 38 tables reports its `rowCount` in the header and then an empty `rows` array.
There is no truncation and no error; the arrays are simply `[]`. A file describing 198 people is
4,460 bytes.

**Do not build a migration against these files.** They are a Dexie (IndexedDB) dump of the
browser's *offline cache*, and what came out is its structure without its contents. Three things
to try, in this order:

1. **Press SYNC NOW first, then EXPORT.** The Connection Status dialog showed *Last Synced:
   28/08/2026 08:29:04 PM* and the export was taken at 08:30 — so the cache should have been warm,
   which argues against this being the cause. Cheap to eliminate anyway.
2. **Ask 1Place for a full account export**, in writing, naming the modules. They are the vendor
   and Little Pearls is the customer; this is a contractual request, not a favour. Ask for
   checklists (completed, with responses and photos), incidents, tasks, hazards, people and rooms
   — as CSV or JSON per module, not as a database dump.
3. **Fall back to the web console's own per-module exports** if it has them. The mobile layout in
   the screenshots may be hiding report/download actions that the desktop view offers.

Until one of those produces rows, everything below is a build plan and not a migration plan.

### What the empty file was still worth

The Dexie header carries each table's **keyPath**, and that separates real record stores from
cache blobs. A table with a keyPath (`id`, `++localId`) holds records; a table with `schema: ""`
holds one blob per cached screen. So:

| Hard counts | |
|---|---|
| `people` (key `id`) | **198** |
| `person_types` (key `id`) | **3** — matching the People screen's *Children*, staff, *1Place Logins* |
| `images` (key `++imageId`) | **6** |

`checklist_templates: 12`, `hazards: 1`, `sites: 2` and the rest are **cache entries, not domain
counts**. Twelve cached checklist-template payloads probably means twelve templates, and it is not
evidence. The counts that *are* evidence come from the screenshots: **73 tasks** and **99+
incidents** on the home tabs, and incident IDs running to **2461**.

---

## 1. The 1Place model, recovered

1Place is a generic multi-site health-and-safety auditing product — the vocabulary is
`franchise → franchisee → site`, and Little Pearls is one franchisee with two sites. That framing
matters for what *not* to build (§5).

The load-bearing relationship is in the `person_types` keyPath:

```
person_types   id, *checklistTemplateIds, *incidentTypeIds, *ticketCategoryIds
```

**A person's type decides which checklists, incident types and task categories apply to them.**
Everything in the product hangs off a Person, and Children are just one person type among three.
Doorway is built the other way round — `children` is a first-class table with guardianship
policies on it, and staff are `staff_members`. That is a better fit for the domain and it means
there is no `person_types` to port; there is a mapping to do.

Observed vocabularies, from the screenshots:

| Field | Values |
|---|---|
| Task status | Pending · Open · Resolved · Closed |
| Task priority | Critical · High · Medium · Low |
| Task category | Enrolment Enquiry · Hazard Identification · Maintenance |
| Hazard fields | Name · Action · Created date · Likelihood · Consequence · Risk Score · Frequency Of Review |
| Checklist search | Centre/Room · Template · Name · From/To date · People |
| Incident row | id · child · Type · Category · Site (room — centre) · Date · Status · PDF |

Rooms seen: Carpark (both sites), Infant, Toddler, Preschool, Kitchen, Playground 1, Playground 2,
Office / Staff Room / Entrance (both sites) — eleven visible before the list scrolled.

---

## 2. Module-by-module gap

| 1Place module | Doorway today | Verdict |
|---|---|---|
| Centres | `centres`, centre switching, `/select-centre` | **Done** |
| Rooms | *nothing* — no table, no column, the word appears only in comments | **Missing, and structural** |
| People | `children`, `guardians`, `staff_members`, `memberships` | **Done differently** — map, don't port |
| Checklists + templates | *nothing*. `safety_checks` is a fixed eight-value enum, not a template engine | **Missing — the largest piece** |
| Tasks / tickets | *nothing* | **Missing** |
| Incidents / Sickness | `incidents` + `/incidents` | **Ahead of 1Place** — three gaps closed in D; a fourth found 2026-08-29 (§7.3) |
| Hazards | `hazards` + `/facilities` | **Partial** |
| Drafts | outbox exists; no user-visible list | **Partial** |
| Favourites | *nothing* | Skip (§5) |
| Offline sync + status | outbox on web and mobile; no status UI | **Partial** |
| Notifications | `notifications`, push tokens, quiet hours | **Done** |
| Per-record PDF | print stylesheet on the binder and `/funding` only | **Missing** |
| Export / import | CSV layer + BOM handling, per [exports](../llm-wiki/wiki/exports.md) | **Partial** |
| Intercom support chat | n/a | Skip |

### Where Doorway is already ahead, and should not regress to match

`incidents` carries `status draft→final`, `parent_notified_at`/`notified_by`,
`acknowledged_at`/`acknowledged_by`, and `supersedes` — an amendment is a new row, and **no DELETE
grant exists for anybody**. 1Place runs two independent status axes — a Pending → Open → Resolved
workflow and a separate Signature Status driving the *Unsigned* queue. The migration keys on
signature status alone: *Unsigned* → `draft`, *Signed* → `final`; it does not add a mutable status
column to match 1Place's. (Corrected 2026-08-29 — §7.2. This paragraph previously called the
status "flat" and mapped *Pending* → `final`, which conflicts with the *Unsigned* rule on an
unsigned Pending record.)

Attendance, ratios, funding, enrolment, billing, consent-gated media and the compliance binder have
no 1Place counterpart at all. Replacing 1Place is a subset of this product, not a rebuild of it.

---

## 3. The two structural gaps

### 3.1 Rooms — the prerequisite for everything else

There is no `rooms` table. 1Place scopes checklists, tasks and incidents to a room, and the
screenshots show staff using it that way: *Playground — Mt Roskill*, *Toddler & Infant — Mt
Roskill*. Without rooms, every module below loses its most-used filter and the incident list cannot
reproduce what staff read today.

```
rooms(id, centre_id, name, sort, archived_at, created_at)
```

Then `room_id` on `incidents` (which has a free-text `location` today), `safety_checks`,
`hazards` (free-text `area`), and the new `tasks` and `checklist_runs`.

**One decision to make before writing the policy.** Every other register in `0034` uses
`caller_staff_centre_ids()` and excludes parents by construction. Room *names* are benign — a
parent already knows their child is in Toddler — but the safe default in this repo is staff-only,
and widening later is a one-line change while narrowing later is a disclosure. Recommend
staff-only; revisit if a parent-facing screen needs a room name.

**Archive, never delete.** A closed room still has last year's incidents pointing at it.

### 3.2 The checklist engine — the largest single piece of work in the plan

This is what Little Pearls actually opens 1Place for, twelve templates' worth, and it is the reason
the subscription exists. It is also the biggest thing in this document by a wide margin — comparable
to attendance, and harder in one respect.

```
checklist_templates       (id, centre_id|null, folder, name, active, created_at)
checklist_template_versions(id, template_id, version, published_at, published_by)
checklist_template_items  (id, version_id, sort, prompt, response_type, required)
checklist_runs            (id, version_id, centre_id, room_id, assigned_to, due_on,
                           started_at, completed_at, signed_by, client_uuid)
checklist_answers         (id, run_id, item_id, value, note, media_id)
```

Four things that will decide whether this works:

1. **Versioning is not optional.** A completed checklist must render as the template *as it was
   when it was completed*, or a change to the wording rewrites last month's evidence. 1Place's
   local `checklists` store is keyed `++localId, versionId, checklistId, …` — they hit this and
   solved it the same way. `checklist_runs` points at a *version*, never at a template.

2. **A signed run is append-only**, per [AGENTS.md §4.4](../AGENTS.md): withhold `UPDATE` and
   `DELETE` from everybody including `service_role`. An amendment is a new run carrying
   `supersedes`, exactly as `incidents` already does. Getting this wrong makes every completed
   checklist a document somebody can quietly change, which is the opposite of what a checklist is
   for.

3. **Photos do not collide with the consent gate — corrected 2026-08-29, on the owner's
   direction.** This item originally said a checklist photo with a child in the background was
   consent-gated child media, and the photo work was deferred on it. The correction: photo consent
   exists for *publication* — `photo_internal` is the whānau journal, `photo_public` is
   website/social/print — and an evidence photo is internal documentation, a purpose consent was
   never about. [unverified-claims 42](../llm-wiki/wiki/unverified-claims.md) records the limits
   of that ruling. What survives, with a better reason: checklist photos are staff-only evidence
   in their own store, never routed through `media`, never joined to `media_children` — not
   because the gate refuses them but because parking no-consent-needed photos in the consent-gated
   table either blocks legitimate evidence or teaches people to bypass the gate.

4. **This is the most offline-dependent write in the product** — a walk round the playground before
   the gate opens, in the rain, on the worst wifi in the building. Which runs straight into the
   prerequisite below.

**Prerequisite, and it is a real one.** [unverified-claims §21](../llm-wiki/wiki/unverified-claims.md)
records that the web outbox has never been through `drill:offline`. Generalising the outbox from
attendance to checklist runs is a refactor of code whose behaviour under real failure is unknown.
Run the drill before starting §C, not during it — this is the same warning
[roadmap-phases-8-13](roadmap-phases-8-13.md) §0 gives about Phase 8, and it has not been actioned
since.

---

## 4. Phases

Ordered by dependency, not by value. A phase is done when the §5 checklist passes, including the
wiki.

| # | Phase | Estimated | Outcome |
|---|---|---|---|
| **A** | **Rooms** — table, policy, grant, assertion; `room_id` on `incidents`, `hazards`, `safety_checks`; admin screen on `/settings` | Small | **Done** — 0066. The rooms themselves still need entering; no backfill was possible (§0) |
| **B** | **Tasks** — table + `/tasks`, statuses, priorities, assignment, due dates in centre time, a resolution required to close | Medium | **Done** — 0067 |
| **C** | **Checklists** — templates, versions, items, runs, answers, the editor and the run screen | **Large** | **Done** — 0068, minus photos and minus the offline path. Both deferred deliberately; see below |
| **D** | **Incident parity** — `room_id`, category, sickness/incident split, per-record PDF | Small–medium | **Smaller than estimated.** No migration needed at all: `incident_kind` already covers injury/illness/behaviour/near_miss, and 1Place's "Category" was blank on every row *(corrected in §7.1 — populated, and redundant; the decision stands)*. Reduced to the room field and `/incidents/[id]/print` |
| **E** | **Hazard parity** — likelihood, consequence, risk score, review frequency | Small | **Done** — 0069, with no banding. [[unverified-claims]] 40 |
| **F** | **Sync status and drafts** — a Connection Status equivalent | Small | **Done** — `SyncStatus` in the app layout. The separate "drafts list" was dropped: draft incidents already live on `/incidents` and unfinished runs on `/checklists`, and a third list of the same rows is a place for them to disagree |
| **G** | **Migration** — import people/rooms/incidents/tasks/checklist history | Unknown | **Blocked on §0.** Nothing to import |

### Still open after A–F

- **Checklist photos.** 1Place has them. Originally deferred as a consent question; corrected
  2026-08-29 — consent is for publication, not documentation (§3.2 item 3), so what remains is
  the ordinary work of a separate evidence store outside `media`. The header of 0068 still gives
  the old reason and cannot be edited (migrations are checksummed after apply); this file and
  [checklists](../llm-wiki/wiki/checklists.md) are the correction.
- **The offline path for checklist runs.** `client_uuid` exists and is unique, so the contract is
  in place; the value is still generated server-side. Generalising `apps/web/src/lib/outbox.ts`
  from attendance to runs is the work, and it is gated on `drill:offline` per §3.2.
- **Entering the rooms and the twelve templates.** Both are data, and neither can be recovered
  from the exports.

### B — Tasks, and one thing not to import

Mirror the constraint that already works on `hazards`: **closing requires saying how.**
`resolved_at` and `resolution` are a pair, enforced by a `CHECK`. A task list where "Closed" means
nothing is a task list nobody trusts within a month.

`due_on` is a **local date** — `todayInZone(centre.timezone)`, never `toISOString().slice(0,10)`.
This is the exact expression AGENTS.md §4.3 forbids and which `billing.ts:424` still contains.

Of 1Place's three task categories, **only two should become tasks.** *Maintenance* and *Hazard
Identification* are tasks. *Enrolment Enquiry* is already a first-class thing in this product —
`enrolment_applications`, `/enquiries`, `/applications`, an age band, a waitlist and a conversion
report. Importing enrolment enquiries as generic tasks would fork a workflow that already exists
and is better. Map them into `enrolment_applications` or leave them in 1Place's history.

Link hazards to tasks in one direction only: a hazard may spawn a task (`tasks.hazard_id`). A task
does not own a hazard.

### E — Hazards, and a claim not to make

1Place computes a Risk Score from Likelihood × Consequence. That matrix is a **convention**, not a
regulation, and this repo's rule is that the product does not assert what nobody has checked. Ship
the matrix if the centre wants it, but it goes in the UI as the centre's own method, never as a
compliance threshold, and it earns an entry in
[unverified-claims](../llm-wiki/wiki/unverified-claims.md) unless somebody can source the specific
5×5 (or 4×4) grid Little Pearls is expected to use.

The existing `hazards.risk` enum and the new likelihood/consequence pair must not disagree. Either
derive `risk` from the score in one place, or drop the enum in the same migration. Two sources of
truth for the same fact is how the design tokens diverged before `tokens:check` existed.

### F — Sync status, and why it is out of proportion to its size

The Connection Status dialog is trivial to build and it is the single most trust-bearing screen in
1Place: *Device Network Status · 1Place Server Connection · Last Synced · SYNC NOW*. Staff who sign
children in on a tablet need to know whether what they just typed exists anywhere else yet. Doorway
has the outbox and shows the user nothing equivalent. Cheap, and it should not wait for Phase C.

---

## 5. What not to build

- **The franchise / franchisee tier.** Little Pearls is one provider with two centres.
  Doorway's `centres` + memberships already covers it. A third level would be dead structure with
  live policy consequences.
- **Tags, Favourites, per-level dashboards** (`overview_dashboard`, `franchisee_dashboards`,
  `site_dashboards`). Generic-product furniture. Favourites in particular is a bookmark on a list
  of twelve.
- **`person_types` as a table.** Doorway models children, guardians and staff separately and with
  different policies, which is the correct shape for a product where guardianship is a boundary.
- **An Intercom-style support chat.**
- **1Place's mutable incident status.** See §2.

---

## 6. Open questions — these change the plan

1. **Which of the twelve checklist templates are actually used, and how often?** The plan's largest
   phase is sized by this and I am guessing. A photo of the Checklists list with dates would settle
   it. **Partially answered 2026-08-29 (§7.6):** at least two run daily — Room Cleaning Schedule
   per room, a Daily H&S Checklist per centre.
2. **Does a completed checklist need a signature, and whose?** 1Place shows an *Unsigned* queue for
   incidents; whether checklists carry the same is not visible in the screenshots.
3. **How much history has to come across?** 2,461 incident IDs is a lot of records — but that
   number may be global to 1Place rather than per-tenant. "Everything" and "the current licensing
   period" are very different migrations. **Answered 2026-08-29 (§7.5):** per-franchisee sequence;
   the ~2,461 rows are Little Pearls' own history. The everything-vs-licensing-period question
   still stands.
4. **Is there a hard date?** A renewal date on the 1Place subscription changes the order of §4
   and would justify shipping D, E and F before C.
5. **What are the two Settings checkboxes** on the 1Place settings screen? They were obscured by
   the dialog in both screenshots.

---

## 7. What the 2026-08-29 screenshots added

A third batch: the mobile incident list and new-incident flow, the web console's edit view for
record 2461, the Investigation tab, the Severity and Type-of-Injury dropdowns, the Checklists home
tab, and a per-record PDF (No 2461, Details tab only — the filename says so, and whether the
Investigation tab prints is not known). Two findings correct what is written above, two answer §6
questions, one is a module this plan had not seen; the rest is vocabulary, recorded for phase G.

### 7.1 Correction: the Category field is not blank on every row

§2 and [incident-register](../llm-wiki/wiki/incident-register.md) said 1Place's Incident Category
"was blank on every row". In this batch it is populated on two of the three visible rows — with the
value **Incident**, on rows whose Type is already Incident — and blank on 2461 even though the web
edit view marks it required. The mobile flow auto-fills it from the type chosen at creation, which
explains both observations. So the field is filled, and the observed value duplicates the Type
field exactly. The Phase D decision stands — `incident_kind` carries more information than a
category that echoes the type — but it now rests on "redundant", not "unused". If a row ever shows
a category that is not simply the type, revisit.

### 7.2 Correction: two status axes, not one

No 2461 is **Signature Status: Signed** and **Status: Pending** at the same time. The web edit
view shows Status as a three-step workflow — Pending → Open → Resolved — while the list keeps a
separate *Unsigned* section. Independent axes: the Unsigned queue keys on signature status, not on
workflow status.

§2 previously mapped *Unsigned* → `draft` and *Pending* → `final` — two rules that conflict on an
unsigned Pending record, which is what a freshly filed report presumably is. The mapping keys on
**signature status alone**: Unsigned → `draft`, Signed → `final`. Pending/Open/Resolved is a
triage state with no Doorway counterpart; if it comes across at all, it comes as text on the
imported record, not as a column.

### 7.3 The Investigation tab — the fourth gap, and the one where Doorway can be better

Behind the Details form is a second tab this plan had not seen. Its fields: Investigation Is
Required · Date Investigated · Investigated By · **Worksafe Need To Be Advised · Date Worksafe
Advised** · Hazard Register Updated · Description and Notes · **Staff : Child Ratio (in the
child's room at the time of the incident)** · Current First Aid trained staff in area/room at the
time · Time · Outcome · First Aid was administered / By whom · Child was taken to hospital / By
whom · An agency was contacted / Time / Date.

Doorway's incident register has none of this. Two notes for whenever it is built:

- **The ratio field is free text in 1Place and does not have to be here.** Doorway has attendance
  and ratios first-class; the ratio in the child's room at the incident's timestamp is computable,
  and a computed figure is evidence where a remembered one is an assertion. This would be the
  first place the product is structurally better than what it replaces, rather than equally good
  with stricter policies.
- **Do not encode when WorkSafe must be advised.** The field is a yes/no in 1Place and can stay
  one here. Any rule of the form "severity X requires notification" is a regulatory claim, and per
  AGENTS.md it needs a source or an
  [unverified-claims](../llm-wiki/wiki/unverified-claims.md) entry before the product asserts it.

### 7.4 The signature model, and what "Signed" turns out to mean

The Declaration block carries four name/signature/date triples: Staff, Witness, Management,
Parent. On 2461, staff (Mycene), a witness (Salma) and the parent (Diana) all signed on the day of
the incident; Management is blank; the record reads **Signed** — so Signed does not require all
four.

The parent's signature is drawn on the centre's device, and the Parent Notification section above
it — Contacted / Name / Time — is empty on the same record: the one fact that section exists to
establish is carried by the drawn signature instead. Doorway's model is stronger on exactly this
point — `parent_notified_at` is recorded by staff, and `acknowledged_at` only by the guardian's
own authenticated account, an attribution a squiggle on a shared tablet cannot make. Do not add a
signature pad to match; the acknowledgement is the signature, which is the same argument
[incident-register](../llm-wiki/wiki/incident-register.md) already makes about the print page's
missing signature line.

### 7.5 Vocabulary and mechanics, recorded for phase G

| Field | Values observed |
|---|---|
| Severity | No Harm / Near Miss · Minor Harm · Serious Harm · Fatal |
| Type Of Injury/Sickness | Slip / Trip · Bruise · Cut / Scratch / Graze · Sprain / Strain · Bite · Sting · Burn · Dislocation / Fracture · Bump · Foreign Body · Sickness · Other |
| Incident status (web) | Pending → Open → Resolved — three steps where tasks have four |
| Text limits | 512 on short fields, 9000 on Description / Explain |

- **The display number is per-franchisee.** The edit URL for No 2461 reads
  `incidentId=1977313&franchiseeId=12442687` — a global row id behind a tenant-local sequence.
  §6 Q3 is answered: ~2,461 incidents really is Little Pearls' own history.
- **Person data is snapshotted, not joined.** Gender, birth date and primary contact sit on the
  edit view as plain text fields with 512-char limits. Phase G imports copies, and a copy may
  disagree with the person record; import them as the incident's own text, exactly as stored.
- **The reporter can be a shared login.** 2461's Reporter is "Mt Roskill Preschool" — a site
  login, not a person — while the new-form default is the signed-in user. Expect reporter
  attribution in imported history to be partly room-level.
- **A room is chosen before the form opens** on mobile, as `site--room` ("Little Pearls Educare
  Mount Roskill--Carpark - Mt Roskill"), then the type (Sickness | Incident). Mandatory scoping at
  creation, which supports the phase A shape.
- **Incidents carry photos** ("Photos From Details Section", each with a taken-date). 2461's photo
  is a child's arm. This bullet originally called that "child media by definition" and a
  consent-gate question; corrected 2026-08-29 — it is not (§3.2 item 3). An incident photo is
  evidence: staff-only, plus — plausibly — the child's own guardian on a final report, the same
  audience as the report text. Whether the photo rides the report's RLS is a decision for when it
  is built, not one this correction makes.
- **A body map** ("Please indicate where the person was injured", four child outlines) sits in the
  Details form and prints on the PDF. Unmarked on 2461 while "What part of the body was injured"
  is filled — the dropdown is what staff actually use.
- **The New sheet has a fourth object: Note** (Checklist · Task · Note · Incident/Sickness), which
  is not in §2's module table. Scope unknown. Recorded, not planned for.
- **Fields go unfilled on a Signed record**: how-did-this-occur, further-medical-attention, the
  whole Parent Notification block, Management. Phase G should expect nulls everywhere, including
  fields the current form marks required — 2461's own required Category is blank.

### 7.6 The checklists actually in use — §6 Q1, partially answered

The Overdue section (7 entries, four visible) shows **Room Cleaning Schedule - Daily** fanned out
per room (Infant - Mt Albert, Preschool - Mt Albert, …) and a centre-level **Daily H&S Checklist**
(Little Pearls Educare Centre, due 27/08). At least two of the twelve templates run daily, one per
room — and the second site is named for the first time: **Mt Albert**. Daily × per-room × two
sites makes checklist runs the bulk of phase G by row count, and puts the no-scheduler design in
[checklists](../llm-wiki/wiki/checklists.md) on the highest-frequency cadence there is.

---

## See also

- [roadmap-phases-8-13.md](roadmap-phases-8-13.md) — the earlier plan; its §0 prerequisites are
  this plan's prerequisites too
- [llm-wiki/wiki/centre-registers.md](../llm-wiki/wiki/centre-registers.md) — hazards, drills and
  safety checks as built
- [llm-wiki/wiki/incident-register.md](../llm-wiki/wiki/incident-register.md)
- [llm-wiki/wiki/offline-outbox.md](../llm-wiki/wiki/offline-outbox.md)
- [llm-wiki/wiki/exports.md](../llm-wiki/wiki/exports.md)

*Last updated: 2026-08-29*
