'use client';

import { useEffect } from 'react';
import { report } from '@/lib/observability';

/**
 * The last resort, for an error thrown outside any page's own boundary.
 *
 * There was no error boundary at all before this: an unhandled render error showed
 * Next's default screen, which in production is a bare "Application error" with no
 * way forward — on a screen an educator might be looking at while holding a child.
 *
 * Deliberately plain. This renders when something is already broken, so it must not
 * depend on anything that could also be broken: no data fetching, no shared layout,
 * no client state.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    report(error, { boundary: 'global' });
  }, [error]);

  return (
    <html lang="en-NZ">
      <body
        style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          background: '#fafaf9',
          color: '#1a1a1a',
          margin: 0,
          padding: '4rem 1.5rem',
        }}
      >
        <div style={{ maxWidth: '28rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#6b6b6b', lineHeight: 1.55 }}>
            The page could not be shown. Nothing you had already saved is affected — this
            failed while displaying, not while writing.
          </p>
          <p style={{ color: '#6b6b6b', lineHeight: 1.55 }}>
            Try again, and if it keeps happening tell us what you were doing
            {error.digest ? <> and quote <code>{error.digest}</code></> : null}.
          </p>
          <p>
            {/* A plain link, not router.refresh(): the router is part of what may be broken. */}
            <a href="/" style={{ color: '#2f6f4f' }}>
              Back to the start
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
