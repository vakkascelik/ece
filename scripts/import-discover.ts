/**
 * Prospective families from a system a centre is switching away from — into `waitlist`,
 * never into `children`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "DISCOVER" IS A NAME FROM THE ROADMAP, NOT A SOURCED FORMAT
 *
 * `docs/roadmap-phases-8-13.md` names `scripts/import-discover.ts` as a target with no
 * further specification — no column list, no confirmation of which product it means. This
 * repo has not sourced an export format from any specific "Discover" product, and inventing
 * one would be the same mistake `import-storypark.ts`'s header refuses to make. So, exactly
 * like that script and like `import-criteria.ts` before it, this defines the shape THIS
 * product needs — documented below — rather than parsing a vendor file directly. Whoever
 * is helping a centre switch maps the old system's real export into this shape by hand or
 * with a small script of their own; `source` records what that old system was.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY `waitlist`, NOT `children` + `guardians`
 *
 * 0052's header makes this argument once already, about the public enquiry form: "a
 * stranger's claim about a child is not a child record… promotion to `children` +
 * `guardians` + `enrolments` is done BY HAND, by the office, after a conversation. There is
 * deliberately no function that does it." A row copied out of another company's database is
 * the same category of claim — arguably a weaker one, since nobody at this centre entered
 * it — and writing it straight into `children` would create a real child's record with no
 * human at this centre having decided to. `waitlist` (0018) already exists for exactly this:
 * a name, a contact, a hoped-for start date, held apart from an enrolment until staff act on
 * it. Reusing it means no new table, no new policy, no new audit-trigger decision — and it
 * gives a table that has had no writer at all until now an actual purpose.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS PRODUCT HAS NO SCREEN THAT SHOWS `waitlist` YET
 *
 * Worth knowing before running this for real: nothing in `apps/web` reads or writes this
 * table today (see [[reporting]] for where that was checked). Imported rows are visible
 * only through Supabase directly until a `/waitlist` page exists. Importing real families'
 * names, contact details and children's dates of birth into a table nobody can act on is a
 * privacy cost with no offsetting use — collect it once a viewing screen exists, not before.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DRY RUN BY DEFAULT
 *
 * Same reasoning as `import-storypark.ts`: this is real families' personal information, not
 * an empty criteria set. `--commit` is required to write anything.
 *
 * FILE SHAPE
 *
 *   npm run import:discover -- path/to/waitlist.json
 *   npm run import:discover -- path/to/waitlist.json --commit
 *
 * {
 *   "source": "Exported from Discover by <centre>, requested 2026-08-01",
 *   "centreSlug": "little-pearls-mt-roskill",
 *   "entries": [
 *     {
 *       "childName": "Rawiri Ngata",
 *       "dateOfBirth": "2023-06-02",
 *       "guardianName": "Mere Ngata",
 *       "contact": "021 555 0134",
 *       "wantedFrom": "2026-09-01",
 *       "wantedDays": [1, 2, 3, 4, 5],
 *       "note": "Waitlisted for the toddler room since 2025"
 *     }
 *   ]
 * }
 *
 * `dateOfBirth`, `wantedFrom`, `wantedDays` and `note` are optional — `waitlist` itself only
 * requires a child's name, a guardian's name and a contact. `wantedDays` is 1 = Monday..
 * 7 = Sunday, matching the column everywhere else in this schema. An entry matching an
 * existing UNRESOLVED row on child name, guardian name and contact is treated as already
 * imported and skipped, so a re-run after fixing some entries does not duplicate the rest.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServiceClient } from '@ece/api';

interface EntryInput {
  childName: string;
  guardianName: string;
  contact: string;
  dateOfBirth?: string;
  wantedFrom?: string;
  wantedDays?: number[];
  note?: string;
}

interface FileInput {
  source: string;
  centreSlug: string;
  entries: EntryInput[];
}

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const commit = args.includes('--commit');
if (!file) {
  die(
    'Usage: npm run import:discover -- path/to/waitlist.json [--commit]\n\n' +
      '  The file must carry a `source` saying where these entries came from.\n' +
      '  Without --commit this only validates and reports; nothing is written.',
  );
}

const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function main() {
  let parsed: FileInput;
  try {
    parsed = JSON.parse(readFileSync(path.resolve(file!), 'utf8')) as FileInput;
  } catch (err) {
    die(`Could not read ${file}: ${(err as Error).message}`);
  }

  if (!parsed.source?.trim()) {
    die(
      'The file needs a `source`: which system these entries came from, and when.\n' +
        '  An entry with no stated provenance is not usable — it is a claim from a system\n' +
        '  this product has never verified the shape of.',
    );
  }
  if (!parsed.centreSlug?.trim()) die('The file needs a `centreSlug`.');
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    die('The file needs a non-empty `entries` array.');
  }

  const db = createServiceClient(url!, serviceKey!);

  const { data: centre, error: centreError } = await db
    .from('centres')
    .select('id')
    .eq('slug', parsed.centreSlug.trim())
    .single();
  if (centreError || !centre) die(`Unknown centre slug: ${parsed.centreSlug}`);
  const centreId = (centre as { id: string }).id;

  const { data: existing, error: existingError } = await db
    .from('waitlist')
    .select('child_name, guardian_name, contact')
    .eq('centre_id', centreId)
    .is('resolved_at', null);
  if (existingError) die(`Could not read the existing waitlist: ${existingError.message}`);
  const alreadyOnList = new Set(
    (existing as { child_name: string; guardian_name: string; contact: string }[]).map(
      (e) => `${e.child_name.trim().toLowerCase()}::${e.guardian_name.trim().toLowerCase()}::${e.contact.trim().toLowerCase()}`,
    ),
  );

  const valid: EntryInput[] = [];
  const invalid: { entry: EntryInput; reason: string }[] = [];
  const skipped: EntryInput[] = [];

  for (const entry of parsed.entries) {
    if (!entry.childName?.trim() || !entry.guardianName?.trim() || !entry.contact?.trim()) {
      invalid.push({ entry, reason: 'missing childName, guardianName or contact' });
      continue;
    }
    if (entry.dateOfBirth && !isoDate(entry.dateOfBirth)) {
      invalid.push({ entry, reason: `dateOfBirth "${entry.dateOfBirth}" is not YYYY-MM-DD` });
      continue;
    }
    if (entry.wantedFrom && !isoDate(entry.wantedFrom)) {
      invalid.push({ entry, reason: `wantedFrom "${entry.wantedFrom}" is not YYYY-MM-DD` });
      continue;
    }
    if (entry.wantedDays && entry.wantedDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      invalid.push({ entry, reason: 'wantedDays must be whole numbers 1 (Monday) to 7 (Sunday)' });
      continue;
    }
    const key = `${entry.childName.trim().toLowerCase()}::${entry.guardianName.trim().toLowerCase()}::${entry.contact.trim().toLowerCase()}`;
    if (alreadyOnList.has(key)) {
      skipped.push(entry);
      continue;
    }
    valid.push(entry);
  }

  console.log(`\n  ${parsed.entries.length} entries in the file`);
  console.log(`  ${valid.length} valid and new`);
  console.log(`  ${skipped.length} already on the open waitlist (same child, guardian and contact) — skipped`);
  console.log(`  ${invalid.length} rejected:\n`);
  for (const { entry, reason } of invalid) {
    console.log(`    "${entry.childName ?? '(no name)'}" — ${reason}`);
  }

  if (!commit) {
    console.log(
      `\n  Dry run — nothing written. ${valid.length} would be added to the waitlist.\n` +
        (invalid.length > 0 ? `  Fix the ${invalid.length} rejected row(s) above and re-run first.\n` : '') +
        '  Re-run with --commit to write.\n\n' +
        '  Remember: nothing in this product shows the waitlist yet. See the header comment.\n',
    );
    return;
  }

  if (valid.length === 0) {
    console.log('\n  Nothing to write.\n');
    return;
  }

  const rows = valid.map((entry) => ({
    centre_id: centreId,
    child_name: entry.childName.trim(),
    date_of_birth: entry.dateOfBirth ?? null,
    guardian_name: entry.guardianName.trim(),
    contact: entry.contact.trim(),
    wanted_from: entry.wantedFrom ?? null,
    wanted_days: entry.wantedDays ?? [],
    note: entry.note?.trim() || null,
  }));

  const { error: insertError } = await db.from('waitlist').insert(rows);
  if (insertError) die(`Writing to the waitlist failed: ${insertError.message}`);

  console.log(`\n  ${valid.length} entries added to the waitlist.\n  source: ${parsed.source.trim()}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
