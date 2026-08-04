import { report, __scrubForTest as scrub } from './observability';

/**
 * Turn a caught error into something safe to show and impossible to miss.
 *
 * Every server action was doing `catch (e) { return { error: e.message } }`, which
 * has two problems:
 *
 *  - The failure was invisible to anybody who could fix it. The user saw a sentence
 *    and nothing was recorded.
 *  - Postgres messages quote the offending value back. "Key (centre_id,
 *    moe_nsn)=(867e…, 123456789) already exists" puts a Ministry identifier on
 *    screen, and a check violation can put a child's name there. Harmless when the
 *    person reading it is the manager who typed it; not harmless in a screenshot in
 *    a support email, or on a screen in a room with parents in it.
 *
 * So the message is scrubbed with the same patterns used before anything is sent to
 * Sentry. Same rules for the screen as for a third party — the reasoning that made
 * them right in one place makes them right in both.
 */
export function actionError(error: unknown, action: string): { error: string } {
  report(error, { action });
  const raw = error instanceof Error ? error.message : String(error);
  return { error: scrub(raw) };
}
