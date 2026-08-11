import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

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

/**
 * The path this app is mounted at, or `''` for its own root.
 *
 * WHY THE CONSOLE IS SERVED UNDER A PATH AT ALL
 *
 * Doorway has no domain of its own yet. Rather than send families to a `*.up.railway.app`
 * address, it is served from the Little Pearls website's hostname at this prefix — one
 * origin, two containers, stitched by a rewrite in `apps/site/next.config.ts`.
 *
 * `basePath` is what makes that possible, and the reason is narrower than it looks: it
 * prefixes the routes *and* `/_next/*`. Two Next apps on one origin otherwise both serve
 * their assets from `/_next/`, and the website's chunks start answering the console's
 * requests — a page that renders and then dies in hydration. Stripping the prefix at the
 * proxy does not fix that collision. This does.
 *
 * WHY A VARIABLE AND NOT THE LITERAL `/portal`
 *
 * `basePath` is global to the build, so hardcoding it moves every local URL as well:
 * `localhost:3000/login` becomes `/portal/login`, and Playwright's `baseURL` —
 * `http://127.0.0.1:<port>`, no prefix — stops matching every spec in the suite. Unset is
 * exactly today's behaviour, which also makes the mount reversible by clearing one variable
 * on each service instead of by reverting a commit.
 *
 * TWO WAYS TO GET THIS WRONG, BOTH WORTH THE WORDS
 *
 * It must be **identical on both Railway services**. `apps/site` forwards the prefix rather
 * than stripping it, so a disagreement is a 404 on every console page.
 *
 * It must be present at **build** time, not only at runtime. Next inlines it into the client
 * bundle, so a value that only exists at runtime serves pages at `/portal` whose scripts are
 * fetched from `/` — every asset 404s while the HTML looks perfect. Nixpacks bakes Railway
 * variables into the image, so a service variable satisfies both; a value passed only to the
 * start command would not.
 *
 * And it moves `/api/health`, which is why `railway.json` names the prefixed path. A
 * mismatch there fails the health check and the deploy never goes live — loud, at least.
 */
/*
 * A LEADING SLASH IS OPTIONAL, AND THAT IS A WINDOWS CONCESSION RATHER THAN GENEROSITY.
 *
 * The first local build of this mount failed with:
 *
 *   Specified basePath has to start with a /, found "C:/Program Files/Git/portal"
 *
 * `export ECE_PORTAL_MOUNT=/portal` in Git Bash. MSYS2 rewrites values that look like POSIX
 * paths into Windows ones when it spawns a native process, and `next build` is native — so
 * the variable arrived mangled and neither app could build. Nothing was wrong with the code.
 *
 * This does not repair a mangled value and must not pretend to: `/C:/Program Files/...` is
 * still nonsense and Next still refuses it, which is correct. What it buys is that a developer
 * on this repo's primary platform can write `ECE_PORTAL_MOUNT=portal`, with no leading slash
 * for MSYS2 to recognise, and get a working build. Railway is Linux and passes `/portal`
 * through untouched, so production is unaffected either way.
 *
 * Duplicated verbatim in apps/site/next.config.ts. Deliberately not shared: a next.config is
 * loaded before path aliases exist, and importing @ece/core — which ships TypeScript source —
 * into the config that configures its own transpilation is a way to break every build at once
 * for the sake of three lines. A disagreement between the two copies fails at build with a
 * 404 on every console page, not silently.
 */
const portalMount = (() => {
  const raw = (process.env.ECE_PORTAL_MOUNT ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
})();

const config: NextConfig = {
  // The shared packages ship TypeScript source rather than compiled output, so
  // Next transpiles them. This is what lets one query layer serve both apps
  // without a build step in between.
  transpilePackages: ['@ece/core', '@ece/api'],
  reactStrictMode: true,

  ...(portalMount ? { basePath: portalMount } : {}),

  ...(extraOrigins.length > 0
    ? { experimental: { serverActions: { allowedOrigins: extraOrigins } } }
    : {}),
};

/*
 * next-intl, deliberately WITHOUT its URL-routing mode ([locale] path segments and the
 * middleware that rewrites them). `middleware.ts` mints a per-request CSP nonce that the
 * whole app's security model depends on — see the header comment on the root layout —
 * and layering next-intl's own middleware in would mean either replacing that logic or
 * composing two middlewares that both touch the request/response headers, either of
 * which is a real chance of silently breaking the nonce for every route at once. A
 * cookie read in `src/i18n/request.ts` (the same pattern `CENTRE_COOKIE` already uses for
 * which centre is active) needs no middleware at all. See llm-wiki/wiki/i18n.md.
 */
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(config);
