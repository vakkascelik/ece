/**
 * Loads a licensing criteria set from a JSON file.
 *
 * WHY THIS EXISTS RATHER THAN A SEEDED MIGRATION
 *
 * The criteria are a published document that was renumbered in 2026, and this repo does
 * not contain them. Seeding a plausible-looking set would produce the worst outcome
 * available for this feature: a centre assembling an evidence binder against a list that
 * looks official and is not. So the set comes from a file somebody has checked against
 * the real thing, and `source` records what that was.
 *
 *   npm run import:criteria -- path/to/criteria.json
 *   npm run import:criteria -- path/to/criteria.json --make-current
 *
 * File shape:
 *
 * {
 *   "name": "Centre-based licensing criteria, 2026",
 *   "serviceType": "centre-based",
 *   "source": "Ministry of Education, <document title>, retrieved <date> from <url>",
 *   "effectiveFrom": "2026-04-20",
 *   "criteria": [
 *     {
 *       "code": "HS1",
 *       "category": "Health and safety",
 *       "title": "…",
 *       "detail": "…",
 *       "supersedesCode": "HS3"
 *     }
 *   ]
 * }
 *
 * `supersedesCode` is the old-to-new mapping. It is what keeps three years of evidence
 * filed against the previous numbering findable, and it is the part worth the effort.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServiceClient } from '@ece/api';

interface CriterionInput {
  code: string;
  category: string;
  title: string;
  detail?: string;
  supersedesCode?: string;
}

interface SetInput {
  name: string;
  serviceType?: string;
  source: string;
  effectiveFrom?: string;
  criteria: CriterionInput[];
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
const makeCurrent = args.includes('--make-current');
if (!file) {
  die(
    'Usage: npm run import:criteria -- path/to/criteria.json [--make-current]\n\n' +
      '  The file must carry a `source` saying where the criteria came from.\n' +
      '  A set with no stated source is not usable as evidence.',
  );
}

async function main() {
  let parsed: SetInput;
  try {
    parsed = JSON.parse(readFileSync(path.resolve(file!), 'utf8')) as SetInput;
  } catch (err) {
    die(`Could not read ${file}: ${(err as Error).message}`);
  }

  if (!parsed.name?.trim()) die('The file needs a `name`.');
  // Enforced here as well as by the CHECK constraint, so the failure is a sentence
  // rather than a constraint violation.
  if (!parsed.source?.trim()) {
    die(
      'The file needs a `source`: where these criteria came from, and when.\n' +
        '  A criteria set with no provenance cannot be relied on in a binder.',
    );
  }
  if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
    die('The file needs a non-empty `criteria` array.');
  }

  // Duplicate codes within a set would make evidence ambiguous about what it covers.
  const seen = new Set<string>();
  for (const c of parsed.criteria) {
    if (!c.code?.trim() || !c.category?.trim() || !c.title?.trim()) {
      die(`Every criterion needs code, category and title. Offending entry: ${JSON.stringify(c)}`);
    }
    const key = c.code.trim();
    if (seen.has(key)) die(`Duplicate code ${key}. Codes must be unique within a set.`);
    seen.add(key);
  }

  const db = createServiceClient(url!, serviceKey!);
  const serviceType = parsed.serviceType ?? 'centre-based';

  const { data: set, error: setError } = await db
    .from('criteria_sets')
    .insert({
      name: parsed.name.trim(),
      service_type: serviceType,
      source: parsed.source.trim(),
      effective_from: parsed.effectiveFrom ?? null,
    })
    .select('id')
    .single();
  if (setError) die(`Creating the set failed: ${setError.message}`);

  const setId = (set as { id: string }).id;

  // Every object carries every key. PostgREST builds one INSERT from the union of keys
  // across a bulk array, so a key present in one object and absent from another is sent
  // as an explicit NULL rather than taking the column default — the same trap
  // `seed-demo.ts` fell into.
  const rows = parsed.criteria.map((c, i) => ({
    set_id: setId,
    code: c.code.trim(),
    category: c.category.trim(),
    title: c.title.trim(),
    detail: c.detail?.trim() || null,
    supersedes_code: c.supersedesCode?.trim() || null,
    sort_order: i,
  }));

  const { error: rowsError } = await db.from('criteria').insert(rows);
  if (rowsError) {
    // The set would otherwise sit there empty and look importable.
    await db.from('criteria_sets').delete().eq('id', setId);
    die(`Importing the criteria failed, and the empty set was removed: ${rowsError.message}`);
  }

  if (makeCurrent) {
    // One current set per service type, enforced by a partial unique index — so the
    // previous one has to be stood down first.
    await db
      .from('criteria_sets')
      .update({ is_current: false })
      .eq('service_type', serviceType)
      .eq('is_current', true);
    const { error } = await db.from('criteria_sets').update({ is_current: true }).eq('id', setId);
    if (error) die(`Imported, but could not mark it current: ${error.message}`);
  }

  const categories = new Set(rows.map((r) => r.category));
  const mapped = rows.filter((r) => r.supersedes_code).length;

  console.log(`\n  ${parsed.name}`);
  console.log(`  ${rows.length} criteria across ${categories.size} categories`);
  console.log(`  ${mapped} carry an old-to-new mapping`);
  console.log(`  source: ${parsed.source.trim()}`);
  console.log(
    makeCurrent
      ? `\n  Marked current for ${serviceType}.\n`
      : `\n  Imported but NOT current. Re-run with --make-current when it has been checked.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
