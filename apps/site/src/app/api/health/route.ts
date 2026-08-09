import { NextResponse } from 'next/server';
import { isUnusableUrl, URL_ENV } from '@/lib/site';
import { mapsConfigured } from '@/lib/staticMap';

/**
 * Health check for the host's load balancer.
 *
 * Mirrors `apps/web`'s, and the reason it exists at all is the reason recorded there: the most
 * likely way a deploy fails is a missing environment variable, and without this route the symptom
 * is a 500 on whichever page somebody opens first, minutes after the deploy was declared
 * successful.
 *
 * WHY THIS CHECKS LITTLE, AND WHY IT NOW CHECKS MORE THAN IT DID
 *
 * The `SITE_*` variables fail **soft**: a missing `SITE_ORIGIN` gives absolute URLs pointing at
 * the production domain, and a missing `SITE_CANONICAL_HOST` skips the redirect. Both are reported
 * and still return ok, which is a deliberate difference from the app's 503 — refusing traffic over
 * a soft default would take a working website offline to complain about a canonical URL.
 *
 * `SUPABASE_URL` and `SUPABASE_ANON_KEY` are different, and they were missing from this list
 * entirely. This comment used to say "it has no Supabase dependency and no database access, so
 * there is no client whose construction could throw lazily", which stopped being true when the
 * careers form was built. `anonDb()` throws without them, so **every application is refused while
 * the applicant is told to email instead** — and because the key is only read at request time, the
 * build passes, all ten pages render, and this endpoint returned a bare `ok`. A green deploy with a
 * dead form and no signal anywhere is exactly what a health check exists to prevent.
 *
 * They are reported rather than made fatal, on purpose. Nine of the ten pages are unaffected by a
 * missing key, and taking a working website offline because a form is misconfigured would be the
 * wrong trade for a service whose main job is telling parents the opening hours. So: still 200,
 * with `careersFormDisabledFor` naming what to set.
 *
 * A health check that queried Supabase would still be wrong: a blip in a third party would fail the
 * check and roll back a container that is fine.
 */
export const dynamic = 'force-dynamic';

const SOFT = ['SITE_ORIGIN', 'SITE_CANONICAL_HOST', 'SITE_APP_URL'] as const;

/**
 * The careers form needs one of each pair. The `NEXT_PUBLIC_*` names are accepted because local
 * development shares `.env.local` with `apps/web`, which already holds them under those names —
 * see `lib/db.ts` for why production uses the unprefixed pair instead.
 */
const CAREERS: readonly (readonly string[])[] = [
  ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
  ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
];

export async function GET() {
  const unset = SOFT.filter((name) => !process.env[name]);
  /*
   * Set, but not to a URL. `SITE_APP_URL` was once set to the description column out of the variable
   * table in the deploy guide — so the footer rendered `href="where "Sign in to the centre app"
   * points"`, which is a relative path, and the sign-in link landed on this site's own 404. The link
   * falls back to the right URL now; this is how somebody finds out the variable is wrong without
   * reading the HTML.
   */
  const unusable = URL_ENV.filter((name) => isUnusableUrl(name));
  const careersMissing = CAREERS.filter((names) => !names.some((n) => process.env[n])).map(
    (names) => names[0],
  );

  return NextResponse.json(
    {
      ok: true,
      ...(unset.length > 0 ? { usingDefaultsFor: unset } : {}),
      ...(unusable.length > 0 ? { setButNotAUrl: unusable } : {}),
      ...(careersMissing.length > 0 ? { careersFormDisabledFor: careersMissing } : {}),
      /*
       * Reported, never fatal — a contact page with an address and no picture of it is a working
       * contact page. It is here because the failure is otherwise invisible: `CentreMap` renders
       * nothing rather than a broken image, so a site with no maps and a site whose key was never
       * set look identical from the outside. This is the one place that tells them apart.
       *
       * A `true` here does NOT mean maps are appearing. The key can be set and the Maps Static API
       * still not enabled on the Google Cloud project, which is a 403 per centre and shows up in
       * the container log rather than here. Checking would mean calling Google from a health probe,
       * and a health check that fails because a third party is slow rolls back a container that is
       * fine — the reason this endpoint does not query Supabase either.
       */
      ...(mapsConfigured() ? {} : { mapsDisabledFor: ['GOOGLE_MAPS_API_KEY'] }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
