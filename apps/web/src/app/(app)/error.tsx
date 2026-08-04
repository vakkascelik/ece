'use client';

import { useEffect } from 'react';
import { report } from '@/lib/observability';

/**
 * Boundary for the signed-in app.
 *
 * Keeps the shell — sidebar, centre name, sign out — so a failure on one screen does
 * not look like the whole product has fallen over, and the person can navigate
 * somewhere that works.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    report(error, { boundary: 'app' });
  }, [error]);

  return (
    <>
      <h1>This screen could not be shown</h1>
      <p className="sub">
        Nothing you had already saved is affected. This failed while reading, not while
        writing.
      </p>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Try again. If it keeps happening, tell us what you were doing
          {error.digest ? (
            <>
              {' '}
              and quote <code>{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </>
  );
}
