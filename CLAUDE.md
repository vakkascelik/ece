# ece — Project Instructions

**Read [AGENTS.md](AGENTS.md) first.** It is the entry point for any agent on this repo and
holds the five rules that bite. The three worth repeating here:

1. **Postgres is the security boundary, not the application.** `packages/api` contains no
   tenant filtering, deliberately. There are two boundaries — centre against centre, and
   guardianship *inside* a centre, because `parent` is a role within the tenant.
2. **A new table needs a policy, a grant, and an assertion in `rls_isolation.sql`** in the same
   commit. RLS is the second check; Postgres tests the table privilege first.
3. **Do not assert what you have not checked.** This is a compliance product for childcare. If
   you cannot source a figure, make the product say so and add it to
   [unverified-claims](llm-wiki/wiki/unverified-claims.md). Never flip a verification flag to
   silence a warning.

A change is done when `typecheck`, `lint`, `test`, `test:rls`, `tokens:check` and `build` all
pass — not when the screen looks right. See [AGENTS.md §5](AGENTS.md).

---

## Karpathy guidelines

All code written in this repository follows these rules (derived from
[Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on common
LLM coding mistakes). They bias toward caution over speed; for trivial tasks, use judgment.

### 1. Think before coding

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### 2. Simplicity first

- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code; no unrequested configurability.
- If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical changes

- Touch only what you must; match existing style.
- Don't refactor things that aren't broken; mention unrelated dead code, don't delete it.
- Remove only the orphans your change created.

### 4. No duplication

- Search for an existing helper before writing one. This repo already has date, ratio, expiry
  and roll-merge helpers in `@ece/core`.
- One source of truth. Design tokens are generated from `packages/core/src/tokens.ts`; two
  hand-maintained copies had already silently diverged before that check existed.

### 5. Verify, don't assume

- Read the file before editing it. Read the migration before writing the next one.
- Run the checks. "It typechecks" is not "it works" — three real bugs in this repo were
  invisible to `typecheck` and to `next build` and were caught only by the RLS suite.
- **Test against the real database.** Every phase here has turned up at least one defect that
  only appeared against live Postgres and real JWTs.
- If a test passes first try on something subtle, be suspicious. Mutation-test it.

### 6. Say what you did and did not do

- Report failures with the actual output. If a step was skipped, say so.
- Do not describe work as verified when it was inferred.
- Corrections go in plainly and once. Two claims in this repo were wrong and are now recorded as
  corrections rather than quietly edited: the Privacy Act does not give a right to erasure, and
  the state-chip borders do not meet WCAG 1.4.11 (they do not need to — the text inside carries
  the meaning).

### 7. Comments explain why, not what

- The code says what it does. A comment earns its place by recording the alternative that was
  rejected, the bug that motivated the shape, or the constraint that is not visible locally.
- This codebase is commented heavily *on purpose*, because the expensive knowledge is why the
  obvious approach was not taken.

---

## Repo-specific notes for Claude Code

- **Windows.** Paths are `C:\dev\ece`. Both Bash (Git Bash) and PowerShell are available; heredocs
  with apostrophes in the content have broken twice — prefer the Write/Edit tools over
  `cat <<'EOF'` for anything long.
- **Migrations** go through `npm run migrate`, which uses `SUPABASE_DB_URL` or, failing that, a
  PAT plus project ref. A PAT is account-wide: one was once handed over pointing at the wrong
  project entirely, and the migration failed only by luck. Inventory before anything destructive.
- **The RLS suite is runnable from here** and is the fastest way to check a policy change.
- **Do not use the Agent tool** unless asked.

*Last updated: 2026-08-04*
