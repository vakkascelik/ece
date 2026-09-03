# ELI integration — the 2026 tranche

**Applications are open. They close at 5pm on Friday 30 October 2026, and the Ministry will
support one commercial applicant.**

Written 2026-09-02. Everything on this page about the Ministry's process is quoted from
[the Ministry's own integration page](https://www.education.govt.nz/suppliers-and-providers/procurement/procurement-goods-and-services/integrating-early-learning-student-management-systems)
(last updated 1 September 2026) or from the two application documents downloaded from it that
day. Everything about this product is either cited to a file or named as unbuilt.

The strategic background — why this matters, and the two Ministry replies that got us here — is in
[funding-and-billing](../llm-wiki/wiki/funding-and-billing.md). The knowledge that came out of
writing this page is in [eli-integration](../llm-wiki/wiki/eli-integration.md).

---

## 1. What changed

Every previous statement in this repo about ELI integration rested on this sentence from the
Ministry's page: *"We are not accepting integration applications in 2025. We will review our
capacity to support new integration applications in July 2026."* On 2026-08-18 the Ministry
confirmed by email that it was *"currently still in the review phase"* with no end date.

**The review has concluded and the page has been rewritten.** It now says:

> *"We are now accepting applications from new early learning student management system (SMS)
> vendors to undergo an assessment for the 2026 tranche."*

| Fact | Value |
|---|---|
| Applications close | **5pm, Friday 30 October 2026** — 58 days from today |
| Places available | **"We will support 1 successful commercial applicant for the 2026 tranche."** |
| Basis of selection | *"readiness for integration"* and *"the criteria and requirements outlined in the application form"* |
| Integration duration once selected | *"expected to take 12 to 18 months"* |
| After this tranche | The Ministry will *"reassess the need to support any further early learning SMSs integrating to the ELI system"* |
| Fees | None, confirmed by email 2026-08-18. The page states no fees |
| Agreement | Placement is *"conditional on signing the agreement that sets out expectations of both parties"* |

**One place, decided on readiness, against incumbents who already run this interface.** That is
the shape of the thing, and it should be said plainly before any of the work below is costed. It
does not argue against applying — the cost of applying is a document, and losing costs nothing but
the document. It argues against building anything on the assumption of winning.

## 2. What must be submitted

Two documents, both downloaded 2026-09-02.

**(a) The assessment application form** ([DOCX, 55KB](https://web-assets.education.govt.nz/s3fs-public/2026-08/Assessment-Application-Form.docx?VersionId=Qt.ROJMKYX5LIjg79odNs1HGydin__jZ)).
Nine fields — name, phone, email, role, company name, whether the company is registered in New
Zealand, the name of the SMS, the company's location, and any existing relationship with the
Ministry. Trivial to complete, and it carries the declarations that are not trivial at all. See §5.

**(b) The ELI/NSI SMS Vendor Integration Application, template version 4.0**, published
11/09/2025 ([DOCX, 162KB](https://web-assets.education.govt.nz/s3fs-public/2025-12/ELI-NSI%20SMS%20Vendor%20Integration%20Application%20template%204.0.docx?VersionId=rDDXok4qwO2woUQo0BObuPnX23s29DCx)).
This is the assessment. It contains:

- **56 assessed items, `AST01`–`AST56`** — *"response will be assessed against the Ministry
  expectations"*. Each carries the Ministry's expectation in the template itself, which means the
  marking scheme is published alongside the question.
- **9 information-only items, `INF01`–`INF09`** — *"information only and not included in the
  assessment"*.
- **Three data-source mapping tables** — ECE Return, RS7 Return, Waha Rumaki/PITA Return. For every
  parameter: its source, where it is editable, and a comment. *"No field should be left blank, use
  N/A if the field is not applicable."*
- **Five duration estimates** — NSI interface, ELI integration, ECE Return, RS7 Return, Teacher
  Data Collection, each *"including your testing cycles"*.
- **Four data-flow diagrams** (`AST27`–`AST30`), which *"must be specific to your SMS"*.

The completed template goes to `ELI.Queries@education.govt.nz`. The Ministry states all of it
*"will be kept in the strictest confidence"*.

Our draft answers are in [eli-application-answers.md](eli-application-answers.md).

## 3. The apparent contradiction, and why there was never one

**RESOLVED 2026-09-03 by reading the page properly. This section previously argued that the
Ministry's own material contradicted itself, and it does not.**

What this document quoted was *"your student management system must already be developed to the
ELI integration specifications"*, and set it against the template's request for
development-and-testing durations for five interface components. Read together those look
irreconcilable: if the components must exist, there is nothing to estimate.

The full sentences on the page settle it, and they were there the whole time:

> *"Your application must already be fully developed and ready for the National Student Index (NSI)
> and ELI integration work to be **added**, tested and verified."*
>
> *"**After we have accepted your application, you will need to develop the NSI and ELI integration
> components.** This includes the interface to NSI and creation of events and transmission of
> events to ELI."*

So: **the SMS's own functionality must be complete at application; the interface work happens after
acceptance.** That is exactly the reading this document called "most likely", and it is now sourced
rather than inferred. The durations in the template are estimates for work that starts once
selected, which is why the Ministry says the process *"will start in late 2026"* and take 12 to 18
months.

**Where the error came from is worth recording, because it is a research failure rather than a
reading failure.** The quoted fragment came from a summary of the page, not from the page. A
summariser had compressed *"must already be fully developed and ready for the … integration work
to be added"* into *"must already be developed to the ELI integration specifications"* — which
inverts the meaning of the sentence by dropping the six words that carry it. This document then
built a section on the compressed version and proposed asking the Ministry about a conflict that
does not exist.

The lesson is the one [AGENTS.md §4.5](../AGENTS.md) already states in a different register: a
paraphrase is not a source. It cost nothing here because the question was drafted and not sent,
which is the only reason this is an anecdote rather than an embarrassment.

**Two facts worth keeping from the same reading:**

- Integration **starts late 2026** and takes 12–18 months. So the calendar is: apply by 30 October,
  hear back, and begin interface work before the year ends.
- *"Before starting the ELI integration process, we will advise the successful applicant of
  timelines, sequence of events and expectations."* The agreement is signed by the successful
  applicant, so asking to read it before submitting is a courtesy rather than a prerequisite.

The remaining questions — and there are fewer than there were — are in
[eli-ministry-enquiry.md](eli-ministry-enquiry.md).

## 4. The ELI schema is public, and that was not known

**`https://eli.minedu.govt.nz/eli.xsd` is served publicly** — HTTP 200, `text/xml`, 23,665 bytes,
fetched 2026-09-02. It is a complete XML Schema definition: 26 root elements, every complex type,
every enumeration, every string length bound.

This repo has spent two weeks treating the ELI message format as knowledge locked inside a
password-protected attachment. The mandatory validation schema was on a public URL the whole time.
Whether it is byte-identical to the *"ELI Event 10.0"* attachment named in the Ministry's covering
email is **not confirmed** and is question 5 of the enquiry — but it is a citable, versionless,
public source for the shape of every message, and it independently confirmed something this repo
had only from an email. The full catalogue and what it changes is in
[the wiki page](../llm-wiki/wiki/eli-integration.md).

The one confirmation worth putting here, because it validates code that already shipped:

> `<xs:simpleType name="RS7PeriodStartDate">` restricts the date to the pattern
> `[0-9]{4}-(02|06|10)-01`, with the comment *"Period start dates restricted to yyyy-02-01 or
> yyyy-06-01 or yyyy-10-01"*.

[`ministryFundingPeriods`](../packages/core/src/funding.ts) returns periods starting
`${year}-02-01`, `${year}-06-01` and `${year}-10-01`. Written 2026-08-18 from a specification
document nobody can now open, and confirmed 2026-09-02 against a public schema. That is the first
funding figure in this product with two independent sources.

## 5. What the declarations actually commit us to

The application form is nine easy fields under four sentences that are not easy. By submitting it,
the applicant confirms:

| The declaration | What it means here |
|---|---|
| *"Your SMS meets the SMS Development Criteria as described on the ELI Homepage."* | A statement about the product's completeness, made to the Crown. §6 is the honest measurement of it |
| *"You have fully completed the ELI/NSI SMS Vendor Integration & Operational Support Approach document."* | Every `AST` and `INF` item answered, three mapping tables with no blank cells, four SMS-specific data-flow diagrams |
| *"You understand that you are not guaranteed a place… placement is decided upon a 'readiness' assessment approach."* | One place, and readiness is the criterion |
| *"Your placement is conditional on signing the agreement that sets out expectations of both parties."* | An unseen agreement. Worth asking for a copy before submitting, not after |

**Two things nobody in this repo can decide, and both belong on the form:**

1. **The legal entity.** Fields 5, 6 and 8 ask for a company name, whether it is registered in New
   Zealand, and its location. The product is referred to throughout this repo as *Salix*
   ([privacy-statement](privacy-statement.md), [breach-response](breach-response.md)), whose
   contact address is a `pif.org.nz` mailbox. Whether Salix is a registered New Zealand company,
   and whether it or Pearl of the Islands Foundation is the applicant, is not recorded anywhere in
   this repo and must not be guessed on a form.

2. **The existing-relationship declaration.** Field 9: *"Do you or the company have any existing
   relationship with the Ministry of Education (e.g. software support, licensee of ECE service)"*.
   The pilot customer, Little Pearls Educare, is a licensed ECE service holding licences 46365 and
   47407, and a Little Pearls address sits on the Foundation's board invitations. **That is a
   relationship, and the honest answer to field 9 is yes, with details.** Declaring it costs
   nothing; omitting it is the kind of thing that ends an application later rather than earlier.

The `[OWNER]` markers in [eli-application-answers.md](eli-application-answers.md) are exactly
these decisions and nothing else.

## 6. Where this product actually stands against the mandatory criteria

Measured 2026-09-02 by reading all 79 migrations, `packages/core`, `packages/api` and the web
routes. Every "not built" below means *no column exists*, not *no screen exists* — the distinction
matters, because a missing screen is a fortnight and a missing column is a migration plus a policy
plus an assertion plus the data entry nobody has done.

### The eight required functionalities

| The Ministry requires | What exists | Verdict |
|---|---|---|
| *"child profile creation"* | `children` — `moe_nsn` (unique per centre), legal and preferred names, DOB, gender, `ethnicities text[]` capped at 3, `iwi`, `first_language`; immunisation in its own table | **Met.** Gaps are code sets and identity-document verification, not the profile |
| *"child enrolment"* | `enrolments` — dates, a GiST overlap exclusion, `funded_hours_per_week`, `days smallint[]`, `twenty_hours_ece boolean` | **Partial.** No permanent/casual/conditional type, which is the axis §6-4 turns on; the 20 Hours attestation is a tick with no date or signatory |
| *"child booking schedule"* | `bookings` — one row per child per date, `absent` status with a guardian-supplied reason, parent-facing `report_absence` functions | **Partial.** There is no weekly or recurring schedule model at all. `ChildBookingSchedule` in the ELI schema is precisely an effective-dated weekday pattern |
| *"20 Hours ECE funding"* | `funding.ts` — 6/day and 20/week caps confirmed against the Ministry's own rules, the 36-to-72-month age band applied *as at each day*, `ineligibleDates`, daily cap before weekly, floors downward | **Met for attended hours.** `FUNDING_RULES_VERIFIED` is `false` because §6-4 to §6-7 absence funding is not modelled — the product **under-claims** and says so |
| *"attendance marking"* | `attendance_events` — append-only, `corrects` supersession, `client_uuid` idempotency, centre-timezone day boundary, §6-3 electronic verification built end to end across `0061`–`0065`, kiosk PIN as signature, mobile roll, offline outbox on both clients | **Met, and the strongest part of the product** |
| *"annual ECE census (staff details and qualifications)"* | ~~`staff_members` and `staff_records` only~~ **Built 2026-09-02/03**: `0080`, `0081`, `census.ts`, the API layer and the `/census` screen | **Partial, and the remaining blocker is not software.** Every field has a column and a form. Six of them — gender, staff role, qualification, playcentre qualification, ethnicity, iwi — cannot hold a value until a Ministry code list is imported, so their inputs are disabled and say so. See below |
| *"RS7 return (for example, calculation for funding periods)"* | `/funding` produces funded hours per child, with completeness banners, and a CSV labelled preparation | **Not built as an RS7 return.** None of the figures the return actually wants is produced — measured 2026-09-03 against the XSD, that is **nine distinct counts** (six per calendar date, three advance-monthly repeated over four months) plus **six declaration fields**. The figure previously stated here, "eleven", was not sourced |
| *"Waha Rumaki/PITA Return"* | Nothing. One mention in the whole repo, and it is a document title in a wiki table | **Not built.** Possibly out of scope — enquiry question 7 |

### Why the census is the hard one

The ELI schema's `EceReturn` carries a `StaffInformationList`, and each `StaffInformation` wants
`GenderCode`, `HoursWorked`, `AgeBand` (one of twelve), `MinAgeTaught`, `MaxAgeTaught`,
`PreviouslyWorkedAsTeacher`, `ArrivedFromAnotherService`, `LeavingTeacherDestination`, and a
`StaffRoles` block whose `EducationalStaffRole` wants `StaffRoleCode`, `HighestQualificationCode`,
`IsRegistered`, `HighestPlaycentreQualificationCode`, start and end dates, `EthnicGroupCodes`,
`IsPaid`, `IsPermanent`, `IsFullTime`, and a `ContactHoursDetailList` of weekday start/end times.

**Measured on 2 September, eleven of those fifteen fields had no column anywhere in this database.**
No staff gender, ethnicity, role code, paid/unpaid, permanent/temporary, full-time/part-time,
qualification of any kind, registration number, years of experience, hours per year or FTE. The
word "qualification" appeared in this repo only in prose comments and one test fixture's job title.
`shifts` is one row per calendar date, so there was no weekday contract to derive
`ContactHoursDetailList` from.

**Built on 2 and 3 September.** `0080` gives every Ministry code list an effective-dated home and
ships it empty; `0081` adds the census record and the weekday contact-hours contract;
`census.ts` assembles the staffing section and names every gap; and `/census` is the screen a
manager fills it in on. 678 unit tests, 632 RLS assertions, and both mutation-tested.

**What is left is not software.** Six fields draw on unenumerated Ministry code lists that nobody
here has obtained, so their inputs are disabled with the reason on the screen — the same treatment
the licensing criteria get, and for the same reason: a plausible invented code in a Crown return is
worse than a blank. Closing it needs the published lists, which is enquiry question 6.

Two things this does *not* finish. `EceReturn` also wants **service-level** details — five
age-banded wait times and the languages the service uses with usage percentages — and neither is
modelled at all. And the census **remains the input to most of RS7**, because
`StaffHourQualifiedCount` and `StaffHourNotQualifiedCount` are daily counts split by
qualification, which cannot be computed until a qualification can be recorded.

### The service models — the requirement this product cannot currently even record

| The Ministry requires | Status |
|---|---|
| *"centre-based (includes education and care services and kindergarten)"* | Education and care is the implicit and only model. **Kindergarten is not modelled**; the word does not appear in the schema, `packages/` or the web app |
| *"home-based services"* | **Not modelled.** Named in `ratios.ts` as an excluded schedule |
| *"sessional and all-day licensed services"* | **All-day only.** Sessional ratio bands differ (1–8 → 1, 9–30 → 2) and are explicitly excluded |
| *"a minimum of 50 services"* | **Architecturally sound, untested at that scale.** RLS-enforced pooled tenancy, `centre_id` indexed everywhere, and `fetchAll` in `packages/api/src/paging.ts` pages past PostgREST's 1,000-row cap and *throws* rather than returning a partial — a defect that once produced 72 hours where 100 was correct. `drill:rowcap` holds it. No load test at 50 services exists |

**`public.centres` has no service-type or licence-type column.** It has six columns added since
`0001` — witness requirements, sleep-check minutes, drill interval, ratio source, AI features,
licensed places — and none of them says what kind of service this is. So the product cannot record
the distinction the Ministry's capability requirement is stated *across*.

**The mitigating fact, and it is a real one:** `ratios.ts` takes the ratio table as an argument.
Its own header says a different service type *"changes data and not logic"*. Adding sessional and
home-based bands is a transcription against Schedule 2 plus a `service_type` column plus the
`RATIO_TABLES_VERIFIED` discipline — not a rewrite. That is worth saying in an application, because
it is the difference between a gap and a redesign.

### Three assessed items that fail on infrastructure rather than function

These are not on the Ministry's functionality list, but they are assessed items, and they fail
harder than anything above.

| Item | The Ministry's expectation | Reality |
|---|---|---|
| `AST06` | *"The Ministry expects a minimum of three environments: Development… Test… Production"* | **There is one, and it is production.** `docs/deploy-railway.md`: *"There is no staging environment. A second Railway service against a second Supabase project would be the honest way to have one, and it does not exist"* |
| `AST09` | *"The Ministry expects SMS production data is isolated to the SMS production environment"* | **Local development runs against the production Supabase project.** There is no local Postgres; `.env.local` and the live project are the same `qdgforljvddgrxxymtug`. The RLS suite is designed to be safe against a live project because that is where it runs |
| `AST18`, `AST19` | Recognised testing standards; a structured defect-management system | The suites are genuinely strong — **607 RLS assertions**, ~579 unit tests, 104 e2e checks against WCAG 2.2 AA, 17 live-schema security checks, and four purpose-built drills. **But CI has never once passed in 137 runs**: it fails on a 113.0kB-vs-106kB bundle budget, and the RLS, restore-drill, security-review and e2e jobs have never executed at all because their secrets are not in the repository. Every gate this product has is run by hand on one laptop. Defect management is three narrative markdown logs and git history — no tracker, no severity taxonomy, no defect-to-release traceability |

Also assessed, also absent: no uptime monitoring, no alerting, no log retention beyond Railway's
default; point-in-time recovery not enabled, so the recovery point is **up to 24 hours** and a real
restore has never been rehearsed; no mailer is configured at all, so invitations are links passed
by hand; no documented support process, SLA or channel; and no export-everything path for a service
leaving (`AST46`), nor the `source_system`/`source_ref` key an import would join on (`AST45`),
which is documented in two places and built in none.

### The verdict, plainly

**The first declaration on the application form cannot be signed truthfully today.** *"Your SMS
meets the SMS Development Criteria"* is a statement to the Crown, and on the Ministry's own list
the RS7 return and the Waha Rumaki/PITA return are absent, the annual ECE census is built but
cannot hold six of its fields until a Ministry code list is published to us, two of the four
service models are unmodelled, and the product cannot record which model a service is.

**Updated 2026-09-03.** This paragraph said *"three of eight functionalities are absent"*. The
census moved from absent to blocked-on-a-list in a day, which is a real change and a smaller one
than it sounds: the declaration still cannot be made, and what moved was the *reason*. Worth
watching in this document, because a gap table that improves faster than the product does is a gap
table nobody should trust.

That is not an argument against applying. It is the work programme, and most of it —
Phase 10, a test environment, a green CI — is worth doing whether or not this application is ever
submitted, because the product holds under-5 medical records and currently has one environment, no
alerting and a 24-hour recovery point.

**What it is an argument against is submitting before question 1 of the enquiry is answered.** If
interface development follows selection, the honest application is "functionally complete for
all-day centre-based, with the census, RS7 aggregates and the other service models scoped and
sequenced" — and a candid gap table is a better readiness signal than a glossy claim, because the
Ministry will find the gaps during a 12-to-18-month integration anyway. If instead everything must
be built before applying, this tranche is not ours and the honest move is to say so and target the
reassessment.

## 7. What is genuinely blocked, and on what

| Blocked | On | Who unblocks it |
|---|---|---|
| `AST24`–`AST33` — the ESL authentication flows and the whole NSI interface design | NSI GINS 6.19 (§5 is the REST interface) and the ECE NSI GINS Appendix 1.41. **Neither is on this machine** | Forward the 2026-08-18 attachments and their password, or re-request from `ELI.Queries` |
| `AST37`, `AST39` — InfoHub transport, the `400 invalid_auth` handling, message submission | InfoHub Specification 1.3. Not on this machine. The public XSD defines message *content*, not transport | Same |
| `AST40` — business rules *"beyond what is defined in the XSD"*, which is the Ministry's own phrasing and tells us the XSD is a floor | ELI Data Collection Specification 11 | Same |
| `AST52`–`AST54` — the entire Waha Rumaki/PITA return | Teacher Data Collection Specification 1.1, and a prior question: whether it applies to a standard education-and-care service at all | Enquiry question 7 |
| The `LookupCode` values — ethnicity, iwi, home language, qualification, staff role, gender, wait time, closure reason | The XSD types every one of these as `LookupCode`, a 1–10 character string, and enumerates none of them. Some are published on Education Counts, which returned a Cloudflare challenge to two fetch attempts on 2026-09-02 and was **not** retrieved | Enquiry question 6 |

**The seven specification documents are not on this machine.** A search of the whole user profile
to six levels deep on 2026-09-02 found none of them. They were decrypted and read on 2026-08-18 —
[unverified-claims item 38](../llm-wiki/wiki/unverified-claims.md) — and what survives of that
reading in this repo is exactly two facts: the 20 Hours caps with their 3-to-under-6 age band, and
the funding period boundaries. Nothing was recorded about message formats, endpoints, business
rules or code sets, because at the time nothing needed them.

That is the cost of reading a specification without writing down what it said, and it is worth
naming as a mistake rather than a circumstance: the reading was done, the product changed because
of it, and the *interface* knowledge evaporated when the session ended.

---

*Written 2026-09-02. Nothing here is built. §6 measures the product; it does not improve it.*
