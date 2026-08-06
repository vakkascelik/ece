import { createBrowserClient } from '@supabase/ssr';

/**
 * The browser client, in a module of its own.
 *
 * WHY IT IS NOT IN `supabase.ts` WITH THE OTHER TWO
 *
 * Because that file imports `next/headers` for the server client, and a module is bundled as a
 * whole. A client component importing `browserDb` from there drags `next/headers` into the
 * browser bundle and the build fails outright:
 *
 *   You're importing a component that needs "next/headers".
 *
 * This is almost certainly why `browserDb()` sat in that file for months **exported and called
 * from nowhere** — the first thing to genuinely need it was the outbox, and it could not have
 * it. Worth stating plainly, because "unused export" and "unusable export" look identical in a
 * grep.
 *
 * Anon key, and the user's JWT rides along in the cookies `@supabase/ssr` reads. RLS decides
 * what it can see, exactly as it does for the server client — there is no privilege difference
 * between the two, only a runtime one.
 */
export function browserDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Inlined at build time, so this is a deployment fault rather than a runtime condition.
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return createBrowserClient(url, anon);
}
