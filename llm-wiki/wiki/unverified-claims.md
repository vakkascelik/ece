# Unverified claims

Everything this product asserts that nobody has checked, in one place.

## Overview

This is the most important page in the wiki, and it exists because of what the product is.
A compliance tool that is confidently wrong is worse than no tool: a manager who is told
they are within ratio stops counting. So every figure, duration and threshold that was
written from reasoning rather than from a source is listed here, with what it would take to
close it.

Two of these are wired into the product as machine-readable flags rather than only prose,
so the UI cannot present an unchecked number without saying it is unchecked. That is the
pattern to follow for anything added later: **if a claim cannot be sourced, make the
product say so, and put it on this page.**

Nothing here is a bug. They are known gaps with known closures.

## Key Points

- **The ratio bands are verified — item 1, CLOSED 2026-08-18.** Read against Schedule 2 as
  at 29 June 2026 and correct in every published row. The reading found a *missing* row
  instead: three or fewer children of mixed ages need one adult, and the product had been
  reporting a breach on a legal room. What is still true, and now said in narrower words on
  every ratio surface, is that the **inputs** are incomplete: Schedule 2 counts every person
  present aged under 6, including a staff member's own child, and this product counts
  enrolled children who signed in. Sessional and home-based tables are not modelled.
- **A service MAY keep its Chapter 6 records outside an approved SMS — item 37, CLOSED
  2026-08-31.** The premise the whole product rests on, confirmed by the Ministry in writing after
  a narrowed re-ask: *"Whether the records are held in a Ministry-approved SMS or another system is
  not, in itself, an ELI requirement."* Conditional, and the conditions are the point — the system
  must enable compliance with **all** of Chapter 6, meet §6-3, keep records available for audit and
  retained, and the service must still submit through ELI Web. Three of those four are open items
  here (6, 36, and 3 with 44), so the risk moved from "the premise may be wrong" to "the premise is
  right and the conditions are ours to meet". **Nothing may imply the Ministry approved this
  software.** It did not; it described when any system qualifies.
- **The same reply told vendors to say something this product did not say — item 45, BUILT
  2026-08-31.** That use of the system does not remove the service's responsibility to comply, and
  that a person must review and validate RS7 figures before submitting them. It is now the second
  sentence of the funding disclaimer, **unconditional** — behind `!summary.verified` it would
  vanish on the day the figures look most trustworthy. The Ministry's word for the failure mode
  this product already discloses is *"under-claiming"*.
- **The census's contact hours may be the wrong kind of hours — item 50, added 2026-09-03.** The
  ELI schema shapes `ContactHoursDetailList` like a contracted weekly pattern and that is what was
  built; **§14-2 of the Handbook calls the same field *"actual contact hours … actually spent
  teaching children"***. If it is actual, the source is recorded staff attendance, not the roster
  agreement — and a service without per-person staff sign-in cannot answer it at all. **A schema
  tells you what a field may contain, not what it means.**
- **The enrolment record now meets §6-1 in full — item 58, opened and CLOSED 2026-09-04.** Reading
  §6-1 against the schema found three of its required contents missing: the child's residential
  address, an attestation of the hours enrolled at another service, and a dated parent signature.
  Four commits closed it — `0086`, `0087` and the two that made them writable. **The last one was
  the one that mattered**: writing the fields on the file-an-enrolment form alone would have left
  every enrolment already on file permanently incomplete, since re-filing is refused by the overlap
  constraint. What is *not* built is a centre-wide readiness list; gaps are named per child.
- ~~**Thirty-four writes cannot tell a refusal from a success**~~ — **item 49, CLOSED the day it
  was opened: 50 guarded, 4 deliberately not.** The triage question turned out to be answerable
  from the query itself: `.eq('id', …)` alone means one named row, so zero rows is a wrong id or a
  refusal; a state filter means *already in that state*; a non-unique key means bulk. The four
  exceptions each carry a comment, because the next reader will see an unguarded write and reach
  for the pattern. It mattered more here than it would elsewhere for the reason
  [AGENTS.md §4.1](../../AGENTS.md) gives — the application holds no tenant filtering by design, so
  *the database will refuse* **is** the security model, and the writes that could not tell included
  revoking a membership, revoking an invitation, sighting a certificate and superseding a custody
  arrangement.
- **The Supabase region is Sydney — `ap-southeast-2`, answered 2026-09-02, and it was one API call.**
  [`privacy-statement.md`](../../docs/privacy-statement.md) carried it as an explicit blank since
  2026-08-06, asking whether children's records sat in *"Sydney, Singapore or Oregon"*. Both regions
  are now named in the document a centre reads. `AST03` of the vendor assessment expects offshore
  storage to be *"communicated and accepted by each service"* — disclosure is done, **acceptance is
  not**, and needs the service to acknowledge it in writing.
- **The product does not meet the Ministry's SMS Development Criteria — item 48, added 2026-09-02.**
  ELI integration applications opened for a 2026 tranche closing 30 October, one place, and the
  form's first declaration is that the SMS *meets* those criteria. Three of eight mandatory
  functionalities are absent (the ECE census, the RS7 return, Waha Rumaki/PITA), home-based and
  sessional are unmodelled, and `centres` cannot record a service type at all. **This is the one
  item on this page that is a measurement rather than a claim**, and signing that declaration today
  would be asserting something untrue to the Crown.
- **The ELI schema is served publicly, and may not be the normative version — item 47.**
  `eli.minedu.govt.nz/eli.xsd` is a complete schema with **no version stamp**. Its *shape* may be
  relied on; a specific length bound or enumeration quoted as a rule the Ministry enforces may not.
- **§14-3 of the Handbook has been read, and the premise no longer rests on an email — item 46.**
  ELI Web is described there as the route for services *"that do not use a SMS"*. Read by a tool
  rather than a person, so it carries item 36's caveat and stays open for a human reading.
- **The restore drill is green again — item 44, CLOSED 2026-08-31.** Six CHECK constraints reading
  `now() - interval '14 days'` made the operational core unloadable more than a fortnight after the
  fact; `0078` moves them to triggers, which a dump creates *after* the rows land. The fix this
  page originally proposed was wrong for the right-sounding reason, and the correction is recorded
  in the item rather than quietly applied.
- **No licensing criteria are loaded, and none are seeded.** The criteria-gap feature
  cannot function until somebody imports a checked set. Deliberate — see
  [[compliance-and-evidence]].
- **"50 services" was a customer count in this repo's six statements of it and is a
  *capability* requirement in the Ministry's** — confirmed 2026-08-18, all six corrected. ELI
  integration is gated on a review with no published end date, not on having fifty customers.
  See [[funding-and-billing]].
- ~~**Seven ELI/NSI specification documents are on disk and none has been read.**~~ **False
  within hours of being written** — they were decrypted and read on 2026-08-18 and the age-band
  rule came out of them. Corrected 2026-08-29. Item 38.
- **The seven-year retention window is now sourced; what it is measured *from* is not.**
  §6-3 gives the 7 years. Whether the clock starts when a child leaves — which is what the
  purge function does — is still an assumption. Item 3, narrowed 2026-08-14.
- **The twelve §6-3 criteria were extracted from a web page by a tool, not read by a
  person.** The verification feature is built on them. Item 36.
- **No airplane-mode drill has been run on a real device.** The contract the outbox relies
  on is tested; `expo-sqlite` is not.
- **Push notification delivery has never run once.** The data model and the quiet-hours logic
  are built and tested; delivery needs an EAS build on a real device.
- **The funding caps and periods are confirmed; the absence rules are not.** Item 6, narrowed
  2026-08-18: the 6/day, 20/week caps and their 3-to-under-6 age band are right, and the three
  four-monthly periods are known. `FUNDING_RULES_VERIFIED` stays `false` because the Frequent
  Absence and 3-Week Continuous Absence rules are not modelled at all. There are deliberately **no
  funding rates** anywhere in the product.
- **Two legal citations in the user-facing documents are unchecked.** The agent rule that
  makes the *centre* the responsible agency, and the section numbers and fine in the breach
  runbook. The substance of both is sound; the citations have not been read.
- **No screen reader has ever been used on this product.** axe passes on every page, which
  is a floor and not a pass.
- **The mobile workspace has no unit tests and no runner**, so `npm test` reports three green
  workspaces while covering none of the app that runs in the room. Item 20.
- **`drill:offline` has now run against live Postgres and passed 10/10 — item 21, closed
  2026-08-09.** Caught a real bug doing it: the drill's own centre lookup broke the moment
  this project held two centres with "albert" in the slug. What is still open is narrower:
  the `expo-sqlite` queue on a real device, which was always item 15's claim, not this one's.
- ~~**The mobile app has never run on a device.**~~ **False since 2026-08-18**, corrected here
  2026-08-29 — versionCode 4 booted, signed in, resolved the tenant and rendered the roll. What is
  still true is narrower and is what this line should have said all along: **nothing that needs a
  loaded roll has ever run**, because that phone had no children enrolled. Not the airplane-mode
  drill, not the sign-out refusal, not the chunked session storage, and `expo-sqlite` has still
  never executed. Two bugs in that path were already found by reading it. Item 15.
- **Two store-submission blockers are not code**: Apple wants a Support URL that does not exist,
  and a personal Play account needs twelve testers for fourteen days. ~~The ratio flag puts a
  disclaimer on the hero screenshot~~ — **cleared 2026-08-18**, and cleared the way item 16
  demanded rather than the way it warned against: Schedule 2 was read and the bands were correct.
  This summary said "three" for eleven days after it became two.
- **No adversarial security testing of any kind.** Sixteen automated checks pass; nobody has
  attacked it. Auth rate limits and session policy are unread Supabase defaults, and the
  service-role key has never been rotated.
- **Four claims this repo made in writing were not true.** Two were about mechanisms the
  database did not enforce; one was about where a file lived. All four are listed in item 14,
  because a compliance product that overstates itself is the exact failure this page exists
  to prevent.
- **The ERO transfer is confirmed; the April 2026 criteria renumbering is not.** Regulatory
  functions for ECE move from the Ministry to ERO on 1 September 2026, fixed by Order in
  Council — checked against the Ministry on 2026-08-30. The renumbering, inherited from the
  same `salix` research session, is still unchecked. Item 8.
- **Neither switcher importer parses a real export.** `import-storypark.ts` and
  `import-discover.ts` define their own intake shapes rather than a sourced vendor format —
  this repo has never seen a real export from either product, and "Discover" is not even a
  specifically identified one. Items 31 and 32.
- **The five Te Whāriki strand names have not been diffed against a primary source, and
  `messages/mi.json` is entirely placeholder text.** The i18n infrastructure exists and is
  proven against one real page; no te reo Māori translation exists anywhere in the product.
  Items 33 and 34.

## Details

### 1. Ratio bands — **CLOSED 2026-08-18.** The bands were right; a missing row was not

The repo's headline open item since day one, and the outcome is the boring one: every
published row matched. What the reading actually bought was a rule nobody knew was absent.

| | |
|---|---|
| **Read** | Schedule 2 of the Education (Early Childhood Services) Regulations 2008, from legislation.govt.nz, **version as at 29 June 2026** — which includes the 23 February 2026 amendment made by s 14 of the Education and Training (Early Childhood Education Reform) Amendment Act 2025 |
| **Method** | Transcribed row by row and diffed against `UNDER_TWO_TABLE` / `TWO_AND_OVER_TABLE`. Not recalled, and not a tool's summary — the failure mode item 36 records |
| **Result** | **All-day centre-based bands correct.** Under 2: 1–5→1, 6–10→2, 11–15→3, 16–20→4, 21–25→5. Two and over: 1–6→1, 7–20→2, 21–30→3, 31–40→4, 41–50→5, and thereafter one per ten, which reproduces every printed row to 141–150→15 |
| **State** | `RATIO_TABLES_VERIFIED = true` |

**What the reading found, and it was not in the tables.** Schedule 2 carries a row this
product did not have: *"Up to 3 children of mixed ages … 1"*. Two infants and a
three-year-old need **one** adult, not the two that summing the bands produces. The
product had been reporting a breach on a legal room — and an indicator that calls a
compliant room non-compliant is one people learn to dismiss, which costs exactly the
morning it is right. A unit test had the wrong behaviour written into it as an assertion,
with a comment explaining the wrong reasoning; both are corrected.

**A correction to this page's own mitigation.** It used to say the two bands were
"computed separately and summed, which is the conservative reading". Summing is not a
reading — the schedule states it, in as many words: *"Sum of minimum staffing requirement
for relevant number of children under 2 years old … and minimum staffing requirement for
relevant number of children of or over 2 years old"*. The guess was right and its stated
basis was invented. A claimed safety margin that does not exist is worse than no claim.

**What `verified` does not cover** — each tagged `TODO(ratios)` in `ratios.ts`:

- **Sessional** tables, which differ for 2-and-over: 1–8→1, 9–30→2, 31–45→3, 46–60→4,
  61–75→5, and so on to 136–150→10. Under-2 sessional is identical to all-day. Little
  Pearls is all-day, so this is a gap for the next customer rather than this one.
- **Home-based**: under 2 is 1–2→1, two-and-over 1–4→1, mixed 1–4→1. A different shape
  entirely, and one of the licence types the ELI capability requirement names.
- **Regulation 44A**, spare under-2 capacity offsetting the 2-and-over count, and
  **regulation 54(4)**, the sibling rules. Both are exceptions that make the requirement
  *lower*, so not modelling them is the safe direction — the product asks for more adults
  than the law does, never fewer.
- **Who counts, which is about the inputs and not the tables.** Every person present aged
  under 6 counts as a child, *including a staff member's own child*, who is on no roll and
  in no attendance event. An adult must be 17 or older, doing something other than food
  service, admin or maintenance, and **does not count while at lunch, on a break, or on
  non-contact time**. This product counts enrolled children who were signed in, and takes
  the adult count as a typed figure.

That last one does not close by checking a number, so it replaced the blanket notice
rather than disappearing with it: `ratioInputCaveat()` renders on every ratio surface and
says what the figure cannot see. **A false caveat is worse than none** — leaving "these
figures have not been checked" on screen after they had been checked would teach people
that the warnings on that screen are decoration.

**The flag still exists and is still load-bearing.** A centre operating under a licence
variation passes its own table into `assessRatio`, and that table has been read by nobody.

### 2. Licensing criteria — absent, on purpose

The criteria run to several dozen numbered items and were renumbered in 2026. This repo
contains none of them, and `0012_compliance.sql` seeds nothing.

Inventing plausible criterion numbers would let a centre assemble an evidence binder
against a list that looks official and is not — a worse outcome than an empty feature. So
the dashboard states the gap and `npm run import:criteria` loads a set from a file that
must carry a `source`.

**To close it:** obtain the current criteria, write the JSON, import with `--make-current`.
Include `supersedesCode` per entry — the old-to-new mapping is what keeps evidence filed
under the previous numbering findable. This is content work, not code.

### 3. Retention period — seven years is a guess

`children_due_for_purge(p_retention_years integer default 7)` in
`supabase/migrations/0008_retention.sql`. The assumption is that funding-relevant records must
survive a Ministry funding audit and that the window is seven years from the date a child
leaves.

It is a **parameter rather than a constant** precisely so it can be corrected without a
migration. **To close it:** check the current ECE Funding Handbook and either confirm 7 or
change the default, recording the source in the migration comment.

**NARROWED 2026-08-14 — the number is sourced; the anchor still is not.** ECE Funding
Handbook §6-3 states *"Attendance records must be kept for 7 years"*, and its criterion 10
repeats it for electronic records: *"Electronic attendance records must be retained for 7
years without any loss of integrity."* Retrieved 2026-08-14, subject to item 36's caveat
about how.

So **7 is no longer a guess** — for attendance records. What remains assumed is the part the
purge function actually depends on: that the clock starts *from the date a child leaves*
rather than from the date each record was made, and that the same window governs the other
child data `children_due_for_purge` reaches. §6-3 says how long an attendance record is kept.
It does not say either of those things.

**To close the remainder:** find the anchor in the Handbook — Chapter 11 on record keeping is
the likely home — and either confirm the leaving-date reading or change the function to age
records individually.

See [[privacy-and-retention]] for the surrounding design, including a correction already
made to an earlier wrong claim about the Privacy Act.

**2026-08-31 — this is now one leg of a stated Ministry condition.** The reply that closed item 37
permits Chapter 6 records outside an approved SMS only where *"records are available for audit and
retained in accordance with Ministry requirements"*. Two open items sit under that clause: the
retention anchor here, and item 44's finding that a backup of the operational core older than
fourteen days will not load. Retained and *restorable* are the same requirement read carefully.

### 4. Offline: no device drill

`npm run drill:offline` replays exactly what the outbox does — keys fixed up front, reused
on retry, a forced double flush — against the real database, and passes 10/10. What it does
**not** exercise is the `expo-sqlite` layer, which needs a tablet or a simulator.

**To close it:** put a device in airplane mode, sign three children in, restore the
connection, confirm exactly three events landed and the times survived. See
[[offline-outbox]].

### 5. Push notifications: built, never executed

| | |
|---|---|
| **What exists** | `push_tokens`, `notification_preferences` with quiet hours, a `notifications` queue, `apps/mobile/lib/push.ts`, and quiet-hours logic with 17 tests |
| **What has never happened** | A single notification being delivered to a device |
| **Why** | Expo push needs a token from a real build. **Corrected 2026-08-29: this project HAS been through EAS** — four finished production AABs, versionCode 2–5. The build stopped being the blocker on 12 August. What remains: no build has ever been asked for a push token on a device, and there is no worker — nothing reads the queue and calls Expo's API |
| **To close it** | A device, a token, and a worker. Then send one and watch it arrive. ~~`apps/mobile/eas.json` now exists with the profiles chosen and commented — it has never been executed, so it is configuration and not progress~~ **— false since 2026-08-12, and still being quoted as current on 2026-08-29.** `eas.json` has been executed four times. It is progress; the build is not what is missing |

The quiet-hours arithmetic *is* verified, including the case that is normally written wrongly — a
window that wraps midnight (20:00 → 07:00), evaluated in the centre's timezone across both sides of
the daylight-saving switch. That part is real; delivery is not.

Two design decisions were made on the assumption they are right and have not been tested against a
real device: that suppressing foreground banners is the correct behaviour, and that a `DEFAULT`
importance Android channel with no sound override is right for notices about a child's day. Both are
judgement calls about not training people to silence the app.

### 6. Funding caps and period boundaries — **narrowed 2026-08-18**

The caps were right. What the check found was a rule nobody had noticed was missing.

| | |
|---|---|
| **Confirmed 2026-08-18** | 20 Hours ECE at 6 hours per day and 20 per week, **for a child aged 3 or older and under 6** — a Ministry business rule, from the specifications the Ministry supplied. `DEFAULT_CAPS` was correct and its basis string now names the source |
| **Also confirmed** | The three four-monthly funding periods: February–May, June–September, October–January. Now in `ministryFundingPeriods()`, offered rather than imposed — the period stays caller-supplied |
| **Read 2026-08-18** | Chapter 6 sections **6-4, 6-5 and 6-7**. The absence rules are now sourced, and they are real: funding may be claimed for hours a **permanently enrolled** child did not attend. For a **casual or conditional** child it is attendance only, and a booked no-show must never be claimed |
| **Still not implemented** | All of it. Funded hours come from attendance events, so an absent day contributes zero. For a casual child that is **exactly right**; for a permanently enrolled child it **under-claims** |
| ~~**The blocker is the schema**~~ **Half-cleared 2026-09-03** | ~~`enrolments` has no permanent/casual distinction — the word "casual" appears nowhere in this repo — and 6-4 turns on precisely that axis.~~ `0084` adds `enrolment_type` with the three values transcribed from §6-4, a CHECK refusing a fourth, and **null meaning not stated rather than permanent** — so a child nobody has classified stays ineligible for absence funding, which is the direction that under-claims. What remains is the rules themselves: the three-week window (§6-5), its suspension while the service is closed (§6-6), the monthly frequent-absence check against the enrolment agreement (§6-7), a reconfirmation record that is a dated act by a named person, and the enrolment agreement as an effective-dated weekday pattern. Plus §6-4's cross-child rule, which no per-child calculation can express |
| **How the product behaves** | `FUNDING_RULES_VERIFIED` stays **`false`**, and the disclaimer no longer says the caps are unchecked (they are checked). It now names the actual gap: the figures count attended hours only, and a service may be entitled to claim more |
| **To close it** | Build it, or decide absence funding is out of scope and say so in the product. Building it needs an enrolment type, a three-week window per absence spell, monthly frequent-absence checks and a record of reconfirmations — a feature with decisions in it, not a patch |

**The age band was not checked anywhere, and that was a real gap.** `twenty_hours_ece` is a boolean
a centre ticks on the enrolment, and until 2026-08-18 nothing compared it against the child's age.
A mis-ticked two-year-old produced capped 20 Hours figures for a child with no entitlement, against
a rule the Ministry checks automatically and raises with vendors.

The fix **names it and leaves the arithmetic alone**: `ineligibleDates` per child, computed with the
age as at each day rather than as at today — a child who turned three in March was not entitled in
February, the same reasoning `replayDay` applies to the ratio bands. The hours are still counted,
because the hours are not in doubt; only the entitlement is, and the attestation belongs to the
centre. Excluding them would be the estimating this product refuses to do.

**Funding periods are offered, not imposed.** The boundaries are known now, so a manager no longer
has to invent a date range on an official-looking figure — but an arbitrary window stays available,
because a period that cannot be chosen is a screen somebody works around.

**There are no funding rates anywhere.** Not one dollar-per-child-hour. A rate is a number the
Ministry publishes and changes, and inventing one would let a centre budget against a figure this
product made up. Rates live in a fee schedule the centre enters, or nowhere.

Two mitigations that make the maths safe even while the caps are wrong: nothing is ever estimated
(a day whose record is incomplete is excluded and named, never guessed), and every rounding
decision goes **down**, so an error in the caps cannot combine with a rounding error to over-claim.

**2026-08-31 — this is the weakest of the four conditions the Ministry named.** Closing item 37
came with a condition that *"the system enables the service to comply with all Chapter 6
record-keeping requirements"*, and §6-4 to §6-7 are Chapter 6. Not modelled is not the same as not
required. Two things keep this honest rather than alarming: the gap **under**-claims, which is a
loss to the centre and never a false claim against the Crown, and the product says so on the
document itself. The same reply also names *"under-claiming"* as something the service must
understand and address — so the disclaimer written here on 2026-08-18 turns out to be the exact
disclosure the Ministry expects. What is now clear is that building the absence rules is the
difference between supporting Chapter 6 and enabling compliance with all of it.

### 7. Warning lead times for expiring documents

`WARNING_DAYS` in `packages/core/src/compliance.ts` — 120 days for police vetting and
safety checks, 90 for practising certificates, 45 for first aid. These are **judgements
about how long renewal takes**, not claims about how long a certificate is valid, and the
schema deliberately holds no validity periods at all.

Lower stakes than the others: being early is harmless, and being late is visible. Worth
adjusting from experience rather than from a source.

### 8. Regulatory context inherited from another repo — half closed 2026-08-30

The product plan in `salix/llm-wiki/wiki/possible-projects/ece-early-learning-app.md`
asserts that the licensing criteria were renumbered on 20 April 2026 and that ERO takes
over as regulator on 1 September 2026. Both were researched in that session; neither had
been re-checked here until now. They matter because they are the timing argument for the
whole product.

**The ERO half is confirmed.** Regulatory functions for early childhood education services,
private schools and school hostels move from the Ministry to ERO on **1 September 2026**.
The Education and Training (System Reform) Amendment Act 2026 came into force on 6 July 2026
and an Order in Council fixed the commencement date. What transfers is the licensing of ECE
services, the certification of playgroups, and the **Director of Regulation** role; the
Ministry keeps ECE policy and the curriculum. Source: [Some Ministry regulatory functions
transfer to Education Review
Office](https://www.education.govt.nz/news/some-ministry-regulatory-functions-transfer-education-review-office).

**The worry this item carried was wrong, and that is worth recording.** It used to say that
if the transfer were real, "the evidence binder's framing may need to change with the
regulator". It does not. `/compliance/binder` addresses *"a reviewer"* and names no regulator
anywhere; every other Ministry reference in the product is either the service number — an
identifier, unaffected — or funding and ELI, which stay with the Ministry. Checked across
`apps/` and `packages/` on 2026-08-30. **No code change is required by this transfer.**

**The criteria renumbering is still open.** The Ministry's transfer announcement says nothing
about a 20 April 2026 renumbering — checked and not found, which is not the same as
disproved. The exposure is narrow but real: `criteria` (0012) ships empty and is loaded only
from a file a human has checked, so a stale numbering cannot reach a screen on its own — but
it can reach the file somebody prepares. **To close it:** confirm the current numbering
against a Ministry source before any criteria set is loaded.

### 9. Things believed on one customer's word

Phase 1 built enrolment, which the product plan's Stage 0 advised against until ten
conversations with centres had happened. Those conversations did not happen; the work
proceeded on the strength of one pilot customer who is a personal contact and who is not
paying.

That is defensible for a free pilot and a weak basis for pricing. It is recorded here
because it is the same class of error as an unverified figure: a decision resting on
evidence nobody has gathered.

### 10. The agent rule, in the privacy statement

| | |
|---|---|
| **What is asserted** | Information held by Salix as agent for a centre is, in law, held by the centre — so the centre is the agency answerable to families and to the Commissioner |
| **Where** | `docs/privacy-statement.md`, and it underpins the whole structure of that document |
| **Basis** | Confident from general knowledge of the Privacy Act 2020. The **section number has not been read.** The equivalent in the 1993 Act was s 3(4) |
| **Why it matters** | It decides who notifies a family after a breach, and it is the paragraph the services agreement has to match. Getting the substance right and the citation wrong in a document a family reads is a credibility problem even when the conclusion holds |
| **To close it** | Read the Act, put the correct reference in, and make the services agreement say the same thing |

### 11. The breach runbook's legal specifics

| | |
|---|---|
| **What is asserted** | A serious-harm test; notification to the Privacy Commissioner *and* to affected individuals as soon as practicable; an offence with a fine for failing to notify |
| **Where** | `docs/breach-response.md` |
| **Basis** | Part 6 of the Privacy Act 2020. The **substance is not in doubt**; the exact sections and the exact maximum fine have not been checked |
| **How the document behaves** | Says so, in a block quote, at the top |
| **To close it** | Read Part 6. Correct the numbers, or remove them and keep the substance |

### 12. Accessibility: automation only

| | |
|---|---|
| **What exists** | A WCAG 2.2 AA audit with axe-core over **21 screens** (`/census` and `/account` both added 2026-09-03, the latter having had no coverage of any kind), both roles, with data loaded, including two error states. Green, with no advisory warnings — **but read the row below before quoting a figure from this one** |
| **The figure this row used to give** | *"30/30 green"*, and it had been unreproducible for six days when somebody finally tried. From 2026-08-28 to 2026-09-03 every navigation in the suite timed out: an unread `fetch` response body in `SyncStatus` left a request in flight on every authenticated page, so `networkidle` could never be satisfied. **The audit was not passing; it was not running.** Item 41 has the diagnosis. The lesson for *this* page is narrower and sharper than the bug: a row that records a past green run is indistinguishable from a row that records a green run *today*, and this one was wrong for six days without changing a character |
| **What has never happened** | Anyone using this product with a screen reader, or completing a task with a keyboard alone |
| **Why it matters** | axe finds somewhere between a third and a half of WCAG failures. It is good at contrast, names, roles and structure. It cannot tell whether a focus order makes sense, whether an error message helps, or whether the ratio banner announces at a useful moment. A green run is a floor |
| **To close it** | A pass with NVDA or VoiceOver on the daily screens — sign a child in, read a ratio, open a child's allergies — and a keyboard-only pass on the enrolment form |

### 13. Security: sixteen automated checks are not an adversary

| | |
|---|---|
| **What exists** | `npm run review:security` — sixteen checks against the live schema, all clean. The RLS suite, whose assertion count the runner prints and this row deliberately no longer restates — it said **176** while the suite was at 632, and three other pages gave three other numbers. An end-to-end suite covering four roles, **117 passing and 1 failing as at 2026-09-03**. No secret in any bundle, no XSS sink, every definer function pinned |
| **What has never happened** | Any adversarial testing at all. No penetration test, no external review, no attempt to enumerate storage objects or traverse an object path, no attempt to forge a JWT |
| **Also unread** | Supabase Auth's rate limits, session lifetime, refresh-token rotation and password policy are all defaults that nobody on this project has looked at. The service-role key has never been rotated. The personal access token the migration runner uses is account-wide, which is far more authority than this project needs |
| **Why it matters** | The checks verify the invariants somebody thought of. Four of the five findings in the Phase 6 review were things nobody had thought of, and each one was found by *running* something rather than by reasoning |
| **To close it** | Rotate the keys and scope the token. Read the auth settings. Then, before real child data: an external review, or at minimum a deliberate adversarial pass by somebody who did not write this |

### 14. The claims this repo made that were not true

Not a gap in the product — a gap in what the documentation asserted, which is worth its own
entry because it is the failure mode the whole honesty apparatus is supposed to prevent.

| Claim | Where | Reality |
|---|---|---|
| "An issued invoice freezes" | Phase 5 commit, README | The line policy required draft; nothing stopped the status going back to it. Fixed in `0021` |
| "An issued invoice freezes", **the second time** | README, [[funding-and-billing]], and this table's own first row | `invoice_lines_write` was `FOR ALL` with `status = 'draft'` in its WITH CHECK only — and PostgreSQL checks USING for DELETE. So a line could be **deleted** from an issued invoice for five phases. `0022` preserved the asymmetry faithfully when it split the policy by verb. Fixed in `0025`, with an assertion on the verb and a second on the class |
| "An issued invoice freezes", **the third statement of it** | README, [[funding-and-billing]] | See the row above. Two mechanisms were claimed and the third verb was open |
| "The outbox carries a `user_id` and every read is scoped to the signed-in user" | [[offline-outbox]] | True of mobile. The **web** outbox had no `userId` at all — on the app that runs on the tablet by the door. Fixed 2026-08-07 |
| "Sign-out uses `scope: 'local'` so it does not touch the person's phone" | [[offline-outbox]] | True of mobile. The web app called `signOut()` with no argument, and the default is global. Fixed 2026-08-07 |
| "Dead entries are named in the dialog and then let go" | `SignOutControl` | The dialog only opened when sign-out was refused, and a dead-only queue is allowed — so they were discarded with nothing shown. Fixed 2026-08-07 |
| "The recovery link stands in for the current password" | `reset-password/actions.ts`, [[password-recovery]] | Nothing checked that a link had been used. Any signed-in session could set a new password. Fixed 2026-08-07 |
| "A time input gives HH:MM anchored to the browser's clock" | `attendance/actions.ts` | The input is `datetime-local` and the code is a server action, so it parsed in the server's zone — UTC in production, putting every correction 12-13 hours out. Fixed 2026-08-07 |
| "The e2e suite has a test for exactly that (CSP violations)" | `docs/deploy-railway.md` | It tested a route that could not fail, while four prerendered routes had every script blocked. Fixed 2026-08-07 |
| "`apps/site` has no Supabase dependency, so there is nothing for a credential to be used by" | `deploy-railway.md`, `railway.site.json`, `api/health/route.ts`, `securityHeaders.ts` | False from the moment the careers form shipped, and it sat twenty lines below a table marking two Supabase variables required. Corrected 2026-08-07 |
| "All ten site routes pass axe at 390px and 1440px" | [[public-website]] | True when written, and a **one-off run** rather than anything repeatable — so it was a claim about a moment. Now `npm run audit:site`, and the site workspace has a test runner where it previously had none |
| The first two days of `audit:site` results | the runs themselves | Measured an **unstyled page** (`domcontentloaded`, and later a stale build served by an orphaned server), so every contrast check passed trivially and every link failed target-size. Neither the passes nor the failures meant anything. Fixed 2026-08-07, and the audit now refuses to report when the stylesheet is absent |
| "The audit trigger records every consequential change" | implied throughout | It covered ten tables while the schema had twenty-two. `staff_records` — the licensing evidence — was uncovered. Fixed in `0021` |
| "The pre-wipe backup sat in OneDrive and was therefore copied to Microsoft" | README, two wiki pages, and said aloud twice | Wrong. This repository is at `C:\dev\ece`, which is not synced; the OneDrive repository is a different one. The file never left local disk. Deleted 2026-08-04 |
| "Every other `FOR ALL` policy is narrower than its select policy" | Phase 4 commit | True when written, and it was a statement about fourteen hand-read expressions rather than about the design. `0022` removes the shape instead |

**The pattern:** each of these was a claim about a *mechanism* derived from reading the code
that implements it. The two that were false in substance were caught by asking the database;
the OneDrive one was caught by running `pwd`. None was caught by review.

**To close it:** nothing to build. The lesson is that a claim about what the product enforces
belongs next to a test that fails when it stops being true — which is now the case for the
first two, and is why `review:security` and `test:rls` both assert them.

### 15. The mobile app has now run on a device — **PARTIALLY CLOSED 2026-08-18**

| | |
|---|---|
| **What exists** | A sign-in screen, role-aware navigation, the roll, the whānau surface, and an outbox whose two most consequential decisions are pure functions in `@ece/core` with tests |
| **What has now happened** | **2026-08-18: versionCode 4 was installed on an Android phone and it ran.** It booted, signed in, resolved the tenant, and rendered the Roll screen for Little Pearls Mt Albert with an empty roll. Everything from module load through auth, tenant resolution and the ratio bar is therefore executed code rather than reasoned-about code, for the first time. **UPDATED 2026-08-12: a build now exists** — an EAS production AAB. **Corrected 2026-08-18: not "the first ever produced".** `eas build:list` shows two finished production AABs on 2026-08-12, versionCode 2 and 3, and a third at versionCode 4 built on 2026-08-18. A small error, recorded because this is the page that is supposed to be exact about what has and has not happened, and because a count nobody checked is the same class of claim as a figure nobody sourced. The app has still never *run* anywhere, so everything below stands unchanged; three artefacts are not an execution. **Corrected a second time, 2026-08-29: the count was wrong again — there are FOUR.** `eas build:list` shows **versionCode 5 at commit `929bb89`, finished 18 August 19:57**, thirty-four minutes after versionCode 4. That is the rebuild `929bb89`'s own message said the ratio-caveat fix would need in order to appear, and nobody recorded that it happened. Correcting a count and then getting the next one wrong is the same mistake twice, so the rule is now explicit: **this number comes from `eas build:list`, never from memory.** versionCode 5 has been built and installed on nothing. **2026-08-29: versionCode 6, commit `655219c`, finished 19:03 — five artefacts now, and this one was inspected.** Config inlined, `EXPO_PUBLIC_SUPABASE_URL` absent, `service_role` absent in **both encodings**, and the consent fix present. Native fingerprint `58befaf8…`, byte-identical across all five, so nothing native has changed since 12 August. **Installed on nothing** |
| **And the first artefact could not have run** | Inspecting that AAB found the variable *name* `EXPO_PUBLIC_SUPABASE_URL` in the bundle and neither value. `lib/supabase.ts` looked its config up with a computed `process.env[name]`, which Metro cannot see, so nothing was ever inlined and any built binary threw at module load before rendering. Correct in development, where a dev server populates `process.env` at runtime, and only there. Fixed; the point for this page is that **item 15 was understating it** — the app had not merely never run, it could not have |
| **Specifically unverified** | The airplane-mode drill (three sign-ins offline, reconnect, exactly three events, no duplicates after a forced double flush); the sign-out refusal; whether the Supabase session is even large enough to take the chunked SecureStore path — if it never chunks, that code has never run either; `AppState` behaviour on `inactive → active` after the app switcher; keyboard behaviour on the sign-in form; and cold-start-to-roll-visible, which is a claim about a number nobody has measured |
| **Why it matters** | The offline outbox is the app's whole reason to exist, and `expo-sqlite` cannot execute in this repo's test runner. Two bugs were already found in that code path by reading it — a clock-drift misclassification and a cross-user attribution — which is a fair indication of what an unexercised path holds |
| **What is still not verified** | Everything that needs a *loaded* roll. The device run had no children enrolled, so nothing was signed in, nothing was queued, and `expo-sqlite` still has not executed. The airplane-mode drill, the sign-out refusal, the chunked SecureStore path, `AppState` on `inactive → active`, and cold-start-to-roll-visible all stand exactly as listed above |
| **To close the rest** | Seed or enrol a child against this tenant, then the drill: airplane mode, three sign-ins, reconnect, confirm exactly three events with the times they happened and no duplicates after a forced double flush |
| **It found something on the first run, as predicted** | Two things. **A defect introduced the same day:** the mobile ratio bar's caveat was gated on `!ratio.verified`, and flipping `RATIO_TABLES_VERIFIED` for item 1 silenced it as a side effect — seven *web* surfaces were given the replacement caveat and the mobile bar was not. The screen an educator reads in the room went quiet while the office screen said more, which is backwards. Fixed by rendering `ratioInputCaveat()` here too. **And one still undiagnosed:** every tab label carries a missing-glyph box above it. `StaffTabs` sets no icons deliberately and the installed `BottomTabItem` returns `null` when none is given, so it is not a JS placeholder; `✓` and `·` render correctly on the same screen, so it is not a font gap. Suspected native Android tab bar via `react-native-screens`, **not confirmed** — and not written up as fact until it is. **2026-08-29: the test is now riding versionCode 6.** `tabBarIcon: () => null` is committed to both navigators, labelled a probe rather than a fix, because the only instrument that can answer this is a build. Two outcomes to look for and they are not the same: the box gone is the hypothesis confirmed; the box gone but the labels sitting lower is the probe itself, since supplying the function makes `icon !== undefined` and the JS path starts rendering an empty icon container. If the box survives, delete the two lines. **Built 2026-08-29 as versionCode 6 and not yet installed** — the probe is in an artefact and has answered nothing, which is the same distinction this page exists to keep |

### 16. Store submission has three blockers that are not code

| | |
|---|---|
| **1. ~~The hero screenshot disclaims the product~~ — CLEARED 2026-08-18** | This read: `RATIO_TABLES_VERIFIED` is `false`, so any roll screenshot with children present carries "these ratio figures have not been checked against the regulations yet", next to listing copy promising the app warns you before the limit — making Schedule 2 a submission prerequisite. Schedule 2 has now been read and the flag is `true`, so the disclaimer is gone. **It was cleared the way the entry demanded and not the way it warned against:** the bands were checked, found correct, and a missing rule was added. What a roll screenshot now carries instead is the narrower input caveat, which says what the count cannot see rather than doubting the tables — a sentence a store reviewer can read without it reading as a confession |
| **2. Apple requires a Support URL** | Nothing in this repo mentions one. It is a fourth hosted page alongside the privacy statement and the deletion-request route, and it is also where "there is no public sign-up, ask your centre" gets said to a reviewer |
| **3. A personal Play account cannot publish quickly** | An account created after November 2023 must run a closed test with 12 testers for 14 continuous days before production. If the account is personal, "a public listing now" has a two-week floor regardless of what the code does. Verify at the console — the rule has moved before |
| **Also** | ~~Zero image files exist in the repo~~ — **fixed 2026-08-12**: `icon`, `adaptive-icon` and `notification-icon` are generated from `MARK` by `npm run icons:mobile`. `expo-splash-screen` is still not a dependency, `eas.json` still declares update channels while `expo-updates` is not installed (EAS warns on every build), and `seed-demo` seeds no attendance so the demo roll is empty — a reviewer signing in would see what looks like a broken app |
| **And a fourth, found by trying** | **`eas.json` had never been valid.** It carried this repo's house-style `"//"` comment arrays, and EAS validates its schema strictly: `"//" is not allowed`, on every profile. Railway tolerates unknown keys and had trained the habit. So the file the wiki called "configuration and not progress" was configuration **no EAS command could read** — `eas init` refused before it did anything. The reasoning moved to `docs/store-listing.md`; the file is now plain JSON |
| **To close it** | Read Schedule 2; host four pages; decide the account type knowingly; generate the assets; extend the demo seed to produce a deliberate at-limit ratio |

### 17. Deleting an account would erase attribution in licensing evidence

Not a claim that is wrong — a consequence nobody had noticed, found while designing the account
deletion Apple asks for.

| | |
|---|---|
| **The mechanism** | `audit_events.actor_id`, `attendance_events.recorded_by` and `staff_records.sighted_by` are all `on delete set null` against `auth.users` |
| **So** | Deleting a person's account anonymises every action they ever took: who signed a child in, who sighted a police vetting, who changed a health record. Silently, and in tables with no UPDATE grant, so it cannot be repaired |
| **Why it matters** | That attribution *is* the licensing evidence this product exists to produce. An account deletion feature built the obvious way would quietly destroy it |
| **To close it** | A tombstone table holding the person's display name — not their email — outside the FK, so attribution survives a deletion. Plus a guard refusing to close the account of the only remaining owner of a centre, because creating a membership needs the service role and a self-service feature would otherwise brick a tenant |

### 18. Password reset emails have never been sent

The forgot-password flow (see [[password-recovery]]) calls Supabase's `resetPasswordForEmail`,
which sends through the project's mailer. No custom SMTP is configured, so that is Supabase's
built-in service — rate-limited to a handful of messages an hour and described by Supabase as
not for production. Nobody has requested a reset against the live project and received the
email.

| | |
|---|---|
| **The claim** | A user who taps "Send reset link" gets an email |
| **What is actually verified** | Everything after the email. Drilled on 2026-08-05 against live Postgres with a disposable account: a recovery token establishes a session at `/auth/confirm`, `/reset-password` refuses a short password and a mismatched confirmation, sets the new one, the new password signs in, the old one does not, and the link cannot be replayed. That the emailed link carries `?code=` rather than a fragment was confirmed from the installed SDK source, not the docs |
| **Still unverified** | That the mailer sends anything at all, and that the message arrives |
| **To close it** | Request a reset for a real account on the live project; check the mailbox and the auth logs. Before real centres depend on it, configure custom SMTP and verify again |

### 19. The product name has not been cleared — **NARROWED 2026-09-05, and the residual risk is now named rather than open-ended**

The design handoff gives the product a working name, **Doorway**, and says in its own first
paragraph that the name has not been trademark- or domain-checked.

**CORRECTED 2026-08-07 — this entry used to say there was no exposure.** It read: "Nothing in this
repo uses it yet — the web app still says 'ECE Platform' — so there is no exposure today, and that
is exactly why it is worth recording before a screen, a store listing or a manifest starts carrying
it." That is no longer true, and the thing it warned about has happened rather than been prevented.

The public website now carries the name **and the mark** in the masthead of all ten routes — "Sign
in to Doorway", plus two mentions in body copy on `/enrolment` and `/contact`. That is not an
internal screen behind a login. It is a real childcare service's public marketing site, at their own
domain, in front of anybody who visits, and it went up before the IPONZ search was run. See
[[public-website]] for why the link was promoted.

The risk is small and it is not nil, and it is now asymmetric in a way it was not before: if the
name has to change, it changes on a customer's live site rather than in a repo.

**UPDATED 2026-08-11 — one of the three checks is now done, and the name was adopted on that
basis.** The owner confirmed `doorway.co.nz` is available and instructed the product to take the
name. **That premise was false — see the correction below.** It now appears in the console's
`<title>`, its favicon and home-screen icon, the rail above every screen, and the mobile app's
display name — where before it was only on the public website.

**A domain being free is not a trade mark search.** Availability at the registrar says nothing
about whether somebody holds a registered mark for "Doorway" in a class covering software or
education services, and it is the mark, not the domain, that can force a rename. The two
remaining checks are unchanged and are now behind more exposure than when they were first
recorded.

**A TRADE MARK CHECK WAS RUN, 2026-08-11 — and it is good news that is not a clearance.**

The owner ran IPONZ's free *Trade Mark Check* on the word **doorway**, with **no goods or
services class selected**. It returned 25 marks, ordered closest-matches-first, and the result
that matters is a negative: **no identical `DOORWAY` word mark appeared.** The top of a
closest-first list was `STAPLES RODWAY`, which is the matcher saying it found nothing nearer —
an exact mark would have sorted first. The near neighbours are phonetic and visual:
`DOO-AWAY / DOO AWAY / DOOAWAY` (Jassal Limited), `Deerway` (Quanzhou Newbarlun Sports Goods),
`QUAI D'ORSAY`, and four unrelated `NORWAY` marks.

That materially lowers the risk. It does not close the item, for three reasons that are on the
tool's own page rather than invented here:

1. **No class was selected**, and co-existence is decided on classes. IPONZ's own next step on
   that screen is "Select a goods or service class", and its wording is that a mark "might be
   able to co-exist if it's for different goods or services". The question this product actually
   needs asked — *can it co-exist in software and education services* — has not been asked. The
   classes worth checking are **9** (downloadable software), **42** (software as a service),
   **41** (education services) and possibly **35** (business administration).
2. **Only the first 8 of 25 results were seen.** The ordering makes an exact match below them
   very unlikely; "very unlikely" is not the same claim as "checked".
3. **This is the free pre-application check**, which offers a paid IPONZ search as its own next
   step. It is a screen, not an opinion.

**CORRECTED 2026-08-11, later the same day — `doorway.co.nz` is *not* available, and the one
check this entry recorded as done was the one that was wrong.**

A registrar's search page returned `doorway.co.nz is unavailable`. The .nz registry agrees, and
says considerably more than the registrar's page did. From `whois.srs.net.nz`, queried directly:

```
Domain Name:      doorway.co.nz
Registrar:        1st Domains Limited
Creation Date:    2024-07-04     Original Created: 2006-06-02
Updated Date:     2026-07-04
Domain Status:    pendingDelete, redemptionPeriod, serverHold,
                  serverRenewProhibited, serverUpdateProhibited
Name Server:      ns1.afternic.com, ns2.afternic.com
```

Three things follow, and they do not all point the same way.

1. **It is registered today, so the check recorded above as verified was not.** How the earlier
   "available" reading was obtained is not known; it is not what the registry says.
2. **It is in the drop cycle, not in use.** `redemptionPeriod` and `pendingDelete` are the states
   a lapsed name passes through, `serverHold` means it is delegated nowhere, and the Updated Date
   of 2026-07-04 is when it lapsed. .nz holds an expired name for a pending-release period before
   it is released first-come-first-served — **90 days is the figure to check, not one this repo
   has confirmed**, which would put release in the first days of October 2026. Verify with a
   registrar or the Domain Name Commission before anyone plans around it.
3. **The holder is not a business called Doorway, so this does not raise the trade mark risk.**
   The nameservers are Afternic — GoDaddy's aftermarket. The name was listed for sale, did not
   sell, and was not renewed. `Original Created: 2006-06-02` against `Creation Date: 2024-07-04`
   says it has already dropped once and been caught by a reseller. A parked domain is evidence
   of a speculator, not of a competing user of the word.

**`doorway.nz` is registered and is not a business.** Registered 2020-11-17 through Webcentral
(AU), on Cloudflare nameservers, locked `clientDelete/Transfer/UpdateProhibited`. An earlier
draft of this paragraph said "somebody is using it" and called it the thing worth looking into,
on the reasoning that a locked domain on real nameservers is closer to a trading name than a
parking page. **That inference was wrong, and fetching the site is what settled it.** `https://doorway.nz`
returns 384 bytes: a `<frameset>` pointing at `jsp.netregistry.net/theBizCard.jsp`, with an empty
`<title>` and empty keywords and description. That is Netregistry's default placeholder. MX is
`mx2/mx3.partnerconsole.net`, the same registrar's default mail. Six years registered, nothing
built.

So **no identical name is in commercial use in New Zealand on either domain** — one is a
speculator's lapsed inventory, the other is a registrar's default page. That is not a trade mark
clearance and does not substitute for the class search below; a registered mark need not own a
website. But the specific worry that somebody is already trading as Doorway is answered: no.

**`doorwayy.co.nz` was reported unavailable and the registry says otherwise** — `Not found`, i.e.
unregistered. Recorded because the disagreement is the point. A registrar's search page was
consulted three times on 2026-08-11 and disagreed with the registry twice: it called
`doorwayy.co.nz` taken when it is free, and `doorway.nz` free when it has been registered since
2020 and answers HTTP 200. **Ask the registry, or the Domain Name Commission's own lookup — not a
seller's search box.** For `doorway.nz` the registry record, an SOA, live A records at Cloudflare
and a 200 response are four independent signals and they agree; a registrar showing "available"
against that is either a second-level-`.nz` parsing bug or a brokerage listing, which is a
different claim wearing the same word.

Also `Not found` at 2026-08-11: `doorway.net.nz`, `doorway.org.nz`, `doorway.kiwi.nz`, and
`getdoorway` / `usedoorway` / `doorwayapp` / `doorwayece` / `trydoorway` / `doorwayhq` `.co.nz`.
Listed as fact, not as a recommendation — none has been checked against anything but the registry.

**THE PUBLIC EXPOSURE IS GONE, 2026-08-16 — the name is off the customer's website.** On the
owner's instruction, and it is the first time an entry on this page has been closed by *removing*
the thing rather than by checking it.

What went: the masthead label on all ten routes, the mark beside it, and the two body-copy sentences
on `/enrolment` and `/contact`.

**CORRECTED LATER THE SAME DAY — the link is gone too, and this entry said it had stayed.** The
paragraph here read: "What stayed: the link itself, which now reads *Sign in to the centre app* …
Removing the way in would have cost the families and kaiako already at the centre the one link they
open the site for, and the instruction was about the name, not the link." That reasoning was mine
and the owner's instruction was broader: the site is not to refer to the app **at all** yet. So the
masthead control, the footer link and the remaining unnamed sentences on `/enrolment` and
`/contact` are all off. There is now no mention of the app anywhere on the public site — asserted
across all nine routes by a check that greps the rendered text and every `href`.

What is still there is the *infrastructure*, which nobody asked to remove: `middleware.ts` still
mounts the app at `/portal` on this hostname, `SITE_APP_URL` still resolves, `/api/health` still
reports on it, and `appUrl()` still works with no caller — see the note on it in
`apps/site/src/lib/site.ts` for why it was kept rather than deleted. Restoring the link is one
element; restoring the plumbing would not have been.

The asymmetry this entry was written to warn about is therefore reversed. A rename is once again a
change to a repo rather than to a customer's live, indexed, archived marketing site. The console,
the icons and the mobile app still carry it — that is a screen behind a login, which is where this
entry said the risk was acceptable.

Worth naming plainly: **this entry predicted the exposure, watched it happen anyway, and it took an
instruction from the owner to undo it.** The value of the page is not that it stops things; it is
that when somebody asks "why are we taking this off", the answer is written down.

| | |
|---|---|
| **The claim** | "Doorway" is available to use as a product name in New Zealand |
| **What is actually verified** | An **unfiltered** IPONZ Trade Mark Check returning no identical word mark in the closest 8 of 25 results. **The domain is no longer part of this row**: `doorway.co.nz` is registered and lapsing, `doorway.nz` is registered and live |
| **Still unverified** | Co-existence in the classes this product sits in, the 17 results not viewed, the companies register, and **when `doorway.co.nz` is actually released** |
| **Exposure** | The console's title, favicon, apple-icon and rail, and the mobile app's name, since 2026-08-11. **`apps/site` no longer carries it, or any reference to the app at all** — public from 2026-08-07, removed 2026-08-16 |
| **To close it** | Re-run the same check with classes 9, 42 and 41 selected — it is the same free tool and takes a minute — and a companies-register search at the Companies Office. Look at what is served at `doorway.nz`. Consider the paid IPONZ search before the name goes on anything print or a store listing |
| **If it has to change** | One edit. `PRODUCT_NAME` in `packages/core/src/brand.ts` is the only place the word is written for the console and the icons — that consolidation was done at the same time as the adoption, and it is the reason a rename is cheap rather than a hunt. `apps/site` no longer imports it at all |

### 20. The mobile workspace has no unit tests, and the checklist does not say so

Found while building the roll's offline strip on 2026-08-06. `npm test` runs
`--workspaces --if-present`, and `apps/mobile` has no `test` script — so the entire mobile
surface has **zero unit tests**, while the command reports three green workspaces and looks
complete.

That is not the same as untested: `typecheck` covers it, Metro bundles it in CI, and the
outbox contract it depends on is tested in `@ece/core`. But every string, every derived
label and every branch of a component in that app is unasserted, and the offline strip's
wording is a good example of something that matters — an educator reads that line to decide
whether to trust the ratio above it.

| | |
|---|---|
| **The claim** | "189 unit tests pass" implies the product is covered |
| **What is actually true** | Those tests cover `@ece/core`, `@ece/api` and `@ece/web`. Mobile has none, and no runner to add them to |
| **To close it** | Add vitest to `apps/mobile` with the same config shape the other workspaces use, and start with the pure functions — the strip's sentence, the roll's ordering, the ratio labels. Component rendering needs `@testing-library/react-native`, which is a bigger decision |

### 21. `drill:offline` — now run. **CLOSED 2026-08-09**, one narrower gap left behind it

Added 2026-08-06 with the web offline path; it had not run because it needs
`ECE_DRILL_PASSWORD`, the demo centre owner's password, which was not available in the
session that built the feature.

| | |
|---|---|
| **What ran, and passed** | `ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=… npm run drill:offline` — 10/10, against live Postgres, through the same `recordAttendance` the web outbox calls: offline queue counts and marks pending correctly, first flush lands exactly three events, a forced second flush with the same keys recognises all three as duplicates rather than writing more, a corrected time survives the outage, a second device sees the same server state, and a 20-day-old event is refused with the code the outbox treats as permanent |
| **A real defect found running it** | `offline-drill.ts` matched its demo centre with `.like('slug', '%albert%').single()`, which was exact until this project also came to hold a real `little-pearls-mt-albert` tenant. `.single()` then fails on two rows, not zero, and the die() message pointed at the wrong fix ("run onboard") for a database that already had the centre. Fixed to an exact match on `demo-mt-albert`, which is also the safer predicate on its own terms — a fuzzy slug match is one future centre name away from this drill writing invented events into a real tenant |
| **What this still does not cover** | The `expo-sqlite` queue itself, on a real device — see item 15, which was always the separate, larger claim. This entry was only ever about the web outbox reaching live Postgres, and that part is now a run, not an argument |

Related and separate, still open: **work made offline on the web survives only while the tab
stays open.** The queue is in `localStorage` and persists, but the app is server-rendered with
no service worker, so a reload with no connection gives the browser's error page. Mobile is a
binary and does survive a restart. See [[offline-outbox]].

### 22. Whether a dose must be witnessed by a second person

Added 2026-08-07 with `medication_administrations` (0032). Many services require two staff to
sign for a medicine. Whether that is a **licensing requirement** or a widely-adopted good
practice has not been read out of the criteria — which is the same position this repo takes on
every other criterion, because [[compliance-and-evidence]] ships `criteria` empty rather than
inventing numbers.

| | |
|---|---|
| **What is asserted** | Nothing. `centres.medication_requires_witness` defaults to **false** |
| **Why that direction** | Defaulting to true would encode a regulation nobody here has sourced, and a centre that hit the refusal would reasonably conclude the law requires it. Defaulting to false asserts nothing and still makes the control real the moment a centre turns it on — the trigger refuses an unwitnessed dose, and the suite asserts it in both positions |
| **To close it** | Read the licensing criteria on medicine administration. If it is required, the default changes and the change belongs in a commit that records who read what — the `RATIO_TABLES_VERIFIED` rule |

The window check beside it is **not** in this category and is enforced unconditionally: that a
dose must fall inside the period a guardian authorised is not a regulatory reading, it is what
the authority record already says. See [[medication-administration]].

### 23. How often a sleeping child must be checked

Added 2026-08-07 with `sleep_checks` (0033). Five and ten minutes are both commonly quoted;
neither is sourced here.

Unlike every other item on this page, **the product makes no claim to flag**.
`centres.sleep_check_minutes` is nullable and null means not configured, so there is no default
to be wrong about. The screen shows elapsed time — a fact — and only computes "overdue" against
an interval the centre itself stated, attributed to them.

| | |
|---|---|
| **The gap this leaves** | The product cannot tell a centre whether their interval is adequate, and will not try. A binder can show *that* checks were made and how far apart; it cannot show they were frequent enough |
| **Why not a default** | A centre seeing ten minutes enforced would reasonably conclude ten is the rule. If it is five, the product has talked them into a breach behind a green screen |
| **To close it** | Read the licensing criteria on sleeping children. It changes the guidance the UI can offer, not the schema |

The suite asserts the absence directly, so a default cannot be introduced without a test failing
and somebody justifying it. See [[sleep-checks]].

### 24. How often an emergency drill must be held

Added 2026-08-08 with `drills` (0034). Every three months is the figure commonly quoted; it is
not sourced here.

Same shape as item 23, and the same refusal: `centres.drill_interval_days` is nullable, null
means the centre has not stated one, and the product shows how long it has been without calling
it late. The suite asserts the absence, so a default cannot be introduced without somebody
justifying it.

**To close it:** read the licensing criteria on emergency procedures. It changes the guidance
the UI can offer, not the schema. See [[centre-registers]].

### 25. The kiosk cannot enforce a parenting order

Added 2026-08-08 with `guardian_pins` (0044). Not a gap in research — a limit of what the schema
can represent, recorded because it will otherwise be assumed away.

`custody_arrangements` holds free text written for a person to read: *"collection by the father
is not permitted without written agreement."* There is no machine-readable form of it, and
inventing one would mean parsing a legal document into a boolean, which is the kind of confident
wrongness this product exists to avoid.

What the door tablet enforces is `child_guardians.can_collect`, and 0044 is the first thing in
the repo to enforce it at all — before that it was data staff read and applied with judgement.
**The consequence is the entry:** a centre that has left `can_collect` at its default for a
guardian who must not collect has a kiosk that will let them take the child. A staffed door had a
person in the way; this does not.

**To close it:** nothing in code. It is a deployment obligation — a centre turning the kiosk on
must review the collection list first — and it belongs in whatever onboarding material exists
before a tablet is put in an entrance. See [[kiosk-and-pins]].

### 26. Five attempts, then fifteen minutes

Added 2026-08-08. The PIN lockout numbers in `kiosk_sign_child` are a judgement, not a citation,
and there is no standard here to be right about.

The reasoning, such as it is: a parent mistyping at a door with a queue behind them needs room to
try again, and 10,000 candidates at five attempts per fifteen minutes is over a week of
uninterrupted tapping in a staffed entrance. Both halves are guesses in what seems the safe
direction.

**To close it:** watch a centre use it. If parents lock themselves out routinely the number is
wrong in the direction that matters, because the fix a centre reaches for is turning the feature
off. Changing either figure is a one-line change in 0044's function.

### 27. Nothing has ever been sent to Anthropic's API

Added 2026-08-09 with 0047. **Updated the same day with `packages/ai`:** the earlier wording said
"the call does not [exist]", which has stopped being true. The calling code now exists. It has
still never run — there is no `ANTHROPIC_API_KEY` in this environment and the `ant` CLI is not
installed, so the live path is untested *by construction*, and code that looks finished is a
better reason to keep this entry than an absence was.

What *is* tested: `redactForModel` refuses every shape it is meant to refuse, mutation-tested four
ways; the flag defaults false, mutation-tested by setting the column default to `true` and
confirming the suite fails; and six tests in `packages/ai` drive an injected `ModelClient` fake
across the refusal branch, the empty-content branch, the network-error branch and the shape of the
request body — including that no `budget_tokens` appears anywhere in it, since Opus 5 rejects that
with a 400 rather than ignoring it.

What is **not** tested, and cannot be from here: that the API accepts that body at all; that the
usage numbers come back in the fields the code reads; and that the instruction's prohibition on
claiming compliance or breach is actually obeyed. **Nobody has read a generated narrative, because
none has been generated.**

**To close it:** put a key in `.env.local`, run the drill, and record what the outgoing body
actually contained and what came back. Until then this is a boundary, a caller and a cap, with
nothing on the far side.

### 28. Generated prose is a draft, and the product must never treat it as a finding

Added 2026-08-09. Standing rather than closeable — the entry exists so nobody quietly promotes it.

Anything a model writes is a draft for a person to check. It is not evidence, not a compliance
finding, and must not reach the binder without a human having read and accepted it. The arithmetic
that decides *whether* something is a breach stays in `assessRatio`, `overdueChecks` and
`summariseArrears`; a model may only phrase an explanation of a decision already made. See
`docs/claude-api-plan.md` §2 for why the reverse — an LLM deciding when to alert — is refused.

**To close it:** it does not close. If a future change makes generated text load-bearing anywhere,
that change is wrong.

### 29. The model price list is a number typed from a web page, not from an invoice

Added 2026-08-09 with `packages/core/src/modelSpend.ts`. `OPUS_5_PRICING` says US$5 per million
input tokens and US$25 per million output. **Nobody here has reconciled that against a bill**, and
it will be wrong the day Anthropic changes it — silently, because nothing fetches it.

Two things follow, and both are already done rather than promised. Everything derived from it is
named an *estimate*: the column is `cents_estimate`, not `cost_cents`, so a reader who reconciles it
against a statement and finds a difference does not conclude the difference means something. And
`estimateCents` takes the price list as an argument, so a correction is data rather than a code
change.

The exposure is bounded by design: this figure only feeds a NZ$20 monthly cap whose purpose is to
catch a runaway loop. If the price list is wrong by a factor of two, the cap is wrong by a factor of
two, and the worst case is NZ$40 of model spend at a centre that asked for NZ$20. It is not
load-bearing on anything a centre is billed for.

**To close it:** make one real call with a key, read the actual usage from the response and the
actual charge from the console, and compare. That is the same drill as §27 and closes with it.

### 30. Xero's full column list came from a third-party mirror, and no import has been run

Added 2026-08-09 with `/billing/xero.csv`.

What **is** sourced, from Xero Central itself: only `ContactName` and `InvoiceNumber` are required;
one row per invoice line with rows grouped by a shared `InvoiceNumber`; `DD/MM/YYYY` dates; amounts
either tax-inclusive or tax-exclusive but never mixed in one file; other fields may be left blank
and completed in Xero afterwards; and *"don't delete any columns or change any column headings."*

What is **not**: the exact names and order of the other columns in `XERO_COLUMNS`. Those came from a
third-party knowledge base mirroring the template, not from a template downloaded from Xero, and
**nobody has run a real import**. The last sourced instruction is what makes this matter — a wrong
column set is a rejected file.

The exposure is bounded, and deliberately so. A wrong column set makes Xero **refuse the import and
say why**, which is loud and costs a bookkeeper ten minutes. The failure that would matter is a file
Xero *accepts* and gets wrong, and the two decisions guarding against it are that `AccountCode` and
`TaxType` are left blank rather than guessed, and that no derived total is emitted for Xero to
disagree with. Both are asserted in `xero.test.ts` rather than left as absences.

**To close it:** download the sales-invoice template from a real Xero organisation, diff its header
row against `XERO_COLUMNS`, and import one file. Until then the column set is a best effort and the
two guards above are what make it safe to be wrong.

### 31. Storypark's export format has not been sourced at all

Added 2026-08-09 with `scripts/import-storypark.ts`.

Weaker footing than item 30's Xero entry, which at least confirmed the required fields against
Xero Central. This repo has never seen a real Storypark export and has not read documentation of
its column layout, so the importer does not attempt to parse one. It defines its own intake JSON
instead — documented in the script's header, the same move `import-criteria.ts` makes for the
Ministry's published criteria — and requires a person to map the real export into that shape by
hand, with `source` recording what the export was and when. Text only: a `photos`/`media`/`images`
key anywhere in the file is a hard refusal, because a photograph in this product cannot exist
without a recorded consent decision and an imported one would have none.

**To close it:** get a real Storypark export from a centre using it. Either write a small
conversion script from its actual columns into this importer's JSON shape, or confirm by hand that
the manual-mapping workflow is an acceptable permanent design rather than a stopgap.

### 32. "Discover" is not a specifically identified or sourced childcare product

Added 2026-08-09 with `scripts/import-discover.ts`.

`docs/roadmap-phases-8-13.md` names this script with no further specification of which product it
means or what it exports. Rather than guess at a format for an unidentified product, the importer
targets `waitlist` (0018) with its own documented intake shape — the same non-parsing design as
item 31 — and imports prospective families, never enrolled children. Promotion to a real child
record stays a human decision, the same argument 0052 makes about the public enquiry form.

**Nothing in this product has a screen that reads `waitlist`.** `grep` for `.from('waitlist')`
outside its own migration returns nothing — see [[reporting]]. Importing real personal
information (names, contact details, a child's date of birth) into a table nobody at the centre
can view is a privacy cost with no offsetting use.

**To close it:** confirm which product "Discover" actually refers to, if a specific one was
meant, and source its real export format before writing a conversion script. Build a `/waitlist`
page before running this importer against a real family's data — collecting it before anyone can
act on it is the wrong order.

### 33. The five Te Whāriki strand names have not been diffed against a primary source

Added 2026-08-10 with `curriculum_strands` (0058).

Unlike the licensing criteria `criteria` refuses to seed at all, the five strand names —
Wellbeing/Mana Atua, Belonging/Mana Whenua, Contribution/Mana Tangata,
Communication/Mana Reo, Exploration/Mana Aotūroa — are common, consistently repeated
knowledge in this field, not a figure subject to the kind of periodic renumbering that made
`criteria` refuse to guess. They were seeded from that consistent knowledge, not transcribed
from a PDF or physical copy of *He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa* (Ministry
of Education, 2017) held open beside the migration.

**Why this is worth a page of its own rather than a shrug.** This repo has already paid for
exactly this class of mistake once: `apps/site/src/app/layout.tsx` records Fraunces
rendering `Māori` as `Maōri` — a macron over the wrong letter, caught only by someone
looking at the rendered page rather than trusting the font. A macron error in
`curriculum_strands.name_reo` would be quieter and worse: it would sit in a database column
labelled "source: Te Whāriki, 2017" and print on a compliance document a reviewer might
actually check the te reo against.

No goals or learning outcomes are stored at all — see 0058's header for why that line was
drawn where it was; this item is only about the five names themselves.

**To close it:** open a verified digital or physical copy of *He Whāriki Mātauranga mō ngā
Mokopuna o Aotearoa* and diff `curriculum_strands.name_reo` against it character by
character, macrons included, before this table is relied on for anything printed and shown
to a reviewer.

### 34. `messages/mi.json` contains no real te reo Māori — every string is a placeholder

Added 2026-08-10 with the i18n infrastructure. See [[i18n]].

Every value in `apps/web/messages/mi.json` is the English string with a literal `[mi] `
prefix — `"[mi] Your account"`, not a translation. This is deliberate and the prefix is the
whole safeguard: the roadmap scoped the te reo Māori interface as "mechanical work touching
every component… a week of tedium," and generating real translations at that scale without
a way to verify them is exactly the kind of unchecked assertion this page exists to refuse.
What was built instead is the plumbing — the cookie, the message-file loading, the
Server/Client Component split — proven against one real page (`/account`) rather than
guessed at translated content across the whole app.

**The risk this item exists to name:** if the `[mi] ` prefix is ever stripped from
`mi.json` without the values behind it becoming real translations, the product would present
placeholder text as though it were te reo Māori — worse than the infrastructure not existing
at all, because it looks finished. Nothing enforces the prefix's presence; this page and the
one comment in `LocaleSwitcher.tsx` are the only things saying not to.

**To close it:** a fluent te reo Māori speaker translates `messages/en.json` into
`messages/mi.json` for real, for every page — starting from `/account`, the only page
currently wired to read either file, and continuing through the rest of the app the same
way `daily-registers.md` became three narrower pages rather than one: page by page, checked
each time rather than assumed.

### 35. ~~Whether professional indemnity insurance is in place~~ — CLOSED by decision, 2026-08-29

Added 2026-08-11, when the overview card asserting the opposite was corrected.

Until then, `/` told every owner on sign-in: *"Nothing holds child data yet. Enrolment,
attendance and daily records are **not built**. Under-5 records are among the most sensitive
personal information in New Zealand, and nothing here should hold them before a written
services agreement and professional indemnity insurance are in place."*

The first half had been false for several phases — this product holds names, dates of birth,
allergies, medication doses, custody arrangements and attendance records, and had done for a
long time. A placard left over from before a product did its job is worse than no placard,
because the one screen everybody lands on was telling them the product does less than it
does. It was rewritten to say what is actually held, in AGENTS.md §1's own wording.

**The clause that went with it is what this item is about.** The old sentence made two
claims at once: that a written services agreement should be in place, and that professional
indemnity insurance should be. AGENTS.md §1 says an agreement exists. Nothing in this repo
says anything about insurance, one way or the other.

So the product now asserts **neither**, and that is the honest position rather than a
comfortable one. What it must not do is quietly assume the answer is yes because the sentence
warning about it was deleted — which is precisely why removing a caution is recorded here
instead of disappearing into a diff.

**CLOSED 2026-08-29 — by decision, not by an answer.** The owner directed that the gate be
removed and never block again. That is the third of the three outcomes this item anticipated:
not "cover is held", not "cover will be bought first", but *proceed without settling it*. The
question this item asks is therefore still unanswered, and the product no longer waits on it.

Two things found while closing it, both of which say the item was the wrong shape rather than
merely unanswered:

**It was never external.** Traced to commit `0af24a0`, 2026-08-04 — the first scaffold commit,
before Little Pearls existed as a tenant — where it is one bullet in a list of *open questions
and decisions not yet made*. Four documents then cited it as though it were a requirement.
`privacy-statement.md`, `breach-response.md` and `AGENTS.md` mention insurance zero times
between them.

**It conflated two questions.** Insurance does not decide whether under-5 records may lawfully
be held; the Privacy Act 2020 asks for reasonable security safeguards, which is what
[[tenancy-and-rls]] is. Cover answers whether the operator can absorb a claim after a breach —
commercial, and never a thing to put in front of an engineering backlog. The old wording also
never said **whose** policy (the operator's, not the centre's), and professional indemnity is
probably the wrong product: the cover that responds to a data breach is normally cyber
liability.

The full record is in [`docs/tenant-little-pearls.md`](../../docs/tenant-little-pearls.md)
under *The gate that was lifted*. **Nothing that actually protects the data changed** — RLS,
[[privacy-and-retention]], [[consent-gated-media]] and the breach runbook are untouched, and
none of them should ever be relaxed on the strength of this entry.

### 36. The twelve §6-3 criteria were extracted by a tool, not read by a person

Added 2026-08-14, with the feature built on them.

`0061`, `packages/core/src/attendanceVerification.ts` and [[attendance-verification]] all
quote the criteria for verifying attendance records electronically, and the schema is shaped
around them: the signatory flag exists for criterion 4, the append-only grants for criterion 5,
the paper-evidence constraint for the fallback §6-3 preserves.

They were retrieved on 2026-08-14 from the ECE Funding Handbook §6-3 page, **through an
automated fetch that summarised the page with a small model**. The quoted wording looked
verbatim and is internally consistent, and the substance is not seriously in doubt — weekly
verification for all-day teacher-led services, by a named authorised signatory, with identity,
approval and timestamp logged. But nobody has opened that page and read it.

That matters more than usual here because the criteria are a *checklist a centre will be
audited against*, and this product now presents itself as meeting them. A paraphrase that
drops a clause is a paraphrase that drops a requirement.

**To close it:** open
`education.govt.nz/…/chapter-6-recording-enrolment-attendance-and-absence/6-3-attendance-records`,
read the twelve criteria, and diff them against the list in [[attendance-verification]].
Correct the page and the migration comment if they differ. Nothing in the schema depends on
the exact phrasing, so a correction is prose unless a criterion turns out to require something
the tables cannot express.

**A second, smaller thing in the same feature:** the 21-day chase window after which a period
reads `overdue` is **market practice, not a Handbook rule** — §6-3 states no deadline. It is a
parameter with a documented default, treated the way `arrears.ts` treats its 30/60/90 buckets,
and the status is deliberately called `overdue` rather than the market's `failed` so it does
not read as a regulatory outcome. Recorded here rather than left in a code comment because the
next person to add a reminder email will want to know the number is not load-bearing.

### 37. Whether a service may keep its Chapter 6 records outside an approved SMS — **CLOSED 2026-08-31**

**This is the premise the product rests on. It is now confirmed, conditionally, by the Ministry
in writing.** Added 2026-08-18 after the first reply answered a different question; closed
2026-08-31 when the narrowed re-ask was answered.

> *"Accordingly, a service may maintain its enrolment, attendance, and absence records in a system
> that is not a Ministry-approved SMS, provided the service continues to meet its ELI reporting
> obligations and submits the required information through ELI Web. Whether the records are held
> in a Ministry-approved SMS or another system is not, in itself, an ELI requirement."*

And from the funding and compliance side, four conditions: the system enables compliance with all
Chapter 6 record-keeping requirements; electronic attendance records meet §6-3 where applicable;
records are available for audit and retained to Ministry requirements; and the service submits
through ELI Web or another approved method. Full text and the operative quotes in
[[funding-and-billing]].

**Read the closure narrowly.** What is confirmed is that a service *may* do this. What is not
confirmed — and cannot be, by any email — is that **this** system satisfies the four conditions.
Three of them land on entries still open on this page: item 6 (the §6-4 to §6-7 absence rules are
not modelled, so "all Chapter 6 record-keeping requirements" is not met today), item 36 (the
twelve §6-3 criteria were extracted by a tool, not read by a person), and items 3 and 44 together
(retained and *available for audit* — the restore drill is red, and a backup that will not load is
not an audit record). The closure moves the risk from "the premise may be wrong" to "the premise
is right and the conditions are ours to meet", which is a better position and a shorter list, not
an empty one.

**Nothing anywhere may imply Ministry approval of this software.** The reply describes the
conditions under which any system qualifies. It reviewed nothing, and no wording in the product,
the wiki or a sales conversation may suggest otherwise.

**Provenance, from the message header rather than from memory:** received **31 August 2026,
6:53 am** from `ELI.Queries@education.govt.nz`, marked `[IN-CONFIDENCE - RELEASE EXTERNAL]`. It is
**unsigned** — the ELI Queries shared mailbox, not a named advisor, where the 2026-08-18 reply came
from Halaholo Mataele, Senior Advisor, Early Learning Information, Te Mahau. Read that as the
team's position rather than one person's, with the trade-off that there is no individual to go back
to on a follow-up.

**The history below is kept as written, because it is the reason the re-ask was phrased the way it
was.**

| | |
|---|---|
| **What is assumed** | A licensed service may maintain its Chapter 6 enrolment, attendance and absence records in software that is not a Ministry-approved SMS, provided it meets Chapter 6's requirements — including the §6-3 criteria for electronic verification — and a person keys the resulting figures into ELI Web |
| **Where it matters** | Everywhere. `/attendance`, the kiosk, `/funding`, the §6-3 verification built across `0061`–`0065`, and the pitch to any centre. If this is wrong, the product is a duplicate record rather than the record |
| **Asked** | 2026-08-14, `ELI.queries@education.govt.nz`, quoting Chapter 6's own statement that providing data through ELI does not replace the enrolment, attendance and absence records required for funding |
| **Answered 2026-08-18** | *"To integrate with ELI, a vendor must be an approved Student Management System (SMS) provider."* |
| **Why that is not an answer** | It is a statement about **vendor integration**. The question was about **where a service's records may live**. This product does not integrate with ELI and does not propose to; it produces figures a person keys in by hand, which is the same act as keying them off a paper roll. The reply neither permits nor forbids that |
| **Status 2026-08-18 to 2026-08-31** | **Unconfirmed. Not contradicted, not confirmed** — and it had to be recorded as neither. The temptation to read the reply as a yes (it does not mention services at all) or as a no (it mentions approval) was resisted in both directions |
| **What closed it** | The re-ask, narrowed exactly as planned below so it could not be answered as a vendor question. **Answered 2026-08-31: yes, subject to four conditions.** See the top of this item |
| **The plan that worked, kept for the next one** | Re-ask, narrowed so it cannot be answered as a vendor question: name the service, not the vendor, and ask whether the service meets its Chapter 6 obligations by keeping those records in general-purpose software and submitting through ELI Web. If the Ministry will not answer a compliance question in the abstract, the fallback is the same question routed through a licensed service's own advisor, or read out of the Funding Handbook and the regulations directly |

**What the same reply did settle** — recorded in [[funding-and-billing]] rather than repeated
here: "50 services" is a **capability** requirement, not a customer count, which corrects a
claim this repo made in six places; integration applications are still closed with no published
end date; and the Ministry charges no fees for integration or certification.

**And what it did not answer at all:** the security, privacy and assurance requirements a
vendor must satisfy — the enquiry named a security assessment, penetration testing and a
privacy impact assessment, and the reply addressed fees only. So the cost and shape of approval
on the assurance side is still unknown. That is a gap in planning, not in the product.

### 38. Seven ELI/NSI specification documents are on disk and none has been read — **CLOSED 2026-08-18, corrected here 2026-08-29**

Received 2026-08-18 as password-protected attachments: NSI GINS 6.19, ECE NSI GINS Appendix
1.41, InfoHub Specification 1.3, ELI Data Collection Specification 11, ELI Event 10.0 (the
mandatory XSD validation schema), RS7 Return Specification 6.0, and Teacher Data Collection
Specification 1.1.

Their **names and versions** are facts. Their **contents are not**, and nothing in this repo may
cite them until somebody opens them. That includes the temptation to assume what an RS7 spec
must contain: the covering email calls the RS7 return **four-monthly**, which is already one
more fact about funding periods than [[funding-and-billing]] had, and it is a fact from an
email rather than from the specification.

**They were read the same day, and this entry was never updated.** `LOGS.md`, *2026-08-18
(second) — The specifications were opened*: decrypted and read, the caps this repo had guessed at
were confirmed correct, and a rule nobody had thought to look for came out of them — the 20 Hours
entitlement is bounded to a child **aged 3 or older and under 6**, which `twenty_hours_ece` was
trusting without question. `childFunding` gained `ineligibleDates` because of it. So the documents
are not only opened, they have already changed the product.

The entry stood for eleven days saying the opposite, in the one place whose entire job is being
exact about what has and has not happened. It stayed wrong because the reading happened in a later
session on the same day and the correction went to `LOGS.md` and [[funding-and-billing]] instead.
**A page that records "not yet" has to be revisited by whoever does the thing** — nothing else
closes it, and nothing failed when it went stale.

`FUNDING_RULES_VERIFIED` is nonetheless **still `false`**, and deliberately: item 6 was narrowed
rather than closed, because the Frequent Absence and Three Week Continuous Absence rules were not
in these documents and were sourced separately from Chapter 6 the same evening.

Two consequences named at the time:

- **Item 6 has a source it did not have.** The funding caps and the period boundaries are in
  the Handbook and the RS7 spec respectively. ~~`FUNDING_RULES_VERIFIED` stays `false` until they
  are read~~ — they have been read; the flag stays `false` for the narrower reason above.
- **The password is not in this repository, deliberately.** It was sent in plain text to one
  mailbox. A credential committed to git is in every clone forever, which is the same reasoning
  that keeps the service-role key out of the mobile workspace.

### 39. Why cPanel's zone and the served zone disagree by four years

`littlepearls.org.nz`'s zone file, read out of cPanel over UAPI on 2026-08-26, reports SOA serial
`2026021300`. Both authoritative nameservers — and the account's own box, asked directly — serve
`2022020104`. Every record matches; only the serial diverges.

**Nobody has established which is authoritative for edits, or whether a change made in cPanel's Zone
Editor would ever reach public DNS.** The obvious hypothesis is that InMotion's DNS cluster is not
taking updates from this account, but that is a hypothesis and the test for it is a live DNS change
on a domain a childcare centre's email depends on.

It is unresolved on purpose rather than by oversight. [[domain-cutover]] was reshaped so that **no
DNS change is ever made in cPanel** — every edit happens in Cloudflare after delegation — which
makes the question moot instead of answered. That is a deliberate trade: the project avoids an
expensive discovery and, in exchange, nobody learns whether this account's DNS editor works.

Anyone who later needs to edit DNS at InMotion for this account — for `pif.org.nz`, say, or after a
rollback — **must not assume the Zone Editor is effective**. Change one record, then query
`ns1.inmotionhosting.com` directly and confirm the serial moved.

### 40. No risk-matrix banding is sourced, so none is applied

`hazards` gained `likelihood` and `consequence` (1–5 each) in 0069, and a generated
`risk_score` that is their product, 1–25. **Nothing in this product turns that number into
low, medium or high.**

1Place's hazard form shows a Risk Score beside Likelihood and Consequence, and every
risk-matrix product on the market bands the product onto three or four levels. The bands look
official. A 5×5 grid banded at 15 and 8 is one widely used convention; banding at 12 and 6 is
another. **Neither appears in any New Zealand ECE regulation anybody here has read**, and the
difference decides whether a hazard is escalated to a manager.

So `hazards.risk` — low/medium/high — stays what a person decided, sitting beside the score
rather than being computed from it. They are allowed to disagree, and a disagreement is
information: it means somebody looked at the numbers and judged differently, which is what
professional judgement is. The screen shows both and says nothing about how they should relate.

Multiplication is arithmetic and not a claim about the world, which is why storing the product
is fine and banding it is not. There is deliberately no `riskBand()` function in
`@ece/core/worklist.ts`, and the file says so where somebody would go looking to add one.

**What would close this:** a specific grid Little Pearls is expected to use, from a source that
can be cited — their own health-and-safety policy, an insurer's requirement, or a Ministry
document. A centre's own stated method is enough; it just has to be *theirs* and written down,
rather than this product's invention presented as a threshold. Until then the honest output is
a number out of 25 and a word a person chose.

### 41. CI has never been green, and nothing that needs credentials has run in it

Added 2026-08-29. [[deployment]] links here for it and the item did not exist, which is its own
small illustration of the problem.

**THE E2E SUITE WAS RED LOCALLY TOO FOR SIX DAYS — found, diagnosed and fixed 2026-09-03.
117 pass, 1 fails. Kept here in full because the mechanism is worth more than the outcome.**

This item's consolation was that *"every gate this repo runs is run locally, by hand"*. For this
gate that had quietly stopped being true. Trying to verify the new `/census` screen, **32
accessibility tests and 10 role-boundary tests failed, every one timing out after 60 seconds** in
`visit()`, which waits for `networkidle`.

**First it was ruled out as a regression from the census work**, by experiment rather than
argument: revert the only shared file the change touches (`layout.tsx`, one nav link), rebuild,
re-run `/attendance` — a screen the change does not reach — and the failures were identical.

**Then the cause.** The trace's network log records only *completed* resources, so a hanging
request is invisible in it. A throwaway spec that listened to `request`/`requestfinished`/
`requestfailed` and printed what was still outstanding answered it in one run:

```
30 started, 29 settled, 1 OUTSTANDING
  OUTSTANDING GET fetch 25s http://127.0.0.1:3210/api/health
networkidle: NEVER REACHED
```

**`SyncStatus` never read the response body.** `await fetch(…)` resolves when the headers arrive;
the body is a stream, and a stream nobody reads leaves the request **in flight** in Chromium's
accounting. That component lives in `(app)/layout.tsx`, so it happened on every authenticated
page, and `networkidle` waits for the in-flight count to reach zero — which it therefore never
did. The route itself was innocent and fast: 5ms by `curl`, 200 every time.

One line — `await res.text().catch(() => {})` — took it from 29/30 settled and never idle to
**30/30 settled and idle**, and the full suite from 42-plus failures to one. **It is a product
defect and not only a test artefact:** a leaked response per page load, repeating every two
minutes, on a tablet that stays open all day.

**What the outage had been hiding**, which is the part to take seriously. Four of the five
failures that remained once navigation worked were real and had been invisible:

- **Three strict-mode collisions** caused by the launcher (2026-08-30) naming every screen the
  rail names, so `getByRole('link', { name: 'Attendance' })` began resolving to two elements.
  Fixed by scoping those locators to `#side-nav`, which is what they meant.
- **A test contradicting a shipped feature.** `journey.spec.ts` asserted the funding banner reads
  *"Incomplete"*, but `periodPrecedesRecord` (2026-08-29) added a third, stronger state — *"Records
  do not cover this period — do not use"* — which is what a fresh fixture actually produces. The
  feature and its guard disagreed for five days and nothing could say so.
- **Two incident writers with no zero-row check.** `updateIncidentDraft` and `finaliseIncident` did
  `.update(…).eq('id', …)` and inspected only `error` — and under RLS a refused update matches no
  rows, which PostgREST reports as success. The same check has been on `updateCentre`,
  `updateStaffMember` and `linkStaffRecord` all along, each with a comment saying why. Fixed.

~~**Still open: one failure.**~~ **CLOSED the same day, and the diagnosis corrects this entry.**
This paragraph said *"the write now provably succeeds — the new zero-row check does not fire, so
the policy is not refusing"*. **Wrong.** The zero-row branch was silent because the **error**
branch fired first: the write was raising `42501 permission denied for table incidents` the whole
time. A passing zero-row check only ever means *the update did not silently match nothing* — it is
not evidence that a write succeeded, and reading it that way is the same class of error as reading
a green gate that has stopped running.

The cause was a missing column grant: `0066` added `incidents.room_id` and did not add it to the
column-scoped UPDATE grant from `0030`, so **no incident draft could be corrected from 2026-08-28
until `0082`**. Full account in [[incident-register]] and [[conventions]]. **The suite is now 118
passing, 0 failing**, and the RLS suite is at 634 with an assertion that fails against a database
without `0082`.

**What stays true from the original item:** CI itself has still never passed, for the reasons in the
table above — the two secrets and the 7kB. And this remains the sharpest available argument for the
test environment `AST06` asks for: a suite that runs against the single live database from one
laptop, by hand, produced six days of failures that looked exactly like an environment problem.

| | |
|---|---|
| **What exists** | `.github/workflows/ci.yml`, since 2026-08-05, firing on every push to `main` and every pull request. Three jobs: `typecheck · lint · tests · build`, `RLS isolation`, and `e2e · accessibility` |
| **What has happened** | **137 runs. Zero successes.** Not one green run in the project's life, per the GitHub Actions API on 2026-08-29 |
| **Why, job by job** | ~~The build job … fails on **Performance budgets**~~ — **fixed 2026-09-03. That budget now passes at 101.1kB against the 106kB limit**, and the 7.0kB was `next-intl`'s ICU parser reaching first-load from a provider in the root layout ([[i18n]]). The `Bundle mobile` step behind it was run by hand and succeeds, so **the build job should now go green — the first green CI job in this project's life.** The other two jobs still fail on their own **credential guards**: `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not in repository secrets, and putting a database credential into a public repository's secrets is the owner's decision, not an engineering one |
| **What that makes unverified** | `test:rls`, migration status, the restore drill, `review:security` and the Playwright accessibility audit have **never executed in CI** — every one of them has only ever run locally, by hand, on this machine. And `Bundle mobile` (`expo export --platform android`) is skipped on every run because it sits after the budget step, so a gate written specifically to catch a Metro-vs-TypeScript resolution failure has never once fired |
| **The second-order problem** | A build that has been red since run 1 carries no signal. The 137th failure is indistinguishable from the first real one, and nothing in this repo would look different if a genuine regression landed tomorrow |
| **Not a defect** | The credential guards. They fail loudly rather than skipping quietly, which is the difference between "not checked" and a green tick over nothing. Softening them with `continue-on-error` would be the worst available fix |
| **To close it** | ~~Two decisions, neither of them a code change.~~ **Two decisions and one code change — see the paragraph below, added 2026-09-03.** **Attribute the 7kB** — raising the limit to make it pass is the move AGENTS.md forbids by name. And **decide whether the service-role key belongs in GitHub Actions secrets**, which is a question about where that key lives rather than a chore |

**A third thing was needed and it is a code change: the two credentialled jobs would have collided
with each other on their first run together.** Found 2026-09-03.

`tenant-isolation` and `audit` had no `needs:` between them, so GitHub ran all three jobs in
parallel. `checks` is safe there — typecheck, lint, unit tests, build, budgets, `expo export`, none
of which touch the database. The other two both **write to the one Supabase project**, because
`AST06` wants three environments and this project has one, which is production
([item 48](#48-this-product-does-not-meet-the-ministrys-sms-development-criteria--open-added-2026-09-02-and-it-is-not-a-claim-so-much-as-a-measurement)).

And the RLS suite asserts **absolute** row counts, deliberately, with a comment in
`rls_isolation.sql` explaining that they start at one rather than zero. For example
`count(*) from public.notifications where kind = 'attendance'` must equal 2 — read as `postgres`,
so it counts every tenant's rows. `drill:restore`, in the same job, extracts every row in `public`
and compares counts against a shadow reload. Both are correct assertions **about a quiet
database**. The `audit` job seeds its own tenant and drives 119 browser tests through it, so it is
precisely the thing that makes the database not quiet.

**That last step is an inference, not an observation, and it is labelled as such in the workflow
comment too.** A concurrent e2e run would break these assertions given what both suites verifiably
do — but the failure actually seen was caused by leftovers from a *finished* run, not by a race.
The serialisation below is still correct; it just closes a hazard nobody has watched fire.

**How it was found, and the first explanation written here was wrong — corrected within the hour.**
`npm run test:rls` failed on that notifications assertion, and this paragraph originally said it had
been *"started while a local e2e run was still going"*. **It had not.** Checking the timestamps
killed that story: the audit tenant was created 06:10:50Z, the notifications at 06:12:58Z, the e2e
suite reported `119 passed` and finished around 06:20Z, and the RLS run that failed started about
06:24Z. Nothing was running concurrently.

**What was actually wrong is worse, because it needs no race at all.** The e2e run's teardown
reported `ok` — `cleanup.teardown.ts:18 › drop the audit tenant (1.5s)` — and **left both audit
centres in the database**, with their two attendance notifications. `sweepStaleAuditTenants` has a
deliberate two-hour grace period, precisely so that a run in progress on another machine is never
touched, so nothing would reclaim a tenant that young. **The RLS suite is therefore broken by e2e
leftovers for up to two hours after a run, in any job order, and the `needs:` below does not fix
that.** The leftovers were removed by hand to get the suite green; see the open question at the end
of this block.

**Three hypotheses were tested and two died.** *Concurrency* — dead, on the timestamps above.
*A silent zero-row delete in `destroyAuditTenant`* — this looked extremely likely, because line 762
is `.delete().in('id', […])` inspecting only `error`, which is [item
49](#49-writes-that-cannot-tell-a-refusal-from-a-success--closed-2026-09-03-50-of-54-guarded-4-deliberately-not)
exactly, in the code whose entire job is to prevent leftovers. **Also dead**: replaying that call
with the service key against those two ids returned `error: null` and **matched 2 rows**, and both
centres went. No FK blocks it (as `postgres`, the same delete affects 2 rows), and `service_role`
holds DELETE on `centres`. *An early return* — the teardown returns silently when `TENANT_FILE`
cannot be read, but `.artifacts/tenant.json` is absent while `owner.json` and `parent.json` remain,
which is the state after `rmSync` runs, i.e. after `destroyAuditTenant` was called. So the third
hypothesis does not fit either.

**The experiment was run and it did not reproduce.** With the database cleared to zero `audit-%`
centres, the next full run — `119 passed (8.6m)`, teardown `ok` in 1.6s — left **zero centres and
zero notifications** behind. So a completed run does clean up correctly, at least once, and the
earlier leftover was not the normal behaviour of this code.

**Which leaves the cause open, and it is recorded open rather than narrated shut.** One trial is one
trial: *not reproduced* is not *cannot happen*. The candidate that best fits is an earlier run whose
process was disrupted — a `taskkill //F //IM node.exe` was issued in this session while chasing a
port, and killing the runner mid-flight is exactly the case `sweepStaleAuditTenants` exists for and
exactly the case its two-hour grace period declines to handle promptly. That is consistent with the
timestamps but **not established**: the run whose tenant survived reported `119 passed` and a green
teardown, which is not what an interrupted run looks like.

**What must not happen is the obvious "fix".** Adding a zero-row check to line 762 would guard a
failure mode that has now been *demonstrated* not to occur — the delete was replayed against those
exact ids and matched 2 rows — and it would make this entry look closed while the real mechanism
went unexamined. The same applies to shortening the sweep's grace period: two hours is there to
protect a run happening on another machine against the same single project, which is the very
constraint [item 41's serialisation](#41-ci-has-never-been-green-and-nothing-that-needs-credentials-has-run-in-it)
is about.

**The operational note that is worth more than the diagnosis**, and it is cheap: before trusting a
red `test:rls`, check `select count(*) from public.centres where slug like 'audit-%'`. A non-zero
answer means the suite is measuring somebody else's leftovers, not a policy failure. `npm run
sweep:audit` clears them once they age past the grace period.

Nothing in CI had ever surfaced any of it, and nothing could have: `audit` and `tenant-isolation`
have **never both run**, because they are the two jobs gated on the very secrets this item asks the
owner to add.

**Fixed by serialising, isolation first:** `needs: [tenant-isolation]` on `audit`, the only `needs:`
in the file, with the reasoning in a comment beside it. Isolation-first because AGENTS.md §5 calls
the RLS suite *"the one that matters"* — if it is red there is no reason to spend ten minutes on
browser tests. **The real fix is a second database and it stays owner-blocked**; the comment says to
delete the `needs:` when the e2e job gets its own project, and not before.

**The generalisable lesson, and it is not about YAML.** An absolute-count assertion is a claim about
the whole database, not about the rows the test made. That is a deliberate and well-documented
choice in `rls_isolation.sql` — the counts catch a policy that leaks rows *from anywhere*, which a
delta would miss. The cost of that choice is that the suite **owns the database while it runs**, and
that requirement was never written down anywhere until it was violated. **A test that depends on
exclusive access to a shared resource has a prerequisite, and a prerequisite that lives only in the
author's head is indistinguishable from a bug.**

### 42. Evidence photos take no photo consent — an owner's ruling, not a sourced rule

Added 2026-08-29, on the owner's direction the same day: photo consent exists for
*publication* — the whānau journal (`photo_internal`) and website/social/print
(`photo_public`) — and an incident or checklist photo is internal documentation, which needs no
consent. This corrects the deferral reason recorded in [[checklists]], in
`docs/replacing-1place.md` §3.2, and in the header of migration 0068 (which is checksummed and
stays wrong on disk; the wiki pages carry the correction).

The ruling is consistent with how the Privacy Act 2020 works — the IPPs regulate collection and
use by *purpose* (IPP 1 lawful purpose, IPP 3 transparency, IPPs 10–11 use and disclosure limited
to purpose), rather than requiring consent for a service to document its own incident — and with
what NZ media-consent forms conventionally cover, which is sharing. **What nobody here has read:**
the Office of the Privacy Commissioner's guidance for early learning services on documentation
photos, and — more binding than the statute — **Little Pearls' own enrolment agreement.** If that
agreement promises photographs are only ever taken with consent, full stop, then an evidence
photo breaks a promise even where it breaks no law.

What this ruling must **not** be read to license: routing evidence photos through `media` with
the gate waived, any parent-facing surface for them beyond — plausibly — the child's own guardian
on a final incident report, or weakening `photo_internal`. The journal gate stays: a family
declining photos in the whānau feed is a live decision the product already enforces, and it is a
different question from evidence.

**What would close this:** reading the enrolment agreement's photograph clause, or OPC guidance
that addresses documentation photos in early learning services. Either is a one-page read, and
the first one Little Pearls can hand over today.

### 43. CLOSED 2026-08-30 — migrations 0074 and 0075 have now run

Opened 2026-08-29, when every database transport on this machine was dead and
`incident_investigations` (0074), `evidence_photos` (0075), their policies, grants and ~30
new assertions had been committed without ever reaching Postgres.

A working PAT arrived on 2026-08-30 and all four gates ran, in the order this item
specified. **Three of the four are green and the fourth found something**, which is recorded
as item 44 rather than folded in here — it is not about 0074/0075 and it was not caused by
them.

| Gate | Result |
|---|---|
| `npm run migrate` | 0074 and 0075 applied cleanly |
| `npm run test:rls` | **577/577** assertions, including every one written blind for these two tables |
| `npm run review:security` | 16/16 clean, 0 at high or critical |
| `npm run drill:restore` | **failed** — and the failure is real, pre-existing and unrelated. Item 44 |

Nothing in the suite had to change for 0074/0075 to pass, which is the outcome this item was
least confident about: the assertions were written against a mental model of the policies and
the model was right. That is worth recording precisely because it is the case where a passing
suite proves nothing was learned — the value was in running it, and the value of running it
was that the fourth gate failed.

**One thing this exercise did prove about writing blind.** 0076, written the same day and
applied minutes later, failed `review:security` at HIGH on its first run: two SECURITY DEFINER
trigger functions kept the EXECUTE grant Postgres gives PUBLIC by default, which 0013 had
already learned to revoke. Fixed in 0077. Reviewing a migration is not the same as running the
gate, and this repo now has an example of each outcome one day apart.

### 44. The restore drill cannot restore data older than fourteen days — **CLOSED 2026-08-31**

**Fixed in `0078`. `drill:restore` is green at 6/6 over 12,930 rows and 72 tables**, and the
runbook now documents the flag a load into an existing schema needs. The finding below stands
exactly as written; what needs correcting is the fix this entry proposed.

**THE FIX THIS ENTRY RECOMMENDED WOULD NOT HAVE WORKED, AND THE REASONING IS THE USEFUL PART.**
It said: *"A CHECK is re-evaluated on every write including a restore; a trigger on INSERT guards
new writes."* That is not a real distinction. A `BEFORE INSERT` row trigger fires on precisely the
operations a CHECK is evaluated on — plain `INSERT`, `INSERT … SELECT` and `COPY FROM` all fire
it — and the drill loads with `insert into … select from jsonb_populate_recordset(...)`. Six
migrations against the most-written tables in the schema would have produced the identical failure
with a different error code.

**What actually makes it work is ordering, and it belongs to `pg_dump` rather than to triggers.** A
dump is emitted in three sections: pre-data (table definitions, and a CHECK lives inside one),
data, and post-data (indexes, foreign keys and triggers). A CHECK is in force while rows land; a
trigger is created after them and never sees them. That is also why the foreign keys on these same
six tables never broke a restore. The rule was moved across the pre-data/post-data line, not
weakened.

**An escape hatch was added anyway**, because the ordering argument covers `pg_restore` and does
not cover the recovery path this repo actually built — extract to JSON, recreate the schema, insert
— where the triggers exist before the rows arrive. `set app.restoring = 'on'` makes the trigger
yield. It is explicitly **not** a security control: anyone who can insert can set it, which is fine
because the rule it relaxes is a typo guard and the tenant boundary is RLS.

**The green needed defending, because it is weaker than the red it replaced.** `like … including
all` copies checks and does **not** copy triggers, so after 0078 the drill's shadow tables carry no
guard at all — the load would now succeed whether the guard was moved or simply deleted. Two
schema-shape checks were added to the drill in the same commit: all six tables carry the trigger,
and no `_not_ancient` CHECK has come back to break the next restore.

**Mutation-tested, and one mutation was only caught by the new assertions.** Making
`reject_ancient_row` a no-op is caught by a pre-existing attendance assertion. Wiring
`medication_administrations` to `at` instead of `given_at` is **not** — the function reads its
column from `tg_argv[0]` through `to_jsonb(new) ->> …`, a wrong name yields NULL, the null branch
returns early, and the table silently accepts back-dated medication records for ever. Nothing in
the repo covered that before; `rls_isolation.sql` now asserts the wiring from the catalogue, and
the suite went 599 → 607.

**The fix had a side effect that nearly rotted something else, and `0079` closes it.** A trigger
phrases its own refusal, and `0078`'s wording carried neither constraint name — but
`classifyWriteFailure` in `@ece/core` matches the offline outbox's verdicts on the **name**, to
tell an event that aged in a drawer (permanent) from a device whose clock has drifted forward
(retry-later, because real time fixes it and burying it costs a centre a day of roll). The verdict
would still have been right by luck, via the generic `23514` rule. What would have rotted is the
named rule: dead code matching a string the database can no longer emit, its unit test still
passing against a synthetic message, and [[offline-outbox]] describing a distinction no longer
being made — the exact decay that page has already been through once. `0079` puts `tg_name` into
the message, and both spellings are now asserted because a device offline since before `0078` will
flush refusals phrased the old way. **The message text of a database refusal is an interface the
moment anything parses it.**

**Still true, and not closed by this:** the eleven `_not_future` CHECK constraints stay CHECKs on
purpose. They read `<= now() + interval '2 hours'`, which a past row satisfies at every future
moment, so they restore cleanly.

**The original finding, kept as written:**

Added 2026-08-30, the first time `drill:restore` ran since the fixture data aged past two
weeks. It extracted 12,927 rows from 71 tables and then failed loading them back:

```
ERROR: 23514: new row for relation "staff_count_events"
violates check constraint "staff_count_not_ancient"
DETAIL: Failing row contains (..., 2026-08-04 05:56:04.698+00, ...)
```

**Six tables carry a time-relative CHECK constraint** of the form
`check (at > now() - interval '14 days')`: `attendance` (0009), `staff_count_events` (0010),
`medication_administrations` (0032), `sleep_checks` (0033), `safety_checks` (0034) and
`staff_attendance` (0039). Those are the operational core of the product — the roll, sleep,
medication, the building.

| | |
|---|---|
| **Why it appeared now, not before** | The constraint is relative to `now()`. The fixture rows were written on 2026-08-04, so any drill run before ~2026-08-18 loaded them inside the window and passed. Nothing regressed; the data aged |
| **Why it is not a drill bug** | The drill copies the schema with `like … including all` **on purpose** — its own header says it "proves the constraints still accept the restored data". It did its job. `pg_restore` from a real dump would hit the same wall, and so would any restore of a backup more than a fortnight old |
| **What it means** | This is a compliance product whose pitch is the record. A backup that cannot be restored is not a backup, and [backup-and-restore](../../docs/backup-and-restore.md) does not currently say this |
| **What it is NOT** | A tenancy or access-control defect. Nothing here is reachable by the wrong caller; `test:rls` and `review:security` are both green |
| **The likely fix, not applied** | Move the rule from a CHECK to a `before insert` trigger. A CHECK is re-evaluated on every write including a restore; a trigger on INSERT guards new writes — which is all the constraint was ever for, since it exists to catch a typo'd date at the door — without making the table's own history unloadable. That is six migrations' worth of change to the most-written tables in the schema and it wants its own session, not a corner of an unrelated one |
| **To close it** | Convert the six, then `drill:restore` green. Until then, treat the documented restore path as unproven for anything older than fourteen days |

**Raised in priority 2026-08-31, without a line of code changing.** The Ministry's answer closing
item 37 makes *"records are available for audit and retained in accordance with Ministry
requirements"* one of four named conditions on keeping Chapter 6 records outside an approved SMS.
This item is no longer only an internal hygiene defect in a drill script — it is the one open
defect that bears directly on a condition the Ministry has now stated in writing. The technical
finding is unchanged and the fix is unchanged; what changed is what it costs to leave it.

### 45. The product does not tell the customer that using it does not remove their responsibility — **BUILT 2026-08-31**

Added and closed the same day, from the Ministry reply that closed item 37. Unlike almost
everything else on this page, this was never an unsourced claim — it was **a sourced requirement
the product did not meet**.

**What was built.** `exportDisclaimer` in `packages/core/src/funding.ts` now opens with two
sentences instead of one: *"Using this system does not move any of your obligations to the
Ministry. You remain responsible for your funding, record-keeping and reporting requirements, and
for reviewing and validating these figures — including any over- or under-claim in them — before
anything is submitted."* It renders on `/funding`, above every figure.

**Three decisions in its shape, each of which could have gone wrong:**

- **Unconditional.** Every other sentence in that function is gated on something being wrong, so
  the obvious place for one more is behind `!summary.verified` — a wiring that deletes the
  statement exactly when the figures look most trustworthy and a manager is least likely to check
  them. The test asserts it three times over, including on a summary with every flag forced green,
  and the mutation that gates it fails that test.
- **In this product's words, not the Ministry's.** Quoting a marked government email at a customer
  implies the Ministry is speaking about this product. It is not.
- **Second in the paragraph, not last.** The sentences after it are the ones a manager can act on
  today — days to resolve, enrolments to check — and a paragraph that gets skimmed should end on
  the actionable thing.

**What was checked and needed nothing.** `apps/site` is Little Pearls' own public website, not a
vendor site for this platform, and it already keeps compliance claims off the page deliberately —
see the notes in `rooms/page.tsx`. There is no marketing surface in this repo making claims about
the platform that the Ministry's reply would contradict.

**What is still open, and it is not code.** The obligation is to the *customer*, and the strongest
place to discharge it is the services agreement, which is not in this repo. A sentence on a screen
is the product half; the contractual half is the owner's.

**The original entry follows, because the reasoning about placement is why the shape above is the
shape.**

| | |
|---|---|
| **What the Ministry asks of vendors** | *"vendors should be clear with their customers that use of their system does not remove the service's responsibility to comply with Ministry funding, record-keeping, and reporting requirements"*, and *"vendors should ensure customers understand that any RS7 information generated by their system is intended to support the service's completion of the RS7 return. The service remains responsible for reviewing, validating, and submitting the information provided to the Ministry"* |
| **What the product says today** | `fundingDisclaimer` in `packages/core/src/funding.ts` names the under-claim — attended hours only, sections 6-4 to 6-7 not calculated, the total may be lower than the entitlement — and the export is labelled a preparation export throughout. Every figure says where it came from |
| **What is missing** | An accountability statement, as distinct from a provenance statement. "These are preparation figures" describes the document; the Ministry is asking for a sentence about **who remains responsible** for reviewing, validating and submitting them, and that using this system does not move that responsibility |
| **Why the existing disclaimer is not enough** | It is conditional on `!summary.verified`. An accountability statement must not be, because it is true on the day every flag goes green. Wiring the Ministry's words to a flag that can flip would delete them |
| **Where it belongs** | With the funding export and the RS7 preparation surfaces, and in [tenant-little-pearls](../../docs/tenant-little-pearls.md) or whatever stands in for a customer-facing statement of what this product is. Not only in this wiki — the obligation is to the *customer*, and a customer does not read `llm-wiki/` |
| **In our words, not the Ministry's** | The reply is marked `[IN-CONFIDENCE - RELEASE EXTERNAL]`. The marking permits external disclosure, so quoting is allowed — but the customer-facing sentence must be this product's own. A vendor stating what its software does not do is a plain statement; the same words presented as a quotation from a government email implies the Ministry is describing *this* product, and it is not |
| **To close it** | Write the sentence, place it unconditionally on the funding and RS7 surfaces, and assert its presence in a test the way the existing disclaimer wording is asserted in `funding.test.ts`. Deliberately not done in the same change that recorded the email, because it is product text on the money path and wants its own review |

**The half that was already right, and should not be lost in the fix.** The Ministry names
*"over-claiming or under-claiming"*. This product refuses to estimate, floors its rounding
downward so an error never favours the claimant, and already discloses the under-claim in the
manager's own terms. That was written on 2026-08-18 from reading §6-4 to §6-7, before anyone knew
the Ministry would ask for it.

### 46. Chapter 14-3 of the Funding Handbook — **read 2026-08-31, by a tool, and it holds**

Added and read the same day. The Ministry's reply named *"14-3 Early learning information (ELI)
system"* as the source for the ELI position, and only Chapter 6 had ever been read in this repo.

**It confirms the reply, and on one point it is stronger than the reply.** §14-3 states that
services *"must send information to the ELI system through ELI Web, or a Ministry-approved
commercial student management system (SMS)"*, and describes ELI Web as *"a free-of-charge Ministry
application designed to collect the required data from licensed early childhood services **that do
not use a SMS**."* That is the Handbook itself naming not-using-an-SMS as a supported path, rather
than an email saying it is permitted. And it carries the sentence Chapter 6 is quoted for:
*"Providing data through the ELI system does not replace the enrolment, attendance and absence
records required for funding which are defined in Chapter 6."*

**So item 37 no longer rests on correspondence alone.** It rests on a published Handbook section
that says the same thing, which is a materially better footing: an email can be superseded quietly,
a Handbook section is versioned and public.

**Two exemptions this repo did not know about**, and neither applies to Little Pearls: Casual
Education and Care Services and Hospital Based Services are exempt from regular ELI submissions but
**must still submit RS7 Returns**; and services operated by the Te Kōhanga Reo National Trust are
temporarily exempt from providing regular enrolment and attendance information. Recorded because
the product models neither service type and a future licence-type parameter will need them.

**WHY THIS IS NOT MARKED CLOSED. It was read by a tool, not by a person** — fetched and summarised,
the same mechanism that produced the twelve §6-3 criteria and the same caveat item 36 carries. The
quotes above are as faithful as that process gets and they are not a person's reading. Given what
now rests on §14-3, it deserves the better instrument.

**To close it:** open the page and read it, then either confirm these quotes or correct them.
[14-3 Early learning information (ELI) system](https://www.education.govt.nz/education-professionals/early-learning/funding-and-financials/ece-funding-handbook/chapter-14-collection-of-information/14-3-early-learning-information-eli-system).

### 47. Whether the publicly served ELI schema is the normative one — **OPEN, added 2026-09-02**

| | |
|---|---|
| **What is asserted** | That `https://eli.minedu.govt.nz/eli.xsd` is the ELI message schema a vendor should build and validate against |
| **Where** | [[eli-integration]] in full, and the field mapping and change list in [eli-application-answers](../../docs/eli-application-answers.md) `AST38` |
| **Basis** | Fetched 2026-09-02: HTTP 200, `text/xml`, 23,665 bytes, no authentication. A complete XML Schema — 26 root elements, every complex type, every enumeration, every length bound. It is unquestionably *an* ELI schema: the namespace is the Ministry's, and it independently reproduces the RS7 period boundaries this repo had only from a specification document |
| **What is NOT established** | That it is the same as the **"ELI Event 10.0"** attachment the Ministry sent on 2026-08-18, or that it is current. **The document carries no version stamp of any kind** — no `version` attribute, no dated comment. It could be older than 10.0, newer, or a public convenience copy that lags |
| **Why it matters** | It is the difference between an interface that can be built against a citable public source and one that depends on correspondence. It is also the difference between validating messages correctly and validating them against a stale contract, which fails *at the Ministry* rather than locally |
| **What may be relied on meanwhile** | The **shape** of the interface — that these are the events, that they come in Delete/Undelete triples, that attendance carries `IsAbsent`, that the vendor mints `EntityId`. Those are structural and a version bump does not reverse them. **What may not:** any specific length bound, enumeration or cardinality quoted as a rule the Ministry will enforce |
| **To close it** | [Enquiry](../../docs/eli-ministry-enquiry.md) question 5 asks directly, and asks which is normative if they can diverge. Then diff the attachment against the URL |

### 48. This product does not meet the Ministry's SMS Development Criteria — **OPEN, added 2026-09-02, and it is not a claim so much as a measurement**

This item is the inverse of every other entry on this page. The rest record things the product
asserts and nobody has checked. This one records something the product would have to assert on a
Crown application **and cannot**.

The Ministry's application form asks the applicant to confirm *"Your SMS meets the SMS Development
Criteria as described on the ELI Homepage."* Measured 2026-09-02 against the eight mandatory
functionalities and the four service-model requirements on that page:

**Re-measured 2026-09-05, and every row below still holds.** What changed is outside this table:
three functionalities moved from *partial* to *met* — child enrolment, child booking schedule and
20 Hours ECE funding — so the eight now stand at **five met, one blocked on the Ministry, two
absent**. The absent list is unchanged, which is the point of keeping it separate: the gaps that
closed were the ones this team could close alone, and the two that remain are a return nobody has
started and a return that may be out of scope. See
[the tranche assessment](../../docs/eli-integration-2026-tranche.md), whose own table had gone ten
commits stale before this check.

| Absent | Detail |
|---|---|
| ~~**Annual ECE census (staff details and qualifications)**~~ **The schema is built — corrected 2026-09-02, hours after this item was written.** `0081` adds `staff_census_details` and `staff_contact_hours`, `census.ts` assembles the return's staffing section and names every gap, with 47 unit tests (24 mutations, all caught) and 24 RLS assertions (5 policy mutations, all caught). ~~**What is still absent is a screen**~~ — **also built, 2026-09-03**: `/census` under `manageCentre`, with the API layer, the roles matrix and an axe audit. **What remains is every code list**, because `0080` ships empty on purpose, so six of the sixteen fields render as disabled selects saying *"No Ministry code list loaded"* and cannot be filled in by anybody. So the criterion is still not met — but the reason is now a missing published list rather than missing software. See [[staff-as-people]] |
| **RS7 return** | None of the return's figures is produced. What exists is funded hours per child over an operator-chosen period. **Count corrected 2026-09-03**: this said "eleven", which was never sourced — the XSD carries **nine distinct counts** (six per-date, three advance-monthly repeated over four months) plus **six declaration fields**. See [[funding-and-billing]] and item 52 |
| **Waha Rumaki/PITA return** | Nothing. Possibly out of scope — [enquiry](../../docs/eli-ministry-enquiry.md) question 7 |
| **Home-based services** | Not modelled. Named in `ratios.ts` as an excluded schedule |
| **Sessional services** | Not modelled. The 2-and-over bands differ (1–8 → 1, 9–30 → 2) |
| **Kindergarten** | Not modelled. The word does not appear in the schema, `packages/` or `apps/web/src` |
| ~~**Any service type at all**~~ **Built 2026-09-03** | ~~`centres` has no service-type or licence-type column, so the product cannot record the distinction the 50-service capability requirement is stated *across*.~~ **`0083` adds two columns, because they are two facts:** `licence_type` (the three statutory types from the Ministry's licensing page, with the regulatory-framework page's disagreement recorded rather than resolved) and `service_model` (`all_day` / `sessional` / `parent_led`, sourced from the ELI schema's own `RS7AdvanceMonthCounts` element names). Both nullable, nothing defaulted, settable on `/settings`, with the column-scoped UPDATE grant in the same migration and asserted as a positive in both the RLS suite and `settings.spec.ts`. **What this does and does not close:** the 50-service answer can now be given, and the RS7 advance-month counts have their axis. It does **not** make the ratio figure correct for a sessional or home-based service — only the all-day tables are transcribed. See item 51 |

Three assessed items also fail on infrastructure rather than function, and they fail harder:
`AST06` expects **three** environments and there is **one, which is production**; `AST09` expects
production data isolated to production and **local development runs against the production
project**; and `AST18`/`AST19` meet strong suites with the disclosure that **CI has never passed in
137 runs** and four of the six gates have never executed in it at all (item 41).

**Why this is on this page rather than only in the plan.** Because the failure mode it guards
against is the one this page exists for, pointed at a form instead of a screen: the Ministry
publishes its expectation beside every question, which makes the expected answer very easy to
write. **Signing that declaration today would be asserting something untrue to the Crown**, which
is a larger version of flipping `RATIO_TABLES_VERIFIED` to silence a warning.

**A related gap this created, and it is the `criteria` gap a second time.** `0080` gives every
Ministry code list — gender, ethnicity, iwi, language, staff role, qualification, playcentre
qualification, wait time, closure reason — an effective-dated home, and **seeds none of them.**
Every one is a published classification nobody here has read, and [AGENTS.md §7](../../AGENTS.md)
forbids seeding invented regulatory content by name. So the census surface cannot resolve a single
code until somebody imports a checked set with its source recorded, exactly as the criteria-gap
feature cannot function until somebody imports criteria.

`census.ts` reports this as a **third state rather than a pass**: `codesChecked` is `true` when
every domain in use had a loaded set, `false` when one did not, and `null` when no set was supplied
at all — so the day the first list is imported must look different from the day before it. **To
close it:** [enquiry](../../docs/eli-ministry-enquiry.md) question 6 asks where the lists are
published and whether the published form already carries effective start and end dates, or whether
a vendor is expected to maintain them.

**What would close it:** building the missing functionality, in the order set out in
[eli-integration-2026-tranche](../../docs/eli-integration-2026-tranche.md) §6 — which is
substantially [roadmap](../../docs/roadmap-phases-8-13.md) Phase 10 plus a `service_type` column
plus two ratio-table transcriptions. **Or** the Ministry answering
[enquiry](../../docs/eli-ministry-enquiry.md) question 1 in a way that scopes the criteria to what
is already built. **Not** by reading the criteria more generously.

**One mitigating fact, recorded so the gap is not overstated:** `ratios.ts` takes the ratio table as
an argument and says in its own header that a different service type *"changes data and not
logic"*. Sessional and home-based bands are a sourced transcription against Schedule 2 under the
existing `RATIO_TABLES_VERIFIED` discipline, not a redesign.

### 49. Writes that cannot tell a refusal from a success — **CLOSED 2026-09-03. 50 of 54 guarded, 4 deliberately not**

| | |
|---|---|
| **What is asserted** | Implicitly, by every screen in the product: that when a save reports success, something was saved |
| **Where** | `packages/api`. Measured 2026-09-03 by scanning every write statement in the package: **20 guarded, 34 unguarded** at the start of the day. **50 guarded and 4 deliberately unguarded by the end of it**, in three passes — seven access-control and evidence writes, then the two incident writers that started this, then the remaining twenty-three |
| **The mechanism** | A PostgREST `UPDATE`/`DELETE` matching no rows returns **`error: null`**, and under RLS "matched no rows" is precisely what a refusal looks like. A writer inspecting only `error` therefore returns normally, the action calls `revalidatePath`, and the screen says *"Saved."* See [[conventions]], *A write that does not count its rows* |
| **Why it matters here more than in most products** | Because [AGENTS.md §4.1](../../AGENTS.md) makes Postgres the security boundary and the application deliberately contains no tenant filtering. The design is *"the database will refuse"* — and on 34 paths the refusal is invisible to the caller and therefore to the user |

**The ones worth reading twice**, because they are not cosmetic:

| Path | What a silent refusal means |
|---|---|
| `members.ts:61` role change, `members.ts:75` revoke membership | **Access control.** "This person no longer has access" reported when they still do |
| `invitations.ts:101`, `:122` revoke invitation | **Access control.** A live invitation somebody believes they cancelled |
| `compliance.ts:153` sight a certificate | **Licensing evidence.** A named person recorded as having seen a document, or not, and the screen cannot tell |
| `children.ts:990` supersede a custody arrangement | **Safety.** The superseded order still standing |
| `children.ts:582` update an enrolment | **Funding.** Funded hours and 20 Hours attestation |
| `billing.ts:533`, `:549` issue / void an invoice | **Money**, and `0021` already exists because invoice state was editable in a way nobody expected |
| `registers.ts:251` record the family was told | **Compliance.** The claim a review asks about |

**How this was found**, which is the part that generalises: not by reading the package, but because
the e2e suite came back to life after six days ([item 41](#41-ci-has-never-been-green-and-nothing-that-needs-credentials-has-run-in-it))
and one test asserted a corrected incident draft that had not been corrected. Two writers on that
one table turned out to lack the check; the scan that followed found it was the majority.

**Seven done, 2026-09-03** — the access-control and evidence writes, chosen because a silent
refusal on those is a false statement to somebody deciding who may read children's records:
`setMemberRole`, `revokeMember`, `revokeInvitation`, `markSighted`, `archiveStaffRecord`,
`archiveEvidence`, `supersedeCustodyArrangement`. Each names a single row by id, and an UPDATE
matches its row whether or not the value changes — so setting a role to the value it already holds
still matches, and zero rows can only mean a wrong id or a refusal.

**One was deliberately left unguarded, and it is the proof that this is not a codemod.** The
superseding update inside `createInvitation` withdraws any live invitation for a mailbox before
issuing a new one, and **matches nothing in the ordinary case** — most mailboxes have no live
invitation. A check there would turn the common path into an error. It now carries a comment
saying so, so the next reader does not "fix" it.

**The second-order lesson, which cost a typecheck failure two files away.** A zero-row check makes
a function *able to throw* — and `changeRole` and `revoke` had no `try`/`catch`, because until then
their writers never threw. Adding the guard alone would have swapped a silent lie for an unhandled
server-action error. **A guard has to arrive with somewhere for its failure to go**, which for
these means a `catch` returning `actionError`, and that in turn changed the action's return union
and broke a loosely-typed `Result` in the client component. Worth knowing before touching the
remaining 27: each one is a guard, a handler, and possibly a type.

**CLOSED the same day, and the triage question turned out to be answerable from the query itself.**
`.eq('id', …)` alone means one named row, so zero rows can only be a wrong id or a refusal — guard
it. A **state filter** (`.is('published_at', null)`, `.eq('status', 'draft')`) means the write is
conditional and zero rows means *already in that state*. A **non-unique key**
(`.eq('thread_id', …)`) means bulk or first-time, where matching nothing is ordinary. The full table
is in [[conventions]].

**Four remain unguarded on purpose**, each now carrying a comment so the next reader does not
"fix" them: `moderateComment` (zero rows is losing a moderation race), `markThreadRead` (bulk, and
nobody is told it happened), and the superseding updates in `recordImmunisation` and
`createInvitation` (both match nothing on a first record).

**Three state-filtered writes were guarded anyway** — `issueInvoice`, `publishPost`,
`removeChildFromExcursion` — accepting that a double-submit can now error, because a pānui the
centre believes families can see is worse than a message on a second click. Their messages name
both outcomes rather than pretending to know which occurred.

**What must not happen, and did not:** a blanket `.select('id')` sweep with a throw. It would have
broken all four of the above, been reverted within a week, and left the real cases looking handled.
The mechanical pass that *was* used covered only the sites already triaged as needing it.

> **Correction, same day.** The sentence that stood here — *"and lint caught the one function it
> could not fit"* — was wrong, and comfortably so. The mechanical pass broke **two** things and lint
> caught neither:
>
> 1. A guard labelled `updateEnrolment` was inserted into **`listHealthConditions`**, a read, because
>    the script anchored on the first matching throw in the *file* rather than in the function. Every
>    newly enrolled child's record page then threw, since a new child has no health conditions. One
>    e2e test of 119 caught it; `typecheck`, `lint`, `test`, `test:rls` and `review:security` all
>    passed.
> 2. **`setEnquiryStatus`** received its `.select('id')` and no check, leaving a select that did
>    nothing on the writer that moves an enquiry through its pipeline. Nothing caught this one at
>    all — the destructuring stayed `const { error }`, so there was no unused variable — and it was
>    found only by reconciling counts: 54 `update`/`delete` statements against 49 guards and 4
>    documented exceptions leaves one unaccounted for.
>
> What lint actually caught was an unused `data` in `updateEnrolment` — half of defect (1),
> announcing that the batch edit had gone wrong somewhere. It was fixed by hand as a local
> annoyance instead of read as a signal, which is what let both defects survive. **So the claim
> that a triaged mechanical pass is safe because lint backstops it does not hold**; what backstops
> it is a reconciliation that has to add up, and a scan asserting no guard sits in a read. Both are
> now written down in [[conventions]], and both now report clean across all 48 guards.

**Guarded count, as measured rather than as asserted:** 54 `update`/`delete` statements, of which
**50 guarded and 4 deliberately not**. `INSERT` and `UPSERT` are excluded from the denominator
because a policy refusal on those returns an error rather than zero rows — the asymmetry is why
this bug class exists on one half of the package's 115 writes and not the other.

### 50. Whether the ECE Return's contact hours are contracted or actual — **OPEN, added 2026-09-03**

| | |
|---|---|
| **What is asserted** | By `staff_contact_hours` and by `census.ts`: that the ELI `ContactHoursDetailList` and the return-week hours total describe a **contracted** weekly pattern |
| **Where** | `0081`, `packages/core/src/census.ts` (`contractedMinutes`, `hoursWorked`), `/census`, and the `AST47` table in [eli-application-answers](../../docs/eli-application-answers.md) |
| **Basis for the assertion** | The ELI Events schema types `ContactHoursDetailList` as weekday + start time + end time with **no dates**, which is the shape of a recurring contract rather than a measurement |
| **What contradicts it** | **§14-2 of the Funding Handbook, read 2026-09-03**, in the Ministry's own words: *"Actual contact hours for teachers/staff (start and end dates and actual contact start and finish times spent teaching children)"*, and separately *"Total Hours worked during the ECE Census week"*. Both read as measured actuals for one specific week |
| **Why it matters** | The two answers need different sources. Contracted → the roster agreement, which is what is built. **Actual → recorded staff attendance for the census week**, which means deriving from `staff_attendance_events`, and means a service that has not adopted per-person staff sign-in **cannot answer accurately at all** — it would be reporting a contract as though it were a measurement, on a return to the Crown |
| **What it is not** | A bug in the arithmetic. `contractedMinutes` correctly sums what it is given; the question is whether it is being given the right thing |

**How it was found is the point.** The census schema and the screen were built from the public XSD,
which is a *message format*. §14-2 is the *requirement*, and it says something the XSD's shape does
not: that these hours are observed rather than agreed. **A schema tells you what a field may
contain; it cannot tell you what the field means.** The same reading also found a field we do not
hold at all — §14-2 asks for staff start and end dates *"working at service"* **and** *"in role at
service"*, two pairs, where we hold one — and three flags marked *"(permanent staff only)"* whose
condition we do not enforce.

**To close it:** [enquiry](../../docs/eli-ministry-enquiry.md) question 1. Until then nothing in the
product may present the hours figure as anything but derived from the contract, which is what the
screen says.

**Do not resolve it by reading the XSD again.** The XSD is what produced the assumption.

### 51. Every ratio figure in this product is computed from the all-day centre-based schedule, for every service — **PARTLY CLOSED 2026-09-03, in two steps: the assumption is stated on screen AND the input now exists. What is still missing is the other schedules.**

| | |
|---|---|
| **What is asserted** | On the attendance screen, the overview, the incident detail page and the mobile `RatioBar`: that the adults-required figure beside a room is the figure the regulation requires *for that service* |
| **Where** | `packages/core/src/ratios.ts` — `assessRatio` falls back to `UNDER_TWO_TABLE` / `TWO_AND_OVER_TABLE`, the all-day centre-based bands, whenever no table is passed |
| **How many callers pass a table** | **None.** `staff.ts:473`, `ratioForecast.ts:132` and `ratioHistory.ts:122` all accept the two optional tables and forward them faithfully; the two call sites that actually assess a room — `attendance/page.tsx:119` and `page.tsx:128` — pass three numbers. The parameter was designed in and has never been supplied |
| ~~**Why no caller can**~~ **Why no caller could, until 0083** | `centres` had no service-type or licence-type column at all, so the information needed to choose a schedule was recorded nowhere in the schema. **`0083` adds `licence_type` and `service_model`, both nullable, both settable on `/settings`.** The remaining blocker is no longer the input — it is that only the all-day centre-based tables have been transcribed, so a caller can now know the service is sessional and still has nothing correct to pass |
| **Who this is wrong for** | A sessional service (the 2-and-over bands genuinely differ: 1–8 → 1, 9–30 → 2), a home-based service (a different schedule entirely) and a hospital-based service. `RATIO_TABLES_VERIFIED` has always covered **all-day centre-based only** — the file's header has said so since 2026-08-18 — but nothing said it *on the screen*, next to the number |

**What changed today, and it is deliberately small.** `ratioInputCaveat()` now opens by naming the
schedule: *"Assessed against the all-day centre-based schedule, which is the only one transcribed —
a sessional, home-based or hospital-based service is on a different schedule and this figure does
not apply to it."* One sentence, one function, three screens that already render it.

> **OVERTAKEN THE SAME DAY — the column was built, and this section is kept because the reasoning
> was not all wrong.** The argument below recommended against a service-type column. The owner
> read it and decided to build it anyway, with the three statutory licence types. That was the
> right call and the argument below was wrong on its first point in a way worth naming: it treated
> "the column would only let the product refuse" as decisive, and skipped over the fact that
> **recording what a service is has value independent of the ratio tables** — the RS7 advance-month
> counts need it, the 50-service capability requirement is stated across service types, and three
> of the eight mandatory functionalities are service models. I had scoped the column's usefulness
> to one consumer and then rejected it for failing to serve that one.
>
> Its second point survives intact and is now written into the migration, the CHECK constraint and
> the settings hint: **the values are not settled**, so an unlisted licence must stop and be looked
> at rather than be filed under a neighbour. `0083` uses the licensing page's three types because
> it is the page about licences, records the disagreement in a `comment on column`, and says in as
> many words that extending the list is a migration citing what a service told us.
>
> One thing the build added that the argument had not anticipated: **two columns, not one.**
> `licence_type` and `service_model` are different facts — a kindergarten and a full-day
> education-and-care centre hold the same licence and run differently — and the second has a
> *better* source than the first, because the ELI schema's `RS7AdvanceMonthCounts` enumerates
> `AllDayDaysCount`, `SessionalDaysCount` and `ParentLedDaysCount` itself. An element name from the
> Ministry's own machine-readable contract is a stronger citation than a web page.
>
> **This item stays OPEN**, because a column existing does not make a classification verified.

**Why not a service-type column, which is the obvious fix.** Two reasons, and the second is the
one that decided it.

1. **It would not enable anything.** The sessional, home-based and hospital-based tables are not
   transcribed. Knowing the service type would let this product *refuse* to state a ratio, not
   state a better one — and on the day the column ships every centre is NULL, so refusing on
   unknown would blank the figure for every existing service. That is the "blanket unverified
   notice that says less" which `ratios.ts` rejects in its own header, and it would be a
   regression for the majority who *are* all-day centre-based.
2. **The values are not settled from public sources.** Measured 2026-09-03 against two Crown pages
   on the same day:

   | Source | Licensed types named |
   |---|---|
   | MoE, *Licences to operate in early childhood education and care* | **Three**: "education and care services", "home-based services", "hospital-based services". Kōhanga reo, kindergarten and playcentre are not named as separate categories. Playgroups "are not licensed, but they can choose to be certified" |
   | MoE, *Laws and regulations for early learning services* (the regulatory framework) | **Four**: "centre-based services — including kindergartens, playcentres, education and care services, puna reo, reo rua education and care", "home-based services", "hospital-based services", "Te Kōhanga Reo" |

   The two disagree on granularity and on whether Te Kōhanga Reo is its own licensed type.
   CHECK-constraining a column to either list would be asserting a classification nobody here has
   verified, which [AGENTS.md §7](../../AGENTS.md) forbids by name — the same rule that keeps
   `0080`'s nine code sets empty.

**To close it properly, in order:** (a) the ELI service-type code list, which is
[enquiry](../../docs/eli-ministry-enquiry.md) question 6's territory — where the lists are published
and in what form; (b) transcribe the sessional and home-based schedules from Schedule 2 with the
same row-by-row discipline as 2026-08-18, and extend `RATIO_TABLES_VERIFIED` to say *which*
schedules it covers rather than being one boolean; (c) then, and only then, the column — at which
point every existing caller already has the parameter waiting.

**The generalisable part.** An optional parameter that no caller supplies is not a seam, it is a
default nobody chose, and it reads as configurability in a code review. This one was designed in
correctly, plumbed through three modules correctly, and has produced a single hard-coded schedule
for the life of the product. **Grep for who actually passes it** before believing a design is
service-type-aware.

### 52. RS7 needs round-to-nearest and every hours figure in this product floors — **CLOSED 2026-09-05**

| | |
|---|---|
| **What would be asserted** | That the RS7 daily counts can be produced from the same hours arithmetic the funding screen already uses |
| **Why it cannot** | `toHours(minutes)` (`packages/core/src/hours.ts:195`) **rounds down, always**, and that is deliberate: a preparation figure must never overstate what a service may claim. Funding Handbook §9-4 directs the opposite for the staff hour count — *"Round the total to the nearest hour. For example: 68 hours and 30 minutes would be rounded to 69 hours whereas 68 hours and 29 minutes would be rounded to 68 hours."* |
| **And the schema agrees the figures are whole** | `RS7DayCount` is `xs:restriction base="xs:int"`, `minInclusive="0"`, `maxInclusive="9999"`. Retrieved from `https://eli.minedu.govt.nz/eli.xsd` on 2026-09-03. So there is no decimal escape hatch: a rounding rule has to be chosen, and the two callers need different ones |
| **Size of the error** | Up to 30 minutes per figure per day, in the service's favour or against it depending on the minutes. On a staff hour count of ~69 hours that is under 1%; across a four-monthly return it is a systematic bias in one direction, which is the kind auditors notice |

**Why this is recorded before the code exists.** Because the obvious implementation is to reuse
`toHours`, it would pass every test written against it, and the resulting bias would be invisible —
the figure would look exactly like a correct one. This is the same shape as the ratio tables being
verified for one service type and applied to all of them: right helper, wrong context, no symptom.

**What must happen:** RS7 gets its own rounding, `toHours` is left alone, and neither calls the
other. A shared helper with a `mode` parameter is the tempting middle path and is worse than both —
it puts the choice at the call site where it will be got wrong once, silently, on a Crown return.

~~**Not yet checked**, and it belongs to whoever transcribes §9-2 and §9-3: whether the *child*
hour counts round the same way as the staff hour count.~~

**CHECKED 2026-09-04, and they do — §9-2, verbatim:** *"Round the total to the nearest whole
number. Numbers ending in 0.5 or above should be rounded up to the next whole number. Numbers
ending in 0.4 or below should be rounded down to the previous number."*

**And it rounds something different from what I assumed.** That instruction is step 5 of the
under-2 calculation, and step 4 is *"Add together the claimable hours for each day"* — so what gets
rounded is the **daily total across children**, not each child's hours. Rounding per child and then
summing gives a different answer, and it is the answer a per-child calculation would naturally
produce. `RS7DayCount` being an integer 0-9999 is consistent with a rounded total, not with a sum of
rounded parts.

So item 52 now has two parts: RS7 must not reuse `toHours` (which floors), **and** it must round
at the aggregate rather than at the child.

**CLOSED 2026-09-05 — `packages/core/src/rs7.ts` does both, and the drill proves it does.**

`roundToNearestHour` is **not exported**, so nothing outside that file can reuse it and no shared
helper with a `mode` parameter exists — the tempting middle path, and the one that puts the choice
at a call site where it gets got wrong once, silently.

The aggregate half is asserted with three children attending 2.5 hours each on one day:

| | |
|---|---|
| per child, rounded first | 3 + 3 + 3 = **9** |
| per child through `toHours` | 2 + 2 + 2 = **6** |
| aggregate, rounded once | 7.5 → **8** |

Three answers from the same attendance, and only 8 is what §9-2 asks for. Both wrong answers are
in the mutation drill and both are caught.

**A third figure this item did not anticipate:** §9-2's step 5 rounds *"0.5 or above… up"* and
*"0.4 or below… down"*, so a 2.4-hour day and a 2.5-hour day must land on different integers.
`toHours` floors both to 2. That is asserted separately, because a "round to nearest" that happened
to floor would pass every other test here.

**And since 2026-09-05 it is also asserted against live Postgres**, which the closure above was not.
`reconcile:funding` gives its agreement child one booking block of five and a half hours and asserts
the RS7 figure for that date is 6. Flooring `roundToNearestHour` returns 5 and fails that assertion
and no other. Worth the addition for a specific reason: the first version of that section passed
35/35 with every figure a whole number, so it could not have told the two rules apart at all — a
drill in which flooring and rounding agree is not evidence about which one is running.

### 63. RS7's daily figures need three allocations the Handbook does not make — **OPEN, added 2026-09-05**

Everywhere else this product **reports rather than adjusts** when a rule is ambiguous. That option
is not available in `rs7.ts`, and the reason is structural rather than a lapse: **RS7 asks for a
daily figure and the Handbook's rules are weekly.** A projection onto days is forced, so the choice
is not "assume or report" but "assume and disclose, or produce nothing at all".

All three are chronological — hours are claimed as they occur — which is the only order that
preserves the weekly totals the Handbook *does* state. Each is returned in `assumptions` and only
when it actually applied to the period.

| # | The allocation | What the Handbook says |
|---|---|---|
| 1 | **Which days lose the excess when a week hits the 30-hour cap.** The later days do. | §9-2 states the maximum and never says which days go. `funding.ts:449` refuses a `fundedByDate` for exactly this reason and says so |
| 2 | **Which of a week's hours are 20 Hours ECE and which are Plus 10.** The first twenty, in date order. | §9-3 caps 20 Hours at 20 a week and calls Plus 10 *"the remainder (up to 30 hours)"* — a weekly split, with no daily one |
| 3 | **Which replacement child loses hours under §6-4.** The largest claim first. | §7-7 names *which side* goes (*"without claiming funding for that replacement child"*); it does not choose among several candidates |

**Why (3) is smaller than it looks, which the mutation drill established rather than argument.**
At the aggregate the tie-break only changes an answer when the candidates sit in **different
buckets** — two two-and-over casual children lose the same five hours from the same figure
whichever is picked. It matters when one is under two and the other is not, and that case is now
asserted. Largest-first is chosen so the figure can never run high.

**Direction of each:** (1) and (3) under-claim or are neutral. (2) does not change any total — it
moves hours between two figures that are both on the return, so a wrong daily split misstates the
composition of a correct week.

**To close it:** the RS7 Return Specification 6.0, which we do not hold — it is in the list
requested with the password in the enquiry sent 2026-09-03. A specification that states a daily
figure almost certainly states how it is derived.

### 53. Two places now record which days a child attends — **NARROWED 2026-09-05; the screens no longer disagree**

| | |
|---|---|
| **What is asserted** | Nothing yet, and that is the point: `enrolments.days` and `child_booking_schedule` both record which days a child attends, and nothing decides which one is right when they disagree |
| **Where** | `enrolments.days smallint[]` (0004) and `public.child_booking_schedule` (0085) |
| **Measured before shipping the second one** | `enrolments.days` is **display-only**. `formatDays()` renders it on the children list (`children/page.tsx:175`) and on the enrolment row (`EnrolmentPanel.tsx:309`, was `:105` before the panel grew), and **nothing** in funding, ratios, the roll or the forecast computes with it |
| **Sharpened 2026-09-05, and it got worse rather than better** | It is no longer "not yet a duplicated *computed* fact". `child_booking_schedule` is now computed with — §9-2's hours source, §6-5's *"enrolled to attend"*, §6-7's comparison — while `enrolments.days` is still what two screens render. **So the two can now disagree in front of a user**: a children list saying Mon/Wed beside a funded figure derived from a Tue/Thu schedule, with nothing on either screen saying which one the money came from. That is a sharper hazard than two recorded copies, and it arrived by building the thing this item said to build |
| **Why it is a hazard anyway** | It is a duplicated *recorded* fact, in a repo where two hand-maintained copies of the design tokens diverged silently — a page background of `#fafaf9` against `#faf9f7`, and a muted grey a full contrast point worse than the value the contrast test asserted. `tokens:check` exists because of it |
| **The stated rule** | **Where a schedule block exists it is authoritative; `enrolments.days` is the coarse older form.** Written into `0085`'s header and the table comment |

**Why the collapse was not done in the same migration**, which is the part worth keeping. Deriving
the display from the schedule and dropping the column is the obvious tidy-up, and it would have
been wrong on the day it shipped: `child_booking_schedule` is **empty**, so a reader that preferred
it would show every existing child as having no days. The same reasoning that keeps `0080`'s code
sets empty rather than seeded — a mechanism with no data in it must not be allowed to overwrite the
answer that does exist.

**To close it, in order:** ~~(a) a screen that writes schedule blocks, so the table stops being
empty~~ **built 2026-09-04** — a section on the child record's Documents tab, beside
`EnrolmentPanel`, under `manageCentre`; (b) a backfill deriving one open-ended block per weekday
from `enrolments.days`, with the times left null or stated as unknown — **and that is where this
gets interesting, because `days` carries no times and the new table requires them**, so the
backfill cannot be lossless and has to decide what an unstated time means; (c) then, and only then,
derive `formatDays` from the schedule and drop the column.

~~**Step (b) is now the urgent one, not the tidy one.**~~ **The interim shipped 2026-09-05 and the
screens no longer disagree.**

`weekdaysOn(blocks, asAt)` in `weekdayBlock.ts`, and both render sites use it: the children list and
`EnrolmentPanel`. Where a booking-schedule block covers today, the row shows **the agreement's**
weekdays and is flagged `agreement`; where none does, it falls back to `enrolments.days` exactly as
before. So a screen can no longer show Mon/Wed beside a funded figure derived from a Tue/Thu
agreement.

It honours the effective window, which is the part that makes it safe to display: a block that
ended last term does not vote. `enrolments.days` has no history at all, so a naive union over every
block would have introduced a *new* disagreement in the direction nobody would check.

**What is still open, and it is the original item.** Two places still RECORD the fact.
`enrolments.days` is still written by the enrolment form and is still what a child with no schedule
shows. Step (b) — the backfill — remains blocked on deciding what an unstated time means, and step
(c) on it. What has gone is the *visible* contradiction, which was the part that could mislead
somebody today.

**Do not close it by deleting `enrolments.days` alone.** It is what two screens render today, and
the enrolment form writes it.

#### The mobile half, 2026-09-05 — and it was worse than an unqualified label

The web fix left `apps/mobile/components/ChildCard.tsx` rendering
`enrolment ? formatDays(enrolment.days) : 'Not enrolled'`, which this item had recorded as the
remaining disagreement — a day pattern on the roll educators actually carry, unqualified.

**It was not showing the wrong days. It was showing "Not enrolled" under every child.** Both call
sites — `RollScreen` and `TamarikiScreen` — pass `enrolment={undefined}`, and always have;
`useRoll` fetches children, attendance, health and the adult count and nothing else. So the ternary
had one reachable branch, and every child on a roll composed entirely of enrolled children was
labelled as not enrolled.

**Removed rather than wired.** Wiring it means fetching enrolments *and* `child_booking_schedule`
down the mobile path with an offline story attached — and rendering `enrolments.days` there would
reproduce on the phone the exact disagreement this item names. The day pattern is also not what the
roll is for: it answers who is here now, and an educator at the door cannot act on which weekdays a
child is booked. Same judgement the child record made about an empty "Learning" tab.

The `enrolment` prop, the `Enrolment` and `formatDays` imports and the orphaned `meta` style went
with it. The consent row now renders only when there is a consent gap — it was previously always
present because the false text always filled it.

**What this says about the item generally:** a prop that no caller has ever supplied is not a
feature with a bug, it is a design that was never finished, and a ternary is very good at hiding
which of those you have. The web fix was found by reading the code; this one was found by asking
what the callers actually pass.

### 54. The funded-hours figure over-states for a child with no 20 Hours attestation — **CLOSED 2026-09-04, the same day it was opened**

| | |
|---|---|
| **What is asserted** | On `/funding` and in its CSV: that the funded-hours column is what the service may claim |
| **Where** | `childFunding` in `packages/core/src/funding.ts` — `if (!input.twentyHoursEce) return { date: day.date, hours };`, and the weekly branch immediately below it |
| **What it does** | For a child **without** a 20 Hours ECE attestation, applies **no cap at all**. A nine-hour day contributes nine funded hours |
| **What the Handbook says** | §9-2, read 2026-09-04: *"a maximum of 6 hours can be claimed each day for each licensed child-place"*, to *"a maximum of 30 FCHs per child-place per week"*. Those are **ECE Funding Subsidy** limits and they do not depend on a 20 Hours attestation |
| **Why the code did it** | A comment that read *"there is nothing to cap without the entitlement, and pretending otherwise would understate an ordinary fee-paying enrolment"*. It conflates two separate pieces of Crown funding: 20 Hours ECE, and the ECE Funding Subsidy that an ordinary fee-paying enrolment still attracts |
| **Size** | Up to 3 hours a day per child on a nine-hour day, and unbounded over a week — a child attending 40 hours shows 40 where 30 is the maximum |

**Why this one is worse than the two under-claims beside it.** Every other known gap in this
file — absence funding, Plus 10 — makes the figure too **low**, and `exportDisclaimer` has said so
in as many words since it was written: *"the total may be lower than what you are entitled to
claim."* A manager who has been told the numbers only ever run low has been given a reason **not to
check the long days**. That sentence was true about the gaps somebody had thought about and false
about this one.

~~**Fixed in the disclaimer today, not in the arithmetic.**~~ **CLOSED the same day, in Phase 2b.**
The caps are now 6 a day and 30 a week for **every** child, and the disclaimer's over-statement
sentence came out with the defect rather than lingering as a stale caveat — a test now asserts its
**absence**, which is the only way to stop a warning surviving its own fix.

Three assertions changed direction with it, and each is worth naming because each had encoded the
defect: the unit test *"does not cap a child without the attestation"* expected 8 and now expects 6;
*"does not cap weekly for a child without the attestation"* expected 40 and now expects 30; and
`scripts/reconcile-funding.ts` asserted `funded is 16.00 — the caps must NOT apply without the
attestation`, which was hand arithmetic **verifying a four-hour over-statement** in a script whose
entire purpose is catching that.

~~**The reconcile drill was NOT run**, and that is a real gap in this closure rather than a
formality: it needs `ECE_DRILL_PASSWORD`, the demo centre owner's own login, which is not available
here. Its hand arithmetic is updated and it typechecks; nobody has watched it pass.~~

**RUN 2026-09-05, and the gap is closed.** The password requirement was itself the defect — the
drill now provisions its own manager account on a `.invalid` address with a fresh random password
each run, so `ECE_ALLOW_DEMO_SEED=yes npm run reconcile:funding` is the whole command. The corrected
arithmetic for this item — `funded is 12.00`, both eight-hour days capped — passes against live
Postgres, watched. Same disclosure as [[design-system]] made for the same reason, now discharged.

**What Phase 2b has to get right, and it is more than adding a cap:** §9-2 calculates the
2-and-over subsidy *"less any hours for children claimed as 20 Hours ECE"*, so the four RS7 child
figures are **mutually exclusive buckets** rather than overlapping views of the same hours. A cap
bolted onto the current single `fundedHours` number cannot express that. The caps become 6/day and
30/week for every child, with a 20/week sub-cap on the 20 Hours component and the remainder to 30
as Plus 10.

### 55. Funded hours are derived from attendance, and for a permanently enrolled child the Handbook starts from enrolment — **CLOSED 2026-09-04**

> **The claim that this product's funding error only ever runs LOW went conditional and is now
> restored — 2026-09-04, both within a few hours.**
>
> It held while attendance was the only source. The agreement basis broke it in one place: §6-5
> stops absence funding from the date a family gives notice, and **nothing recorded notice**, so the
> window ran its full length. For a few hours the honest position was a disclaimer telling the
> service to go and check.
>
> **`0093` closes it.** `enrolments.notice_given_on` and `notice_given_by`, wired through
> `readFundingPeriod` into `classifyAbsences`, which has refused sessions from the notice date since
> the day it was written and had nothing to refuse them with.
>
> **The promise is qualified rather than fully restored, and the qualification is real:** a service
> that never records notice still gets the full window. What changed is that recording it works. Same
> shape as §9-2 — the capability is the fix, the data is the service's. `exportDisclaimer`'s caution
> stays for that reason.

| | |
|---|---|
| **What is asserted** | By this whole phase, including the sentence at the top of [[funding-and-billing]]: *"A funding claim comes from `attendance_events`: the Crown pays for hours actually delivered, and a claim built on what was planned would be a claim for hours nobody observed"* |
| **What §9-2 says** | Read 2026-09-04. Step 1: *"List the daily number of hours of **enrolment** for each permanently enrolled child under 2 years of age."* Step 2, separately: *"If any children under 2 years of age attended the service on a casual or conditional basis, list the number of hours each of these children **attended**."* |
| **So the source differs by enrolment type** | Enrolment hours for a permanent child; attended hours for a casual or conditional one. This product uses attended hours for both |
| **Why it is not simply "attendance plus absence funding"** | Those arrive at the same number when a child attends exactly as enrolled, but the derivation is different — and the derivation is what an auditor follows. Starting from the agreement and deducting unclaimable absences is not the same computation as starting from attendance and adding claimable ones, and the two diverge the moment a child attends *more* than the agreement |

**This is why `0085` was built**, and it is a larger finding than the absence rules it was built for.
The product had no record of enrolment hours at all until `child_booking_schedule`, so it could not
have started from the agreement even if somebody had read §9-2. Now it can — but the table is empty,
so nothing changes until a screen fills it.

**NARROWED 2026-09-04: `childFunding` can now do it, and no caller asks it to.** The function takes
an optional `agreement` and returns a `hoursBasis` with four values — two correct by the Handbook and
two that under-claim:

| Basis | Meaning |
|---|---|
| `agreement` | §9-2 step 1. Permanent child with booking-schedule blocks: the agreement is the source and the absence rules decide how much survives. **The only basis that can claim an absence** |
| `attendance` | §9-2 step 2, and **correct rather than a fallback** — for a casual or conditional child attendance *is* the rule |
| `attendance-no-agreement` | Permanent, but no blocks. Under-claims. **Every existing child is here** |
| `attendance-type-not-stated` | `enrolment_type` is null. Under-claims deliberately, because assuming permanent would over-claim |

**WIRED 2026-09-04, and the hazard was real.** `readFundingPeriod` now reads the agreement, the
operating calendar and the §7-7 exemptions, and the funding page says on any row that under-claims
which basis produced it. The filter was the trap it looked like: it dropped children with
`attendedHours === 0 && unresolvedDates.length === 0`, which is **exactly** a permanent child whose
claim is entirely absence-based — so the whole change would have been invisible, with the figure
right and the child missing from the report. It now also keeps a row with funded hours or with
unclaimable absences, the second being the most actionable row on the page.

#### What was left was one column, and it was an OVER-claim — closed the same day by `0093`

§6-5 stops a claim when a parent gives notice the child will not return, *"even if the three week
period has not ended"*, and the Ministry recovers anything claimed after that point. For a few hours
**nothing in this schema recorded notice**, so `noticeGivenOn` was passed as null and the window ran
its full length. `enrolments.end_date` was never it: notice comes first, and the end date may be
later or absent entirely.

`0093` added `enrolments.notice_given_on` and `notice_given_by`, paired by a CHECK so a date cannot
exist without the guardian who gave it, and `readFundingPeriod` passes it
(`packages/api/src/billing.ts`). **This product now knowingly contains no over-claim in the absence
calculation.**

**Two later commits closed the rest of the absence work**, which is why this item is CLOSED rather
than partly so: §6-7's monthly check, and §6-4's cross-child detection. §6-4 is *detected and
reported* rather than deducted — a place can still be claimed twice in `fundedHours` with a sentence
on the screen saying by how much — but that is item 57's remaining question, not this item's. The
hours **source** question this item was opened about is answered: a permanently enrolled child with
a recorded agreement is funded from the agreement, and `hoursBasis` names the source of every
figure.

**What is NOT closed by this**, and is tracked elsewhere: `FUNDING_RULES.hoursSource` stays `false`,
because a permanent child with no recorded booking schedule still falls back to attendance and
under-claims. That is a data gap the product reports per child, not a calculation gap.

**The sentence in [[funding-and-billing]] is not wrong so much as half-right**, and it is corrected
there rather than deleted, because the reasoning behind it is sound: a claim for hours nobody
observed *is* the hazard, and the Handbook's answer is that for a permanently enrolled child the
observation that matters is the **agreement plus the absence rules**, not the turnstile.

**Closed 2026-09-05**, two days after the gap it named was filled — found by re-reading this register
during a status check rather than by the commit that fixed it, which is the failure mode
[[conventions]] warns about from the other direction. The commit message for `0093` said it closed
the product's one over-claim; it did not say so here.

### 56. Whether the RS7 two-and-over subsidy figure excludes Plus 10 hours or only the first twenty — **OPEN, added 2026-09-04**

| | |
|---|---|
| **What would be asserted** | By any `rs7.ts` that aggregates the per-child figures: that it knows which hours belong in `SubsidyFundedChildTwoAndOverCount` |
| **The instruction** | §9-2, read 2026-09-04: the 2-and-over step is *"Repeat Step 1 (above) for children aged 2 or over **less any hours for children claimed as 20 Hours ECE**."* |
| **The ambiguity** | Do the Plus 10 hours count as *"claimed as 20 Hours ECE"* for the purpose of that deduction, or only the first twenty? §14-4 lists the two fields as *"daily total of 20 Hours ECE Funded Hours (20 Hours ECE)"* and *"daily total of 20 Hours ECE Funded Hours (Plus 10)"* — both under the heading **20 Hours ECE Funded Hours**, which suggests both are deducted. But it is a heading, not a rule |
| **Why it matters** | It decides whether an attested child's Plus 10 hours appear **once** (as Plus 10) or **twice** (as Plus 10 and again inside the 2-and-over subsidy). Getting it wrong double-counts up to ten hours a week per child on a return to the Crown |
| **Why it is not decided in `funding.ts`** | It changes an RS7 **aggregate**, not the per-child split, which is unambiguous. `childFunding` computes `twentyHoursHours` and `plusTenHours` from §9-3's plain wording; how they are then bucketed into the four RS7 counts belongs to `rs7.ts`, and that file does not exist yet |

**Deliberately not resolved by inference.** The heading argument is suggestive and this repo has been
wrong once already by treating a suggestive shape as a rule — the census's contact hours, item 50,
where the XSD's shape said contract and the Handbook said actuals. A field grouping is a weaker
signal than that shape was.

**To close it:** the RS7 Return Specification 6.0, or §9-2's worked examples — the page names two,
*"Kowhai Street Childcare Centre is an all-day service and Huia Playcentre is a sessional service"* —
which would show the arithmetic directly. Reading those examples is the cheapest route and is the
next thing to do before `rs7.ts` is written.

### 57. The funding caps are per licensed child-place and this product applies them per child — **REPORTED as of 2026-09-04, still not APPLIED, and the split is deliberate**

| | |
|---|---|
| **What is asserted** | By `childFunding`: that 6 hours a day and 30 a week is a limit on a **child** |
| **What the Handbook's Glossary says** | Read 2026-09-04. A funded child hour is *"an **occupied child-place** that is funded for 1 hour"*, and services may be funded *"for up to 6 FCHs **per child-place** per day, to a maximum of 30 FCHs **per child-place** per week"*. A child-place is *"each place for a child for which a service is licensed. Child-places may only be used by 1 child at a time but **may be used by more than 1 child during the course of a day**"* |
| **The consequence** | Two children each attending four hours may share one child-place — eight hours occupied on a place that can yield six. Per child, this product claims 4 + 4 = **8**. Two hours nobody was entitled to |
| **Direction** | **Over-statement in aggregate**, and invisible from inside the calculation: `childFunding` receives one child and cannot see the other |
| **When the approximation is exact** | An all-day service where each child holds a place for the whole day. It is wrong for a **sessional** service, where a morning child and an afternoon child share the place — which is exactly the distinction `centres.service_model` (0083) now records |

**It also settles a discrepancy this repo had recorded as unresolvable.** §9-2 says *"per licensed
child-place"* and §9-3 says *"per child"*; `funding.ts` noted both and applied the per-child reading
because that is what it could see. The Glossary is the tie-break and §9-2 was the accurate one.

**Two other Glossary definitions land in the same place, and they are sharper than the words
suggest.** *Conditional* enrolment is *"Enrolments of children who are on a waiting list and that
are **above** the service's licensed maximum number of child-places"* — so it does not mean
*provisional*, it means **over capacity**, which is why §6-4 funds those children on attendance
only. And *permanent* is *"Enrolments that are **within** the service's licensed maximum number of
child places and where the child is entitled to attend for the enrolled hours on a regular, ongoing
basis"*. Nothing here enforces either capacity condition, though `centres.licensed_places` (0050)
is the denominator both need.

**Why this is not a constant to change.** The calculation has to move from per-child to
per-place-per-day. `childFunding` takes one child; `readFundingPeriod` does not even fetch
`licensed_places`; and that column is **nullable**, so for a centre that has not stated its licence
a per-place cap cannot be computed at all — the same missing-denominator problem `0050` documented
for occupancy, arriving somewhere it changes a funding figure rather than a percentage.

**AND IT IS THE SECOND INDEPENDENT REASON FOR THE SAME RESTRUCTURING**, which is the part worth
keeping. §6-4 already said *"Funding must not be claimed for both an absent permanently enrolled
child under an absence rule and for the conditional or casual child who fills the absent child's
place."* That is also a statement about a **place** rather than a child. Two rules, read four days
apart from different chapters, both saying the unit of funding is a place and not a child.

**So absence funding was NOT built on top of this.** Implementing §6-5 to §6-7 per child, over a
per-child cap that should be per-place, would compound one wrong unit with another and produce a
figure that is harder to correct than the one it replaced.

---

#### Corrected the same day: the restructuring is smaller than the paragraph above claimed

That paragraph said the calculation has to move from per-child to per-place. **It does not**, and
the arithmetic settles it: the per-child cap is **exact** whenever a day's children do not outnumber
the licensed places, because `sum(min(hᵢ, 6)) ≤ 6N ≤ 6P`. It over-states only when N > P — a
sessional service where a morning child and an afternoon child share a place, or a day with
conditional enrolments, which the Glossary defines as being *above* the licensed maximum.

So the fix is an **additive aggregate cap**, not a restructuring, and the per-child figures stay
exactly as they are for every all-day service that is not over-subscribed.

#### What was built: the reporting half

`placeCapExceedances({ children, licensedPlaces, caps })` in `packages/core/src/funding.ts`,
reported on `/funding`, with six tests and a mutation drill on the three-state contract.

- **Three states, and `null` is not `[]`.** Null means the centre has not stated its licence, so the
  question was not asked; `[]` means checked and every day is inside it. The screen renders null as
  a sentence pointing at Settings, not as reassurance — the `overdue: null` contract, and the same
  reason `0050` makes the occupancy report decline a percentage without a denominator. The mutation
  drill collapsed null to `[]` and the suite failed on exactly that assertion.
- **It changes no figure**, and that is the decision rather than an omission. Trimming the excess
  needs an attribution rule — *which* child's hours go — that nothing read so far supplies, and RS7
  needs the surviving hours split by age band and 20 Hours status, so an invented trim would
  propagate into a Crown return. The day and the amount are named instead, which is the treatment a
  broken attendance day already gets.
- **`ChildFunding.dailyCappedByDate`** was added to make the day-level check possible, and it is
  named for what it is: hours **before** the weekly cap. There is deliberately no `fundedByDate`,
  because when a week is capped the Handbook states the maximum and does not say which days lose the
  excess. `sum(dailyCappedByDate) === fundedHours` only when no week was capped, which is an
  uncomfortable invariant and the honest one — a single plausible `fundedByDate` would have hidden
  it.

#### The attribution question is narrower than this item has been saying — 2026-09-04

*"Whose hours are not claimable"* is answered by the Handbook for one case, and it was sitting two
chapters away the whole time. §7-7: *"Another child may attend the absent child's place **without
claiming funding for that replacement child**."*

So where an excess involves a claimed absence and a casual or conditional child attending, the
replacement child's hours are the ones not claimed. That is a quotation and not a reading, and
`sixFourOverlaps` now detects those days and names the amount — see [[funding-and-billing]].

**What that leaves genuinely open** is the general case: a day over `6 × licensed places` with no
claimed absence in it, which is two present children sharing a place, and there §7-7 has nothing to
say. That is still the enquiry question, and it is now a narrower one.

**And the second blocker is not attribution at all.** Even with the rule known, a trim applied in
`funding.ts` propagates into RS7's age-band and 20 Hours splits, and choosing which casual child
among several loses their hours is a judgement the Handbook does not make. Naming the day and the
amount is what a preparation export is for.

#### What is still open

Applying the cap in the general case, which needs the attribution rule for a day with no claimed
absence; enforcing the two capacity conditions the Glossary attaches to *permanent* and
*conditional* enrolments; and `centres.licensed_places` being **nullable**, so for a centre that has
not stated its licence the capacity half cannot be computed at all — which is why `sixFourOverlaps`
reports a `capacity-unknown` day rather than skipping it.

### 58. §6-1's enrolment record — **CLOSED 2026-09-04**

**Opened and closed the same day, in four commits, and the register should say so rather than read
as though it was always this.** As first written, three of §6-1's required contents were absent.
`0086` added the residential address and the commit after made it reachable; `0087` added the last
two — the other-service hours and the dated parent signature — and the commit after **that** made
them writable.

**Why it did not close on the migration.** `0087` landed schema-only, and a column nothing writes
satisfies no rule. The specific trap was narrower than that: writing the fields on
`fileEnrolment` alone would have made them reachable **only at creation time**, leaving every
enrolment already on file permanently incomplete — re-filing is not something a service can do,
because the overlap constraint correctly refuses it. So `completeEnrolmentRecord` exists, and the
panel offers it on every row rather than only on incomplete ones, since a signature recorded against
the wrong parent has to be correctable.

**What is not built, named so it is not mistaken for done:** a centre-wide readiness list. Gaps are
named on each child's record; a manager wanting to know which of eighty children have incomplete
records has no screen. That is a reporting feature rather than a compliance gap. See
[[funding-and-billing]] for the field-by-field map.

**Two interpretations `0087` had to make, neither of them quotations:**

1. **The other-service hours are recorded per week.** §6-1 says *"the hours the child is enrolled at
   another service"* without naming a period. Weekly is chosen to match `funded_hours_per_week` on
   the same row and the weekly cap the figure feeds. If the Ministry means something else — hours per
   day, or total across the enrolment — the column name is wrong rather than the data.
2. **One signature covers the whole record.** §6-1 item 5 asks for a dated signature attesting to
   *"the accuracy of the enrolment record"*, so the other-service hours get no signature pair of
   their own: they are part of the record being attested. The booking schedule **does** get its own
   pair, and that is not the same interpretation — §6-1 asks separately for changes to the agreement
   to be *"signed and dated"*, which is a different act on a different date.

§6-1 lists what an enrolment record must contain. Measured against the schema on 2026-09-04:

| Required | State |
|---|---|
| *"official name, date of birth, and home/residential address, and the child's preferred surname and first name"* | **Done.** `children` had all but the address; `0086` adds it |
| *"the date the child commenced attendance … and their finish date"* | Already there — `enrolments.start_date` / `end_date` |
| *"the days and times each child is expected to attend, and details of any later changes to the agreement **signed and dated by at least one parent/guardian**"* | **Half.** `0085` holds the days and times and `2A` made them editable. **The signature on a change does not exist** |
| *"**attestation by the child's parent/guardian of the hours the child is enrolled at another service** (including none if appropriate)"* | **Column exists** — `0087`, `hours_at_other_service_per_week`, three-state. **Nothing writes it** |
| *"**a dated signature of at least one parent/guardian** to attest to the accuracy of the enrolment record"* | **Columns exist** — `0087`, `signed_on` / `signed_by`, guardian-referenced. **Nothing writes them** |
| National Student Number | Already there — `children.moe_nsn` |

**Why the other-service hours matter more than they look.** The 6-hour daily and 30-hour weekly caps
follow the **child**, and a child enrolled at two services can exceed them between the two. That is
also what §7-7 rests on when it says a child with learning-support needs *"enrolled at 2 services
for the same hours of attendance cannot be funded for absences at both"*. So this is not an
administrative field — it is an input to a cap this product currently applies as though each service
were the only one.

**And it is unenforceable from here, which has to be said.** `enrolments_no_overlap` is scoped by
`child_id` **across centres**, so this database already refuses a child holding two overlapping
enrolments *within it*. A second enrolment at another provider is invisible. The attestation is the
only instrument, which is presumably why the Handbook asks the parent for it rather than expecting
the service to know.

**A defect this reading found in `0084`.** `enrolments.twenty_hours_attested_by` references
`auth.users`. The 20 Hours attestation is signed by a **parent or guardian**, and the enrolment
form's own comment says so — *"An attestation the parent signs"*. A guardian may have no account at
all, so that column can only ever hold the id of the staff member who ticked the box, recorded as
though they were the attesting party. The columns are **unwritten** — nothing sets them yet — so this
is correctable without a data migration, and it should be corrected alongside the §6-1 signature
rather than separately, since both are the same shape: a dated act by a named guardian.

**The migration landed as `0087`** — `hours_at_other_service_per_week` (nullable, and **null is not
zero**), `signed_on` / `signed_by` on both `enrolments` and `child_booking_schedule`, the `0084`
correction, and a trigger requiring a signatory to be a current guardian of that child. The `0084`
defect above is **closed**: both columns were counted empty against the live database before the
reference was changed, so no data migration was needed.

**Closed by:** `enrolmentRecordGaps()` and five fields on `Enrolment` in `@ece/core`; the reader and
both writers in `packages/api/src/children.ts`; `completeEnrolmentRecord` beside `fileEnrolment`; the
guardian picker on both panels; and the **Record incomplete** flag that names the missing parts. Five
unit tests, thirteen RLS assertions on the migration, and an e2e test that links a guardian and
completes a record end to end.

### 59. The occupancy average cannot tell a closed day from an empty one — **CLOSED 2026-09-05**

`averageOverOpenDays` (`packages/core/src/occupancy.ts`) filters with `d.children > 0`. It is a
proxy for "the service was open", and it is the only one that existed until `0088`.

**The direction of the error is the awkward one.** A centre that opened on a snow day and had nobody
turn up is averaged as though it had been shut — so the day is dropped from the denominator and the
average is **flattered**. A figure that is too high is the one that gets quoted.

Three consumers, all of them through the same function: the occupancy report's `averageChildren`,
and both of `attendanceTrend.ts`'s summaries (weekly and per-weekday).

**`0088` makes it fixable and does not fix it.** `service_closures` now records which days the
service did not operate, so the proxy has an alternative. It was left alone in that commit
deliberately: changing this average changes a number somebody may already have put in a board paper,
and it needs its own commit, its own assertions, and a sentence on the screen saying what the
average is now over. The migration landing is not the fix, and this entry exists so the two are not
confused.

**THE CLOSURE PLAN ABOVE WAS WRONG, AND IT IS CORRECTED HERE RATHER THAN EDITED AWAY — 2026-09-04.**

As first written this entry said: *"filter on 'not closed' rather than 'somebody attended'"*. That
would have made the figure **considerably worse**, and reading `readAttendanceByDay` before
implementing it is what caught it.

`readAttendanceByDay` returns **one row per day in the window**, `children: 0` included — it is
`days.map(...)` over the window the caller supplies, not a row per day that had events. And the
occupancy page supplies *thirty consecutive calendar days*. So a 30-day window contains **eight or
nine weekend days with zero attendance**, and no service is going to record its weekends in
`service_closures`.

Filtering on "not closed" would therefore admit every Saturday and Sunday as a zero. On a 65-place
service averaging 30 children across 21 weekdays, adding nine zeros takes the average to about 21 —
a 30% drop, presented as a correction.

**What the fix actually needs is the set of weekdays the service operates**, and `service_closures`
does not carry it. The only principled source in this schema is `child_booking_schedule.weekday`
(`0085`) — the union of weekdays any child is enrolled to attend on the date in question, which is
the service's operating pattern by definition. That table **ships empty**, so the fix has to be
three-state like everything else here:

| Operating weekdays known | Then |
|---|---|
| Yes, from the booking schedule | count a day if it is not closed **and** falls on an operating weekday. A day the service was open and nobody came is a real zero and belongs in the denominator |
| No, schedule still empty | fall back to today's `children > 0` proxy **and say so on the screen**, because a figure computed one way must not silently look like a figure computed the other |

**This is not only a reporting concern, which is the other thing the reading changed.** RS7's
`AdvanceMonthCounts` needs *forward operating days by service model* — the same concept, for a Crown
return. So "which days does this service operate" is a funding primitive that two separate
consumers want, and building it for the occupancy average alone would be building it twice.

**CLOSED 2026-09-05, and the plan above is what shipped.**

`operatingDays({ blocks, closures, from, to })` in `packages/core/src/closures.ts` derives the
operating weekdays as the **union of `child_booking_schedule.weekday`** per date, minus closures,
and returns a three-state `basis`:

| `basis` | Meaning |
|---|---|
| `schedule` | a block was effective on some open day in the range, so the calendar is derived |
| `unknown` | no block was effective anywhere in the range — **nothing is claimed** |

The `unknown` state is the part that matters. An implementation testing `blocks.length === 0` would
answer `schedule` with zero dates for a centre whose schedule expired last year, which reads as a
permanently closed service rather than as one nobody has updated. That mutation is in the drill.

**`averageOverOpenDays` now takes the calendar and returns `basis` and `denominatorDays`**, and
`daysWithAttendance` keeps its old meaning on both bases — redefining it silently would have been
the drift this page exists to prevent. Measured on the fixture: a week with a wet Tuesday and one
day nobody came averages **23.5 over four days** on the old proxy and **18.8 over five** on the
calendar. Nearly five children, in the flattering direction.

Two decisions inside it, both asserted:

- **A closure beats the pattern.** A Tuesday the service was shut is not an operating day even
  though Tuesdays normally are, and `closedDates` is populated on **both** bases because a closure
  is recorded directly and does not need the weekday pattern to be known.
- **A day with attendance the calendar omits is still counted.** The children were demonstrably
  there, so the calendar is what is wrong; dropping the day would hide an attendance record that
  contradicts the schedule.

**And `/reports` renders which basis produced the figure**, in words, because the two give different
answers from the same attendance. On the proxy basis it now says *why* — no booking schedule covers
the period — and points at the record where the days and times are entered. That sentence is the
actual fix; the arithmetic was never the hard part.

**9/9 mutations caught.** Phase 3C consumes the same helper for RS7's `AdvanceMonthCounts`, which
is why it lives in `closures.ts` rather than in `occupancy.ts` where its first consumer is.

#### It was closed on one screen and left open on the next — fixed 2026-09-05

`/reports` got the calendar. **`/reports/trends` did not**, and nobody noticed because the defect
does not announce itself: `summariseWeeklyAttendance` and `summariseWeekdayPattern` both called
`averageOverOpenDays` with no calendar *and discarded the `basis` it returned*, so twelve weeks of
averages were on the attendance proxy and the page had no field with which to say so. Two reports
reading the same attendance could print different averages with nothing on either explaining why.

Both functions now take an optional `OperatingDays` and return `averageBasis` and
`denominatorDays`, and the trends page passes the calendar and renders the sentence — the same one
`/reports` makes, deliberately, because a reader moving between them should not have to work out
that they were computed differently.

**The size of it, from the new test:** week two of the fixture is five weekdays averaging 30.0 on
the proxy. Tell it the service also operated on the Saturday nobody came, and the denominator goes
from five to six and the average to **25.0**. That is not a rounding difference; it is a manager
reading "we average thirty" instead of "we average twenty-five", from one empty Saturday.

**The general lesson, and it is the reason this is filed under a CLOSED item rather than a new
one:** `occupancy.ts` carries the comment *"a screen must render this"* about `averageBasis`. One
screen did. The helper could not enforce it, because a caller is free to destructure two fields out
of four and throw the rest away — which is exactly what both trend functions did. **A contract
expressed as a returned field is a contract only where somebody reads the field.**

### 60. An approved emergency closure is FUNDABLE, and `0088` could not tell one from a term break — **CLOSED on the schema 2026-09-04**

Found by reading [§7-5 Emergency
closure](https://www.education.govt.nz/education-professionals/early-learning/funding-and-financials/chapter-7-special-circumstances/7-5-emergency-closure)
immediately after §7-7, because it sat two links away and was obviously relevant to a closures table
shipped an hour earlier.

**§7-5 in its own words.** An emergency closure is *"when circumstances beyond the control of
individual services cause temporary closures. Closures are normally for 1 or 2 days only."*
Qualifying: *"extreme weather conditions"*, *"interruptions to essential services"*,
*"non-controllable health and safety issues"*, *"civil defence emergencies"*. **Not** qualifying:
*"lack of staff (except when this is due to a non-controllable health and safety issue)"*,
*"person responsible is absent"*, *"funerals in the community"*, *"A&P show"*.

**It needs ERO approval, and it comes back in writing.** *"Contact ERO at the first available
opportunity"* and *"ERO will provide a letter to confirm approval/not approval"*. That is the exact
opposite of §7-7, which needs no approval at all — two sections two pages apart with opposite
processes, which is precisely why reading both mattered.

**And with approval the closed days are claimable.** *"Funding may be claimed for the hours that
children have a permanent enrolment subject to the funding maximums of the ECE Subsidy and 20 Hours
ECE"*, using *"actual booked hours for the day(s) of emergency closure"*.

**So `service_closures` is incomplete in a way that matters.** It has `reason_code` — an
unresolvable `LookupCode` — and `reason_note`, free text. Neither can answer *"is this a fundable
emergency closure with ERO approval?"*, and that question has to be answerable before §6-6 or RS7
can use the table: a term break and a snow day are both closed days and only one of them is
claimable.

**An RS7 detail worth capturing now**: §7-5 says the paper RS7 uses an *"EC" code in the Staff Hour
Count column* for emergency closure days. That belongs to Phase 3D and is recorded here so it is not
rediscovered.

**Closed by `0091`**, which added exactly that: `claimed_as_emergency`, `ero_approval`
(`requested` / `approved` / `declined`, null meaning nobody has contacted ERO) and
`ero_letter_dated_on`, with three CHECKs — an unlisted state is refused, an approval cannot sit on a
closure nobody is claiming, and a letter date cannot exist for a request nobody has answered.

**Three decisions inside it worth keeping:**

- **The claim and the answer are separate columns**, because §7-5 says to contact ERO *"at the first
  available opportunity"* — which is after the doors are shut. They arrive at different times, and
  one column would force the service to wait or guess.
- **`claimed_as_emergency` defaults to false**, so every closure recorded before `0091` is an
  ordinary closure. That under-claims rather than over-claims, which is the one direction this
  product's funding figures promise they never get wrong — a default of `true` would have silently
  turned every term break already on file into a funding claim. Asserted.
- **§7-5's four qualifying circumstances are NOT an enum.** They are prose in a Handbook section,
  not a published code list, and the field meant to hold the Ministry's vocabulary —
  `ClosureReasonCode` — sits on the same row and ships unresolvable. A locally-invented enum beside
  it is the AGENTS.md §7 mistake with an extra trap: somebody would later serialise it. The
  circumstance stays in `reason_note`.

**What remains, and it is arithmetic rather than schema:** nothing computes funded hours from
closures yet. The question is now answerable and no code asks it; that belongs to 2F with the rest of
the absence rules.

### 61. §6-7's sentence and §6-8's examples disagree about month three — **OPEN, added 2026-09-04**

Two Ministry sources, one narrower than the other, and the difference decides whether a funding
claim is legitimate.

**§6-7's own prose:** *"Funding for absences in the third month must only be claimed if the child's
enrolment agreement has been reconfirmed."* One condition — a reconfirmation.

**§6-8's worked examples say two**, in all three of them. Example 1, Kristen, absent more than half
the Fridays in August: *"May claim: August and September enrolled hours; October enrolled hours if
attendance returns to normal in October **OR** enrolment agreement is reconfirmed/changed"*. Example
2 (Sione, fewer hours) and Example 3 (Vijay, fewer days) repeat the same structure with different
months.

So the examples permit a month-3 claim where **attendance simply returned to normal** and nobody
reconfirmed anything. §6-7's sentence does not mention that case at all.

**Why it matters in both directions.** Implement the narrow reading and the product refuses a claim
the Ministry's own examples allow, and tells a service to go and collect a signature it does not
need. Implement the permissive reading and the product may claim a month the Handbook's binding
prose says requires a reconfirmation. The first under-claims, which is this product's stated safe
direction; the second is a Crown return asserting something the rule may not permit.

**This is not a reading error.** The plan's earlier one-line summary of §6-7 had the narrow version —
*"month 3 claimable only if reconfirmed"* — which is what §6-7 says and is why the disagreement only
surfaced when §6-8 was read alongside it. Reading the examples is what found it, and that is now the
third time this week that a companion section changed the answer: §7-5 beside §7-7, §6-8 beside §6-7.

**How this product will behave until it is resolved:** `enrolment_reconfirmations` (`0092`) records
the reconfirmation and nothing computes month-3 claimability yet, so nothing is currently wrong. When
2F lands, the narrow reading applies — under-claiming — **and the surface says which reading it
used**, because a figure computed one way must not silently look like a figure computed the other.

**NARROWED 2026-09-04 by writing the code, and the narrowing is worth recording.**

Implementing the narrow reading made the disagreement mostly disappear, which was not the expected
result. §6-8's extra route is *"attendance returns to normal"* — but a month where attendance
returned to normal **does not trigger §6-7 at all**, so it ends the run, and its own absences are
claimable under the 50% test with no reconfirmation needed. The two readings therefore agree on
every one of §6-8's three worked examples.

Where they can still part company is one edge: a month that returns to normal *overall* while
failing a single trigger — absent three of four Fridays, say, while attending everything else. The
narrow reading refuses that month's absences without a reconfirmation; the permissive one might
allow them. The product under-claims there, and says which reading it used.

**To close it:** ask, but ask the sharper question. Not "which reading is right" — "does a month
that fails one of the three triggers count as attendance returning to normal for the purposes of a
third-month claim?" That is answerable in a sentence and it is the only case the two sources
actually decide differently.

### 62. §6-7's closure extension is reported and deliberately not applied — **OPEN, added 2026-09-04**

§6-7: the rule *"may be extended"* across *"periods of two or more weeks of non-operation
(holidays, renovations, etc.)"* — the same clause as §6-6, which suspends the Three Week Rule.

**What is unverified is not whether the clause exists but what it does.** Three things are unstated:

- **By whom.** "May be extended" does not say whether a service applies it, or whether the Ministry
  does on request. §7-7's exemptions are the pattern of a rule a service applies with its own
  paperwork; §7-5's emergency closures are the pattern of one where a letter comes back. This
  clause reads like neither.
- **By how much.** §6-6 is specific for the Three Week Rule: the window stops spending while the
  service is closed. §6-7 counts calendar months, and a closure that eats half of September does
  not obviously make September not a month.
- **In which direction it may be applied.** Extending pushes months 3 and 4 later, so **more**
  months become claimable.

That last point decides the behaviour. Applying an extension on an inference would raise a Crown
claim; not applying it lowers one. So `assessFrequentAbsence` keeps counting the run through a
closure of two weeks or more and **reports the closure as a gap on that month**, naming the clause
and saying the extension was not applied. Same posture as the place cap (item 57): reported, never
applied, and visible on the surface rather than buried in a comment.

**How this product behaves today:** the run counts every month, so a service with a three-week
Christmas closure inside a frequent-absence pattern reaches month 4 sooner than it might be
entitled to and claims less. The gap text tells them why.

**To close it:** the third question for the Ministry enquiry, and it is cheap to ask alongside the
item 61 question because both are about the same rule.

### 64. RS7's advance months are four, and nothing says four ahead of what — **OPEN, added 2026-09-05**

| | |
|---|---|
| **What is asserted** | By `rs7AdvanceMonths`: that the four `AdvanceMonthCounts` entries are the four calendar months **following the period's last day** |
| **What is actually sourced** | Three things, all from the public schema retrieved 2026-09-03: the element names `AllDayDaysCount`, `SessionalDaysCount` and `ParentLedDaysCount`; that there are up to **four** of them; and that each is bounded `0–99`. Nothing states the anchor |
| **The structural argument for the default** | An RS7 period is four months. The advance counts are four months. *"Advance"* reads as funding paid forward. Three facts pointing the same way — and still an inference |
| **What else it could be** | The four months **of** the period being returned, which would make them a restatement of operating days already covered by the daily figures; or four months from the submission date rather than from the period, which for a return filed late is a different four months |
| **Direction of the error** | Neither. A wrong anchor does not over- or under-claim — it reports operating days for the wrong months, which is a figure the Ministry uses to pay in advance. Being wrong here means a service is funded forward against a calendar it does not have |

**How this product behaves meanwhile.** `firstMonth` is a **parameter**, not a constant, and the
answer is disclosed in `assumptions` on **every** return rather than once in a comment — the screen
and the CSV both carry the sentence *"the schema says there are four and does not say four ahead of
what"*. A mutation removing that disclosure is in the drill and is caught.

**To close it:** the RS7 Return Specification 6.0, which is in the list requested with the password
in the enquiry sent 2026-09-03. A specification that defines a forward count almost certainly says
what it counts forward from. Failing that, it is a one-line question for the next enquiry.

### 65. The sessional and home-based ratio schedules cannot be transcribed from here — **OPEN, added 2026-09-05**

`ratios.ts` transcribes **only** the all-day centre-based tables, and `assessRatio` takes both
tables as arguments *precisely* so another service type can supply different ones — a design
recorded in that file since 2026-09-03, with the note that **no caller anywhere passes them**. So
a sessional or home-based service reading this product gets a confident figure computed from a
schedule that does not govern it, and `ratioInputCaveat()` says so on every ratio surface.

Closing that is Phase 6 of the plan, and it is **blocked on retrieval, not on effort**.

| | |
|---|---|
| **Attempted** | 2026-09-05. `https://www.legislation.govt.nz/regulation/public/2008/0204/latest/dlm1412637.html` — Schedule 2, the page the all-day bands were read from on 2026-06-29 — and the whole-instrument page |
| **Result** | **HTTP 403 Forbidden**, both. The host refuses the fetcher |
| **What was NOT done** | Transcribing the bands from a search-result snippet, or from memory. Either would be inventing regulatory content, which [AGENTS.md §7] forbids by name — and a ratio table decides whether a room is legally staffed, so being confidently wrong here puts a service in breach or tells it a breach is fine |

**This is the second host to refuse.** Education Counts answered two fetch attempts on 2026-09-02
with a Cloudflare challenge and *"was not retrieved"*, which is why nine code-set domains ship
empty. The pattern is worth naming: **a source this product must read row by row is not always a
source this environment can reach**, and the honest response is a recorded gap rather than a
plausible table.

**To close it:** somebody opens the page in a browser and pastes Schedule 2 in full — the sessional
tables for both age bands, and the home-based schedule. The all-day bands were read that way on
2026-06-29 and that reading found a rule nobody knew was missing (*"Up to 3 children of mixed ages
… 1"*), so the row-by-row method has already earned its cost once here.

**Until then** the caveat stands unchanged and `assessRatio`'s table parameters stay unused. The
product records `service_model` and `licence_type` (`0083`) and cannot assess against either, which
is stated in the tranche assessment rather than implied.

#### Re-measured 2026-09-05, and a better option appeared that this item had not considered

Queried against `whois.srs.net.nz` on port 43 — the registry, not a registrar's search box, which
this item records disagreeing with the registry twice in one day in both directions.

| Name | State at 2026-09-05 |
|---|---|
| `doorway.co.nz` | **Unchanged.** `redemptionPeriod` + `pendingDelete`, `Updated Date` still 2026-07-04. Two months after it lapsed it has not been released |
| `doorway.nz` | Registered since 2020, Netregistry placeholder. As before |
| `salix.co.nz` | **Also in `redemptionPeriod` + `pendingDelete`**, created 2017-07-03. Same registrar as `doorway.co.nz` |
| **`salix.nz`** | **Not found — unregistered.** Second-level `.nz`, the shortest form |
| `doorway.org.nz`, `doorway.net.nz` | Not found — still unregistered, re-verified against the registry after the owner reported it |
| `doorwayhq` / `usedoorway` / `getdoorway` `.co.nz`, `salixhq.co.nz` | Not found |

**`doorway.org.nz` is available and is still not the answer, for three reasons that have nothing to
do with its price.**

1. **`.org.nz` is the wrong signal for a commercial vendor**, and here it is actively confusing. The
   pilot customer is `littlepearls.org.nz` and the contact mailbox is `pif.org.nz` — both genuine
   non-profits. The application spends real effort establishing that the **centre** is the agency
   under the Privacy Act and that Salix Limited is the agent holding data on its behalf. Putting the
   vendor on `.org.nz` blurs precisely the distinction being argued.
2. **It does not buy the thing that is at risk.** If the unrun class search finds a `DOORWAY` mark in
   9, 42 or 41, the name goes and the domain with it. Buying inside the Doorway family before that
   search is doing the cheap half of a decision whose expensive half is unmade.
3. **It leaves us on `.org.nz` while a speculator holds the `.co.nz`.** New Zealanders type `.co.nz`
   for a commercial product. That is a permanent low-grade tax, and on this product it is worse than
   cosmetic: **authentication and password-reset mail would come from `doorway.org.nz` while
   `doorway.co.nz` is parked by whoever catches it in the drop** — a look-alike-domain surface
   created for ourselves, on a system that emails parents about their children.

As a **defensive hold** it is defensible: thirty dollars to stop somebody else taking the obvious
alternative if the name does clear. Nothing should be built on it, pointed at it, or configured to
it until the class search is done.

#### CORRECTED 2026-09-05, same day — **no domain needs buying at all. One already exists.**

The recommendation above was to register `salix.nz`. That was written without knowing the owner
already holds **`salixtech.co.nz`**, which the owner then said. Measured rather than taken on
report:

| | |
|---|---|
| Registry | Created **2026-05-18** — three days after Salix Limited was incorporated. Status `ok`, not expiring. Cloudflare nameservers |
| Serving | `Server: railway-hikari` — the same platform as the console. Apex 308s to `www`, which returns 200 with `<title>Salix Limited — Software Development Company, New Zealand</title>` |
| TLS | Refuses 1.0 and 1.1; negotiates `ECDHE-RSA-AES256-GCM-SHA384`. See item 66 |

It is better than the thing being recommended, on every axis that mattered: `.co.nz` is the correct
commercial second level rather than `.org.nz`'s non-profit signal, it carries the company's own name
so there is no trade mark exposure to clear, it is already live on the right platform, and its TLS
is already right where the customer's zone is not.

**So `INF08`'s hostname problem needs configuration, not procurement**, and this item's remaining
open work shrinks back to the one thing it was always about: **the IPONZ class search on 9, 41, 42
and 35.** That decides whether *Doorway* survives as a product name. It has nothing to do with
domains, and buying any is a way of appearing to act on this item without touching it.

#### The class search cannot be run from this environment — attempted 2026-09-05

| Route | Result |
|---|---|
| IPONZ *Trade Mark Check*, `app.iponz.govt.nz/app/TradeMarkCheck` | 302 to a session-bound ASP.NET page that then **redirect-loops** a cookieless fetcher. `?targetApp=TM` returns 404 |
| IPONZ API, `portal.api.business.govt.nz/api/iponz` | A `POST /trademarksearch` SOAP operation exists and is **not open**: RealMe login plus a generated subscription key. That is the owner's identity credential and is not something an agent should hold |
| WIPO Global Brand Database | A single-page app. Every candidate API path returns the application shell; TMview does not resolve |

**This is the fourth host to refuse this environment in four days** — Education Counts (2026-09-02,
Cloudflare challenge), legislation.govt.nz (2026-09-05, 403, item 65), the Domain Name Commission
(2026-09-05, 403) and now IPONZ. The pattern named in item 65 holds and is worth restating: **a
source this product must read is not always a source this environment can reach**, and the honest
response is a recorded gap rather than a plausible answer. A fabricated trade mark result would be
the worst example of that this repository could produce.

#### What the existing evidence already settles, which narrows what the search is for

The 2026-08-11 check was unfiltered, **ordered closest-match-first**, and returned `STAPLES RODWAY`
at the top with no identical `DOORWAY` among the results seen. If a `DOORWAY` word mark existed on
the register **in any class**, a closest-first matcher would rank it first. It did not.

So the class search is very unlikely to answer *"does somebody already own DOORWAY"* — the evidence
says no. What it answers is the different and still-open question: **whether a *similar* mark in
classes 9, 41, 42 or 35 would block a registration, or create a confusion risk in the field this
product actually trades in.** Those are two different risks and this item has been conflating them:

- **Freedom to operate** — can we use the name? On present evidence, low risk. No identical mark, no
  business trading as Doorway on either `.nz` domain, and the name is currently off the customer's
  public site.
- **Registrability** — could we register it, and could a near mark be asserted against us? Unknown,
  and this is what the class search is for.

Neither is closed by a domain purchase, and neither is closed by this note. **The free tool is a
screen and not an opinion** — that was true when this item was written and is still true; a paid
IPONZ search or an advisor is what produces a clearance.

#### RUN BY THE OWNER, 2026-09-05 — and two of this item's three open reasons close

The owner ran IPONZ *Trade Mark Check* on **doorway** and reviewed the results in full.

| | |
|---|---|
| **Results** | **19 trade marks, closest matches first** — down from the 25 the unfiltered August run returned |
| **Top match** | `STAPLES RODWAY` (Baker Tilly Staples Rodway New Zealand Limited), again |
| **Owner's reading of all 19** | *"they are irrelevant, not doorway"* — no identical mark, and none judged confusable |
| **Others sighted** | `Do Ray Me Music Tuition Studio Ltd` (a device mark, music tuition — the only result in an education field, matching phonetically on *do-ray* / *door-way*), and `Deerway`, which the August run also returned |

**`STAPLES RODWAY` ranking first is the finding, not the footnote.** In a closest-matches-first
ordering an identical `DOORWAY` sorts first. Twice now the matcher has put a mark sharing four
trailing letters at the top, which is it reporting that nothing nearer exists. What was *"very
unlikely, and that is not the same claim as checked"* in August is now checked.

**Two of the three reasons this item stayed open are closed.** No class was selected → the result
count dropped from 25 to 19, which is what a filter does. Only 8 of 25 results were seen → all 19
were read this time.

**One is not, and cannot be.** *This is the free pre-application check.* IPONZ's own page offers
"get IPONZ to search… a small fee applies" as the next step. A screen is not an opinion, and no
number of screens becomes one.

**One detail was not captured and is recorded as such rather than assumed:** which classes were
ticked. The 25→19 drop is consistent with 9, 41, 42 and 35 having been selected as this item asked,
but nobody wrote it down, and **this entry's own history is a check recorded as done that had not
been** — the August "doorway.co.nz is available" line, which the registry contradicted the same day.
So: if the class selection ever matters evidentially, it needs re-running with a screenshot.

#### The residual risk, split three ways, because "not cleared" was hiding three different things

| | |
|---|---|
| **Freedom to operate** — may we use the name? | **Low, and now checked rather than assumed.** No identical mark on the register, nothing confusable in the results, no business trading as *Doorway* on either `.nz` domain, and the name is off the customer's public site |
| **Registrability** — could we register it, could a near mark be asserted at us? | **Looks clear on the same evidence, and it is an examiner's call, not ours.** The only result in an education field is a four-word device mark for children's music tuition |
| **Unregistered rights** — passing off, Fair Trading Act | **Untouched, and no register search can touch it.** Nothing appears on a register for an unregistered right. This has never been addressed and is not a gap the tool was ever going to close |

**Practical position: the name is safe enough to keep building on, and that is a change from where
this entry started.** What would justify a paid search or an advisor is a commercial event, not a
technical one — raising money on the brand, printing it on something expensive, or opposing somebody
else. Until then this is a screened name with a named residual, which is a materially different
thing from an unchecked one.

**The lesson, which is the reason this correction is written out rather than edited in:** three
paragraphs of domain analysis were spent before anybody asked what the owner already owned. The
register is good at recording what has not been *checked* and was, here, silent about what had not
been *asked*. Cheapest possible question, asked last.

**The release date is still unconfirmed and this environment cannot confirm it.** The Domain Name
Commission's expired-names policy page returns **HTTP 403** to the fetcher — the third host to
refuse it, after Education Counts (2026-09-02) and legislation.govt.nz (2026-09-05, item 65). The
"90 days, so early October" figure in this item remains an estimate nobody has checked, and it
should be confirmed by a phone call to a registrar rather than inferred.

**What changes the decision is not the date, it is that the applicant now has a legal name.** Salix
Limited was confirmed registered on 2026-09-05, and `salix.nz` is free. That matters because this
item's open risk has never been the domain — it is the **trade mark**, and classes 9, 41, 42 and 35
have still never been searched. A company's own registered name carries none of that risk: the
Companies Office has already refused any name too similar to an existing one, which is a clearance
the product name has not had.

There is also a deadline on having *a* hostname at all, and it is not this item's. `INF08` is
`[FIX FIRST]` because Supabase's authentication redirect URL is one project-wide value, so every
invitation and password-reset link currently lands on the **pilot customer's** hostname. The
Ministry is to be invited as a tester. A Crown assessor's invitation link arriving at
`little-pearls-production.up.railway.app` is the same class of finding as `AST06` and `AST09`.

**So the sequencing is: the free IPONZ class search first, because it is the thing that can force a
rename; a hostname that carries no naming risk second, because it is needed regardless; and
`doorway.co.nz` last or never.** An Afternic-parked name that has already dropped once is watched by
drop-catchers, so "wait for October and register it" is a plan that assumes winning a race against
automation. Buying a brand domain before the class search is buying an asset that may have to be
abandoned.

### 66. Our own public zone accepts TLS 1.0 and 1.1 — **OPEN, added 2026-09-05**

Found by measuring rather than by reading: `AST26` had stood as *"we can commit to it, and we should
verify rather than commit — what our runtime negotiates has never been measured."* Measuring it took
twenty minutes with `openssl s_client`, pinning one protocol version at a time across every host we
operate.

| Host | TLS 1.0 | TLS 1.1 | Default |
|---|---|---|---|
| `…supabase.co` — the database, auth and every child record | refused | refused | TLS 1.3 |
| `little-pearls-production.up.railway.app` — the console | refused | refused | TLS 1.3 |
| **`www.littlepearls.org.nz`** — the customer's public site | **accepted** | **accepted** | TLS 1.3 |
| `www.salixtech.co.nz` — the vendor's own site | refused | refused | TLS 1.3 |

The legacy handshakes negotiate `ECDHE-ECDSA-AES128-SHA` — CBC with a SHA-1 MAC, no AEAD — against
the Ministry's stated NZISM floor of TLS 1.2 or above.

**It is ours, which is the part worth stating.** The hostname is served by Cloudflare in front of our
own Next.js site (`Server: cloudflare`, `x-powered-by: Next.js`, a Google Trust Services certificate
for `littlepearls.org.nz`). Cloudflare's *Minimum TLS Version* defaults to 1.0 and nobody changed it.

**And the fix is now known to be one dropdown, because a correctly-configured zone already exists in
the same account — added 2026-09-05.** `www.salixtech.co.nz`, the vendor's own site, refuses TLS 1.0
and 1.1 and negotiates `ECDHE-RSA-AES256-GCM-SHA384` at TLS 1.2 — **the Ministry's endorsed cipher
verbatim**, negotiable there because that host presents an RSA certificate where the other three
present ECDSA. Two Cloudflare zones, same account, differing in one setting, one of them already
right. That removes the last reason to treat this as anything but a five-minute change, and it
answers the separate question `AST26` raised about whether the named RSA suite can be served at all:
it already is.
So this is not a third party's posture to disclose; it is a zone setting nobody looked at.

**Why it is open rather than fixed.** Raising the minimum drops genuinely old clients — the
population is small and it is not ours to decide, because those are the customer's visitors looking
up a childcare centre. `[OWNER]`, one setting, and the trade-off should be stated to them rather than
made for them.

**Mitigating, and deliberately not used as a reason to leave it:** no child record travels that
hostname. The console and the database are the other two rows and both refuse legacy protocols. But
the Ministry's expectation is about the vendor's posture, and *"the non-compliant one is only the
brochure"* is a weak answer when the fix is a dropdown.

**The general finding, which outlasts this one.** Three separate documents in this repository
described the transport posture, and all three described it as *committable* rather than *measured*.
None was wrong; none had been checked. A claim nobody has measured is the same object whether it
turns out true or false — and here two of three hosts were better than claimed and one was worse.

## See Also

- [[eli-integration]] — the public schema, the event catalogue, and items 47 and 48
- [[checklists]] — where the hazard assessment fields live, and the rest of the 1Place work
- [[kiosk-and-pins]] — the door tablet, and what it can and cannot know
- [[attendance-and-ratios]] — where the ratio bands are used
- [[attendance-verification]] — the feature item 36 is about
- [[compliance-and-evidence]] — why criteria ship empty
- [[privacy-and-retention]] — retention, and the Privacy Act correction
- [[offline-outbox]] — what the drill covers and does not
- [[consent-gated-media]] — where consent decisions finally do work
- [[funding-and-billing]] — why nothing is estimated, and what cannot be submitted
- [[reporting]] — occupancy, attendance trends, and enquiry conversion
- [[deployment]] — item 41's detail: the three CI jobs and what each one skips

*Last updated: 2026-09-05*
