import { describe, expect, it } from 'vitest';
import { sameOriginPath } from '../nextPath';

const ORIGIN = 'https://app.example.nz';
const FALLBACK = '/reset-password';
const safe = (raw: string | null) => sameOriginPath(raw, ORIGIN, FALLBACK);

/**
 * The `next` parameter on `/auth/confirm`, which decides where a freshly established recovery
 * session lands.
 *
 * The guard this replaces was `next.startsWith('/') && !next.startsWith('//')`. It looks exhaustive.
 * The first case below is the one that mattered, and it was measured rather than reasoned about.
 */
describe('sameOriginPath', () => {
  it('refuses the single backslash that defeated the old prefix check', () => {
    // `/\evil.com` starts with one slash, so the old check passed it — and the WHATWG parser treats
    // a backslash as a slash for special schemes, so it resolves to https://evil.com/. An open
    // redirect on the domain a password-reset email points at.
    expect(new URL('/\\evil.com', ORIGIN).href).toBe('https://evil.com/');
    expect(safe('/\\evil.com')).toBe(FALLBACK);
  });

  it('keeps an ordinary same-origin path, with its query', () => {
    expect(safe('/reset-password')).toBe('/reset-password');
    expect(safe('/account?tab=password')).toBe('/account?tab=password');
    expect(safe(`${ORIGIN}/account`)).toBe('/account');
  });

  it('refuses every other way of naming another host', () => {
    for (const hostile of [
      '//evil.com',
      '/\\\\evil.com',
      '\\\\evil.com',
      'https://evil.com/x',
      '//evil.com/reset-password',
      `https://app.example.nz.evil.com/x`,
      // A leading space is stripped by the URL parser before it decides on the host.
      '  /\\evil.com',
      '\t//evil.com',
    ]) {
      expect(safe(hostile), `${hostile} must not survive`).toBe(FALLBACK);
    }
  });

  it('refuses a scheme that is not a path at all', () => {
    expect(safe('javascript:alert(1)')).toBe(FALLBACK);
    expect(safe('data:text/html,<script>')).toBe(FALLBACK);
    expect(safe('mailto:someone@example.nz')).toBe(FALLBACK);
  });

  it('drops a fragment rather than carrying it', () => {
    // A fragment never reaches the server, so reconstructing one here would only be a place to put
    // something. GoTrue's implicit flow puts tokens in a fragment, which is why this matters here.
    expect(safe('/account#access_token=abc')).toBe('/account');
  });

  it('falls back when there is nothing, or nothing parseable', () => {
    expect(safe(null)).toBe(FALLBACK);
    expect(safe('')).toBe(FALLBACK);
    expect(safe('http://')).toBe(FALLBACK);
  });
});
