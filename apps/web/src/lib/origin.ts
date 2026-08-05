import { headers } from 'next/headers';

/**
 * The origin to build an outbound link against — invitation links, password
 * reset redirects.
 *
 * From the request headers rather than a configured base URL, so the link works on
 * localhost, on a preview deployment and in production without three settings. The
 * `x-forwarded-*` pair is what a proxy sets; `host` is the fallback for running
 * `next start` directly.
 */
export async function originOf(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
