# Privacy statement

**Status: template, for a centre to adopt and adapt. Not legal advice.**

There is a distinction in this document that has to be got right before the wording
matters.

## Who is responsible for this information

Under the Privacy Act 2020, the **agency** that collects personal information carries
the obligations. When a family gives a centre their child's allergies, the agency is
**the centre**. Salix runs the software the centre uses to hold it.

The Act treats information held by one agency **as agent for** another as being held by
the principal, not the agent — so the centre remains the agency answerable to a family
and to the Privacy Commissioner, and Salix's obligations run through the services
agreement rather than directly to the family. That is the intended arrangement and it
needs to be written into the services agreement explicitly, because a default nobody
wrote down is an argument later.

> The section reference for the agent rule has not been checked against the current
> Act. See [unverified-claims](../llm-wiki/wiki/unverified-claims.md) — this is item 10.
> The *substance* (the centre is the responsible agency) is not in doubt; the citation
> is what needs verifying before it appears in a document a family reads.

**So this file is a template.** A centre adopting it must put its own name on it, name
its own privacy officer, and take responsibility for it. What Salix can state
definitively is the second half of this document: what the software actually collects,
where it goes, and who can see it. That part is derived from the schema, not drafted.

---

## What the software collects

Everything below is a column that exists today. Nothing is aspirational and nothing has
been left out to make the list shorter.

### About a child

| What | Why it is held | Who can see it |
|---|---|---|
| Name, preferred name, date of birth | Identity, and the ratio calculation needs an age | Staff at that centre; the child's own whānau |
| Gender, ethnicities, iwi, first language | Ministry funding returns ask for these | Staff at that centre; the child's own whānau |
| National Student Number (NSN) | Identifies the child in Ministry systems | Staff at that centre; the child's own whānau |
| Enrolment dates, days, funded hours, 20 Hours ECE | Funding, and the roll | Staff at that centre; the child's own whānau |
| Allergies, medical conditions, dietary requirements, severity, response plan | Keeping a child safe and alive | Staff at that centre; the child's own whānau |
| Medication authorities — medicine, dose, route, instructions, who authorised it | Giving medicine lawfully | Staff at that centre; the child's own whānau |
| Sign-in and sign-out times | Ratios, funding, and knowing who is in the building | Staff at that centre; the child's own whānau |
| Photos and videos, where consent has been given | The learning journal, and notices | Staff, and the audience the consent covers |
| Consent decisions, and who gave each one | So consent is a record, not a memory | Staff at that centre; the child's own whānau |

### About whānau

Full name, relationship to the child, email, phone, address, whether they may collect
the child, and whether they are an emergency contact.

### Custody and court orders

Where a centre records a custody arrangement, it holds the detail entered and a court
order reference. **Visible to staff only, and never to any parent** — including the
parent it concerns. That is deliberate: a screen that shows one parent what has been
recorded about the other is a screen that turns a centre into a party to a dispute.

### About staff

Name, role, and the compliance records the centre is required to hold: first aid,
police vetting, safety checks, practising certificates, child protection training —
each with its reference, dates, and who sighted the original document.

A staff member can always read **their own** records. That is not a courtesy: the Act
gives a right of access to information about oneself, and building a system where an
educator cannot see their own police vetting result would be building a system that
denies it.

### Technical

An email address and password for anybody with a login. A device token for anybody who
turns on notifications. A log of who changed what and when — recording the **names of
the fields** that changed and never their contents, so the log itself holds no
information about any child.

## What the software does not collect

- No payment card details. There is no payment processing.
- No analytics, no advertising identifiers, no tracking of any kind. There is no
  third-party analytics script in either app.
- No location data. Sign-in records a time, not a place.
- No biometrics.
- No contact list, calendar or photo library access beyond the photo a user chooses to
  attach.

## Where it is held

In a Postgres database and file storage operated by Supabase. **Confirm the region
before a centre adopts this template** — a New Zealand centre should know whether its
children's records are in Sydney, Singapore or Oregon, and the answer belongs in this
document rather than in a support email.

Error reports go to Sentry when something breaks. Those reports are scrubbed before they
leave: email addresses, phone numbers, dates of birth and any database value quoted
inside an error message are removed. That scrubbing has its own tests, because a bug in
it does not produce a wrong screen — it sends a child's medical information to a third
party.

## Who can see what

Separation is enforced by the database, not by the application. Every table carries
row-level security, and there are two boundaries:

1. **Between centres.** A person at one centre cannot read another centre's records,
   even where the same person works at both. 176 automated assertions test this on every
   change, including that a *write* across the boundary is refused, not just a read.
2. **Between families inside one centre.** A parent sees their own children and nobody
   else's. This is keyed on the guardianship record, so it survives a role change.

Photographs have a third gate. A photo of a child whose whānau have not consented is
refused when it is uploaded, and — should consent be withdrawn later — the photo becomes
unreadable rather than merely hidden: the link the browser needs can no longer be
issued.

## Your rights

- **To see what is held about you or your child.** Ask the centre. The Act gives you
  this right and the centre must respond.
- **To ask for a correction.** Also a right. Where the centre disagrees, you may ask for
  a statement of your view to be attached to the record.

**On deletion:** New Zealand law does **not** give a general right to have information
erased. That is European law and it does not apply here. What the Act does require is
that information is not kept longer than it is needed — see
[retention](retention.md) for how long that is and why.

## If something goes wrong

A privacy breach that is likely to cause serious harm must be notified to the Office of
the Privacy Commissioner and to the people affected. The centre is the agency that
notifies; Salix's obligation is to tell the centre immediately and to help establish
what happened. The steps, and the timeframes, are in
[breach-response](breach-response.md).

## Who to contact

- **The centre's privacy officer** — every agency must have one. Name and contact
  details go here when a centre adopts this template.
- **Salix**, for anything about the software itself: vakkas@pif.org.nz
- **The Office of the Privacy Commissioner**, if a complaint is not resolved:
  privacy.org.nz

---

*Template last updated 2026-08-04. A centre adopting it should date its own version and
review it whenever what the software collects changes — the tables above are generated
from the schema by hand and will drift if nobody looks.*
