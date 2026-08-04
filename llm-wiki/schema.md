# Wiki schema

## Purpose

A knowledge base for the **ece** monorepo — a multi-tenant platform for New Zealand early
learning services, with one Next.js web app, one Expo mobile app, a shared query layer and
Postgres RLS as the tenant boundary.

It tracks the decisions behind the schema and the two access boundaries, what was tried
and rejected, and — most importantly for a product that touches regulated childcare — what
this system asserts that nobody has verified.

---

## Page template

```markdown
# Title

One-sentence summary of what this page covers.

## Overview
2–4 paragraphs for somebody who has not seen this repo.

## Key Points
- The most important fact
- The second
- The caveat that gets forgotten

## Details
Sub-sections as needed. Include what was **rejected** and why.

## See Also
- [[related-page]]

*Last updated: YYYY-MM-DD*
```

Two additions to the salix template, both earned by this domain:

- **Rejected alternatives are part of the page**, not a footnote. Most of the expensive
  knowledge in this repo is "we tried the obvious thing and here is how it failed".
- **Any claim about a regulation, a duration or a threshold carries a source inline.** If
  there is no source, the claim does not go on a topic page at all — it goes in
  [[unverified-claims]].

---

## Categories

| Category | Description |
|---|---|
| **Access and isolation** | The two boundaries: centre against centre, and guardianship inside a centre |
| **Domain** | Children, attendance, ratios, compliance — what the product actually does |
| **Offline** | The outbox, idempotency, and merging device state with the server |
| **Conventions** | Migrations, testing, tokens, CI — how work gets done here |
| **Honesty** | What is asserted and unverified. One page, deliberately |

---

## Conventions

- **Filenames** are lowercase-kebab and match the link name used to reference them.
- **Double square brackets** around a page name for wiki-internal links; ordinary markdown
  links for source files and the root `README.md`, so they resolve on GitHub.
- **Dates are absolute** — `2026-08-04`, never "last week". A relative date in a
  persistent document is a bug that gets worse over time.
- **Numbers carry their measurement date.** "119 assertions" is true on a day, not
  forever.
- **`log.md` is append-only.** Correcting an earlier entry means a new entry that says so.

---

## What does not belong here

- Setup instructions and API shapes — those are the root [`README.md`](../README.md) and
  the source, which cannot drift from itself.
- Session narrative — that is [`LOGS.md`](../LOGS.md).
- Anything secret. This is committed and pushed.
- Copies of regulations. Cite them; do not paraphrase them into a page where the
  paraphrase will later be read as the rule.

*Last updated: 2026-08-04*
