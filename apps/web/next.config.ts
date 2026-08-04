import type { NextConfig } from 'next';

/**
 * Environment comes from the workspace root `.env.local`, loaded by `dotenv-cli`
 * in this app's npm scripts.
 *
 * Next only reads `.env.local` from the app directory, so in a monorepo the root
 * file is silently ignored — and the failure is delayed: `next build` succeeds,
 * because nothing reads the variable until a request arrives. `loadEnvConfig()`
 * here is not enough either; it populates process.env while the config is
 * evaluated but does not survive into the request path under `next start`.
 *
 * One root env file is worth the wrapper: the mobile app needs the same Supabase
 * project, and two copies of a URL and a key drift — with the drift showing up
 * as one app quietly talking to the wrong database.
 */
/**
 * Extra origins the server-action guard should accept, comma separated.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Next checks that a server action's `Origin` matches the host, and behind a reverse proxy
 * it compares against `X-Forwarded-Host`. When a platform's forwarded host disagrees with
 * what the browser sent — a custom domain in front of a generated one, a redirect between
 * the two, a health checker hitting the internal address — the request is refused with
 * "Invalid Server Actions request".
 *
 * **Every write in this product is a server action.** Signing a child in, recording a
 * consent, issuing an invoice: all of them. So this particular misconfiguration does not
 * break one feature, it makes the whole application read-only while every page renders
 * perfectly. That is not a hypothetical failure mode here — a `Referrer-Policy` of
 * `no-referrer` did exactly that during the Phase 6 security review, for the same
 * underlying reason: the origin check falls back to headers a policy or a proxy can remove.
 *
 * Empty by default, because Railway forwards the public host correctly and an allowlist
 * that is not needed is an allowlist that weakens the check. Set it only if writes fail
 * after a deploy, and set it to the exact host rather than a wildcard.
 */
const extraOrigins = (process.env.ECE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const config: NextConfig = {
  // The shared packages ship TypeScript source rather than compiled output, so
  // Next transpiles them. This is what lets one query layer serve both apps
  // without a build step in between.
  transpilePackages: ['@ece/core', '@ece/api'],
  reactStrictMode: true,

  ...(extraOrigins.length > 0
    ? { experimental: { serverActions: { allowedOrigins: extraOrigins } } }
    : {}),
};

export default config;
