# Wiki index

Knowledge base for the **ece** monorepo — a multi-tenant platform for New Zealand early
learning services. Initialised 2026-08-04.

Pages are maintained by hand. See [`../README.md`](../README.md) for the pattern and the rules,
and [`../schema.md`](../schema.md) for the page template.

---

## Start here

- **[[unverified-claims]]** — everything this product asserts that nobody has checked. Read
  this before trusting any figure in the product, and before flipping any flag to make a
  warning go away.

## Access and isolation

- [[tenancy-and-rls]] — two boundaries in Postgres: centre against centre, and guardianship
  inside a centre. Why `packages/api` contains no tenant filter, and the three bugs the
  isolation suite found on its first run
- [[invitations]] — a two-step handshake with only the token hash stored; why signups are
  disabled and what that makes an invitation
- [[kiosk-and-pins]] — the door tablet as a role rather than a person: why a four-digit PIN is
  bcrypt and not SHA-256, why the verify function returns a status instead of raising, the
  audit trigger that would have recorded nothing, and the PIN's second job — signing the week,
  through a gate callable by nobody
- [[password-recovery]] — self-serve reset and in-app change, and why the design documents'
  "no password reset, ask for a re-invitation" was a lockout mechanism, not a safety property

## Domain

- [[attendance-and-ratios]] — append-only sign-in, a ratio that warns *before* a breach, and
  why the adult count is an event rather than a setting
- [[attendance-verification]] — the family's signature the record never had: why the status is
  derived and the competition stores it, the state no stored status can express, the snapshot
  that was not needed because of a decision made four phases earlier, the three tests that
  passed while proving nothing, and the door tablet's show-then-sign flow — a PIN may not sign
  what was never displayed
- [[compliance-and-evidence]] — staff records with expiry, criteria that ship empty on
  purpose, and a binder that never claims compliance
- [[curriculum-strands]] — Tier 4's lowest-priority item, a `FOR ALL` policy that
  reintroduced a bug 0022 had already removed once, and a PL/pgSQL variable named the same
  as a real column
- [[incident-register]] — one table with two audiences and the boundary running inside a centre:
  the draft a family must not see, why the generic `jsonb` register breaks the audit log, and the
  `EXECUTE` grant a code review cannot see because the file does not mention it
- [[medication-administration]] — the half of a medication record that never existed: a window
  check that has to be a trigger, the timezone bug that would have refused a child their
  antibiotics, and the first assertion that a purge reaches a table nobody can `DELETE`
- [[centre-registers]] — drills, hazards and safety checks: the phase where the boundary is one
  line, and the one predicate that would have handed a parent the hazard register
- [[checklists]] — replacing 1Place: a room list the product hangs off and which a parent may
  read (deliberately unlike its neighbours), a work queue, and a checklist engine whose runs
  point at a template *version* so a wording change cannot rewrite last year's evidence; plus
  the two defects the checks caught — a shared function re-declared from its own comment, and an
  EXECUTE grant left at its default for the second time in eleven days
- [[sleep-checks]] — the register that refuses to say how often, and why a default interval
  would be worse than none: it would talk a centre into a breach behind a green screen
- [[staff-as-people]] — the identity question Phase 10 hangs off: three notions of a person that
  already existed and none that fit, and the backfill migration that must not be written
- [[asking-for-consent]] — the mechanism existed from week one and nothing ever asked; the third
  state (asked and waiting), and the decision about telling parents this change satisfies rather
  than reverses
- [[consent-gated-media]] — a photograph that cannot exist without a recorded consent decision,
  and the RLS trap that made the first version leak to staff
- [[post-comments]] — whānau replying to a post: a visibility policy that delegates rather than
  copies, why auto-approved and approved-by-a-person stay different facts, and the names that
  are missing on purpose
- [[exports]] — CSV and PDF: why a byte-order mark is a product decision in a te reo Māori
  product, why a cell beginning `=` is an attack, and why two exports are stricter than the
  pages they sit on
- [[funding-and-billing]] — attendance into money: why a broken record is excluded rather than
  estimated, why bookings and attendance are separate, and what this product cannot submit

## Offline and mobile

- [[offline-outbox]] — a SQLite queue instead of a sync engine, the merge rule where both
  obvious shortcuts are wrong, and why a queued event belongs to the person who made it
- [[mobile-app]] — the app that for five phases rendered "Not signed in." and offered nothing:
  what can and cannot be built with only the anon key, and eleven defects in code that had
  never executed

## Privacy

- [[privacy-and-retention]] — what the Privacy Act 2020 actually requires (and a correction to
  an earlier wrong claim), plus how purging coexists with append-only tables

## Families

- [[parent-self-service]] — the first write a family may make, why it is a definer function and
  not a policy, why the button does not say Cancel, an assertion that lied because its subject
  could not see its own evidence, and the absence the centre now hears about — once per
  submission, however many days it covers
- [[emergency-broadcast]] — a fan-out that reaches every family through a queue with a writer
  for nobody and a reader for nothing, until now; why the word does not mean push or email yet;
  and a bug the RLS suite caught while its own assertion was being written

## Reporting

- [[reporting]] — occupancy and attendance trends, the licence figure this product refused to
  invent a default for, why the average is over open days rather than calendar days, and the
  Postgres GROUP BY that would have been faster and wrong

## Model calls

- [[model-calls]] — what is sent to an external model and what the type system makes
  unsendable, why deterministic code decides and a model only phrases, the refusal branch that
  would otherwise render a blank panel, and the NZ$20 cap computed from a table nobody can edit

## Production readiness

- [[production-readiness]] — the phase that found a centre could not be deleted, what an
  accessibility audit of an empty page is worth, and why a restore drill has to be
  mutation-tested

## Security

- [[security-review]] — sixteen checks written as SQL against the live schema, the four
  findings they turned up, and the four false positives the review made about itself

## Reading data

- [[reading-every-row]] — PostgREST truncates at a thousand rows and reports no error, which
  under-reported a funding claim by 28% and invented broken days that were not broken

## Running it

- [[deployment]] — one Railway service for every centre, why that is forced rather than chosen,
  and a security header that made the whole product read-only
- [[domain-cutover]] — moving littlepearls.org.nz onto Railway: the CNAME that made the
  mail fix a no-op, an SOA minimum read as a record TTL, a cPanel zone four years out of step
  with the one being served, and a verification tool that invented five failures

## Public website

- [[public-website]] — Little Pearls' own site rebuilt as a third app: why not routes in the
  platform, why not a sibling repo, the brand palette that cannot carry text, and the four monorepo
  files that would have skipped a new app silently
- [[recruitment]] — job applications from the public careers page: the **only** write an
  unauthenticated caller may perform in this schema, the two designs rejected before it, why a
  duplicate submission is a quiet no-op rather than an error, and why DELETE is granted here and not
  on `waitlist`

## Design

- [[design-system]] — applying the Doorway handoff: the four token values that diverged, the
  one master-prompt constraint that had to be refused, and which of the thirteen screens are
  actually done
- [[console-handover]] — the second handover, which supersedes the first: structure rather than
  colour, why the menu button reordered in the DOM instead of with `order:`, and the redirect
  origin that signs a screenshot run out without saying so
- [[in-product-help]] — the `?` beside every heading and the page behind it: why a `<details>`
  and not a tooltip, why 186 B of JavaScript is a correctness property rather than a boast, and
  the three buttons that were better off without a question mark

## Conventions

- [[conventions]] — migrations, timezones, PostgREST traps, testing, tokens, and the versions
  worth not re-litigating
- [[i18n]] — infrastructure for the te reo Māori interface, deliberately not the interface
  itself: a cookie instead of next-intl's own middleware, a Server/Client Component split
  the build caught the need for, and a `[mi]` placeholder prefix that is the only thing
  stopping this from looking like a translation nobody actually did

---

## Related, outside this repo

- `salix/llm-wiki/wiki/possible-projects/ece-early-learning-app.md` — the product plan and
  market research this project came from. Status there is still "RESEARCHED — NOT APPROVED",
  which is now out of date: **all seven phases are built**, the first tenant exists, and the web
  app is ready to deploy. Its Stage 0 (ten conversations, zero code) was never run — recorded in
  [[unverified-claims]], and still the weakest evidence under any pricing decision.

*Index last updated: 2026-08-14*
