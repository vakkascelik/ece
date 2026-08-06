import { NextResponse } from 'next/server';

/**
 * Health check for the host's load balancer.
 *
 * Mirrors `apps/web`'s, and the reason it exists at all is the reason recorded there: the most
 * likely way a deploy fails is a missing environment variable, and without this route the symptom
 * is a 500 on whichever page somebody opens first, minutes after the deploy was declared
 * successful.
 *
 * WHY THIS ONE CHECKS ALMOST NOTHING
 *
 * Because this app needs almost nothing. It has no Supabase dependency and no database access, so
 * there is no client whose construction could throw lazily. The two variables below are the only
 * ones whose absence changes behaviour, and both fail *soft* rather than hard — a missing
 * `SITE_ORIGIN` gives absolute URLs pointing at the production domain, and a missing
 * `SITE_CANONICAL_HOST` skips the redirect. So this reports them and still returns ok, which is a
 * deliberate difference from the app's 503: refusing traffic over a soft default would take a
 * working website offline to complain about a canonical URL.
 *
 * A health check that queried anything would be worse than useless here: a blip in a dependency
 * this app does not have would fail the check and roll back a container that is fine.
 */
export const dynamic = 'force-dynamic';

const SOFT = ['SITE_ORIGIN', 'SITE_CANONICAL_HOST', 'SITE_APP_URL'] as const;

export async function GET() {
  const unset = SOFT.filter((name) => !process.env[name]);

  return NextResponse.json(
    { ok: true, ...(unset.length > 0 ? { usingDefaultsFor: unset } : {}) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
