import type { NextConfig } from 'next';

import { legacyRedirects } from './src/lib/legacyRoutes';

/**
 * The console, mounted on this website's hostname.
 *
 * WHY THE MARKETING SITE IS THE THING DOING THE PROXYING
 *
 * Doorway has no domain of its own yet, and the alternative was sending families to
 * `ece-production-fc07.up.railway.app`. Railway routes by **hostname, not by path**, so a
 * single address cannot be split across two services at the platform level — one of the two
 * containers has to forward. It has to be this one, because this is the container that owns
 * the hostname families actually arrive at.
 *
 * That crosses a boundary railway.site.json drew on purpose, and it should be crossed with
 * the eyes open: this image still holds no database credential, but authenticated console
 * traffic and Supabase session cookies now transit the public, unauthenticated container.
 * Recorded in llm-wiki/wiki/deployment.md rather than left to be discovered.
 *
 * THE PUBLIC URL, NOT `ece.railway.internal`, AND NOT AS A MATTER OF TASTE
 *
 * Railway's private network is IPv6-only, and `next start` binds `0.0.0.0` — railway.json
 * says so in its own start-command note, and it was verified there rather than assumed. So
 * the internal hostname resolves, refuses the connection, and every console request becomes
 * a 502 while the marketing pages carry on rendering perfectly. Nothing in this repo has
 * ever used Railway's private network. Moving to it later needs `HOSTNAME=::` on the console
 * service and a test that proves it, not a config change that looks tidier.
 *
 * The cost of the public hop is one round trip through Railway's edge per request. Paid
 * knowingly, in exchange for a mechanism whose failure mode is understood.
 *
 * THE PREFIX IS FORWARDED, NOT STRIPPED
 *
 * `apps/web` runs with `basePath` set to the same value and expects to see it. Stripping it
 * here would put the console's assets back at `/_next/*`, where this site's own build
 * already answers — and the marketing app's chunks serving the console is a page that
 * renders and then dies in hydration. See the long note in apps/web/next.config.ts.
 *
 * WHAT THIS BREAKS IF NOBODY SETS ECE_ALLOWED_ORIGINS
 *
 * Every write in the console is a server action, and Next validates a server action's
 * `Origin` against the forwarded host. Through this proxy the browser says
 * `little-pearls-production.up.railway.app` and the console sees its own hostname, so the
 * check fails and **the whole application goes read-only while every page renders**. That
 * variable is not optional here the way it is on a direct deploy; it is part of the mount.
 */
// Leading slash optional, and normalised the same way as in apps/web/next.config.ts — where the
// Git Bash path-mangling failure that motivated it is written up. The two copies must agree.
const portalMount = (() => {
  const raw = (process.env.ECE_PORTAL_MOUNT ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
})();

/**
 * Where console traffic is forwarded.
 *
 * Defaults to `RAILWAY_SERVICE_ECE_URL`, which Railway injects into every service in the
 * project as a bare hostname. That default is the point: it cannot drift from the hostname
 * Railway actually assigned, so the common case needs no variable of anyone's making, and
 * `SITE_PORTAL_ORIGIN` exists only for the day the console moves somewhere Railway does not
 * know about.
 *
 * Parsed inline rather than through `urlFromEnv()` in `src/lib/site.ts`, which does this job
 * properly and is tested. Two reasons, and the first is mechanical: this file is loaded by
 * Next before the `@/` path alias is available, so the import would not resolve. The second
 * is that the shapes differ — that helper substitutes a fallback, and what is needed here is
 * the *absence* of a value, because no destination has to mean no rewrite rather than a
 * rewrite pointing somewhere plausible and wrong.
 *
 * BUILD TIME, NOT RUNTIME, AND THIS IS NOT THE SAME TRAP AS THE OTHERS.
 *
 * `rewrites()` is evaluated during `next build` and written into `.next/routes-manifest.json`.
 * `next start` reads the manifest and never calls this function again. So both variables have
 * to be set on the Railway service *before the build*, and changing either one needs a
 * redeploy rather than a restart — setting them on a running service does nothing at all,
 * which is a particularly quiet way to be wrong. Nixpacks bakes Railway variables into the
 * image, so a service variable is present at build; a value injected only into the start
 * command would produce a site with no rewrite and a 404 at `/portal`.
 */
const portalOrigin = (() => {
  const raw = (process.env.SITE_PORTAL_ORIGIN ?? process.env.RAILWAY_SERVICE_ECE_URL ?? '').trim();
  if (!raw) return '';
  try {
    // Railway's injected value has no scheme; an explicit override probably does.
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return '';
  }
})();

/**
 * Little Pearls' public website.
 *
 * Environment comes from the workspace root `.env.local` via `dotenv-cli` in this app's npm
 * scripts, the same wrapper `apps/web` uses and for the same reason: Next only reads
 * `.env.local` from the app directory, so in a monorepo the root file is silently ignored and
 * the failure is delayed until a request arrives.
 *
 * `transpilePackages` because `@ece/core` ships TypeScript source rather than build output —
 * `packages/core/package.json` points `main` at `./src/index.ts` and its build script is
 * `tsc --noEmit`. Without this the import fails at build with a syntax error in node_modules,
 * which reads like a broken dependency rather than a missing config line.
 */
const nextConfig: NextConfig = {
  transpilePackages: ['@ece/core'],

  /*
   * Trailing slashes off, and a canonical host enforced in middleware.
   *
   * Their current site is reachable four ways — http and https, with and without www, all
   * returning 200 rather than redirecting. That is four addressable copies of every page, which
   * splits any search ranking they have and means a shared link may be the insecure one.
   */
  trailingSlash: false,

  // Their existing photography is served from Flickr today. Nothing external is loaded here
  // until the consent position for each image is known, so the allowlist starts empty and any
  // addition is a deliberate edit rather than a default.
  images: { remotePatterns: [] },

  /*
   * One rule, and the bare `/portal` is covered by it.
   *
   * There were two. The second existed on the assumption that `:path*` would not match a
   * zero-length tail, which would have left the first URL anybody types — `/portal`, no
   * trailing anything — falling through to this site's 404 instead of the console's sign-in
   * page. The generated `routes-manifest.json` says the assumption was wrong:
   *
   *   ^/portal(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?(?:/)?$
   *
   * The whole segment group is optional, so `/portal` matches this rule and 307s to
   * `/portal/login` like anything else. Verified in the manifest and then through a running
   * proxy rather than reasoned about — the extra rule was harmless, but its comment asserted
   * a constraint that does not exist, and a wrong comment outlives the code it explains.
   *
   * Returning `[]` when either half is missing is deliberate: with no mount configured this
   * file behaves exactly as it did before, so the whole arrangement is switched on and off by
   * one variable on each service rather than by a revert.
   */
  /**
   * The 2018 site's URLs, kept alive.
   *
   * All six are in the old sitemap, so all six are what Google indexed and what eight years of
   * inbound links point at; every one of them 404'd on this build before this existed. The list
   * and the reasoning for each mapping live in `src/lib/legacyRoutes.ts`, where a test can reach
   * them — a redirect map that nothing asserts is a map that rots without anybody noticing.
   *
   * `permanent: false` until the cutover is verified. A permanent redirect is cached for the life
   * of a browser profile and is therefore the one mistake a deploy cannot fix; see the note in
   * middleware.ts, which learned it the hard way.
   *
   * Redirects run before rewrites in Next's pipeline, so none of these can collide with the
   * `/portal` mount below.
   */
  async redirects() {
    return legacyRedirects(false);
  },

  async rewrites() {
    if (!portalMount || !portalOrigin) return [];
    return [
      { source: `${portalMount}/:path*`, destination: `${portalOrigin}${portalMount}/:path*` },
    ];
  },
};

export default nextConfig;
