import { headers } from 'next/headers';

/**
 * The origin this request arrived on — scheme and host, no path.
 *
 * From the request headers rather than a configured base URL, so it works on localhost, on a
 * preview deployment and in production without three settings. The `x-forwarded-*` pair is what a
 * proxy sets; `host` is the fallback for running `next start` directly.
 *
 * **This is the origin for a security comparison, not for building an outbound link.** Use
 * `publicAppBase()` for anything that goes in an email or in front of a person — see the long note
 * on it for why the headers cannot answer that question behind a proxy.
 */
export async function originOf(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** `ECE_PORTAL_MOUNT`, normalised the same way `next.config.ts` normalises it for `basePath`. */
function mount(): string {
  const raw = (process.env.ECE_PORTAL_MOUNT ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * An app-relative path turned into one the browser can use — `/billing/export.csv` becomes
 * `/portal/billing/export.csv` under the mount.
 *
 * FOR THE HREFS NEXT DOES NOT REWRITE, WHICH IS A SHORTER LIST THAN IT SOUNDS AND WAS STILL MISSED.
 *
 * `<Link>`, `redirect()` from `next/navigation` and `NavLink` (which wraps `Link`) all prepend
 * `basePath` themselves, so ordinary navigation was never affected. A bare `<a href="/…">` does not,
 * and every CSV download in this app is a bare anchor **on purpose**: these routes are route
 * handlers returning a file, and `<Link>` would attempt a client-side navigation to them.
 *
 * So the six download links and one stray in-app anchor all pointed at the marketing site's 404
 * from the moment the mount went live. The check that missed them looked at what the framework
 * emits — `/_next/*` chunks, redirect targets, the routes manifest — and never at the hrefs written
 * by hand, which is the one category the framework does not touch. Found by an audit, not by the
 * verification that claimed the mount was sound.
 *
 * Server-only, like everything else here: `ECE_PORTAL_MOUNT` is not a `NEXT_PUBLIC_` variable and
 * must not become one, because a second variable naming the same fact is how the two drift. Every
 * call site is a Server Component; the one client component that had a bare anchor was changed to
 * `<Link>`, which is the right tool for in-app navigation anyway.
 */
export function appPath(path: string): string {
  if (!path.startsWith('/')) throw new Error(`appPath needs an absolute app path, got "${path}"`);
  return `${mount()}${path}`;
}

/**
 * Where the world reaches this app, including any mount path and with no trailing slash.
 *
 * TWO BUGS MADE THIS NECESSARY, AND ONLY ONE OF THEM WAS THE MOUNT'S FAULT.
 *
 * **The pre-existing one.** `auth/confirm/route.ts` built its redirects from `request.url`, and on
 * Railway the container is addressed internally, so `url.origin` is `https://localhost:8080`.
 * Password recovery therefore ended by redirecting the person to localhost — measured on the
 * console's own hostname, with the proxy out of the picture entirely, so it had been broken since
 * the first deploy and was simply never exercised. Nobody had reset a password in production yet.
 *
 * **The mount's one.** Every route now lives under `/portal`, and a link built from the bare origin
 * omits it. `NextResponse.redirect(new URL(path, origin))` gets no `basePath` — unlike `redirect()`
 * from `next/navigation`, which does. That asymmetry is why one route was wrong and its neighbour
 * was right.
 *
 * WHY A CONFIGURED VALUE, WHEN `originOf()` DELIBERATELY AVOIDS ONE
 *
 * Because behind the mount the app genuinely cannot know its own public address. The website
 * proxies `/portal/*` to this service by fetching its Railway hostname, so `x-forwarded-host` here
 * is **this** service's host in both cases — never the one the browser typed. That is not a guess:
 * it is the same fact that forces `ECE_ALLOWED_ORIGINS` to exist, because the server-action origin
 * check compares against exactly that header and fails without help.
 *
 * A header-derived link would therefore point at `ece-production-fc07…/portal/auth/confirm`, which
 * is **not** on Supabase's `uri_allow_list` — and an off-allowlist redirect is silently replaced
 * with `site_url`, so the person lands on the sign-in page with nothing having happened and no error
 * anywhere. One value, naming the address the world actually uses, is the only thing that answers it.
 *
 * Unset it and this returns to header derivation plus the mount, which is correct for a direct
 * deployment and for localhost. So the variable is required only while the app is proxied — and
 * when Doorway has a domain of its own, clearing both variables restores the original behaviour
 * with no code change.
 */
export async function publicAppBase(): Promise<string> {
  const configured = (process.env.ECE_PUBLIC_URL ?? '').trim();
  if (configured) {
    try {
      const u = new URL(configured);
      // Origin plus path, so the variable may carry the mount. Query and fragment are discarded:
      // this is a base to concatenate onto, and a stray `?` in it would swallow what follows.
      return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
    } catch {
      // A malformed value must not take password recovery down silently. Falling through to the
      // headers is wrong under a proxy but reachable, which beats throwing inside a server action
      // whose only visible outcome is "if that address has an account, the email is on its way".
    }
  }
  return `${await originOf()}${mount()}`;
}
