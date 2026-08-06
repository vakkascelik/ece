import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceClient, type Db } from '@ece/api';

/**
 * Supabase clients for the web app.
 *
 * Three of them, and the distinction is the tenant boundary:
 *
 *   browser / server — anon key, carry the user's JWT, RLS applies. Safe. The browser one
 *                      lives in `supabaseBrowser.ts`; see the note below.
 *   service          — bypasses RLS entirely. Can read every centre at once.
 *
 * The service client exists for onboarding a tenant and for scheduled work.
 * Every use of it is a place where cross-tenant leakage is possible, so each one
 * should be obvious in review — which is why it is not the default export and
 * not wrapped in anything convenient.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local.`);
  return value;
}

const URL_ = () => required('NEXT_PUBLIC_SUPABASE_URL');
const ANON = () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY');

/*
 * The browser client used to live here and has moved to `supabaseBrowser.ts`.
 *
 * It had to: this module imports `next/headers` for the server client, a module is bundled as a
 * whole, and so any client component importing `browserDb` from here failed the build with
 * "You're importing a component that needs next/headers". Which is very likely why it sat here
 * exported and called from nowhere until the outbox needed it.
 */

/**
 * Server components, route handlers and server actions.
 *
 * Reads and writes the auth cookie so the session survives navigation. The
 * `setAll` catch is required: Next forbids setting cookies from a Server
 * Component render, and Supabase calls it speculatively during token refresh.
 * Swallowing it there is correct — middleware owns refresh.
 */
export async function serverDb() {
  const store = await cookies();
  return createServerClient(URL_(), ANON(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* not writable during a Server Component render; middleware refreshes */
        }
      },
    },
  });
}

/**
 * RLS-bypassing client. Server-only, and never in response to unauthenticated
 * input. If you are reaching for this to make a query work, the query is
 * probably missing a membership rather than a privilege.
 */
export function serviceDb(): Db {
  return createServiceClient(URL_(), required('SUPABASE_SERVICE_ROLE_KEY'));
}
