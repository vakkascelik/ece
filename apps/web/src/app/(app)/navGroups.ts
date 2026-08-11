/**
 * Which nav groups a person has collapsed — the pure half.
 *
 * No `next/headers` in this file, deliberately. `NavGroupMemory` is a Client Component and
 * needs the cookie's name; importing it from a module that reads `cookies()` pulls a
 * server-only API into the client bundle and the build refuses, which is exactly what
 * happened the first time this was written. `locale.ts` / `locale.server.ts` had already
 * split for the same reason and its header says so — a second occurrence is worth a second
 * note rather than a shrug.
 *
 * WHY THE COOKIE STORES WHAT IS CLOSED, NOT WHAT IS OPEN
 *
 * So the default with no cookie — a new person, a cleared browser, a shared tablet — is every
 * group open. A stored list of *open* groups would default to a rail with nothing in it, and
 * the failure mode of a preference feature must never be "the navigation disappeared". A group
 * added later is open until somebody closes it, by the same argument.
 *
 * IT IS A PREFERENCE, NOT A PERMISSION
 *
 * The cookie is client-controlled and anybody can set it to anything. All it decides is
 * whether a `<details>` renders open. What each group *contains* is decided by the `can()`
 * calls in `layout.tsx`, and what those links reach is decided in Postgres — a forged value
 * here collapses a group or expands one, and that is the whole blast radius.
 */
export const NAV_CLOSED_COOKIE = 'ece_nav_closed';

/** Group labels are ASCII and stable, so the label doubles as its own key. */
export function groupKey(label: string): string {
  return label.toLowerCase();
}

/** Shared by the reader and the writer, so the two cannot disagree about the format. */
export function parseClosed(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
