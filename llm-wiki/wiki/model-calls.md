# Model calls

*What this product sends to an external model, what it refuses to send, what it refuses to let a
model decide, and what the whole thing costs.*

Migrations `0047`–`0049`. Code: `packages/core/src/redaction.ts`, `packages/core/src/modelSpend.ts`,
`packages/ai/`, `packages/api/src/ai.ts`. The plan this was built from is `docs/claude-api-plan.md`.

> **Read [[unverified-claims]] §27 first.** There is no `ANTHROPIC_API_KEY` in this repo's
> environment. Nothing below has ever run against the real API. Every path is exercised against an
> injected fake, and the live one is untested *by construction* — not by oversight.

---

## The one-sentence version

A model is allowed to **phrase figures this product already calculated**. It is not allowed to
calculate them, decide anything, read the database, or see a name.

---

## What is not built, and why that is the important half

`docs/claude-api-plan.md` §2 is a list of things deliberately refused. The one worth repeating:

**No LLM behind an alert.** The ratio check, the expiry check and the arrears ageing are
arithmetic — `assessRatio`, `overdueChecks`, `summariseArrears` — and they are arithmetic because a
centre acts on them. A ratio alert that is right 97% of the time is worse than no alert: it trains
a manager to dismiss it, and the 3% is a regulated breach. A model that "notices something looks
off" is a product feature in a market where the buyer is legally accountable for the noticing.

So the direction is fixed and one-way: **deterministic code decides, the model writes it up.**
Never the reverse. Anything proposing the reverse is a change to this page first.

**No translation of posts.** Auto-translating a journal entry about a named child through an
overseas API is a cross-border disclosure under IPP 12, made by default, on behalf of a family who
consented to a learning journal and nothing else. The consent surface costs more than the feature
returns until a centre asks for it. See [[privacy-and-retention]].

---

## The boundary: `redactForModel`

`packages/core/src/redaction.ts`. Everything crossing the border goes through it, and it is built
to be **incapable of expressing** the thing it is preventing rather than to strip it.

```ts
type Scalar = number | boolean | null;
interface ModelPayload {
  figures: Record<string, Scalar>;   // numbers only — the type has no string branch
  labels?: string[];                 // and every one must be in the caller's declared vocabulary
}
```

Three properties, in order of how much they matter:

1. **`figures` cannot hold a string.** Not "strings are stripped" — the type has no string case, so
   a name cannot be put there by a caller who was not thinking about it. A sanitiser you can forget
   to call is a sanitiser that gets forgotten.
2. **`labels` is checked against an allowlist the caller declares at the call site.** Not scanned
   for PII — *matched against a fixed vocabulary*. `'first aid'` passes because the caller named it;
   `'Beau Ngata'` does not, because nobody did.
3. **It throws.** It does not sanitise and continue. A caller that assembled an unsafe payload has a
   bug, and a bug that returns a tidy `blocked` status gets shipped. `summariseFigures` deliberately
   does **not** catch this — the refusal has to be loud enough to fail a test suite.

The `FORBIDDEN` regexes (email, DOB, NSN, UUID, phone) are the **second** check, not the first. They
exist to catch a shape that slipped into a label, not to be the boundary. One of them was wrong on
the day it was written: the phone pattern matched separators positionally, so `021 555 1234` passed
while `0215551234` did not. Fixed by stripping separators before matching — recorded here because
the lesson is that a regex is a poor boundary and a type is a good one.

---

## `packages/ai` — the only place a key is read

Server-only, and it must never be imported from `packages/core` (which the mobile app bundles) or
from a client component. `check:bundle` is the tripwire.

It is **two calls wide** on purpose. `ModelClient` is a hand-written structural interface rather
than the SDK's own type, so what this product depends on is visible in one place — and so every
test can supply a fake. If that interface grows, the growth is the thing to look at.

It has **no tools**. An agent with a Supabase connection would be a second write path around RLS,
and [[tenancy-and-rls]] is the entire security model. It also does not read the database, so it
cannot widen what gets sent by fetching one more field.

### The branch that exists because of how it fails

```ts
if (response.stop_reason === 'refusal') { … }   // BEFORE reading content
```

A refusal is an **HTTP 200 with an empty `content` array**. Code that reads `content[0].text`
optimistically does not throw — it renders `undefined` into the page. The failure would arrive as a
blank panel with no error anywhere, on a compliance screen, and nobody would be able to explain it.
Plausible here rather than theoretical: a childcare product's figures sit next to incidents and
injuries. Mutation-tested — deleting the guard fails the assertion by name.

### The provider's error message is dropped, not passed through

An API error quotes the offending request back, and the request contains the centre's figures. Same
reasoning as `actionError.ts`, which exists because Postgres does the identical thing with the value
that violated a constraint. A failed call also records **zero tokens**, because none were billed — a
failure that recorded an estimate would make the cap refuse calls for spend that never happened.

### Request shape, and the two settings that are not style questions

| Setting | Value | Why |
|---|---|---|
| `thinking` | `{type: 'adaptive'}` | `budget_tokens` is **rejected with a 400** on Opus 5, not ignored. A stale prior here is a runtime failure. Asserted in the test. |
| `system` | one block with `cache_control` | The instruction is identical on every call, so it is the cacheable prefix; the figures vary and come after. Wrong order caches nothing. |
| `output_config.effort` | `medium` | Summarising figures is not intelligence-sensitive. Swept down deliberately. |
| `max_tokens` | 16 000 | Caps thinking *and* text together on Opus 5, hence the headroom. |

---

## The one screen — `/compliance`

Tier A of the plan: aggregates only, no personal information, so no new consent is required.

**Eight integers and five words.** The payload is `staff_records_total`, `_expired`, `_due_soon`,
`_original_not_sighted`, `days_replayed`, `days_with_a_recorded_breach`, `total_minutes_in_breach`,
`days_where_breach_length_is_unknown`, `attendance_events_in_period`, and a fixed label vocabulary of
`['staff records', 'ratio history', 'seven days', 'certificates', 'sign-in events']`.

Two decisions inside that are easy to miss:

- **The centre's name is deliberately not sent**, though it would improve the prose. A centre name
  plus a breach count is small, but it is a disclosure about an identifiable organisation, and the
  screen can put the name back locally for free.
- **`days_where_breach_length_is_unknown` is sent separately** because `minutesInBreach` is `null`,
  not zero, when a breach was still open at the last recorded event of a day. Summing null as zero
  would understate the total. The instruction tells the model to say the figure is a floor rather
  than a total when that count is above zero — which is the same rule the rest of the product
  follows: [[reading-every-row]] exists because a silent understatement is the worst failure
  available to a compliance figure.

The figures are computed by the page and **passed into** the action, not re-read inside it. The
prose has to describe the same numbers as the table above it, and the only way to guarantee that is
one set of variables. It also means the action cannot reach the database for figures — the property
that stops it quietly widening later.

### It is a button, and the button is below the computed answer

Three reasons, weightiest first. A generated sentence sitting on the dashboard by default becomes
part of how the screen reads, and within a fortnight somebody is skimming the prose instead of the
table — the table is the product. It costs money per render, on the page a manager leaves open. And
a cross-border disclosure that happens because somebody pressed a button is a different thing from
one that happens because they opened a page.

The output is labelled **before** the prose, not after. A caveat underneath is read second, if at
all, and by then the sentences have been taken as a finding. [[unverified-claims]] §28.

The panel is absent entirely unless `ai_features` is on — a button whose only function is to say
"this is switched off" is worse than no button. That is a layout decision; the control is the flag
check inside the action, and behind that, Postgres.

## Cost, and the cap

`packages/core/src/modelSpend.ts`, pure, so the cap is testable without a key.

`estimateCents` rounds **up**, and the direction is the point: the figure only ever decides whether
to *refuse* the next call, so rounding down lets a centre drift past its cap a hundredth of a cent
at a time, invisibly, until the bill arrives. (`toHours` floors for the mirror-image reason —
under-claiming the Crown is conservative. The shared rule is that an estimate errs against the party
doing the estimating.)

`checkSpend` refuses in two ways, and the order matters: **the switch is checked before the cap.** A
centre that never enabled this must not be told it has exhausted an allowance it never asked for.
Both mutation-tested; so is `>=` versus `>` at the cap boundary.

`MONTHLY_CAP_CENTS` is NZ$20 and is a **constant, not a column**. A column needs a migration, a
grant, a form field and a support conversation, and nobody has asked for a different number. It
exists to catch a runaway loop, not to ration ordinary use — a narrative is a few cents, so this is
hundreds of them. When a centre asks for a different figure, that is the moment it becomes a column.

The cap is checked against spend *so far*, not spend plus a guess at this call. Response size is not
knowable in advance and a cap that guessed would refuse calls that would have fitted. The
consequence, stated rather than hidden: the last call of a month may cross the line by its own cost.
A few cents, and the right trade.

**The price list in `OPUS_5_PRICING` is a figure nobody here has re-checked against an invoice.**
It will be wrong the day Anthropic changes it. That is why everything derived from it is named an
*estimate* — in the column, in the type, and on screen. [[unverified-claims]] §28.

---

## `ai_requests` (0049)

One row per call: which centre, which feature, which model, who asked, tokens, estimated cents,
outcome. Owner and manager can read it; an educator has no reason to and a parent's answer to "what
do you send" is the privacy statement, not a usage log.

**It records the shape of the call, never its content.** No prompt, no response, no figures. Storing
what was sent would re-create the disclosure inside our own database and give it a second lifetime
under a different retention rule. The consequence is stated rather than hidden: *this table cannot
answer "what did we send".* The answer to that is structural instead — `redactForModel` cannot
express a name. An audit log of payloads would be a weaker guarantee wearing a stronger one's
clothes.

**Every outcome is recorded, including the ones where nothing left the building.** A `blocked` row —
switch off, cap reached, or payload refused — is how a centre finds out the feature has been
refusing all week. A table holding only successes could not answer that.

### Append-only, and the assertion that proves it

UPDATE and DELETE are revoked from every role **including `service_role`**, which is the branch that
matters: the web app's server actions hold that key. Same treatment as `payments` and
`attendance_events`.

The suite asserts on **SQLSTATE 42501**, not on "the update changed nothing", and the distinction is
the design. A withheld GRANT *raises*; a missing policy silently *filters*. Both look like a refusal
from the client, but only one of them cannot be undone by a later migration without `review:security`
noticing. The mutation confirmed it: granting UPDATE back made the statement succeed with no
exception, and the named assertion failed with `got none (the update SUCCEEDED)`.

### A correction: the default-off assertion was a census

The suite's `ai_features` assertion originally read *"nought centres across the whole table have
this on"*. That is a different claim from the label above it, and it is **false in normal
operation** — the first customer to legitimately enable the feature turns `test:rls` red on every
run.

It was caught by an e2e run that switched the flag on and had not yet put it back, which is the
benign version. The malignant version is a real centre enabling it, the suite failing for a reason
that is not a defect, and the pressure at that moment being to delete a security assertion so a
suite goes green. A check whose normal state is failing is a check that gets removed.

It now asserts the property the label always meant: a centre inserted without mentioning the column
comes out false, and the catalogue default is `false`. Both survive a customer using the feature,
and both still fail if a migration adds `default true` or backfills the column — which is the
failure it exists to catch.

### Two exemption lists, and a warning

`ai_requests` carries **no audit trigger** — the row is its own record, the reasoning 0021 records
for every append-only table. That exemption has to be declared in **two** places:

- `supabase/tests/rls_isolation.sql`, in the audit-trigger class assertion
- `scripts/security-review.ts`, in the `auditGaps` query

They are two hand-maintained copies of the same list in two languages, and this repo already has a
precedent for what happens to those: the design tokens diverged silently before `tokens:check`
existed. Adding the table to the SQL list and not the TypeScript one produced a clean RLS run and a
`HIGH` from `review:security` — which is the good failure. **Nothing guarantees they stay in step.**
Noted rather than fixed: unifying them crosses a language boundary and is a bigger change than this
one earned. If a third list appears, unify all three.

---

## What is honestly not proven

- **The live API call.** No key, no `ant` CLI. Six tests drive an injected fake, which covers the
  refusal branch, the empty-content branch, the error branch and the request body. Whether the API
  *accepts* that body is untested and cannot be tested from here. [[unverified-claims]] §27.

  What `narrative.spec.ts` *does* cover is everything on this side of the call, and that is the
  half with a database in it: the capability check, the flag, the month boundary in the centre's
  timezone, the spend read, `checkSpend`, and the insert into `ai_requests` — all against live
  Postgres under a real JWT with RLS in front. It also proves the panel is **absent** until a
  centre turns the feature on, which no unit test can. The model call is the one step that is
  purely network, and it is the one step not covered.
- **The price list.** §28.
- **Whether the output is any good.** Nobody has read a generated narrative, because none has been
  generated. The instruction forbids claiming compliance or breach; that it obeys is unverified.

---

## Related

[[unverified-claims]] · [[privacy-and-retention]] · [[tenancy-and-rls]] · [[security-review]] ·
[[reading-every-row]] · [[conventions]]

*Last updated: 2026-08-09*
