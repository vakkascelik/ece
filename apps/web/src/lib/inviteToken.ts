import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Invitation tokens.
 *
 * Server-only — `node:crypto` cannot be bundled for the browser or for Metro, which
 * is why this lives in the web app rather than in `@ece/api`. That is also a useful
 * guardrail: a raw token should never exist in a client bundle or a client state.
 */

/**
 * 32 bytes from the CSPRNG, base64url so it survives a URL and an email client that
 * decides to linkify.
 *
 * 256 bits is far more than needed against online guessing, and the cost of
 * generosity here is a slightly longer link. Not `Math.random`, which is seeded
 * predictably and is not a security primitive.
 */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex. What the database stores; the token itself is never persisted. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two hashes without leaking timing.
 *
 * Arguably unnecessary — the lookup is an indexed equality test in Postgres, not a
 * comparison here — but this is available for any path that ends up comparing in
 * application code, and a fast-exit `===` on a secret is a habit worth not having.
 */
export function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Seven days out, as an ISO timestamp. */
export function inviteExpiry(days = 7, from: Date = new Date()): string {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}
