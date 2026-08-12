import { afterEach, describe, expect, it } from 'vitest';
import { appUrl, isUnusableUrl, siteOrigin, urlFromEnv } from '../site';

// Tracks DEFAULT_APP_URL in ../site. It changed when the console moved to /portal: the old value
// named a path basePath had deleted, so the fallback — used exactly when SITE_APP_URL is unset —
// was a 404.
const DEFAULT_APP = 'https://little-pearls-production.up.railway.app/portal/login';

afterEach(() => {
  delete process.env.SITE_APP_URL;
  delete process.env.SITE_ORIGIN;
});

/**
 * The environment variables that end up in an `href`.
 *
 * The first case is not hypothetical: `SITE_APP_URL` was set on the live Railway service to the
 * description column out of the variable table in `docs/deploy-railway.md`. The footer rendered
 * `<a href="where &quot;Sign in to the centre app&quot; points">`, which is a relative URL, so
 * "Sign in to the centre app" resolved against the site's own host and landed on the site's own 404.
 */
describe('urlFromEnv', () => {
  it('falls back when the variable holds prose instead of a URL', () => {
    process.env.SITE_APP_URL = 'where "Sign in to the centre app" points';
    expect(appUrl()).toBe(DEFAULT_APP);
    expect(isUnusableUrl('SITE_APP_URL')).toBe(true);
  });

  it('upgrades a bare host, because that is the recoverable mistake', () => {
    // Somebody pasting a hostname without the scheme meant the right thing and made a relative URL.
    // Deliberately the same host and path as DEFAULT_APP: the assertion below only means something
    // if the recovered value and the fallback are identical.
    process.env.SITE_APP_URL = 'little-pearls-production.up.railway.app/portal/login';
    expect(appUrl()).toBe(DEFAULT_APP);
    // Recovered rather than rejected, so this is NOT reported as unusable — the link works. This
    // assertion is the one that caught the first implementation, which reported trouble by comparing
    // the result to the fallback: the recovered value IS the fallback here.
    expect(isUnusableUrl('SITE_APP_URL')).toBe(false);
  });

  it('keeps a correct value untouched, and tolerates whitespace around it', () => {
    process.env.SITE_APP_URL = 'https://app.littlepearls.org.nz/login';
    expect(appUrl()).toBe('https://app.littlepearls.org.nz/login');
    process.env.SITE_APP_URL = '  https://app.littlepearls.org.nz/login  ';
    expect(appUrl()).toBe('https://app.littlepearls.org.nz/login');
  });

  it('refuses a scheme that is not a website', () => {
    // `new URL('javascript:...')` parses happily, so protocol has to be checked explicitly.
    for (const hostile of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      process.env.SITE_APP_URL = hostile;
      expect(appUrl(), `${hostile} must not reach an href`).toBe(DEFAULT_APP);
    }
  });

  it('refuses a single word, which is a relative path and not a host', () => {
    process.env.SITE_APP_URL = 'login';
    expect(appUrl()).toBe(DEFAULT_APP);
  });

  it('uses the fallback when unset, and does not report that as a problem', () => {
    expect(appUrl()).toBe(DEFAULT_APP);
    expect(isUnusableUrl('SITE_APP_URL')).toBe(false);
  });

  it('strips a trailing slash from the origin, so absolute URLs do not double up', () => {
    process.env.SITE_ORIGIN = 'https://www.littlepearls.org.nz/';
    expect(siteOrigin()).toBe('https://www.littlepearls.org.nz');
    expect(`${siteOrigin()}/careers`).toBe('https://www.littlepearls.org.nz/careers');
  });

  it('is generic, so a third URL variable gets the same treatment', () => {
    expect(urlFromEnv('SITE_NOT_SET_ANYWHERE', 'https://fallback.example')).toBe(
      'https://fallback.example',
    );
  });
});
