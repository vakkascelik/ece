/**
 * Browser-side initialisation, before hydration.
 *
 * Unlike the server hook this one is safe: it is client-only, so nothing here can
 * reach the edge bundle that middleware runs. Still inert without a DSN, and the
 * Sentry SDK itself is dynamically imported — see lib/observability.ts.
 */
import { initObservability } from './lib/observability';

initObservability();
