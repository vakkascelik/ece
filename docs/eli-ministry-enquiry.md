# Draft enquiry to ELI.Queries — before submitting the 2026 tranche application

**Not sent.** Drafted 2026-09-02 for the owner to send from the mailbox that holds the 2026-08-14
and 2026-08-18 correspondence.

**The form requires this.** The assessment application form states: *"If you have any questions
regarding the SMS Development Criteria or process, you must contact the Ministry at
ELI.Queries@education.govt.nz before submitting this form."* Asking is a step in the process, not
a delay to it.

**Why it is shaped like this.** The 2026-08-14 enquiry asked five questions; two came back
unanswered or answered sideways. The Chapter 6 question was phrased so that a statement about
*vendors* was a defensible reply to a question about *services*, and the assurance question was one
sentence inside a paragraph about fees, so the reply addressed the fees. Both cost a fortnight.

So every question below is **numbered, standalone, and says what turns on the answer.** None is
bundled. None can be satisfied by answering an adjacent question. Question 1 is the one that
decides whether we can sign the form at all — if only one gets answered, it should be that one.

---

## Suggested subject

`ELI/NSI SMS vendor — 2026 tranche: nine questions before submitting our application`

## Draft body

Tēnā koutou,

Thank you for the replies of 18 August and 31 August. Both were used: the 31 August answer closed a
question about where a service's Chapter 6 records may live that we had been unable to resolve from
the Handbook alone, and the vendor obligation it described — that customers must understand our
system does not remove their responsibility to comply, and that a person must review and validate
RS7 figures before submission — is now stated unconditionally on our funding screens rather than
only in our internal documentation.

We intend to apply for the 2026 tranche. The application form directs us to raise any questions
about the SMS Development Criteria or the process before submitting, so these are ours. I have kept
them separate and numbered so that none has to be answered as part of another.

**1. How complete must the SMS be at the point of application, as opposed to at go-live?**

The integration page states that *"your student management system must already be developed to the
ELI integration specifications"*. The application template asks us to estimate durations for NSI
interface, ELI integration, ECE Return, RS7 Return and Teacher Data Collection *"development and
testing"*, and states that go-live approval waits until all five components *"have been developed,
tested by the vendor, and tested by the Ministry"*. It also notes that ESL production credentials
cannot be issued until a service is live in the SMS production environment.

We read these together as: the SMS's own functionality must be complete at application, and the
five interface components are what the 12–18 month integration period is for. **Is that reading
correct?** If instead the five interface components must also be built and tested before applying,
we would not be eligible for this tranche, and we would rather establish that now than submit a
form whose first declaration we cannot honestly make.

**2. Which page carries the "SMS Development Criteria" the form's declaration refers to?**

The form asks us to confirm our SMS *"meets the SMS Development Criteria as described on the ELI
Homepage"*. The criteria we have measured ourselves against are the ones on the integration page
under *Developing your SMS*. Please confirm that is the correct and complete source, or point us to
the page you mean, so that what we are declaring against is unambiguous.

**3. Is the closing date 5pm, Friday 30 October 2026?**

The integration page gives that date. The application form refers to *"the September 2026 tranche"*.
We assume the form's wording is left over from an earlier draft and the page is current, but the two
disagree and we would rather not assume.

**4. What security, privacy and assurance evidence does the Ministry require from a vendor?**

This was question 4 of our 14 August enquiry and is the one part of that enquiry still open — the
reply of 18 August addressed the fee question in the same paragraph and did not reach it. Restating
it on its own:

- Does the Ministry require an **independent security assessment or penetration test**, and if so,
  at what point — before application, before go-live, or periodically after?
- Does the Ministry require a **privacy impact assessment**, and does it review one?
- Beyond `AST26`, which specifies TLS 1.2 or above with `ECDHE-RSA-AES256-GCM-SHA384` for ESL
  transport, **does the NZISM apply to the SMS as a whole**, and if so at what classification?
- Is any of this a **cost to the vendor**? Your 18 August reply confirmed no fees for integration
  or certification; an assessment commissioned from a third party would be a different kind of cost
  and we would like to plan for it.

**5. Are the specification documents you sent on 18 August still current, and is the schema at
`https://eli.minedu.govt.nz/eli.xsd` the same as "ELI Events v10.0"?**

Please send current copies of the seven documents (NSI GINS v6.19, ELI NSI GINS Appendix v1.41, ELI
InfoHub v1.3, ELI Data Collection v11.0, ELI Events v10.0, RS7 Return v6.0, Teacher Data Collection
v1.1) with the password, to the address this email is sent from.

Separately: the URL above serves an XML Schema publicly, without authentication. **Is that the same
schema as the "ELI Events v10.0" attachment**, and is it the authoritative version a vendor should
validate against? If they can diverge, we would rather validate against the document than the URL,
and we would like to know which is normative.

**6. Where are the authoritative reference code sets published?**

The schema types ethnicity, iwi, home language, qualification, staff role, gender, wait-time and
closure-reason values as a 1–10 character `LookupCode` and enumerates none of them. `AST55` asks
how our system will handle updates to these lists and expects every value to carry an effective
start and end date. Please tell us where each list is published, in what format, and whether the
published form includes those effective dates — or whether the vendor is expected to maintain the
effective dating itself.

**7. Does the Waha Rumaki/PITA return apply to a standard education and care service?**

The integration page describes it as *"teacher allowances for specific education & care service
types"*. Our pilot customer is a standard education and care service and, as far as we can tell,
would never file this return. `AST52`–`AST54` nonetheless require us to design and describe it.
**Is it in scope for every applicant, or only for vendors serving the relevant service types?** If
the former, we will build and describe it; we are asking so that we describe it accurately rather
than plausibly.

**8. May we see the agreement before submitting?**

The form makes placement *"conditional on signing the agreement that sets out expectations of both
parties"*. We would like to read it before we commit to a 12–18 month programme, not after
selection. A copy, or the material obligations in summary, would be enough.

**9. How is the 50-service capability requirement evidenced?**

Your 18 August reply confirmed that *"the product must be capable of supporting a minimum of 50
services across the relevant licence types"* is a capability rather than a customer count, which we
have taken as settled. For the readiness assessment: **how is that capability demonstrated** — an
architectural description, load or volume testing, an existing multi-service deployment, or
something else? We can evidence whichever of those you assess against; we would rather not guess
which.

---

For completeness about who is writing: we run one pilot deployment, for a two-site not-for-profit
education and care provider in Auckland. We are a small vendor and are not going to represent
ourselves as anything else. Question 1 exists because the honest answer to it may be that we should
apply to a later tranche, and we would rather know.

Ngā mihi,

`[OWNER — name, role, entity, phone]`

---

## What to do with the answers

| Answer | Consequence |
|---|---|
| **1 — interface work follows selection** | Apply. The functionality gaps in [§6 of the tranche plan](eli-integration-2026-tranche.md) become the work programme, and the honest position is "functionally complete for centre-based; home-based and the three returns are scoped" |
| **1 — everything must be built first** | Do not submit. Say so in the wiki, and target the next tranche if the Ministry *"reassesses the need"* in our favour |
| **4 — an independent assessment is required** | A real cost and a real timeline, and it lands on [production-readiness](../llm-wiki/wiki/production-readiness.md) whether we apply or not. Worth doing regardless: the product holds under-5 medical records |
| **5 — the public XSD is normative** | The integration can be built and validated against a public, citable schema. Removes the single largest dependency on correspondence |
| **6 — the Ministry maintains effective dates** | A reference-data table with `effective_from`/`effective_to`, seeded from a published source. **Do not invent code values** — [AGENTS.md §7](../AGENTS.md) |
| **7 — Waha Rumaki is out of scope for us** | Three `AST` items become a scoped N/A with a reason, and `EceReturn` staffing is the only teacher-data surface to build |

Every one of these goes in [unverified-claims](../llm-wiki/wiki/unverified-claims.md) as it is
answered, with the date and the wording, the same way items 37 and 45 were recorded. **Nothing in
this repo may read an unanswered question as a yes.**
