# llm-wiki

A persistent, compounding knowledge base maintained by an LLM — an implementation of
[Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f),
matching the one in the `salix` repo.

---

## The idea

Traditional RAG re-reads raw documents every time you ask a question. The LLM Wiki
inverts that: a source is read **once**, integrated into a structured set of markdown
pages, and from then on the work happens against the organised wiki rather than the raw
pile.

```
Sessions ──► LLM ──► Wiki (markdown) ──► LLM ──► Answers
    ↑                     │
 new work                 └─ grows, cross-links, stays coherent
```

| Property | What it means here |
|---|---|
| **Persistent** | Lives in git, survives between sessions and between agents |
| **Compounding** | Each session enriches existing pages instead of starting over |
| **Cross-linked** | `[[WikiLinks]]` between pages |
| **Auditable** | [`wiki/log.md`](wiki/log.md) records every change, dated and append-only |
| **Cheap to query** | An agent reads a page, not 20,000 lines of source |

## What this wiki is *for*, in this repo

The [`README.md`](../README.md) at the repo root is already long and explains the
architecture. This wiki is not a second copy of it. The division:

| Where | What belongs there |
|---|---|
| `README.md` | How to run it, and the design decisions a contributor needs before touching code |
| `llm-wiki/wiki/` | **Why** decisions were made, what was tried and rejected, and what is asserted but unverified |
| [`../LOGS.md`](../LOGS.md) | Session-by-session narrative: what happened, what broke, what was found |
| [`../AGENTS.md`](../AGENTS.md) | The entry point an agent reads first |

The single most useful page is [`wiki/unverified-claims.md`](wiki/unverified-claims.md) —
a register of everything this product asserts that nobody has checked. In a compliance
product that page is worth more than any of the others.

## There is no `wiki.py` here, deliberately

The `salix` repo ships a `wiki.py` CLI with `init` / `ingest` / `query` / `lint`
subcommands. This repo does not, for two reasons:

1. **The pages there are edited by hand**, not produced by `ingest`. The script is
   effectively vestigial, and copying a tool nobody runs would be worse than not having
   it — it would imply the pages are generated and can be regenerated.
2. It needs `pip`, a `requirements.txt` and an `ANTHROPIC_API_KEY` to do a job an agent
   with file access already does directly.

If a scripted ingest is wanted later, copy it from `salix/llm-wiki/wiki.py`. Note its
glob is `wiki/*.md`, non-recursive, so it cannot see subfolders.

## Rules for maintaining it

- **Append to [`wiki/log.md`](wiki/log.md) in the same commit** as any page change. A
  wiki with no change history is a set of assertions with no provenance.
- **Update [`wiki/index.md`](wiki/index.md)** when a page is added.
- **Date every page** at the bottom. A page with no date cannot be distrusted, which is
  worse than one that can.
- **Record what was rejected**, not only what was chosen. The alternatives that were
  considered and dropped are the expensive part of the knowledge.
- **Never write a claim about the law, a regulation or a figure without a source.** If
  there is no source, it goes in
  [`wiki/unverified-claims.md`](wiki/unverified-claims.md) instead.
- **Commit and push `wiki/`.** It is not generated output; it is the knowledge.

*Last updated: 2026-08-04*
