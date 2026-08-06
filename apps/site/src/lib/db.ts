import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The public website's only database access: an `anon` client, on the server, used for exactly
 * one function call.
 *
 * WHY THE ENV VARS ARE NOT `NEXT_PUBLIC_`
 *
 * This is the whole design, not a style choice. `NEXT_PUBLIC_` tells Next to inline the value
 * into the client bundle, and an inlined anon key means the browser can talk to Supabase — at
 * which point the CSP's `connect-src 'self'` is a policy that no longer describes the app, and
 * every future page could quietly grow a browser query. Unprefixed names make that impossible
 * rather than discouraged: `process.env.SUPABASE_ANON_KEY` is `undefined` in a browser.
 *
 * The `NEXT_PUBLIC_*` fallbacks are for local development only, where `.env.local` is shared
 * with `apps/web` and already holds them under those names. In production the site's Railway
 * service sets the unprefixed pair.
 *
 * WHAT HOLDING THIS KEY LETS THE SITE DO
 *
 * Insert one job application, and nothing else. `anon` has `usage on schema public` and not a
 * single table grant — `scripts/security-review.ts` check 8 fails the build at high severity if
 * that ever changes — plus EXECUTE on `submit_job_application`, which returns void. The
 * service-role key, which bypasses RLS on every table, is not here and must never be: see
 * `docs/deploy-railway.md`.
 */
export function anonDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Named explicitly, because the failure this replaces is a form that appears to work and
    // silently discards applications — which is the state their Adobe Muse mailer was in.
    throw new Error(
      'The careers form needs SUPABASE_URL and SUPABASE_ANON_KEY. Without them an application ' +
        'cannot be stored, and failing loudly is better than accepting one and losing it.',
    );
  }

  /*
   * No session, no storage, no refresh. This client authenticates nobody: it exists for one
   * anonymous RPC, and `persistSession` on a server that handles every visitor's request would
   * be a shared mutable auth state.
   */
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/*
 * There is deliberately no `isCareersFormConfigured()` for the page to branch on.
 *
 * It would be read during static generation and baked into the HTML, so a page built before the
 * key was set would keep saying the form is unavailable until somebody redeployed — and the
 * symptom would be a working service showing a stale message, which is the failure mode the
 * canonical-host redirect already taught this repo once. The form always renders; the action
 * catches a missing key and says so, with the careers mailbox as the way through.
 */
