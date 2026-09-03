# Draft enquiry to ELI.Queries — before submitting the 2026 tranche application

**Not sent.** Drafted 2026-09-02, **rewritten 2026-09-03 after searching for the answers first.**
For the owner to send from the mailbox holding the 2026-08-14 and 2026-08-18 correspondence.

**The form requires an enquiry.** The assessment application form states: *"If you have any
questions regarding the SMS Development Criteria or process, you must contact the Ministry at
ELI.Queries@education.govt.nz before submitting this form."*

**But four of the original nine questions were already answered in public, and asking them would
have been the wrong kind of thorough.** They are recorded below rather than deleted, because what
each one turned out to be is more useful than the question was — and one of them was the question
this whole application was said to depend on.

---

## Answered without asking

| Was going to ask | Answer, and where it was |
|---|---|
| **How complete must the SMS be at application versus at go-live?** Called "the one that decides whether applying this tranche is possible at all" | **Functionality complete at application; interface work after acceptance.** The integration page: *"Your application must already be fully developed and ready for the NSI and ELI integration work to be **added**, tested and verified"*, and *"**After we have accepted your application, you will need to develop the NSI and ELI integration components.**"* Integration *"will start in late 2026"* and take 12–18 months |
| **Which page carries the "SMS Development Criteria"?** | The integration page itself, under *Intended functionalities* and the development requirements. The form's phrase *"as described on the ELI Homepage"* is loose wording for that page |
| **Is the closing date 5pm Friday 30 October 2026?** | Yes, per the page. The form's reference to *"the September 2026 tranche"* is stale wording left from an earlier draft, and *"will start in late 2026"* is consistent with an October close. Not worth a question |
| **Does the Waha Rumaki/PITA return apply to a standard education and care service?** | **No.** §14-5 of the Funding Handbook: only *"Puna Reo, Reo Rua education and care, Leo o Fanau Moana immersion or Leo o Fanau Moana bilingual"* services submit it, monthly. Our pilot service would never file one — **but that answers the service's obligation, not the vendor's**, which is the Chapter 6 lesson again, so it survives below in narrowed form |
| **May we see the agreement first?** | The page says the Ministry *"will advise the successful applicant of timelines, sequence of events and expectations"* before starting, and the agreement is signed by the successful applicant. Asking to read it pre-submission is a courtesy, not a prerequisite. Dropped |

**And one question the reading created**, which is better than any it replaced: §14-2 of the Handbook
lists the census staff fields, and two of them do not match how we have built this. That is
question 1 now.

---

## The Ministry wrote first — reply to that, not to a new thread

**Received ~2026-08-31 from Halaholo Mataele** (Senior Advisor, Early Learning Information, Te
Mahau), marked `[IN-CONFIDENCE - RELEASE EXTERNAL]`, to the ELI Queries thread:

> *"This email is being sent to you as you have previously contacted the Ministry to inquire/express
> an interest in the Early Learning Information (ELI) integration process. I would like to advise
> you that the process for integration to the ELI system is available here <link>. Please follow the
> instructions on the above webpage if you wish to apply for an assessment."*

Two things follow. **Reply-all on that thread** rather than opening a new one — it keeps the history
together and reaches the named advisor as well as the shared mailbox. And the invitation to *"apply
for an assessment"* is the opening the form's pre-submission question requirement wants.

**Worth recording rather than glossing:** the Ministry told us the tranche was open, unprompted,
and the notification sat unread for three days while this repo went on asserting that applications
were closed. The 2026-08-18 reply had said the review had no end date, so nothing here was watching
the page — but something *was* watching us, and the answer arrived by email. Not every open question
needs a poller; some need somebody to read the inbox.

## The short version — this is the one to send

The owner asked for brief questions. Five, in the order that matters: question 1 is the only one
whose answer changes code that is already written.

> Kia ora Halaholo,
>
> Thank you — that is helpful. We do intend to apply for the 2026 tranche before 30 October.
>
> We have worked through the webpage and both application documents and answered most of our
> questions from them. Five we could not:
>
> **1. Contact hours — contracted or actual?** `ContactHoursDetailList` in the ELI Events schema is
> a weekday with start and end times and no dates, which reads as a contracted pattern. §14-2 of
> the Funding Handbook describes the same field as *actual* contact hours spent teaching children
> in the census week. Which is intended? It decides whether we source them from roster agreements
> or from recorded staff attendance.
>
> **2. Assurance requirements.** What security and privacy evidence does the Ministry require of a
> vendor — an independent security assessment or penetration test, a privacy impact assessment —
> and at what stage? This was one question in our 14 August enquiry that the reply did not reach.
>
> **3. Specifications.** Could you resend the seven specification documents with the password? And
> is the schema served publicly at `https://eli.minedu.govt.nz/eli.xsd` the same as ELI Events
> v10.0, and the version we should validate against?
>
> **4. Code lists.** Where are the staff role, wait-time and closure-reason lists published? We have
> found ethnicity, iwi and ECE language codes on Education Counts. Do the published lists carry
> effective start and end dates, or is a vendor expected to maintain those?
>
> **5. Waha Rumaki/PITA.** §14-5 limits the return to Puna Reo, Reo Rua and Leo o Fanau Moana
> services. Is a vendor still required to build it in order to be approved if it serves none of
> those service types?
>
> Ngā mihi,
> `[OWNER — name, role]`

**Held back to keep it short**, both askable later without cost: how the 50-service capability is
evidenced (it shapes how we prepare, not what we build), and §14-2 listing two pairs of staff dates
where the schema carries one — the specifications will likely settle that once resent.

**Why brevity is the right call here and not a compromise.** The 2026-08-14 enquiry asked five
questions and two came back unanswered or answered sideways; the one that failed was a sentence
buried inside a paragraph about fees. Fewer questions, each standing alone, is the shape that got
an answer on 2026-08-31.

---

## The long version, kept for the reasoning

Not for sending. This is the full set with the argument behind each, and the record of what was
answered without asking.

## Suggested subject

`ELI/NSI SMS vendor — 2026 tranche: six questions before submitting`

## Draft body

Tēnā koutou,

Thank you for the replies of 18 August and 31 August; both were used. The 31 August answer closed a
question about where a service's Chapter 6 records may live, and the vendor obligation it described
— that customers must understand our system does not remove their responsibility, and that a person
must review and validate RS7 figures before submission — is now stated unconditionally on our
funding screens.

We intend to apply for the 2026 tranche. Before submitting, we have worked through the published
material and answered several of our own questions from it, including the sequencing one: we
understand from the integration page that the SMS's own functionality must be complete at
application and that the NSI and ELI integration components are developed after acceptance. The
questions below are the ones we could not answer from what is published. Each is separate and
numbered, and none needs to be answered as part of another.

**1. Are `ContactHoursDetailList` entries a contracted weekly pattern, or the actual hours worked in
the census week?**

This is our most consequential question, because the two answers need different data models and we
have built one of them.

The ELI Events schema types `ContactHoursDetailList` as a list of weekday-plus-start-time-plus-end-time
triples with **no dates**, which reads as a recurring contractual pattern. §14-2 of the Funding
Handbook describes the same field as *"Actual contact hours for teachers/staff (start and end dates
and actual contact start and finish times spent teaching children)"*, and asks separately for
*"Total Hours worked during the ECE Census week"* — both of which read as measured actuals for one
specific week.

If they are **contracted** hours, a service can answer from its roster agreements. If they are
**actual** hours, the SMS must derive them from recorded staff attendance for the census week, and a
service without per-person staff sign-in cannot answer accurately at all. Which is it?

**2. §14-2 lists two pairs of staff dates. Which pair does the role block carry?**

§14-2 asks for *"Staff start and end dates working at service"* **and** *"Staff start and end dates
in role at service"* — two distinct pairs. The schema carries one `StartDate`/`EndDate` pair, inside
`EducationalStaffRole`. We read that as the **in-role** pair, given where it sits, with the
at-service dates coming from the staff record. Please confirm, and tell us where the second pair is
carried if it is transmitted at all.

**3. What security, privacy and assurance evidence does the Ministry require from a vendor?**

This was question 4 of our 14 August enquiry and is the only part of that enquiry still open — the
18 August reply addressed the fee question in the same paragraph and did not reach it. We have not
found it published anywhere. Restating it on its own:

- Does the Ministry require an **independent security assessment or penetration test**, and if so
  at what point — before application, before go-live, or periodically after?
- Does the Ministry require a **privacy impact assessment**, and does it review one?
- Beyond `AST26`, which specifies TLS 1.2 or above with `ECDHE-RSA-AES256-GCM-SHA384` for ESL
  transport, **does the NZISM apply to the SMS as a whole**, and at what classification?
- Is any of it a **cost to the vendor**? Your 18 August reply confirmed no fees for integration or
  certification; an assessment commissioned from a third party is a different kind of cost and we
  would like to plan for it rather than discover it.

**4. Are the specification documents you sent on 18 August still current, and is the schema served
at `https://eli.minedu.govt.nz/eli.xsd` the same as "ELI Events v10.0"?**

Please send current copies of the seven documents with the password, to the address this email comes
from.

Separately: that URL serves an XML Schema publicly, without authentication, and we have been
working from it. **Is it the same schema as the "ELI Events v10.0" attachment**, and is it the
version a vendor should validate against? It carries no version stamp of its own. If the two can
diverge we would rather validate against whichever is normative and know which that is.

**5. Are the Education Counts code sets the authoritative source for the ELI `LookupCode` fields,
and do the published lists carry effective dates?**

The schema types ethnicity, iwi, home language, gender, staff role, qualification, wait-time and
closure-reason values as a 1–10 character `LookupCode` and enumerates none of them. We have found
ethnic group, iwi and ECE language codes published on Education Counts, and we note the statement
that a system *"approved as meeting the specifications … for integration to the Early Learning
Information system must capture at least Level 3"* ethnic groups, which we have taken as settled.

What we cannot establish:

- Are those pages the **authoritative source** for the ELI fields, or do the specifications carry
  their own lists that differ?
- Where are the **staff role**, **wait-time** and **closure-reason** lists published? We have not
  found them.
- `AST55` expects every value to carry an effective start and end date. We can see that codes are
  withdrawn on dates in practice — the home-based qualification codes H01 and H02 ceased to be
  available from 1 June 2022. **Do the published lists carry those dates in a machine-readable
  form, or is the vendor expected to maintain the effective dating itself?**

We ask because we have deliberately built the reference tables and **left them empty**: rather than
transcribe a code list we could not source, the affected fields are disabled in our product with an
explanation on screen. We would rather import a published list than type one in.

**6. Must a vendor build the Waha Rumaki/PITA return to be approved, even if it serves none of the
service types that file it?**

§14-5 is clear about the **service's** obligation: only Puna Reo, Reo Rua, and Leo o Fanau Moana
immersion or bilingual services submit it. Our pilot customer is a standard education and care
service and would never file one.

The **vendor** requirement is what we cannot resolve. Your development criteria list the Waha
Rumaki/PITA Return among the intended functionalities, and `AST52`–`AST54` ask us to design and
describe it. Is it required of every applicant, or only of vendors intending to serve those service
types? We are asking so that we describe it accurately rather than plausibly.

**7. How is the 50-service capability requirement evidenced?**

Your 18 August reply confirmed that *"the product must be capable of supporting a minimum of 50
services across the relevant licence types"* is a capability rather than a customer count, which we
have taken as settled. For the readiness assessment: **how is that capability demonstrated** — an
architectural description, load or volume testing, an existing multi-service deployment, or
something else? We can evidence whichever you assess against and would rather not guess.

---

For completeness about who is writing: we run one pilot deployment for a two-site not-for-profit
education and care provider in Auckland. We are a small vendor and will not represent ourselves as
anything else.

Ngā mihi,

`[OWNER — name, role, entity, phone]`

---

## What to do with the answers

| Answer | Consequence |
|---|---|
| **1 — actual hours** | The contact-hours model changes: derive from `staff_attendance_events` for the census week rather than from the contracted pattern in `staff_contact_hours`. A service without per-person staff sign-in cannot answer accurately, which is an argument for the per-person roll rather than the typed adult count |
| **1 — contracted** | What is built is right, and `staff_contact_hours` is the source. The Handbook's word "actual" then describes the intent rather than the field |
| **2 — the role block is in-role** | One migration: in-role dates on the census record, distinct from `staff_members.started_on`/`finished_on` |
| **3 — independent assessment required** | A real cost and timeline, and it lands on [production-readiness](../llm-wiki/wiki/production-readiness.md) whether we apply or not. Worth doing regardless: the product holds under-5 medical records and has never been attacked |
| **4 — the public XSD is normative** | The integration can be built and validated against a citable public schema, removing the largest dependency on correspondence |
| **5 — the Ministry maintains effective dates** | A reference-data importer following `scripts/import-criteria.ts`, seeded from the published source with its citation. **Do not invent code values** — [AGENTS.md §7](../AGENTS.md) |
| **6 — out of scope for us** | Three `AST` items become a scoped N/A with a reason, and `EceReturn` staffing is the only teacher-data surface to build |
| **7 — load testing** | It does not exist today and nothing in the repo has been load-tested at any scale |

Every answer goes into [unverified-claims](../llm-wiki/wiki/unverified-claims.md) with its date and
wording, as items 37 and 45 were. **Nothing in this repo may read an unanswered question as a yes.**
