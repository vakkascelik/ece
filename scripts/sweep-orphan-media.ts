/**
 * Removes storage objects with no `media` row pointing at them.
 *
 * WHY ORPHANS EXIST AT ALL
 *
 * A file has to be uploaded before there is a media row to attach a child to, so the consent gate
 * cannot fire at upload time — it fires on the *next* statement, when the child is tagged. An
 * upload for a child without consent therefore leaves an object behind.
 *
 * `posts/actions.ts` cleans up after itself when the gate refuses. This exists for the cases it
 * cannot reach: the browser tab closed between the upload and the tag, a crash, a network drop.
 *
 * Orphans are unreachable rather than exposed — no media row means the storage read policy has
 * nothing to match, so nobody can sign a URL for them. They are a storage bill and a pile of
 * photographs of children that nothing accounts for, which is reason enough to clear them.
 *
 *   npm run sweep:media            report only
 *   npm run sweep:media -- --delete
 *
 * Report-only by default, because the failure mode of a bug here is deleting a photograph that a
 * post depends on.
 */

import { MEDIA_BUCKET } from '@ece/core';
import { createServiceClient } from '@ece/api';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function die(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const doDelete = process.argv.includes('--delete');

/**
 * How long an object must have existed before it counts as an orphan.
 *
 * An upload in progress has no media row yet. Sweeping it would delete a file somebody is midway
 * through attaching, which is the one way this script can cause the problem it exists to solve.
 */
const MIN_AGE_MINUTES = 60;

async function main() {
  const db = createServiceClient(url!, serviceKey!);

  // Every path the database knows about. Service role, so RLS does not narrow it — and the
  // restrictive consent policy must not either: a file whose consent was withdrawn still has a
  // row and is emphatically not an orphan.
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('media')
      .select('storage_path')
      .range(from, from + 999);
    if (error) die(`Reading media rows failed: ${error.message}`);
    const rows = (data ?? []) as { storage_path: string }[];
    for (const r of rows) known.add(r.storage_path);
    // PostgREST caps an unbounded select at 1000 rows, so this pages explicitly rather than
    // trusting one request to have returned everything.
    if (rows.length < 1000) break;
  }

  const { data: centres, error: centreError } = await db.from('centres').select('id');
  if (centreError) die(`Reading centres failed: ${centreError.message}`);

  const cutoff = Date.now() - MIN_AGE_MINUTES * 60_000;
  const orphans: string[] = [];
  let seen = 0;

  // Objects are stored as `<centre_id>/<uuid>.<ext>`, so the listing is per centre folder.
  for (const { id: centreId } of centres as { id: string }[]) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.storage
        .from(MEDIA_BUCKET)
        .list(centreId, { limit: 100, offset });
      if (error) die(`Listing ${centreId} failed: ${error.message}`);
      const files = data ?? [];
      for (const f of files) {
        seen += 1;
        const path = `${centreId}/${f.name}`;
        if (known.has(path)) continue;
        const createdAt = f.created_at ? Date.parse(f.created_at) : 0;
        if (createdAt > cutoff) continue; // possibly mid-upload
        orphans.push(path);
      }
      if (files.length < 100) break;
    }
  }

  console.log(`\n  ${seen} objects, ${known.size} referenced by a media row`);
  console.log(`  ${orphans.length} orphaned and older than ${MIN_AGE_MINUTES} minutes`);

  if (orphans.length === 0) {
    console.log('\n  Nothing to do.\n');
    return;
  }

  for (const path of orphans.slice(0, 20)) console.log(`    ${path}`);
  if (orphans.length > 20) console.log(`    … and ${orphans.length - 20} more`);

  if (!doDelete) {
    console.log('\n  Report only. Re-run with --delete to remove them.\n');
    return;
  }

  // In batches: `remove` takes a list, and one request with ten thousand paths in it is a
  // request that times out halfway through.
  let removed = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100);
    const { error } = await db.storage.from(MEDIA_BUCKET).remove(batch);
    if (error) die(`Removing a batch failed after ${removed} deletions: ${error.message}`);
    removed += batch.length;
  }

  console.log(`\n  Removed ${removed} orphaned object(s).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
