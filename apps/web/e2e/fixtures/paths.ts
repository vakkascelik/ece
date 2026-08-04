import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Where the audit's working files live — as absolute paths, deliberately.
 *
 * FOUND BY `git status`, ONE COMMAND BEFORE IT WOULD HAVE BEEN COMMITTED
 *
 * These paths used to be the relative strings `'e2e/.artifacts/owner.json'`. Playwright
 * resolves `storageState` against the **process working directory**, not against the
 * directory the config file sits in — so running the CLI from the repo root wrote them
 * to `<repo>/e2e/.artifacts/`, while `.gitignore` was watching
 * `apps/web/e2e/.artifacts/`. The files landed in a directory nothing ignored.
 *
 * What was in them: `sb-<project>-auth-token`, which is a Supabase session cookie —
 * an access token and a **refresh token** for a live account. A refresh token is worse
 * than a password in one specific way: it keeps working after a password change.
 *
 * The accounts in question are created and deleted inside a single run, so the tokens
 * were dead within two minutes. That is luck about timing, not a design that prevented
 * anything, and the same slip in a fixture that reused a durable account would have put
 * a working credential in the history permanently — where removing it means rewriting
 * every commit after it.
 *
 * Hence absolute paths derived from this file's own location: the artefacts land in one
 * place no matter where the command was typed. `.gitignore` now also matches the
 * artefact directory at any depth (a leading double-star), because two independent
 * guards is the right number for something whose failure mode is a credential in a
 * public repository.
 *
 * (The glob is described rather than written out, because the star-slash inside it
 * closes this comment. Which is its own small lesson about escaping.)
 */
/**
 * `__dirname` and not `import.meta.dirname`.
 *
 * Playwright transpiles TypeScript to CommonJS before running it, so `import.meta` is a
 * syntax error inside the test runner even though the rest of this repo is ESM. The
 * failure is loud and immediate — the config will not load at all — which is the good
 * kind, but the reason is worth writing down because `import.meta.dirname` is the
 * obvious thing to reach for and it will be reached for again.
 */
const HERE = __dirname;

/** `apps/web/e2e/.artifacts` — absolute. */
export const ARTIFACTS = join(dirname(HERE), '.artifacts');

/** What the tenant looks like, written by setup and read by every spec. */
export const TENANT_FILE = join(ARTIFACTS, 'tenant.json');

/** Session state per role. Holds live auth cookies; never committed. */
export const OWNER_STATE = join(ARTIFACTS, 'owner.json');
export const PARENT_STATE = join(ARTIFACTS, 'parent.json');

/** Measurements from the journey spec. */
export const TIMINGS_FILE = join(ARTIFACTS, 'timings.txt');

export function ensureArtifacts(): string {
  mkdirSync(ARTIFACTS, { recursive: true });
  return ARTIFACTS;
}
