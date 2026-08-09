/**
 * Learning stories from Storypark, as text — never as a live parser of a Storypark export.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS DOES NOT READ A STORYPARK FILE DIRECTLY
 *
 * This repo has never seen a real Storypark export and has not sourced its column layout
 * from anywhere. Guessing one would produce exactly the failure mode `unverified-claims`
 * exists to name: a file that parses, looks plausible, and is wrong in a way nobody
 * notices until a story is attributed to the wrong child. So this script does what
 * `scripts/import-criteria.ts` already does for the Ministry's criteria — it defines the
 * shape THIS product needs, documented below, and a person (or a small script somebody
 * else writes against Storypark's real export) is the thing that produces a file in it.
 * `source` is required for the same reason it is required there: a story with no stated
 * provenance is not usable as this centre's record of what happened.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO PHOTOS, AND THAT IS A REFUSAL RATHER THAN AN OMISSION
 *
 * A photograph in this product cannot exist without a recorded consent decision —
 * [[consent-gated-media]] is the whole reason `media.audience` and the two photo-consent
 * flags exist. A photo pulled from a family's old Storypark journal has no `media` row and
 * no consent decision behind it in THIS database; inserting one straight into storage would
 * make a photograph appear that this product cannot prove anybody agreed to. So this
 * importer writes text only, and a `photos` or `media` key anywhere in the input file is a
 * hard stop rather than a silently ignored field — see `refuseMediaFields` below.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DRY RUN BY DEFAULT
 *
 * Unlike `import-criteria.ts`, a bad run here does not sit in an empty, obviously-unused
 * set — it attributes text to a real child's record, visible to their whānau. So this
 * requires `--commit` to write anything at all; without it, every row is validated and
 * matched and nothing is inserted. Run it once without `--commit`, read what it found,
 * fix the source file's names, and only then add the flag.
 *
 * FILE SHAPE
 *
 *   npm run import:storypark -- path/to/stories.json
 *   npm run import:storypark -- path/to/stories.json --commit
 *
 * {
 *   "source": "Exported from Storypark by <centre>, requested 2026-08-01, covering 2023–2025",
 *   "centreSlug": "little-pearls-mt-roskill",
 *   "stories": [
 *     {
 *       "childName": "Ana Kupe",
 *       "date": "2024-03-14",
 *       "title": "Building with blocks",
 *       "body": "Ana spent the morning stacking the wooden blocks almost as tall as her..."
 *     }
 *   ]
 * }
 *
 * `childName` is matched against this centre's children, case-insensitively, against both
 * "first last" and "preferred last" — exactly one match required. Zero or several matches
 * refuses that row rather than guessing one; fix the name in the file and re-run. A row
 * whose title, date and matched child already exist as a post is treated as already
 * imported and skipped, so re-running a file after fixing three names does not duplicate
 * the other four hundred.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServiceClient } from '@ece/api';

interface StoryInput {
  childName: string;
  date: string;
  title: string;
  body: string;
}

interface FileInput {
  source: string;
  centreSlug: string;
  stories: StoryInput[];
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
    'Usage: npm run import:storypark -- path/to/stories.json [--commit]\n\n' +
      '  The file must carry a `source` saying where these stories came from.\n' +
      '  Without --commit this only validates and reports; nothing is written.',
  );
}

/** A `photos` or `media` key anywhere is a hard stop — see the header for why. */
function refuseMediaFields(raw: string): void {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const stories = Array.isArray(parsed.stories) ? (parsed.stories as Record<string, unknown>[]) : [];
  const offending = stories.some((s) => 'photos' in s || 'media' in s || 'images' in s);
  if (offending) {
    die(
      'This file has a photos/media/images field on at least one story.\n' +
        '  This importer writes text only — see the header comment for why a photograph\n' +
        '  cannot be brought across without a recorded consent decision. Remove those\n' +
        '  fields (the pictures themselves are not imported) and re-run.',
    );
  }
}

async function main() {
  const raw = readFileSync(path.resolve(file!), 'utf8');
  refuseMediaFields(raw);

  let parsed: FileInput;
  try {
    parsed = JSON.parse(raw) as FileInput;
  } catch (err) {
    die(`Could not read ${file}: ${(err as Error).message}`);
  }

  if (!parsed.source?.trim()) {
    die(
      'The file needs a `source`: where these stories came from, and when.\n' +
        '  A story with no stated provenance is not this centre’s record of what happened.',
    );
  }
  if (!parsed.centreSlug?.trim()) die('The file needs a `centreSlug`.');
  if (!Array.isArray(parsed.stories) || parsed.stories.length === 0) {
    die('The file needs a non-empty `stories` array.');
  }

  const db = createServiceClient(url!, serviceKey!);

  const { data: centre, error: centreError } = await db
    .from('centres')
    .select('id')
    .eq('slug', parsed.centreSlug.trim())
    .single();
  if (centreError || !centre) die(`Unknown centre slug: ${parsed.centreSlug}`);
  const centreId = (centre as { id: string }).id;

  const { data: children, error: childrenError } = await db
    .from('children')
    .select('id, first_name, last_name, preferred_name')
    .eq('centre_id', centreId);
  if (childrenError) die(`Could not read this centre's children: ${childrenError.message}`);

  // Every name this centre's roll answers to, mapped to the child ids that answer to it.
  // A name matching more than one child is not resolvable by name alone.
  const byName = new Map<string, string[]>();
  for (const c of children as { id: string; first_name: string; last_name: string; preferred_name: string | null }[]) {
    const names = [`${c.first_name} ${c.last_name}`];
    if (c.preferred_name?.trim()) names.push(`${c.preferred_name} ${c.last_name}`);
    for (const name of names) {
      const key = name.trim().toLowerCase();
      const existing = byName.get(key);
      if (existing) existing.push(c.id);
      else byName.set(key, [c.id]);
    }
  }

  const { data: existingPosts, error: existingError } = await db
    .from('posts')
    .select('id, title, published_at, post_children(child_id)')
    .eq('centre_id', centreId);
  if (existingError) die(`Could not read existing posts: ${existingError.message}`);
  const alreadyImported = new Set(
    (existingPosts as { title: string; published_at: string | null; post_children: { child_id: string }[] }[]).map(
      (p) => `${p.title.trim().toLowerCase()}::${p.published_at?.slice(0, 10)}::${p.post_children[0]?.child_id}`,
    ),
  );

  const matched: { childId: string; story: StoryInput }[] = [];
  const unmatched: { story: StoryInput; reason: string }[] = [];
  const skipped: StoryInput[] = [];

  for (const story of parsed.stories) {
    if (!story.childName?.trim() || !story.date?.trim() || !story.title?.trim() || !story.body?.trim()) {
      unmatched.push({ story, reason: 'missing childName, date, title or body' });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(story.date.trim())) {
      unmatched.push({ story, reason: `"${story.date}" is not a YYYY-MM-DD date` });
      continue;
    }
    const ids = byName.get(story.childName.trim().toLowerCase());
    if (!ids) {
      unmatched.push({ story, reason: `no child named "${story.childName}" at this centre` });
      continue;
    }
    if (ids.length > 1) {
      unmatched.push({ story, reason: `"${story.childName}" matches ${ids.length} children — ambiguous` });
      continue;
    }
    const key = `${story.title.trim().toLowerCase()}::${story.date}::${ids[0]}`;
    if (alreadyImported.has(key)) {
      skipped.push(story);
      continue;
    }
    matched.push({ childId: ids[0]!, story });
  }

  console.log(`\n  ${parsed.stories.length} stories in the file`);
  console.log(`  ${matched.length} matched a single child and are new`);
  console.log(`  ${skipped.length} already imported (same title, date and child) — skipped`);
  console.log(`  ${unmatched.length} could not be matched:\n`);
  for (const { story, reason } of unmatched) {
    console.log(`    "${story.title ?? '(no title)'}" — ${reason}`);
  }

  if (!commit) {
    console.log(
      `\n  Dry run — nothing written. ${matched.length} would be created.\n` +
        (unmatched.length > 0 ? `  Fix the ${unmatched.length} unmatched row(s) above and re-run first.\n` : '') +
        '  Re-run with --commit to write.\n',
    );
    return;
  }

  if (matched.length === 0) {
    console.log('\n  Nothing to write.\n');
    return;
  }

  for (let i = 0; i < matched.length; i += 1) {
    const { childId, story } = matched[i]!;
    const { data: post, error: postError } = await db
      .from('posts')
      .insert({
        centre_id: centreId,
        kind: 'learning_moment',
        title: story.title.trim(),
        body: story.body.trim(),
        // No author: this is a historical import, not a decision anybody at this centre
        // made today, and attributing it to whoever ran the script would be wrong the
        // same way `submit_enrolment_application` records no actor for a public enquiry.
        author_id: null,
        /*
          A minute past UTC midnight on the story's date, not noon.

          Storypark gives a date, never a time, so there is no wall-clock moment to
          preserve — only the calendar day. New Zealand is always AHEAD of UTC (+12 or
          +13, never behind), so a UTC instant just after midnight is still that same
          calendar date once read in Pacific/Auckland; noon UTC would already be past
          midnight the NEXT day there. This is the same class of bug `localDates.test.ts`
          exists to catch, just built by hand instead of with `.toISOString().slice(0,10)`
          — the guard's regex would not have caught this one. If this product ever serves
          a centre west of UTC, this line needs `zonedWallClockToUtc` and the centre's
          actual timezone instead of an assumption that holds only for New Zealand.
        */
        published_at: `${story.date}T00:01:00Z`,
      })
      .select('id')
      .single();
    if (postError || !post) {
      die(
        `Writing "${story.title}" failed: ${postError?.message}. Stopped after ${i} of ` +
          `${matched.length} — re-run is safe, already-written rows are skipped as duplicates.`,
      );
    }

    const { error: linkError } = await db
      .from('post_children')
      .insert({ post_id: (post as { id: string }).id, child_id: childId });
    if (linkError) die(`Linking "${story.title}" to its child failed: ${linkError.message}`);
  }

  console.log(`\n  ${matched.length} stories imported.\n  source: ${parsed.source.trim()}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
