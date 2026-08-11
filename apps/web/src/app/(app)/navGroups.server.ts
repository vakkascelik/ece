import { cookies } from 'next/headers';
import { NAV_CLOSED_COOKIE, parseClosed } from './navGroups';

/**
 * The cookie-reading half of `navGroups.ts` — split out because it imports `next/headers` and
 * the cookie's name is also needed from a Client Component. Exactly the split
 * `locale.server.ts` already makes, for exactly the same reason, and the build refuses without
 * it rather than failing quietly.
 *
 * A cookie, the same pattern `CENTRE_COOKIE` and `LOCALE_COOKIE` use — not a preference table
 * and not middleware. This app's `middleware.ts` mints the CSP nonce every route depends on,
 * and a layout preference that needed its own middleware would be a second thing able to break
 * the first.
 *
 * Read on the server so the `<details>` elements arrive already in the state the reader left
 * them in. Deriving it in the browser instead would flash every group open on first paint and
 * then collapse them, on every page load, forever.
 */
export async function closedGroups(): Promise<Set<string>> {
  const store = await cookies();
  return parseClosed(store.get(NAV_CLOSED_COOKIE)?.value);
}
