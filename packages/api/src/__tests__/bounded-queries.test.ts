import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every read in this package must be bounded, and the ones that are not must say why.
 *
 * WHY A TEST THAT READS SOURCE CODE
 *
 * Because the bug it guards against is invisible at runtime. PostgREST is configured with
 * `max_rows: 1000` and returns a truncated result **with `error` set to null** — so no
 * assertion about behaviour catches it unless the test happens to have more than a thousand
 * rows to hand. Measured, not theorised: 1,200 attendance events produced a funding export
 * that reported 72 hours instead of 100 and invented two unresolved days.
 *
 * There is no type, no lint rule and no runtime check that distinguishes "this query returns
 * everything" from "this query returns the first thousand of an unknown number". The only
 * place the distinction exists is the source. So the source is what gets checked.
 *
 * HOW A QUERY SATISFIES THIS
 *
 * By paging with `fetchAll`, or by being provably small — `.single()`, `.maybeSingle()`, an
 * explicit `.limit()` — or by appearing in `BOUNDED_BY_REASON` below with the reason written
 * out. A new list query that does none of those fails this test, which is the point: the
 * decision has to be made once, deliberately, by whoever adds it.
 */

const SRC = join(import.meta.dirname, '..');

/**
 * Reads left unpaged on purpose, each with the ceiling that makes it safe.
 *
 * A count here is not a guess at a comfortable number — it is an argument that the row count
 * is structurally bounded. "A centre is licensed for 65 children" is such an argument. "It
 * probably will not get that big" is not, and anything resting on that got paged instead.
 */
const BOUNDED_BY_REASON: Record<string, string> = {
  // One row per child, by construction — `attendance_today` is `distinct on (child_id)`.
  // A licence caps a centre at a few dozen children, and the largest ECE service in the
  // country is nowhere near a thousand.
  'attendance.ts:attendance_today': 'one row per child; a licence caps the roll',

  // Per child. A child has a handful of guardians, a few conditions, one live enrolment and
  // a fixed number of consent kinds. Nothing here scales with time except consent history,
  // which gains a row only when a decision changes.
  'children.ts:child_guardians': 'per child; a handful of guardians',
  'children.ts:enrolments': 'per child; enrolments do not overlap, so one per period of attendance',
  'children.ts:health_conditions': 'per child; a handful of conditions',
  'children.ts:medication_authorities': 'per child; a handful of authorities',
  'children.ts:current_consents': 'per child; one row per consent kind, and there are seven',
  'children.ts:consent_events': 'per child; a row only when a decision changes',
  'children.ts:custody_arrangements': 'per child; rare, and superseded rather than multiplied',
  'children.ts:guardians': 'per centre, two per child against a licensed roll of dozens',

  // Day-scoped. 65 children signing in and out is 130 events; the ratio replay reads one day
  // at a time, and the binder reads seven days as seven separate queries.
  'compliance.ts:attendance_events': 'one day at a time; ~2 events per child per day',
  'compliance.ts:staff_count_events': 'one day at a time; a handful of adult counts',
  'compliance.ts:children': 'per centre; a licence caps the roll',

  // A published licensing criteria set is a few hundred rows at most, and it is reference
  // data that changes when the Ministry republishes it rather than as a centre operates.
  'compliance.ts:criteria': 'a published criteria set is a few hundred rows',

  // Post-scoped, and a post is about a handful of children.
  'engagement.ts:post_children': 'per post; a post names a few children',

  // Membership-scoped. A person belongs to one or two centres; a centre has tens of staff.
  'index.ts:centres': "the caller's own memberships; one or two",
  'index.ts:memberships': "the caller's own memberships; one or two",
  'members.ts:centre_members': 'per centre; tens of staff',
  'members.ts:memberships': 'per centre; tens of staff',

  // One live invitation per mailbox is enforced by a partial unique index, and accepted ones
  // are not listed.
  'invitations.ts:invitations': 'live invitations only, one per mailbox by unique index',
};

interface Query {
  file: string;
  line: number;
  table: string;
  bounded: boolean;
  key: string;
}

function queries(): Query[] {
  const out: Query[] = [];
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
    const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = /\.from\('([a-z_]+)'\)/.exec(line);
      if (!m) return;

      /*
       * The window is the ENCLOSING FUNCTION. Three narrower definitions were tried and each
       * of them lied:
       *
       *  1. "Any chain containing `.select(`" counted `insert(…).select()` — the idiom for
       *     returning an inserted row — as an unbounded read. Three false positives. A guard
       *     that reports things which are not true earns an allowlist entry, then gets
       *     ignored, then gets deleted.
       *
       *  2. A fixed eighteen-line lookahead bled into the NEXT function. `listChildren` is
       *     followed by `getChild`, which ends in `.single()`, so the scanner declared the
       *     unbounded query bounded and the suite passed while the bug it exists to catch was
       *     still present. Worse than a false positive, because it is silent — and it is the
       *     exact shape of the bug being guarded against, in the guard.
       *
       *  3. "To the end of the statement" broke on the builder pattern this file uses in
       *     several places: `let q = db.from(…).select(…);` then a conditional `.gte(…)` then
       *     `await q.order(…).limit(200)`. The `.from(` statement ends at the first
       *     semicolon, so the `.limit()` three lines later was out of scope and a bounded
       *     query was reported as unbounded.
       *
       * The function is the unit that actually holds a query, however it is spelled.
       */
      let start = 0;
      for (let j = i; j >= 0; j -= 1) {
        if (/^(export )?(async )?function |^(export )?const \w+ = (async )?\(/.test(lines[j]!)) {
          start = j;
          break;
        }
      }
      let end = lines.length - 1;
      for (let j = i; j < lines.length; j += 1) {
        if (/^\}/.test(lines[j]!)) {
          end = j;
          break;
        }
      }
      const fn = lines.slice(start, end + 1).join('\n');

      const firstVerb = /\.(select|insert|update|upsert|delete)\(/.exec(lines.slice(i, end + 1).join('\n'));
      if (firstVerb?.[1] !== 'select') return;

      const bounded =
        /fetchAll[<(]/.test(fn) ||
        /\.range\(/.test(fn) ||
        /\.limit\(/.test(fn) ||
        /\.single\(\)/.test(fn) ||
        /\.maybeSingle\(\)/.test(fn);
      out.push({ file, line: i + 1, table: m[1]!, bounded, key: `${file}:${m[1]}` });
    });
  }
  return out;
}

describe('every read is bounded, or says why not', () => {
  const all = queries();

  it('finds the queries at all, so a broken scan cannot pass silently', () => {
    // Without this, a regex that matched nothing would make every assertion below vacuous —
    // a green test proving only that the test is broken.
    expect(all.length).toBeGreaterThan(25);
    expect(new Set(all.map((q) => q.file)).size).toBeGreaterThan(4);
  });

  it('has no unpaged read that is not accounted for', () => {
    const unexplained = all.filter((q) => !q.bounded && !(q.key in BOUNDED_BY_REASON));
    const detail = unexplained
      .map(
        (q) =>
          `  ${q.file}:${q.line}  ${q.table}\n` +
          `      Page it with fetchAll(), or add '${q.key}' to BOUNDED_BY_REASON with the\n` +
          `      structural reason its row count cannot reach 1000.`,
      )
      .join('\n');
    expect(
      unexplained,
      `Unbounded reads can silently truncate at PostgREST's 1000-row cap:\n\n${detail}\n`,
    ).toEqual([]);
  });

  it('has no stale entries in the reason list', () => {
    // An allowlist that outlives the query it excused is how the next unbounded read gets
    // waved through by a name that happens to match.
    const present = new Set(all.map((q) => q.key));
    const stale = Object.keys(BOUNDED_BY_REASON).filter((k) => !present.has(k));
    expect(stale, `No such query any more: ${stale.join(', ')}`).toEqual([]);
  });

  it('pages every read in the money and evidence paths', () => {
    // These are the ones where truncation does not merely hide a row: it changes a figure
    // somebody submits, or shortens a document a reviewer is handed.
    const mustPage = [
      'billing.ts:attendance_events',
      'billing.ts:bookings',
      'billing.ts:invoices',
      'billing.ts:invoice_totals',
      'billing.ts:invoice_lines',
      'billing.ts:children',
      'billing.ts:enrolments',
      'compliance.ts:evidence',
      'compliance.ts:staff_records',
      'engagement.ts:messages',
      'engagement.ts:message_threads',
      'engagement.ts:media',
    ];
    for (const key of mustPage) {
      const matching = all.filter((q) => q.key === key);
      expect(matching.length, `${key} not found — has it been renamed?`).toBeGreaterThan(0);
      for (const q of matching) {
        expect(q.bounded, `${key} at ${q.file}:${q.line} must be paged`).toBe(true);
      }
    }
  });
});
