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
const config: NextConfig = {
  // The shared packages ship TypeScript source rather than compiled output, so
  // Next transpiles them. This is what lets one query layer serve both apps
  // without a build step in between.
  transpilePackages: ['@ece/core', '@ece/api'],
  reactStrictMode: true,
};

export default config;
