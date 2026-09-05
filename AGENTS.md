# AGENTS.md — ece

> Single source of truth for any LLM or autonomous agent working on this repo. Read this before
> writing code. If you are Claude Code, [CLAUDE.md](CLAUDE.md) points here and adds the coding
> rules.

---

## 1. What this is

A multi-tenant platform for **New Zealand early learning services** — childcare centres. One
Next.js web app, one Expo mobile app, one deployment serving every centre.

The first real user is **Little Pearls Educare**, a two-site not-for-profit provider in
Auckland (Mt Albert and Mt Roskill). The pilot is free; the plan is to monetise later
customers. A services agreement exists.

**This product holds children's names, dates of birth, allergies, medication doses, custody
arrangements and attendance records.** Under-5 records are among the most sensitive personal
information in the country and a breach is notifiable. That is not a reason to be timid, but it
is the reason several decisions in here look paranoid. They are load-bearing.

## 2. Read these, in this order

| # | File | Why |
|---|---|---|
| 1 | **[llm-wiki/wiki/unverified-claims.md](llm-wiki/wiki/unverified-claims.md)** | Everything the product asserts that nobody has checked. Read it before trusting a figure or silencing a warning |
| 2 | [README.md](README.md) | How to run it, and the design decisions a contributor needs |
| 3 | [llm-wiki/wiki/index.md](llm-wiki/wiki/index.md) | Why decisions were made, and what was tried and rejected |
| 4 | [LOGS.md](LOGS.md) | Session narrative — what happened, what broke, what was found |

## 3. Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 15 App Router, React 19, TypeScript strict |
| Mobile | Expo 57 / React Native 0.86, React 19 |
| Shared | `packages/core` (no Node, no Next, no React Native) and `packages/api` (the only place either app talks to Supabase) |
| Database | Supabase Postgres 17. **RLS is the tenant boundary** |
| Styling | Plain CSS with custom properties generated from shared tokens. No Tailwind |
| Errors | Sentry, dynamically imported, inert without a DSN |

## 4. The five rules that bite

### 1. Postgres is the security boundary, not the application

`packages/api` contains **no tenant filtering at all**, deliberately. A filter in the app is one
forgotten `.eq('centre_id', …)` away from showing one centre another centre's children, and
writing it anyway would imply the filter is what keeps centres apart.

There are **two** boundaries. Centre against centre, and — harder — guardianship *inside* a
centre, because `parent` is a role within the tenant. A policy keyed on `centre_id` alone passes
every pre-Phase-1 test and hands one family another family's medical records.

### 2. A new table needs a policy, a grant, and an assertion — in the same commit

RLS is the *second* check. Postgres tests the table privilege first, so a table with perfect
policies and no `GRANT` is unreachable, and a table with a `GRANT` and no policy returns
everything. Both halves of a policy (`USING` **and** `WITH CHECK`) are required. Remember
`service_role`: it bypasses RLS but **not** grants.

Then add an assertion to `supabase/tests/rls_isolation.sql`. If your suite passes first run,
**mutation-test it**: weaken the policy deliberately and confirm the suite fails on the right
assertion. A test that cannot fail is not a test.

### 3. Never compute "today" as UTC

PostgREST connects as UTC and New Zealand is 12–13 hours ahead, so for the whole New Zealand
morning UTC is *yesterday*. This has already caused two real bugs, including a `CHECK`
constraint rejecting a baby born that morning as born in the future.

- SQL: `(now() at time zone 'Pacific/Auckland')::date`, never `current_date`
- TypeScript: `todayInZone(centre.timezone)` from `@ece/core`, never
  `toISOString().slice(0, 10)`, and never the device's local date on a server

### 4. Append-only means no grant, not just no policy

`audit_events`, `consent_events`, `attendance_events` and `staff_count_events` withhold
`UPDATE`/`DELETE` from **everybody including `service_role`**. That is what makes "this cannot
be altered" true rather than aspirational, and it is why `audit_events.detail` holds column
names and never values — which is in turn the only reason a child's record can be purged while
the evidence that it existed survives.

### 5. Do not assert what you have not checked

This is a compliance product. A tool that is confidently wrong is worse than no tool, because a
manager who is told they are within ratio stops counting.

If you cannot source a figure, a duration or a regulation: **make the product say so** in a
machine-readable flag the UI renders, and add it to
[unverified-claims](llm-wiki/wiki/unverified-claims.md). Two flags already work that way —
`RATIO_TABLES_VERIFIED` and the deliberately empty criteria table.

**Never flip such a flag to make a warning disappear.** Flipping `RATIO_TABLES_VERIFIED` is a
claim about the law and belongs in a commit that records who read what.

## 5. Verification — a change is not done until these pass

```bash
npm run typecheck        # four workspaces, plus the e2e project
npm run lint
npm test                 # unit tests
npm run test:rls         # the one that matters — one centre reaching another
npm run tokens:check     # generated CSS matches the shared tokens
npm run check:docs       # every documentation link resolves
npm run check:bundle     # performance budgets, in gzipped bytes
npm run review:security  # checks against the live schema
npm run build            # web
```

Touching mobile? Also `cd apps/mobile && npx expo export --platform android` — Metro's resolver
is not TypeScript's, and a package can typecheck and fail to bundle.

Touching the offline path? Also `npm run drill:offline`.
Touching a read that could return many rows? Also `npm run drill:rowcap`.
Touching the schema? Also `npm run drill:restore`.
Touching auth, roles or a route guard? Also `npm run test:e2e`.

Deliberately not listing assertion counts here. A number in a checklist is a number that goes
stale, and the counts live in the tools that print them.

CI runs all of it. The RLS suite is a separate job, because a red cross there means something
different from a failing unit test: it means one centre can reach another centre's children.

### The last gate: the wiki, in the same commit

**Update `llm-wiki/` before you commit, not after.** This is a step in the list above, not a
tidy-up afterwards.

| If the change… | Then |
|---|---|
| made a decision worth keeping, or rejected an approach | the relevant page, or a new one |
| found a defect, especially one no check could have caught | the page for that area, with the mechanism |
| **contradicts something a page already says** | correct that page **first** — a wiki that is wrong is worse than no wiki |
| asserts anything nobody has verified | an entry in [unverified-claims](llm-wiki/wiki/unverified-claims.md) |
| added a page | a line in [index.md](llm-wiki/wiki/index.md) |
| any of the above | an entry in [log.md](llm-wiki/wiki/log.md), and `npm run check:docs` |

Two reasons it goes before the commit rather than after. The commit message and the wiki page
are written from the same understanding, and that understanding is at its sharpest while the
work is fresh — a page written three commits later records what you remember, not what you
learned. And a wiki updated afterwards is a wiki that gets skipped the one time the work was
hard, which is the time it was worth writing down.

The only exception is a commit that touches nothing but `llm-wiki/`.

## 6. What is built

Phases 0–3 of the plan. Web: login, centre switching, roster, invitations, children and their
whānau, enrolment, health, consent, attendance with live ratios, and a compliance dashboard with
a printable evidence binder. Mobile: the roll, one-tap sign-in, a pinned ratio bar, and an
offline outbox.

Phase 4 (parent engagement: posts, consent-gated media, messaging, push) is next. It is the
first phase where `has_consent()` stops being a function nobody calls and starts gating whether
a photo can be attached at all — which is why it was built in Phase 1 rather than left to be
remembered later.

## 7. Standing constraints

- **This repository is public.** Verified 2026-09-05, not assumed — an unauthenticated request to
  the GitHub API returns 200. Everything written here is published: policies, the complete register
  of what nobody has checked, the breach runbook, a named customer. That is a deliberate decision
  and it is also a **filter on every commit**. Nothing goes in that identifies a person or
  authenticates an organisation — no credential, no key, no tax or identity number. The test that
  settled the last one: an NZBN is on a public register by design and may be recorded; an IRD
  number is on none and may not, and the fact that a form might one day want it is not a reason to
  keep it here.
- **Never commit `.env.local` or `.backups/`.** The latter holds a pre-wipe dump of the previous
  occupant of this database, including user emails and forum posts.
- **The service-role key never goes near the mobile workspace or a browser bundle.** Expo inlines
  every `EXPO_PUBLIC_*` value into the shipped binary.
- **Do not seed invented regulatory content.** Not criterion numbers, not ratio bands, not
  retention periods.
- **The demo seed is guarded** and writes to a real database. `ECE_ALLOW_DEMO_SEED=yes` is
  required, everything it creates is tagged `Demo-Seed`, and its emails use the `.invalid` TLD.
- **Migrations are applied by `npm run migrate`**, never by hand. It refuses if a file changed
  after it was applied, and they must replay cleanly against a populated database.
- **Update the wiki before committing**, never after — it is the last gate in §5, with a table
  of what to touch when.

*Last updated: 2026-09-05*
