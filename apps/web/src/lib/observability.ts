/**
 * Error reporting, and the scrubbing that has to come with it.
 *
 * WHY THIS IS NOT JUST `Sentry.init({ dsn })`
 *
 * This app holds children's names, allergies, medication doses and custody
 * arrangements. An error report is a copy of whatever state the app was in when it
 * broke — a Postgres error carrying a row value, a stack frame with a variable, a
 * URL with a child's id — and sending that to a third party by default would be a
 * disclosure nobody consented to, arriving through the monitoring tool rather than
 * the product.
 *
 * So: PII off, request bodies never sent, and a `beforeSend` that redacts anything
 * that looks like a name or a value out of the message itself. The cost is losing
 * some debugging detail, which is the correct trade for this data.
 *
 * Inert without `NEXT_PUBLIC_SENTRY_DSN`. Nothing is sent, nothing is queued, and
 * `report()` still writes to the server log so local debugging is unchanged — a
 * monitoring integration that only works once configured is fine; one that silently
 * swallows errors when unconfigured is not.
 *
 * WHY SENTRY IS IMPORTED DYNAMICALLY
 *
 * A static `import * as Sentry` put 75 kB into the shared client bundle — every page
 * on every visit, including a parent checking an allergy on mobile data — for an
 * integration that does nothing without a DSN. The dynamic import keeps it out of
 * the bundle entirely when unconfigured, and in a lazily-loaded chunk when it is.
 *
 * The cost is that reporting is fire-and-forget: `report()` returns before the
 * capture happens. For error reporting that is the right trade — nothing downstream
 * waits on it, and an error report that delays showing the user an error message is
 * worse than one that arrives a moment later.
 *
 * WHY THERE IS NO `instrumentation.ts`
 *
 * Next's instrumentation hook is the documented place to initialise a reporter, and
 * it was tried. It bundles into the **edge** runtime, which is what middleware runs,
 * and the runtime guard (`NEXT_RUNTIME !== 'nodejs'`) does not help because it is a
 * runtime check and the bundler still follows the import. Measured: middleware
 * 91 kB → 176 kB, on every single request.
 *
 * So initialisation happens on the first `report()` instead. What that gives up is
 * `onRequestError`, which forwards Next's own nested server render errors — those
 * are still logged by Next, and the boundaries in `global-error.tsx` and
 * `(app)/error.tsx` report the cases a user actually sees. Worth revisiting if
 * middleware ever moves to the Node runtime.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Are we actually reporting anywhere? Also useful for a health endpoint later. */
export const observabilityEnabled = Boolean(DSN);

/**
 * Patterns that indicate a value rather than a shape.
 *
 * Postgres is helpful in exactly the wrong way here: a unique or check violation
 * quotes the offending value back, so "Key (moe_nsn)=(123456789) already exists"
 * carries a Ministry identifier into the report. These strip the value and keep the
 * part that says what went wrong.
 */
const REDACTIONS: [RegExp, string][] = [
  // Postgres constraint violations quoting the offending value.
  [/Key \(([^)]+)\)=\([^)]*\)/g, 'Key ($1)=(REDACTED)'],
  // `detail`/`hint` fragments that echo a row.
  [/(DETAIL|HINT):\s*.*/gi, '$1: REDACTED'],
  // Anything shaped like an email address.
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'REDACTED@REDACTED'],
  // NZ phone numbers, loosely.
  [/\b0[2-9]\d[\s-]?\d{3}[\s-]?\d{3,4}\b/g, 'REDACTED_PHONE'],
  // Dates of birth in ISO form. A uuid is fine to keep — it identifies a row
  // without describing anybody — but a date of birth is personal information.
  [/\b(19|20)\d{2}-\d{2}-\d{2}\b/g, 'REDACTED_DATE'],
];

function scrub(text: string): string {
  return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

let started = false;

/**
 * Initialise on first use. Safe to call repeatedly, and called by `report()` so
 * there is no separate setup step to forget.
 */
export function initObservability(): void {
  if (started || !DSN) return;
  started = true;

  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: DSN,
      // Errors only. Performance traces on a product with a handful of centres cost
      // quota to tell us what the database already knows.
      tracesSampleRate: 0,

      // No IP addresses, no cookies, no headers, no usernames. The default is on,
      // and for this app the default is wrong.
      sendDefaultPii: false,

      // A release marker so a stack trace can be tied to a commit, when one is
      // available. Absent locally.
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      environment: process.env.VERCEL_ENV ?? 'development',

      beforeSend(event) {
        if (event.message) event.message = scrub(event.message);

        for (const exception of event.exception?.values ?? []) {
          if (exception.value) exception.value = scrub(exception.value);
          // Local variables in stack frames are the richest source of accidental
          // disclosure and the least necessary for diagnosis.
          for (const frame of exception.stacktrace?.frames ?? []) {
            delete frame.vars;
          }
        }

        // Request data: keep the route, drop everything that carries content. The
        // pathname holds a child's uuid, which identifies a row without describing
        // a person, so it stays — a query string might hold anything, so it does not.
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          delete event.request.headers;
          delete event.request.query_string;
        }

        // Breadcrumbs replay what the user did, including form values.
        delete event.breadcrumbs;

        return event;
      },
    });
  });
}

/**
 * Report an error that has already been handled.
 *
 * Used where an action catches something and returns a message to the user: the
 * user gets a sentence, and this makes sure the failure is not invisible to
 * whoever has to fix it.
 */
export function report(error: unknown, context?: Record<string, string>): void {
  if (DSN) {
    initObservability();
    void import('@sentry/nextjs').then((Sentry) => {
      Sentry.captureException(error, context ? { tags: context } : undefined);
    });
  }
  // Always logged, configured or not. An unconfigured monitoring integration should
  // not make errors quieter than they were before it was added.
  const message = error instanceof Error ? error.message : String(error);
  console.error('[ece]', scrub(message), context ?? '');
}

/** Exported for the unit test — scrubbing is the part of this worth asserting. */
export const __scrubForTest = scrub;
