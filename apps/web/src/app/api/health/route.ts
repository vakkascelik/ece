import { NextResponse } from 'next/server';

/**
 * Health check for the host's load balancer.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It checks that the container booted **with its configuration**. It does not touch the
 * database.
 *
 * That distinction is the whole design. The most likely way this deploy fails is a missing
 * or misspelled environment variable — and without this route the symptom is a 500 on
 * whichever page a user happens to open first, minutes after the deploy was declared
 * successful, because `required()` throws lazily at the first request that needs a client.
 * Checking the variables here moves that failure to before the host routes any traffic.
 *
 * A health check that queried Supabase would be worse, not better: a transient blip in a
 * third-party service would fail the health check, the host would restart or roll back a
 * container that is perfectly healthy, and an outage in a dependency would become an
 * outage of its own making. Liveness is about this process.
 *
 * WHAT IT MUST NOT SAY
 *
 * No versions, no variable *values*, no database status, no build hash. An unauthenticated
 * endpoint that reports which secrets are configured is a reconnaissance endpoint. The
 * failure case names the missing variable because that is only reachable when the app is
 * already broken and cannot serve anything anyway — and knowing which one is missing is
 * the entire value of the check to whoever is deploying.
 */
export const dynamic = 'force-dynamic';

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  // Needed at runtime, not just by scripts: accepting an invitation calls the GoTrue
  // admin API to create the account, and no Postgres function can stand in for that.
  // See docs/deploy-railway.md on what that means for the blast radius of this container.
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export async function GET() {
  const missing = REQUIRED.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, missing },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
