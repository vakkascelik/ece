# Infocare: the roll copy, and the division of labour

Doorway replaces every system Little Pearls runs **except Infocare**. Infocare keeps the SMS
work. This document is how the roll gets into Doorway so the rest can function, what must not
come with it, and the one page the arrangement makes dangerous.

**Decided 2026-08-29 by the owner: copy, not migration.** Infocare remains the system of record.
A partnership and API integration will be requested; this path must work whether or not it is
granted, and permanently if it is refused.

Written 2026-08-29. Supersedes the first draft of this file, written the same day, whose
"creates, never edits" rule was correct for a one-shot migration and is **wrong** for a standing
copy — see §2.

Read [AGENTS.md](../AGENTS.md), then [`scripts/import-storypark.ts`](../scripts/import-storypark.ts)
and [`scripts/import-discover.ts`](../scripts/import-discover.ts) — the house importer pattern is
already written twice and this follows it.

**Nothing in this document is built.**

---

## 0. The division of labour

The five systems the centre runs (`LOGS.md:318`) and where each stands:

| System | What it does | Status |
|---|---|---|
| **1Place** | Health and safety: checklists, tasks, incidents, hazards | **Replaced** 2026-08-28 — migrations 0066–0072, [`checklists`](../llm-wiki/wiki/checklists.md). Rooms and templates still to be entered |
| **VisTab** | Visitor sign-in | `visitors` (0035) and `/visitors` exist. **Parity not assessed** — no screenshots of VisTab have ever been seen by this repo |
| **Educa** | Learning stories, family portfolio | `posts`, `post_children`, `post_strands`, `/posts`, Te Whāriki tagging (0058) and [`import-storypark.ts`](../scripts/import-storypark.ts) exist. **Parity not assessed** |
| **KindyNow** | Absence notification | Core absorbed 0063 — reason, office notification, per-day-honest range |
| **Infocare** | Enrolment, attendance, funding returns, parent billing | **Kept.** Not replaced, not competed with |

What every one of the four replacements needs and none of them has: **a roll**. Both centres
currently hold a name, a service number and a timezone, and zero children. That is the only
thing this import exists to fix.

So the scope is narrow, and stating it narrowly is the point:

| | Owner | In this import |
|---|---|---|
| Children — name, DOB, NSN | Infocare | **Yes** |
| Guardians and their links to children | Infocare | **Yes** |
| Allergies, conditions, response plans | Infocare | **Yes** — an incident screen without them is worse than paper |
| Immunisation **status** | Infocare | Yes, without the sighting — §6 |
| Enrolment start/end and booked days | Infocare | **Yes** — the roll, the ratios and bookings need them |
| Funded hours, 20 Hours ECE attestation | Infocare | **No** — §3 |
| Attendance history | Infocare | **No, and it cannot be** — §5 |
| Invoices, payments, fee schedules | Infocare | **No** |
| Consent decisions | *Doorway, re-collected* | **No** — §6 |
| Photos and media | *Doorway, re-collected* | **No** — §6 |
| Incidents, checklists, tasks, hazards, visitors, posts | Doorway | Not applicable — Doorway owns these outright |

---

## 1. The manual import is not a stopgap

The partnership may be refused, or may take a year. Two consequences follow, and the second one
overturns something written yesterday.

**It must be maintainable.** A throwaway script becomes the permanent load-bearing path. It gets
the same treatment as anything else in `scripts/`.

**It must be re-runnable against a changed roll.** Children start and leave, phone numbers change,
a guardian is added. Under a copy arrangement the two rolls diverge from the first afternoon.
A one-shot importer means the divergence is permanent and invisible.

---

## 2. Field ownership — the correction

The first draft of this file said: *"this script creates, it never edits… an importer that updates
on re-run silently overwrites a correction somebody made in Doorway after the first run."*

That reasoning is sound for a migration and wrong for a copy. In a copy, Infocare **is** the
correction — a phone number changed there is not a change Doorway is entitled to ignore. But the
original worry is also real: a re-run must not flatten data Doorway owns and Infocare has never
heard of.

Both hold, because the fields belong to different systems. So the rule is per field, not per row:

| Field | Owner | On re-import |
|---|---|---|
| `children.first_name`, `last_name`, `preferred_name`, `date_of_birth`, `moe_nsn` | Infocare | **Overwrite.** Report every change in the dry run |
| `children.ethnicities`, `iwi`, `first_language`, `gender` | Infocare, if it holds them | Overwrite **only if the file supplies a value.** An absent key is not an instruction to blank |
| `children.archived_at` | Doorway | Never touched. Leaving is a decision the office makes here |
| `guardians.full_name`, `email`, `phone`, `address` | Infocare | Overwrite |
| `guardians.user_id` | **Doorway** | Never touched — it is the link to a real login |
| `child_guardians.*` | Infocare | Overwrite, **except** that a link present in Doorway and absent from the file is **reported, never revoked** — §8 |
| `enrolments.start_date`, `end_date`, `days` | Infocare | Overwrite |
| `enrolments.funded_hours_per_week`, `twenty_hours_ece` | Infocare | **Not imported at all** — §3 |
| `health_conditions.*` | Infocare | Insert new, report changes, **never resolve** — closing an allergy is a clinical decision |
| `immunisation_records` | Infocare (status only) | New row, superseding — the table is already append-and-supersede |
| Everything else in the schema | Doorway | Never touched |

**Write this table once and it serves twice.** If the partnership is granted, the API sync needs
exactly this contract — which fields Infocare wins, which Doorway wins, which are merged. Getting
it right for a JSON file now means the integration is a change of transport rather than a change
of meaning.

Every overwrite is **printed in the dry run as a before/after**, not counted. A re-import that
silently changes 40 phone numbers is indistinguishable from one that silently changes 40 names.

---

## 3. The arrangement makes `/funding` dangerous, and this is the sharpest finding here

Doorway has a funding page. Under this arrangement Infocare prepares the funding return — and
Doorway's attendance record starts on the cutover date and holds nothing before it.

**What the code does with that, read rather than assumed.** `childFunding` in
[`packages/core/src/funding.ts`](../packages/core/src/funding.ts) filters days into `complete` and
`unresolved`. A child with **no attendance rows at all** produces an empty `inPeriod`, so both
lists are empty: `fundedHours` is 0 and `unresolvedDates` is `[]`. `summariseFunding` then counts
`unresolvedChildCount = 0` and sets **`complete: true`**.

So for any period before the cutover, Doorway's funding page reports **zero funded hours and
declares itself complete**. Not "incomplete", not "excluded and named" — the treatment
[`funding-and-billing`](../llm-wiki/wiki/funding-and-billing.md) insists on for a broken day, and
which is correctly implemented for a broken day, does not fire here, because a period with no
records at all is not a broken record. It is silence, and silence reads as zero.

`FundingSummary.complete` carries this comment:

> The export leads with this. A summary that looks final while three children have missing
> sign-outs is a summary that gets keyed into ELI Web.

That is precisely the hazard, one step to the left of where the author was looking. And it is not
theoretical: RS7 returns are four-monthly, so the first return after cutover **necessarily** spans
a period Doorway has no records for.

**There is no way to switch the page off for one centre.** Capabilities are role-based —
`can(ctx.role, capability)` — and `centres` carries no feature columns. An owner or manager sees
`/funding` because they are an owner or manager.

Three mitigations, cheapest first:

1. **Do not import `funded_hours_per_week` or `twenty_hours_ece`.** They are funding inputs and
   Infocare owns funding. Leaving them at their defaults keeps Doorway's funding page visibly
   unconfigured rather than plausibly wrong. This is a decision in the importer and costs nothing.
2. **A record-start banner on `/funding` and its export.** Compare the earliest `attendance_events.at`
   for the centre against the period start; when the period begins before the record does, say so
   and refuse to call the summary complete. This is a small change to `summariseFunding` plus a
   date the caller already has, it needs no schema, and it is the same shape as the product's
   existing habit of rendering `overdue: null` differently from `overdue: false` — *a green tick
   against an unmeasured gap is how a product talks a centre into a breach*.
3. A per-centre module toggle. New schema, new policy, new assertion. Only worth it if more
   tenants end up in this arrangement.

**Recommend 1 and 2, and 2 is worth doing before the import runs rather than after.** It is the
only item in this document that can produce a wrong number on a return to the Crown.

---

## 4. There is nowhere to record which Infocare row a child came from

`children` has `moe_nsn` and nothing else external. `guardians` has no external reference at all.

For the file-based import that is survivable — the NSN is a real shared key (§7). For the
**integration**, it is a gap: a sync needs to know that *this* Doorway child is *that* Infocare
record, and re-deriving it by name on every sync reintroduces exactly the ambiguity §7 exists to
refuse. Guardians are worse, having no natural key at all — a mother with two children and a
changed surname is not identifiable by anything the schema holds.

**Recommendation: add the columns with the importer, not with the integration.** A nullable
`source_system text` and `source_ref text` on `children` and `guardians`, unique per
`(centre_id, source_system, source_ref)`. A column on an existing table inherits that table's
policies, so this is small — but AGENTS.md §4.2 still applies to the grant and the assertion.

Deliberately generic rather than `infocare_id`: naming a vendor in the schema is a name that
outlives the vendor. Deliberately *now* rather than later: the manual import is the only moment
when a human is looking at both systems and can establish the correspondence cheaply. After that
it is archaeology.

---

## 5. Attendance history cannot come across — and under this arrangement, need not

`attendance_events` (0009):

```sql
constraint attendance_not_ancient check (at > now() - interval '14 days'),
```

Five sibling tables carry the same constraint — `staff_count_events`, `medication_administrations`,
`sleep_checks`, `safety_checks`, `staff_attendance_events` — and **none of the six has been relaxed
in seventy-two migrations**. It is a house invariant: these tables record what is happening, and a
row inserted today claiming to describe last March is not a record of anything anybody observed.

Under a migration this was a painful limitation. Under a copy it is simply correct: **attendance is
Infocare's job.** It keeps the history, it keeps producing the return, and Doorway's attendance
record begins on the cutover date and is used for what Doorway owns — ratios, the roll, sign-in at
the door.

`bookings` (0018) carries no such constraint, so **forward** bookings can and should be imported.
That is what lets the cutover happen without re-keying a term by hand.

**The cutover date goes on this page when it is chosen.** §3's banner depends on it.

---

## 6. Four categories refused outright

Each a hard stop that names the row and exits — the way `refuseMediaFields` does — never a
silently ignored field. A field quietly dropped is one nobody discovers is missing.

**Photos.** [`consent-gated-media`](../llm-wiki/wiki/consent-gated-media.md): a photograph here
cannot exist without a recorded consent decision. One pulled from Infocare has no `media` row and
no consent behind it *in this database*.

**Consent decisions themselves.** Subtler and worse. `consent_events.given_by` is documented as
*"the guardian whose consent this is. Not the person who typed it in."* An imported consent row
asserts a named parent agreed to something, with `given_by` pointing at a `guardians` row the same
import created ninety seconds earlier. That is not migrating evidence of consent, it is
**manufacturing** it. Re-collected in Doorway or it does not exist in Doorway.

**Immunisation sightings.** The table splits status from sighting deliberately — *"'The family told
us she is up to date' and 'somebody looked at the certificate' are different claims and only the
second survives a review."* Status imports fine; `immunisation_sighting_complete` permits both
sighting columns null, so the schema already expresses "reported, not sighted". `sighted_by` and
`sighted_at` would claim a member of this centre's staff examined a document. Certificates get
re-sighted, and that cost is named to the centre up front.

**Custody arrangements.** The strongest comment in the schema: *"Court orders and collection
restrictions. **STAFF ONLY — never readable by a guardian, including the guardian it
concerns.**"* Infocare will most likely hold these as free text on a child or contact record.
Importing that as a note moves staff-only information into a row a parent can read. Anything
resembling a court order, a non-collection instruction or a restraining order is a hard stop.
Entered by hand, by the office, having read it.

---

## 7. Matching, which gets stricter rather than looser

`children.moe_nsn` is `unique (centre_id, moe_nsn)`, nullable — *"null until issued"*. Infocare
holds it because a funding return cannot be made without it.

- **NSN is the match key.** Exact, one row, trimmed and no other normalisation.
- **The name must also agree.** An NSN matching a child whose name does not is a **refusal** — not
  an update, not a second child. Either a typo or the wrong child, and both need a person.
- **No NSN falls back to the Storypark rule**: `first last` and `preferred last`,
  case-insensitively, exactly one match; zero or several refuses the row. Plus date of birth as a
  second factor, which Storypark never had.
- Once `source_ref` exists (§4), it takes precedence over both and this section becomes the
  fallback for rows that predate it.

---

## 8. Guardianship is a security boundary, and the import writes it

`child_guardians` is what `caller_may_see_child` rests on. Everywhere else a wrong row is wrong
data; here a wrong row **shows one family another family's child** — their incidents, their photos,
their medication records. [`tenancy-and-rls`](../llm-wiki/wiki/tenancy-and-rls.md) names this as
the second of the two boundaries and the reason `packages/api` filters nothing.

- Every link is **printed** in the dry run, grouped by child, with relationship and collection
  flag. 198 children is twenty minutes of reading, which is cheap against the failure.
- `can_collect` defaults `true` in the schema. **The importer requires it explicitly** and defaults
  it `false`. The schema's default is right for a person filling in a form while looking at the
  parent, and wrong for a machine reading a file.
- A child with **zero** guardian links is refused.
- **A link in Doorway and absent from the file is reported, never revoked automatically.** Removing
  a guardian is how a family stops seeing a child — the correct outcome when a court order lands,
  and a catastrophe when it is an export artefact. A person makes that call.

### One consequence of the tenancy model that will surprise the centre

`children.centre_id` and `guardians.centre_id` are both `not null` and every uniqueness constraint
is per centre. Infocare almost certainly models Little Pearls as one organisation with two sites;
this product models **two centres**.

A family with a child at each site is **two guardian rows**, unlinked. A child who transferred is
**two child records**, the earlier archived rather than moved. That is the tenancy model working as
designed — centre-vs-centre is the primary boundary — but the import file is **per centre**,
`centreSlug` is required, and the centre will see duplicate-looking names across the two sites.

---

## 9. The file shape

Per centre, mapped by hand from whatever Infocare produces. Do **not** write a parser for
Infocare's own format — [`import-storypark.ts`](../scripts/import-storypark.ts) explains why, and
the 1Place exports proved it: two files, both parsed cleanly, both declared their row counts in a
header (243 and 6), both contained **zero rows**. A guessed parser would have reported success.

```jsonc
{
  "source": "Exported from Infocare by Little Pearls, roll as at 2026-09-xx",
  "centreSlug": "little-pearls-mt-albert",
  "children": [
    {
      "sourceRef": "IC-40912",           // Infocare's own id, if the export carries one — §4
      "moeNsn": "123456789",             // omit if not yet issued
      "firstName": "Ana",
      "lastName": "Kupe",
      "preferredName": "Annie",
      "dateOfBirth": "2023-06-02",       // REQUIRED — the column is NOT NULL
      "ethnicities": ["Māori", "NZ European"],   // max 3, schema-enforced
      "iwi": "Ngāti Whātua",
      "firstLanguage": "te reo Māori",
      "gender": "female",                // female | male | another | unspecified

      "enrolments": [
        {
          "startDate": "2024-02-05",
          "endDate": null,
          "days": [1, 2, 3, 4, 5]        // 1 = Monday, as everywhere in this schema
          // no funded hours, no 20 Hours attestation — Infocare owns funding, §3
        }
      ],

      "guardians": [
        {
          "sourceRef": "IC-C8871",
          "fullName": "Mere Kupe",
          "email": "mere@example.nz",
          "phone": "021 555 0134",
          "address": "12 Lorraine Ave, Mount Albert",
          "relationship": "Mother",
          "isPrimary": true,
          "canCollect": true,            // REQUIRED, no default — §8
          "isEmergencyContact": true,
          "contactPriority": 1
        }
      ],

      "healthConditions": [
        {
          "kind": "allergy",
          "name": "Peanuts",
          "severity": "severe",
          "responsePlan": "EpiPen in the red bag by the door. Call 111 first."
        }
      ],

      "immunisation": {
        "status": "up_to_date",          // status only, never a sighting — §6
        "reference": "Reported in Infocare, not sighted at transfer"
      }
    }
  ]
}
```

Refused keys anywhere in the file, each naming the row and exiting: `photos`, `media`, `images`,
`consent`, `consents`, `attendance`, `custody`, `courtOrder`, `sightedBy`, `sightedAt`, `invoices`,
`balance`, `fundedHours`, `twentyHoursEce`.

Two constraints the mapper hits immediately:

- `children_ethnicities_max_three` caps the array at three and stores free text, while Infocare
  will hold Statistics NZ codes. **Do not invent a code-to-label table** — that is the exact shape
  [`unverified-claims`](../llm-wiki/wiki/unverified-claims.md) exists to catch. Either the mapper
  writes the labels the centre itself uses, or the field is left empty and filled in the console.
- `enrolments_no_overlap`, a GiST exclusion on `(child_id, daterange(start_date, end_date))`.
  Infocare may hold overlapping rows for one child — two rooms, or a correction never closed off.
  Refused per child with both rows printed, because merging them is a judgement about what the
  centre actually agreed to.

---

## 10. Phases

| | What | Depends on | Size |
|---|---|---|---|
| **A** | Ask Infocare, in one message, for both the export **and** the partnership conversation — §11 | nothing | an email |
| **B** | The `/funding` record-start banner, §3 mitigation 2 | nothing | small |
| **C** | `source_system` / `source_ref` on `children` and `guardians`, §4 | nothing | small — one migration, a grant, an assertion |
| **D** | `scripts/import-infocare.ts` — parse, validate, match, refuse, dry-run report. **No write path** | A for the real column names; **not** the insurance gate | medium |
| **E** | The write path behind `--commit`, with the §2 ownership table as its spec | C, D | medium |
| **F** | Dry-run against the real file, read the guardianship report end to end, fix, repeat | A, D | a morning |
| **G** | Run it | **the insurance gate** — §12 | minutes |
| **H** | Forward bookings for the term, so the cutover date has a roll behind it | G | small |
| **I** | Wiki page; `unverified-claims` entries for anything Infocare asserted that nobody here verified | E | small |

**B and C do not wait on Infocare and should not.** B is the only item that can prevent a wrong
number reaching the Crown, and C is cheapest at the moment a human is looking at both systems.

**D is worth building before A returns anything.** Every refusal path — missing NSN, ambiguous
name, zero-guardian child, custody field, overlapping enrolments — can be exercised against a
handwritten fixture, and a dry run against an empty roll still proves the script refuses what it
should. The deliberate inverse of the 1Place sequencing mistake, where the plan waited on files
that turned out to hold nothing.

---

## 11. What to ask Infocare for

The 1Place ask has produced nothing to date, which is why its Phase G is still blocked. That
lesson: *"They are the vendor and Little Pearls is the customer; this is a contractual request,
not a favour."*

**Two asks, one message, because they are the same conversation.**

**The export**, as CSV or JSON per module, not as a database dump:

1. **Children** — including the **NSN**, date of birth, preferred name, ethnicity, iwi, first
   language, site, and **Infocare's own record id**.
2. **Contacts / guardians**, with the relationship to each child, collection authority,
   emergency-contact ordering, and again the record id. The one that matters most and the one most
   likely to arrive as an unusable blob.
3. **Enrolments** — start, end, booked days.
4. **Health** — allergies, conditions, response plans, medication authorities.
5. **Immunisation status**, with whatever provenance it carries.
6. **Rooms**, if it has them. `rooms` (0066) is empty and needs filling either way.

Not asked for: attendance history (§5), invoices, fee schedules. Infocare keeps those and keeps
doing that work.

**The integration**, separately and plainly: is there an API or a partner programme, what does it
cost, what does it cover, and what would it take to be granted access. The answer determines
whether the importer above is a bridge or the permanent arrangement — and it is worth asking
*before* the manual export lands, because a vendor that will grant API access may hand over a
better export than one being asked to help a customer leave.

Also ask what the **notice period and data-return clause** in the contract say. Nobody here has
read it, and it decides whether the dual-run has an end date.

---

## 12. Open questions

1. **Is the professional indemnity insurance in place?** Blocks Phase G entirely.
   [`tenant-little-pearls.md`](tenant-little-pearls.md): *"No child record goes in until
   professional indemnity insurance is in place"* — absent as at 2026-08-05, never rechecked. Needs
   a date and a policy reference, because *"somebody said yes once" is the shape of claim this repo
   keeps having to correct*.
2. **The cutover date** for attendance — the day Doorway's own record begins. §3's banner and §5
   both depend on it.
3. **Does the export carry the NSN, and Infocare's own record id?** Without the NSN, §7 collapses
   to name-plus-date-of-birth matching and the import gets materially riskier. Without the record
   id, §4 has nothing to store.
4. **Does Infocare hold custody or collection restrictions**, and in which field? Decides whether
   §6's hard stop fires on real data.
5. **Two sites or one organisation** in the export, with a site column per child? Decides whether
   §8's per-centre split is a filter or a manual sort.
6. **How often does the re-import run**, and who runs it? §2 makes it safe; nobody has said whether
   it is weekly, per enrolment, or on request.
7. **VisTab and Educa parity is unassessed.** Both have a surface in this product and neither has
   been compared against the thing it replaces. Screenshots would settle it the way they settled
   1Place — that exercise took one afternoon and found two structural gaps.

---

*Written 2026-08-29. Nothing here is built.*
