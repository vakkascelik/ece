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
| Incidents / Sickness | `incidents` + `/incidents` | **Ahead of 1Place**, with three gaps |
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
grant exists for anybody**. 1Place shows a flat *Status: Pending* and an *Unsigned* queue. The
migration maps *Unsigned* → `draft` and *Pending* → `final`; it does not add a mutable status
column to match 1Place's.

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

3. **Photos collide with the consent gate.** `media` and `0015_consent_gate_restrictive` exist
   because a photo containing a child is consent-gated. A photo of a broken latch is not. A photo
   of a broken latch *with a child in the background* is. The engine must decide which store a
   checklist photo lands in, and the honest default is: checklist photos are staff-only evidence,
   never surfaced to parents, and never joined to `media_children`. Do not let a checklist become a
   side door into the media gate.

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
| **D** | **Incident parity** — `room_id`, category, sickness/incident split, per-record PDF | Small–medium | **Smaller than estimated.** No migration needed at all: `incident_kind` already covers injury/illness/behaviour/near_miss, and 1Place's "Category" was blank on every row. Reduced to the room field and `/incidents/[id]/print` |
| **E** | **Hazard parity** — likelihood, consequence, risk score, review frequency | Small | **Done** — 0069, with no banding. [[unverified-claims]] 40 |
| **F** | **Sync status and drafts** — a Connection Status equivalent | Small | **Done** — `SyncStatus` in the app layout. The separate "drafts list" was dropped: draft incidents already live on `/incidents` and unfinished runs on `/checklists`, and a third list of the same rows is a place for them to disagree |
| **G** | **Migration** — import people/rooms/incidents/tasks/checklist history | Unknown | **Blocked on §0.** Nothing to import |

### Still open after A–F

- **Checklist photos.** 1Place has them. Deferred because `media` is consent-gated and a photo of
  a broken latch with a toddler in the background is child media — see the header of 0068.
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
   it.
2. **Does a completed checklist need a signature, and whose?** 1Place shows an *Unsigned* queue for
   incidents; whether checklists carry the same is not visible in the screenshots.
3. **How much history has to come across?** 2,461 incident IDs is a lot of records — but that
   number may be global to 1Place rather than per-tenant. "Everything" and "the current licensing
   period" are very different migrations.
4. **Is there a hard date?** A renewal date on the 1Place subscription changes the order of §4
   and would justify shipping D, E and F before C.
5. **What are the two Settings checkboxes** on the 1Place settings screen? They were obscured by
   the dialog in both screenshots.

---

## See also

- [roadmap-phases-8-13.md](roadmap-phases-8-13.md) — the earlier plan; its §0 prerequisites are
  this plan's prerequisites too
- [llm-wiki/wiki/centre-registers.md](../llm-wiki/wiki/centre-registers.md) — hazards, drills and
  safety checks as built
- [llm-wiki/wiki/incident-register.md](../llm-wiki/wiki/incident-register.md)
- [llm-wiki/wiki/offline-outbox.md](../llm-wiki/wiki/offline-outbox.md)
- [llm-wiki/wiki/exports.md](../llm-wiki/wiki/exports.md)

*Last updated: 2026-08-28*
