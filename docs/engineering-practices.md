# Engineering practices — browsers, dependencies, change control, defects

**Written 2026-09-05.** Four assessed items on the ELI vendor application — `AST02`, `AST04`,
`AST15` and `AST19` — ask what this team's engineering practice *is*. Until today the honest answer
to each was "there is one, and it is not written down anywhere", which is indistinguishable on a
form from not having one.

Nothing here is aspirational. Every claim is either measured on the date given, or marked
`[OWNER]` because it is a decision this repository cannot make.

**Deliberately not in this document:** the support process (`AST23`) and the business-continuity
plan (`AST22`). Both need commitments — a channel, a response time, a named person — that are the
owner's to make, and a document that invented them would be worse than the gap.

---

## 1. Supported browsers — `AST04`

### The declared target

`package.json` now carries a `browserslist` key:

```
chrome 64, edge 79, firefox 67, opera 51, safari 12
```

**Those five values are not a choice; they are Next.js 15.3.9's own default, written down.** Read
from `next/dist/shared/lib/modern-browserslist-target.js` on 2026-09-05 — the minimum versions
supporting static import, dynamic import and `import.meta`. `getSupportedBrowsers()` in
`next/dist/build/utils.js` falls back to that list only when no browserslist config resolves, which
was this repository's state until today.

**So declaring it changed no served byte, and that was verified rather than assumed.** Bundle
budgets before and after the change, both from `npm run check:bundle` on 2026-09-05:

| | before | after |
|---|---|---|
| `apps/web` first-load JS | 101.1kB gzip | **101.1kB** |
| `apps/web` first-load CSS | 3.7kB | **3.7kB** |
| `apps/web` middleware | 88.0kB | **88.0kB** |
| `apps/site` first-load JS | 104.3kB | **104.3kB** |

The point of declaring it is not to change the target but to **pin** it: a future Next.js upgrade
that moves its own default would otherwise move ours silently, and the first symptom would be a
parent on an old phone seeing a blank screen.

### What is actually tested, which is narrower

| | |
|---|---|
| **Engine** | **Chromium only.** The reasoning is recorded in `apps/web/playwright.config.ts`: axe-core's engine-varying checks are the ones automation is weakest at anyway, and running one rule set three times measures Playwright rather than the app |
| **Desktop** | 1440×900, `en-NZ`, `Pacific/Auckland`, against a **production build** — not `next dev`, which serves a different bundle, unminified CSS and a development React |
| **Phone** | 390×780, a separate project. It exists because it was absent once and a real defect shipped: the 224px side rail never collapsed — 57% of the screen — and `/attendance` scrolled 327px sideways |
| **Not tested** | Firefox, Safari/WebKit, Edge, any Internet Explorer, and any browser on a real device rather than an emulated viewport |

**We do not claim the declared target is verified.** The target says what the build compiles for;
the table above says what has been exercised. Those are different statements and the gap between
them is the honest answer to `AST04`.

### What would close the gap

Adding `firefox` and `webkit` Playwright projects is roughly an hour and triples the suite's
runtime. It is worth doing when there is layout that could disagree — today there is one grid and
one flex row, and the config says to add the projects at that point rather than before it.

---

## 2. Dependency management — `AST02`

### The policy

1. **Node is pinned exactly** by `.nvmrc`. `next` and `react-native` are pinned to exact versions;
   everything else uses caret ranges against a committed `package-lock.json`. One lockfile at the
   root covers every workspace.
2. **A version-coupling constraint is recorded in the manifest itself**, not in someone's memory:
   Expo 57 / RN 0.86 is the first pairing that runs React 19, which is what lets the web and mobile
   applications share one logic layer. Breaking that pairing breaks the shared layer, so the two are
   upgraded together or not at all.
3. **No dependency change is merged without the full gate.** Nine commands must pass — `typecheck`,
   `lint`, `test`, `test:rls`, `tokens:check`, `check:docs`, `check:bundle`, `review:security`,
   `build` — plus the conditional gates in `AGENTS.md §5` for whatever the change touches. A
   dependency bump is not exempt; `check:bundle` and `review:security` exist precisely because an
   upgrade can move a served bundle or a database grant without changing a line of our code.
4. **Security updates are not batched and not scheduled.** They are taken as they are raised.
5. **A major version of the framework, the database client or the mobile runtime is a piece of
   work, not a merge** — it gets the same treatment as a feature, including a wiki entry recording
   what changed and why.

### The automation, as of 2026-09-05

`.github/dependabot.yml`. Weekly on Monday, Auckland time, at most five open branches, grouped by
**blast radius rather than by ecosystem**:

| Group | Why it is its own group |
|---|---|
| `framework` — Next, React, Expo, React Native | Can move the served bundle, the CSP nonce path and the render model |
| `data` — Supabase clients, `pg` | Can change how PostgREST paging and error codes surface, and this product parses both — see `classifyWriteFailure` |
| `tooling` — TypeScript, Vitest, ESLint, Playwright, tsx | Cannot reach production. Safe to take together |

GitHub Actions versions are updated monthly and separately.

**Weekly rather than daily, and the reason is not taste.** One contributor runs nine gates by hand
on every commit. A daily cadence would open more branches than there are working days to gate them,
and an ignored bot is worse than no bot — it trains the reader to skip the one notification that
mattered.

**What this does not yet do:** nothing has run through it. The configuration lands 2026-09-05; the
first batch will arrive the following Monday, and until one has been taken end to end this is a
stated policy with automation attached rather than a demonstrated practice. Said plainly here so it
is not read as more than it is.

---

## 3. Change control — `AST15`

### How a change is actually made today

One contributor. Commits go **directly to `main`**; there are no feature branches and no pull
requests. Every commit carries a message stating what changed and *why*, and the repository holds
251 of them as at 2026-09-05.

What stands in place of a review gate:

- **The nine-command gate above, run locally before every commit.** Not a policy — the gates are
  the reason three real defects in this product were caught that `typecheck` and `next build` could
  not see.
- **An append-only decision log.** `llm-wiki/wiki/log.md` records every change that made a decision
  worth keeping, found a defect, or contradicted an earlier page. `AGENTS.md §5` makes updating it
  a step *before* the commit, not after, and states the reason: a page written three commits later
  records what somebody remembers rather than what they learned.
- **A standing register of everything unverified.** `llm-wiki/wiki/unverified-claims.md` — 65 items,
  52 open as at 2026-09-05. Its purpose is that a claim nobody has checked is recorded as such
  rather than quietly becoming true by repetition.
- **A migration runner that refuses to lie.** `npm run migrate -- --status` fails if a migration
  file changed after it was applied.

### What is genuinely absent

`[GAP]` **There is no branch protection, no `CODEOWNERS`, and no second pair of eyes on any
commit.** With one contributor, a review requirement would be a person reviewing themselves, which
is ceremony rather than control — but three things that branch protection gives are *not* about
having a reviewer, and their absence is a real risk:

| Absent control | What it would prevent |
|---|---|
| Block force-push to `main` | A rewritten history on the repository that is this product's only audit trail of its own development |
| Block branch deletion | The same, more bluntly |
| Require the CI checks to pass before merge | A commit reaching the deploy branch that no gate has run against — see `AST16` |

`[OWNER]` **Recommendation: enable branch protection on `main` for force-push and deletion only,
and do not require pull requests.** Requiring PRs contradicts the working model this project runs
on — direct commits to `main` are a deliberate standing instruction, not an oversight — and a
process that one person performs on themselves is the kind that gets bypassed the first time it is
inconvenient, which is worse than not having it. The two prohibitions cost nothing and remove the
only irreversible failure mode.

The third row depends on CI having credentials to run against, which is `AST18` and is blocked on
the second Supabase project rather than on this decision.

---

## 4. Defect tracking — `AST19`

### How it works today

`[GAP]` **There is no issue tracker.** What exists instead, and it is more than nothing:

| | |
|---|---|
| `llm-wiki/wiki/unverified-claims.md` | The register. 65 numbered items, each with what is unresolved and what would close it; items are marked `CLOSED` with the date and the commit rather than deleted |
| `llm-wiki/wiki/log.md` | Append-only. Correcting an earlier entry means a new entry saying so |
| `LOGS.md` | The narrative record |
| Git history | 251 commits, each stating the reason for the change |

That is a real defect record — it is how the §6-4 rule, the offline classifier misdiagnosis and the
funding over-statement were each tracked from discovery to closure — but it has three specific
weaknesses that a tracker would not:

1. **No state machine.** "Open" and "closed" are prose. An item can be closed in one document and
   open in another, and has been: register item 48 still described the functionality table as it
   stood two days earlier.
2. **No assignee and no date.** Nothing distinguishes an item waiting on the Ministry from one
   waiting on nobody.
3. **Not readable by anyone outside.** A Ministry auditor cannot be given a filtered view of open
   defects; they would be given a 2,600-line markdown file.

### What should change, and it is small

`[OWNER]` Enable GitHub Issues on the repository and adopt this split: **the register keeps
recording *claims* — what has not been verified and why** — and Issues track *work* — what is open,
who holds it, and what closes it. The register is the thing this project does unusually well and
should not be replaced; what it is bad at is being a queue.

The one rule worth writing down now: **an item is closed by a commit that says what closed it**,
never by editing the entry to remove the problem. That is already the practice in the register and
it is the practice worth carrying across.

---

## See also

- [AGENTS.md](../AGENTS.md) §5 — the verification gates, in full, and the lessons behind each
- [eli-application-answers.md](eli-application-answers.md) — `AST02`, `AST04`, `AST15`, `AST19`
- [ci-secrets-and-second-project.md](ci-secrets-and-second-project.md) — why `AST18` is blocked on
  an environment rather than on a decision
