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

## Domain

- [[attendance-and-ratios]] — append-only sign-in, a ratio that warns *before* a breach, and
  why the adult count is an event rather than a setting
- [[compliance-and-evidence]] — staff records with expiry, criteria that ship empty on
  purpose, and a binder that never claims compliance
- [[consent-gated-media]] — a photograph that cannot exist without a recorded consent decision,
  and the RLS trap that made the first version leak to staff
- [[funding-and-billing]] — attendance into money: why a broken record is excluded rather than
  estimated, why bookings and attendance are separate, and what this product cannot submit

## Offline

- [[offline-outbox]] — a SQLite queue instead of a sync engine, and the merge rule where both
  obvious shortcuts are wrong

## Privacy

- [[privacy-and-retention]] — what the Privacy Act 2020 actually requires (and a correction to
  an earlier wrong claim), plus how purging coexists with append-only tables

## Production readiness

- [[production-readiness]] — the phase that found a centre could not be deleted, what an
  accessibility audit of an empty page is worth, and why a restore drill has to be
  mutation-tested

## Conventions

- [[conventions]] — migrations, timezones, PostgREST traps, testing, tokens, and the versions
  worth not re-litigating

---

## Related, outside this repo

- `salix/llm-wiki/wiki/possible-projects/ece-early-learning-app.md` — the product plan and
  market research this project came from. Status there is still "RESEARCHED — NOT APPROVED",
  which is now out of date: Phases 0–3 are built. Its Stage 0 (ten conversations, zero code)
  was never run — recorded in [[unverified-claims]].

*Index last updated: 2026-08-04*
