# Claude API in this product — a plan

## Context

The ask is to use a Claude API key in the system — alerts, generated reports, and whatever else
makes sense. This document is the plan, and it opens with the two things that decide its shape,
because both are already settled in this repo and neither is negotiable on my say-so.

**1. This repo has already refused the obvious version of this feature.**
[roadmap-phases-8-13.md §442](roadmap-phases-8-13.md) rejects auto-translating pānui, in terms that
apply to every idea below:

> *sending a post about a named child to an overseas translation API is a **cross-border disclosure
> of personal information** (IPP 12), made by default, on behalf of a family that consented to a
> learning journal and not to that.*

Anthropic's API is an overseas processor. Nothing here gets to pretend otherwise.

**2. Most "AI alerts" in this product would be a downgrade.** See §2 — this is the section I would
most like read before any of the build sections.

The plan is therefore tiered by **what data crosses the boundary**, not by what is easiest to build.

---

## 1. What to build

### Tier A — no personal information leaves. Build this first.

The product already computes exact figures it cannot explain in prose. That gap is real, and it is
fillable with aggregates alone.

| Feature | What is sent | Value |
|---|---|---|
| **Monthly compliance narrative** | Counts and dates from `replayDay` / the binder: breach minutes, drill dates, check intervals. No names. | A board or licensing report a manager currently writes by hand from the binder |
| **Accounts narrative** | The `summariseArrears` totals — bucket sums, counts, no family names | *"$2,455 is over 90 days, concentrated in three families"* as a sentence for a committee paper |
| **Funding variance explanation** | `summariseVariance` rows — period labels and cents | Why a claim and a receipt differ, phrased for somebody who did not key it in |
| **Roster forecast narrative** | `forecastDay` segments — counts and times, no staff names | *"Tuesday afternoon is the week's exposure"* |

Every one of these takes numbers the product already computed and returns prose. **The model never
sees a child, a family, or a staff member.** No new consent is required, because no personal
information is disclosed — the privacy statement gains a processor, not a new category of sharing.

### Tier B — staff-authored text, human-reviewed. Only after Tier A ships and the consent surface exists.

| Feature | What is sent | Guard |
|---|---|---|
| **Pānui drafting** | Bullet points a staff member typed | Draft only; a human edits and presses publish. Never auto-publishes |
| **Incident narrative tidying** | A draft incident report an educator wrote | Draft-stage only, never a finalised report. 0030 already freezes finals |
| **Policy Q&A** | The centre's own policy documents | No child data; the centre uploads what it chooses |

These send text a person typed, which can contain anything — including a child's name. That makes
them a genuine IPP 12 disclosure and they need the full consent surface in §3.

### Tier C — refuse for now

Anything that sends a child's record, health information, custody arrangement, or attendance
history. The value is not close to the cost, and `custody_arrangements` alone is enough to rule it
out: prose written for a person to read, about a family in conflict.

---

## 2. What NOT to build, and why it matters most

**Do not put an LLM behind alerts.** The obvious pitch — *"Claude watches the data and warns you"* —
is the worst idea in this document, for four reasons this repo has already paid for:

1. **The product already computes these exactly.** `assessRatio` warns *before* a breach.
   `overdueChecks` names the cot. `summariseArrears` ages every invoice. `forecastDay` finds next
   Tuesday's gap. Each is a pure function with mutation-tested assertions.
2. **An LLM would make them less reliable, not more.** These are arithmetic with a right answer. A
   model that gets it right 99% of the time is a regression from code that gets it right always, and
   the 1% lands on a ratio breach or a sleeping child.
3. **It breaks the rule the whole product is built on.** *"Do not assert what you have not checked."*
   A generated compliance alert is an assertion nobody checked, wearing the interface of one that
   was.
4. **The bands are still unverified.** `RATIO_TABLES_VERIFIED` is `false`. Putting a confident
   sentence over an unverified number is exactly what [unverified-claims](../llm-wiki/wiki/unverified-claims.md)
   exists to prevent.

**The honest version:** arithmetic decides *whether* to alert; Claude may phrase the *explanation*
once the arithmetic has already decided. The trigger is never the model's.

Also not building: **retrieval/RAG over children's records** (Tier C by another name), and **an
agentic loop with database tools** — an agent with a Supabase connection is a second write path
around RLS, and RLS is the security boundary.

---

## 3. Architecture

### 3.1 Where the code lives — a new `packages/ai`

Neither existing package can hold it:

- `packages/core` is pure and **bundled into the mobile app** — nothing there may import a Node
  built-in, and an API key must never be reachable from a client bundle.
- `packages/api` is the only place that talks to Supabase, deliberately.

So: `packages/ai`, server-only, importing `@anthropic-ai/sdk`. It takes already-redacted input and
returns text. It never reads the database — callers pass it data.

### 3.2 The redaction boundary, modelled on the Sentry scrubber

The precedent already exists and [privacy-statement.md:139](privacy-statement.md) states the reason
better than I would:

> *That scrubbing has its own tests, because a bug in it does not produce a wrong screen — it sends a
> child's medical information to a third party.*

Same shape, same rule. A pure function in `@ece/core` — `redactForModel()` — strips names, NSNs,
dates of birth, emails, phone numbers and addresses, with its own tests and its own mutation tests.
Tier A payloads are **built from aggregates and asserted to contain no free text at all**, which is
stronger than scrubbing: there is nothing to scrub.

Plus a **source-scanning guard test**, the third of its kind here after `localDates.test.ts` and
`bounded-queries.test.ts`: every call site in `packages/ai` must receive a payload that passed
through the redactor, or the build fails. Exemptions are named entries with the argument written
out, never a pattern in an ignore list.

### 3.3 Consent and the kill switch

- `centres.ai_features boolean not null default false` — the 0040 `ratio_source` precedent. **Every
  existing centre is unchanged on deploy.** A feature that turns itself on for a childcare centre is
  a feature that gets discovered by a parent.
- Tier B additionally needs a `consent_kind` and the trigger-enforced pattern from
  [consent-gated-media](../llm-wiki/wiki/consent-gated-media.md) — a UI check is not a boundary.
- `docs/privacy-statement.md` names Anthropic as a processor, with the region, **before** the first
  call is made in production. That document currently names three processors and is accurate; it
  must not become inaccurate in the same commit that adds a fourth.

### 3.4 Audit

`ai_requests`: `(centre_id, feature, requested_by, model, input_tokens, output_tokens, cents_estimate, outcome, created_at)`.
Policy, grant, and an assertion in `rls_isolation.sql` in the same commit — the standing rule for a
new table. It records **what was asked and what it cost, not the content**: storing the prompt would
re-create the disclosure inside our own database.

This is also the cost control. A per-centre monthly token budget, checked before the call, refusing
with a plain sentence rather than a surprise invoice.

### 3.5 Output is always a draft

Nothing generated is ever presented as a compliance fact. Every surface labels it, the binder never
includes generated prose without a human having accepted it, and — per the standing rule — an entry
goes in `unverified-claims` saying plainly that generated narrative is not a checked figure.

---

## 4. API specifics

Verified against the bundled Claude API reference rather than recalled:

| Decision | Value | Why |
|---|---|---|
| Model | `claude-opus-5` | Current default. Not downgraded for cost — that is the owner's call, and these are short calls |
| SDK | `@anthropic-ai/sdk` | Official TypeScript SDK; the repo is TypeScript throughout |
| Thinking | `{type: "adaptive"}` | On by default on Opus 5. **`max_tokens` caps thinking + text together** — size it accordingly |
| Effort | `output_config: {effort: "medium"}` to start | Narrative summarisation is not intelligence-sensitive; sweep it |
| `max_tokens` | ≥ 16000 non-streaming | Lowballing truncates mid-sentence |
| Structured output | `zodOutputFormat` via `messages.parse()` | Anything parsed. **Never** assistant prefill — it 400s on Opus 5 |
| Sampling | none | `temperature` / `top_p` / `top_k` are **removed** on Opus 5 and return 400 |
| Refusals | check `stop_reason === "refusal"` **before** reading `content` | A refusal is HTTP 200 with empty content. An incident narrative is exactly the kind of text that could trip a classifier |
| Fallback | `fallbacks: "default"`, beta `server-side-fallback-2026-07-01` | Recovers a refusal server-side rather than failing the screen |
| Caching | stable system prompt first, volatile figures last | Opus 5's minimum is 512 tokens. Verify with `usage.cache_read_input_tokens` |

Rough cost: a narrative report is ~2k in / ~1k out ≈ **$0.035**. The budget exists to catch a loop,
not to ration ordinary use.

---

## 5. Sequence

1. **Privacy statement and `ai_features` flag** — the paperwork and the switch, before any call.
2. **`redactForModel()` + guard test** — the boundary before the thing that needs it.
3. **`packages/ai` + `ai_requests`** — one function, audited, budgeted.
4. **Tier A: the compliance narrative** — one screen, one button, aggregates only.
5. **Measure.** Cost, refusal rate, and whether a manager actually uses it.
6. **Tier B only if step 5 says yes**, and only with the consent surface built first.

---

## Verification

Every commit, per [AGENTS.md §5](../AGENTS.md): `typecheck`, `lint`, `test`, `test:rls`,
`tokens:check`, `check:docs`, `check:bundle`, `review:security`, `build`.

Specific to this work:

- **`check:bundle` is load-bearing.** `@anthropic-ai/sdk` must never reach a client bundle. If
  `first-load-js` moves, the import crossed a boundary it should not have.
- **`redactForModel()` is mutation-tested** — weaken each rule, confirm the named assertion fails.
  A redactor that silently stops redacting is the failure mode that matters.
- **A drill, not just a unit test.** `drill:redaction`: build a payload from a real seeded centre,
  assert the outgoing body contains no child name, NSN, DOB, email or phone. The unit tests prove
  the function; the drill proves the wiring.
- **`review:security` must be re-read, not just re-run** when the API key is introduced — a new
  outbound secret is exactly what its checks are for.
- **Wiki before the commit**: a new page for the boundary and the tiering, `privacy-and-retention`
  corrected, an `unverified-claims` entry for generated prose, `log.md`, `check:docs`.

## What this plan does not do

- Send any child's record, health information, or custody arrangement to an API.
- Put a model in the path of any alert, ratio, or compliance decision.
- Give a model database access or an agentic loop with tools.
- Enable anything for an existing centre without somebody turning it on.
