import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session on every request.
 *
 * Without this, an access token expires mid-visit and Server Components start
 * seeing a signed-out user while the browser still believes it is signed in —
 * which presents as random redirects to /login that nobody can reproduce.
 *
 * Two rules that are easy to get wrong and painful to debug:
 *
 *  - Cookies must be written to the SAME response object that is returned. A
 *    fresh NextResponse created after the client has set cookies drops them and
 *    the session silently never refreshes.
 *  - getUser() must actually be called. It is what triggers the refresh; a
 *    middleware that only constructs the client does nothing at all.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip static assets and images: running auth refresh on every icon request
  // multiplies the auth server's load by the number of assets on the page.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
