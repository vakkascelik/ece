# CI secrets, and the second Supabase project that should come first

**Owner runbook.** Written 2026-09-04, because four of the six verification gates have never
executed in CI and the reason is two missing repository secrets. This is the whole procedure, in
the order it should be done, with the reason for the order stated first — because doing it in the
obvious order trades one Ministry criterion for another.

---

## Do this first, and here is why

**Right now there is one Supabase project and it is production.** Pointing the CI secrets at it
would make GitHub Actions a third writer against the database holding children's records, on every
push. The three jobs are not equally polite about that:

| Job | What it does to the database |
|---|---|
| `RLS isolation` → `test:rls` | Ends in `ROLLBACK`. Leaves nothing behind |
| `RLS isolation` → `drill:restore` | Creates a shadow schema, compares, drops it. Writes the extract to a temp directory, never the workspace |
| `RLS isolation` → `review:security` | Reads the catalogue only |
| `e2e · accessibility` | **Creates a real tenant and writes real rows** — 124 tests — then drops the tenant on the way out, even on failure |

That last one is the problem. It is safe in the sense that it cleans up; it is not *appropriate*
against production, and `rls_isolation.sql` says so in as many words about itself: *"Worth moving to
a dedicated CI database before this holds real children's records — safe is not the same as
appropriate."*

There is a second reason, and it is the sharper one. **A workflow file is code.** Anybody who can
push a branch can add a step that prints a secret. On a private repository with one collaborator
that is tolerable for the anon key; it is not tolerable for `SUPABASE_SERVICE_ROLE_KEY`, which
**bypasses RLS entirely** and would hand the holder every centre's records at once.

And it closes two assessed criteria rather than one:

- **`AST06`** expects three environments. There is one.
- **`AST09`** expects production data isolated to production. Local development currently runs
  against the production project.

So: **create the second project, point CI at that, and get a green CI plus two criteria in one
move** — instead of a green tick bought by making `AST09` worse.

---

## 1. Create the CI project

Supabase dashboard → **New project**, in the same organisation.

| Field | Value | Why |
|---|---|---|
| Name | `ece-ci` | Distinguishable at a glance in the project switcher, which matters because the next mistake this repo is exposed to is running a migration against the wrong project — it has happened once already, and it failed only by luck |
| Region | Same as production (Sydney) | Not for latency. Same region means the same Postgres version and pooler behaviour, so a CI pass says something about production |
| Database password | Generate a new one, store it in the password manager | Never the production password. If a workflow leaks this one, the blast radius is a throwaway project |

**Free tier is enough.** The suite creates and drops its own tenant; nothing accumulates.

## 2. Apply the schema to it

From this repo, with the new project's connection string in the environment **for one command
only** — not written into `.env.local`, which points at production:

```bash
SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.NEWREF.supabase.co:5432/postgres" \
  npm run migrate
```

Expect `92 applied, 0 pending`. Then confirm the suite passes against it before wiring CI, because
a red first CI run is indistinguishable from a bad secret:

```bash
SUPABASE_DB_URL="postgresql://..." npm run test:rls
SUPABASE_DB_URL="postgresql://..." npm run review:security
```

Expect `741/741` and `16/16`.

> **The suite seeds itself, including `auth.users` — checked, not assumed.** An earlier draft of
> this runbook warned that the fixture users would have to be created first. That is wrong:
> `rls_isolation.sql` inserts its own `auth.users` rows in three places, along with the centres,
> children and memberships it needs, and the whole thing ends in `ROLLBACK`. A freshly migrated
> project is all it wants.
>
> Recorded rather than quietly deleted because the wrong version was plausible and would have sent
> you looking for a missing account instead of at the actual failure.

## 3. Get the four values

All from the **new** project. Dashboard → Settings.

| Secret | Path | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | API → Project URL | Not really secret; it ships in the browser bundle. A repository secret only for convenience |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | API → Project API keys → `anon` `public` | Also public by design. RLS is what protects you, which is why the RLS suite is not optional |
| `SUPABASE_DB_URL` | Database → Connection string → **URI** | **Replace the literal `[YOUR-PASSWORD]` placeholder.** Pasted unedited it fails with an auth error, which reads like a wrong secret rather than an unedited one |
| `SUPABASE_SERVICE_ROLE_KEY` | API → Project API keys → `service_role` | Bypasses RLS. Used by the `e2e` job and nowhere else in `ci.yml` |

**If the direct connection is unreachable from GitHub runners**, use the pooler URI on port `6543`.
`scripts/test-rls.ts` already sets `ssl: { rejectUnauthorized: false }` for it, with a comment
explaining that Supabase terminates TLS at the pooler with a certificate `pg` has no chain for.

## 4. Add them

Repository → Settings → Secrets and variables → Actions → **New repository secret**. Names are
case-sensitive and must match exactly.

Or with the CLI, which prompts on stdin so the value never enters shell history:

```bash
gh secret set NEXT_PUBLIC_SUPABASE_URL      --repo vakkascelik/ece
gh secret set NEXT_PUBLIC_SUPABASE_ANON_KEY --repo vakkascelik/ece
gh secret set SUPABASE_DB_URL               --repo vakkascelik/ece
gh secret set SUPABASE_SERVICE_ROLE_KEY     --repo vakkascelik/ece
```

Do **not** use `--body`: it puts the credential in your history and in the process list. Verify
with `gh secret list --repo vakkascelik/ece`, which shows names and update times and never values.

## 5. What to expect on the first run

Push anything, or re-run the last workflow. Three jobs:

| Job | Expect | If not |
|---|---|---|
| `typecheck · lint · tests · build` | **Pass.** It touches no database and has been green by hand since 2026-09-03 | A real defect; nothing to do with secrets |
| `RLS isolation` | `92 applied / 0 pending`, `741/741`, `6/6`, `16/16` | Check `migrate -- --status` first: a migration file edited after being applied fails here, and it means the schema under test is not the schema in the commit |
| `e2e · accessibility` | `124 passed`, ~9 minutes | It seeds and drops its own tenant, so a failure here leaves nothing behind |

**The two credentialled jobs are serialised** by the only `needs:` in `ci.yml`, and that is
deliberate rather than about build order: `rls_isolation.sql` asserts **absolute** row counts read
as `postgres` across every tenant, so an `e2e` tenant existing concurrently makes it fail for a
reason that is not a defect. Do not parallelise them to save the nine minutes.

**This will be the first CI run in this project's history to pass.** 137 runs, none green — the
earlier failures were a performance budget (fixed) and these credential guards, which fail loudly
rather than skipping so that a green tick cannot mean "nothing was checked".

## 6. Afterwards

- **Point local development at the CI project too**, or at a third one, and take `.env.local` off
  production. That is the rest of `AST09`, and it is a one-line change once the project exists.
- **Rotate the production service-role key** if it has ever been in a shell history, a scratch file
  or a chat. It bypasses RLS; treat any exposure as total.
- **Update [[deployment]]'s CI table**, which currently says these four gates have never executed.
  That sentence becomes false the moment this works, and a wiki that is wrong is worse than none.

---

## What this does not fix

`AST18`/`AST19` ask for strong test suites *and* evidence they run. This gives the evidence. It does
not touch:

- **RS7** — none of its nine counts or six declaration fields exist.
- **The wire format** — no XML anywhere: no library, no serialiser, no validation.
- **Home-based, sessional and kindergarten services** — not modelled; only the all-day ratio tables
  are transcribed.
- **The census code lists** — `0080` ships empty, so six of sixteen fields cannot be filled in by
  anybody until the Ministry publishes them.

See [[unverified-claims]] item 48, which is the measurement rather than the claim.

## See Also

- [[deployment]] — the CI job table, and what each gate covers
- [[tenancy-and-rls]] — why the RLS suite is the one that matters
- [docs/eli-application-answers.md](eli-application-answers.md) — the criteria, question by question
