# First tenant — Little Pearls Educare Centre

Created 2026-08-05. Two centres, one owner account, **zero personal information** — which is
the correct state until the insurance gate is closed.

## What exists

| | Mt Albert | Mt Roskill |
|---|---|---|
| **Centre name** | Little Pearls Educare Centre — Mt Albert | Little Pearls Educare Centre — Mt Roskill |
| **Slug** | `little-pearls-mt-albert` | `little-pearls-mt-roskill` |
| **Centre id** | `89e24ad5-7853-45f1-8b9f-535762c1ed67` | `5539afb4-1b4c-41a7-8a7f-3c64c18e7c62` |
| **MoE service number** | `46365` | `47407` |
| **Timezone** | Pacific/Auckland | Pacific/Auckland |
| **Owner** | vakkas@pif.org.nz | vakkas@pif.org.nz |
| **Manager** | Taner Basar, taner@littlepearls.org.nz — *invited 2026-08-06, not yet accepted* | same |
| Children, guardians, enrolments, health records | 0 | 0 |

The owner is **the platform operator, not the centre**. That is a deliberate starting point:
the centre's manager gets an account through the invitation flow when they are ready to use
it, which is one command and a link they open themselves —

```bash
npm run onboard -- --existing-centre 89e24ad5-7853-45f1-8b9f-535762c1ed67 \
                   --owner <their address>
```

— rather than an account created for a real mailbox before anybody asked for one. Nothing is
emailed by that command; it prints a single-use link to hand over.

## The facts, and where each came from

From [littlepearls.org.nz](https://www.littlepearls.org.nz/), the service's own site:

- **Not for profit, community established.** Two centres, "Owairaka / Mt Albert" and
  "Puketapapa / Mt Roskill".
- Mt Albert: **2a Lorraine Avenue, Mount Albert, Auckland 1025** · +64 9 815 2277 ·
  contact@littlepearls.org.nz
- Mt Roskill: **3 Radnor Road, Mount Roskill, Auckland 1041** · +64 9 216 7838 ·
  mtroskill@littlepearls.org.nz
- **Open each weekday 7.30am to 6.00pm**, children **3 months to 5 years**.
- Site sections: About, Our Centres, Enrolment & Fees, Our Staff & Career, Contact Us.

Not stated anywhere on the site: service numbers, licensed capacity, ratios, roll size, fees,
20 Hours ECE, or any staff name.

From the Ministry of Education's own directories:

| Fact | Source |
|---|---|
| Mt Albert is service **46365** | [Education Counts profile](https://www.educationcounts.govt.nz/find-an-els/els/profile-and-contact-details?ece=46365) · [ERO institution 46365](https://ero.govt.nz/institution/46365/little-pearls-educare-centre) |
| Mt Roskill is service **47407** | [Education Counts profile](https://www.educationcounts.govt.nz/find-an-els/els/profile-and-contact-details?district=7613&ece=47407&region=2) · [ERO institution 47407](https://www.ero.govt.nz/institution/47407/little-pearls-educare-centre-mt-roskill) |

Two independent government directories agree on the same identifier per site, and the ERO
institution number matches the Education Counts `ece=` parameter in both cases.

## What is not verified, and matters

**The service numbers were read from URL parameters and search summaries, not from a rendered
Ministry page.** Education Counts returned 403 to an automated fetch. The identifiers are
almost certainly right — two directories, two matching numbers — and "almost certainly" is
not the standard for a number that **prints on the evidence binder and gets keyed into a
funding return**. Confirm both against a document the centre actually holds (a licence
certificate or any Ministry correspondence) before either is relied on. Until then:

```bash
# to correct one
npm run onboard -- --existing-centre <uuid> --owner vakkas@pif.org.nz   # attach, then fix by SQL
```

**Secondary sources disagree with the centre's own site**, which is why none of the following
was entered anywhere:

| Claim | Source | Status |
|---|---|---|
| Licensed for **65** children (Mt Albert) | third-party directories | Not on the centre's site, not entered |
| Licensed for **53** FTE including up to **14 under two** (Mt Roskill) | third-party directories | Not on the centre's site, not entered |
| Opens at **7.00am** (Mt Roskill) | third-party directory | **Contradicts** the centre's own site, which says 7.30am |
| Mt Roskill opened May 2018 | third-party directory | Not entered; nothing needs it |

Licensed capacity is the interesting one: it is genuinely useful — a roll approaching the
licence is worth warning about — and there is nowhere to put it yet, because the schema has no
capacity column. Adding one means asking the centre for the figure rather than taking a
directory's word for it.

**No fee schedule has been created.** The site publishes no fees, and `fee_schedules` ships
with no amounts anywhere in the product on purpose. An invented rate is a rate a family gets
billed.

## What must not happen yet

**No child record goes in until professional indemnity insurance is in place.** The services
agreement exists; the insurance did not as at 2026-08-05. The line is not "the schema exists"
— it is a real child's allergies being typed in, and the two centres above hold nothing but a
name, a service number and a timezone precisely so that line has not been crossed.

See [privacy-statement](privacy-statement.md) for what will be held when it is, and
[retention](retention.md) for how long.

### Somebody has now asked to cross it — 2026-08-16

**The centre manager asked for the enquiry form to collect a child's date of birth**, as the
centre's old website does. This is the first request that runs directly at the gate above, so
the state of it is recorded here rather than settled in a commit message.

**Nothing was built.** The form, `enrolment_applications`, `submit_enrolment_application` and
the catalogue assertion in `rls_isolation.sql` are all untouched.

**The shape that was agreed, for when it is unblocked: month and year of birth — "March 2024"
— not an exact date.** It answers what the centre actually needs from an enquiry (which room,
which month the transition falls in, and where the family sits on a waitlist) and stops short
of a value that identifies one child on its own.

That reverses a decision made deliberately in migration **0054**, which dropped exactly this
field and called it *"a date of birth with the day filed off … finer than a band, and it invites
exactly the field the page refuses."* That reasoning was sound and the reversal is a change of
requirements, not a correction of it — so 0054's argument has to be answered in whatever
supersedes it rather than quietly overwritten.

**THE ONE FACT THAT BLOCKS IT, and nobody here can answer it: is the professional indemnity
insurance in place now?** The date above is 2026-08-05 and it has not been rechecked. Every
argument on this page depends on it, and the answer is a fact the owner holds. Record it here
with the date it was confirmed — and, if yes, the insurer or policy reference, because "somebody
said yes once" is the shape of claim this repo keeps having to correct.

If the answer is **yes**, this becomes an ordinary product change: a migration superseding 0054,
a new function signature, the `child_name` catalogue assertion in `rls_isolation.sql` rewritten
to pin the *new* boundary rather than deleted, and [privacy-statement](privacy-statement.md)
updated to say the platform now holds a child's birth month from a public form.

If the answer is **no**, it stays as it is. The enquiry keeps the coarse age band, and the
centre takes a birth date the way it does today — in the conversation the enquiry exists to
start.

## The trap this uncovered

The demo centres were originally created with **the real customer's slugs** —
`little-pearls-mt-albert` and `little-pearls-mt-roskill` — because when they were written
there was no real customer, only a plan naming Little Pearls as the first one. And
`scripts/seed-demo.ts` found its centres with `slug like 'little-pearls-%'`.

So the first run of the demo seed after this tenant existed would have inserted seven invented
children — including a fabricated peanut anaphylaxis plan and a fabricated asthma plan — into
a live service's roll. The next run's `purgeAll()` would have deleted them again, which is
worse: it would have looked like nothing had happened.

It was caught by the unique index on `slug` refusing the insert during onboarding. That is
luck: a constraint doing a job nobody asked it to do.

Now: demo data lives under `demo-`, the real tenant under its own name, and the seed script
**refuses to run** if its pattern ever matches a centre whose slug does not start `demo-`. A
prefix convention alone is a convention; the assertion is the rule.

---

## The careers form is live, 2026-08-06

The public site's careers page now writes into this tenant. It is the **first and only** path by
which somebody who is not a member of this centre can create a row here, and it is worth being clear
about what that does and does not mean for the gate below.

**It does not touch the insurance gate.** A job applicant is an adult writing about themselves.
There is no child, no date of birth, no guardianship question, and nothing a family has to have
consented to. Both centres still hold no child record.

**Only Taner and the owner can see an application** — not educators. Applications arrive at whichever
centre the applicant chose, or at both if they chose "either", and appear under **Applications** in
the app. Nothing emails anybody when one arrives; the screen is how you find out.

**CVs still come to `career@littlepearls.org.nz`.** The form cannot take an attachment yet, and the
reason is retention: nobody has said how long the centre wants to keep an unsuccessful applicant's
CV, and that answer is what the storage work needs. The form tells applicants to email it, and staff
can log an emailed application by hand — the record notes which arrived how.

Two things to tell the manager before he uses it: an application can be **deleted outright** and
genuinely is (the audit log records that it happened and keeps no copy of the row), and the
"practising certificate" line is **what the applicant said**, shown on screen as exactly that. The
certificate still has to be sighted and filed under Compliance before anybody starts.

See [[recruitment]] for the design and what was rejected.

## The manager's invitation, 2026-08-06

Taner Basar (taner@littlepearls.org.nz) was invited as **manager at both centres** on 2026-08-06,
at the owner's request. Two invitations, because a membership is per-centre; each is single-use and
expires 2026-08-13.

Issued through `createInvitation` with the app's own token helpers — **not** `npm run onboard`.
That script prints an `action_link` from `admin.generateLink`, whose tokens arrive in the URL
fragment, and nothing in the web app reads a fragment, so it cannot establish a session. See
[[invitations]]. The `/invite/<token>` flow is the one the end-to-end suite covers.

Two things this does not change:

- **No child record still means no child record.** The insurance gate below is untouched. A manager
  signing in to look around is the point; entering a real child's allergies is not, and both
  centres still hold nothing but a name, a service number and a timezone.
- **He will see an empty product**, which is correct. If he only runs one site, revoke the other
  membership from People once he has accepted — one click, and the audit trail keeps the record of
  who invited whom.

A note found while doing it: the UI's "they are already at this centre" guard could not be
reproduced in a script, because `listMembers` reads the `centre_members` view and **service_role
has no grant on it** — "permission denied for view centre_members". service_role bypasses RLS but
not grants, which is AGENTS rule 2 working as designed.

---

*Last updated 2026-08-06. Nobody at the centre has used the product yet; the manager has been
invited and has not accepted. No child record exists.*
