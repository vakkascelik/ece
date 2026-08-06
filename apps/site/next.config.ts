import type { NextConfig } from 'next';

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
};

export default nextConfig;
