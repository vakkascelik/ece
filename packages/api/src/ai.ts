/**
 * The usage record for external model calls: write one, and read what the month has
 * cost so far.
 *
 * This module does **not** call a model. `@ece/ai` does that and is not imported here —
 * `packages/api` is bundled by the mobile app, and an API key has no business being
 * reachable from a phone. The web app's server action calls both: this one to check and
 * to record, that one to ask.
 *
 * No tenant filtering, as everywhere here. `ai_requests_select` restricts reads to
 * owners and managers of the centre.
 */

import { fetchAll } from './paging';
import type { Db } from './index';

/** Mirrors `ai_requests.outcome`'s check constraint. Kept in sync by hand; 0049 is the source. */
export type AiRequestOutcome = 'ok' | 'refused' | 'blocked' | 'error';

export interface AiRequest {
  id: string;
  centreId: string;
  feature: string;
  model: string;
  requestedBy: string | null;
  inputTokens: number;
  outputTokens: number;
  centsEstimate: number;
  outcome: AiRequestOutcome;
  createdAt: string;
}

interface Row {
  id: string;
  centre_id: string;
  feature: string;
  model: string;
  requested_by: string | null;
  input_tokens: number;
  output_tokens: number;
  cents_estimate: number;
  outcome: AiRequestOutcome;
  created_at: string;
}

const COLUMNS =
  'id, centre_id, feature, model, requested_by, input_tokens, output_tokens, cents_estimate, outcome, created_at';

const toRequest = (r: Row): AiRequest => ({
  id: r.id,
  centreId: r.centre_id,
  feature: r.feature,
  model: r.model,
  requestedBy: r.requested_by,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  centsEstimate: r.cents_estimate,
  outcome: r.outcome,
  createdAt: r.created_at,
});

/**
 * Record that a call happened.
 *
 * Every outcome is recorded, including the ones where nothing left the building — a
 * `blocked` row is how a centre finds out the feature has been refusing all week because
 * somebody turned the switch off, and a table that only held successes could not answer
 * that. Zero-cost rows are cheap; a silent refusal is not.
 *
 * Append-only in the database, so there is no update counterpart and there never will be.
 */
export async function recordAiRequest(
  db: Db,
  input: {
    centreId: string;
    feature: string;
    model: string;
    requestedBy: string | null;
    inputTokens: number;
    outputTokens: number;
    centsEstimate: number;
    outcome: AiRequestOutcome;
  },
): Promise<AiRequest> {
  const { data, error } = await db
    .from('ai_requests')
    .insert({
      centre_id: input.centreId,
      feature: input.feature,
      model: input.model,
      requested_by: input.requestedBy,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cents_estimate: input.centsEstimate,
      outcome: input.outcome,
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`recordAiRequest: ${error.message}`);
  return toRequest(data as Row);
}

/**
 * What this centre has spent this calendar month, in cents.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MONTH BOUNDARY IS THE CENTRE'S, NOT UTC's
 *
 * `fromIso` is computed by the caller from the centre's timezone, for the reason
 * `localDates.test.ts` enforces everywhere else: a centre in Auckland asking on the 1st
 * at 9am is thirteen hours into a UTC month that started yesterday, and a cap that used
 * UTC would carry December's spend into January for half a day. This function takes the
 * boundary rather than computing one, so there is exactly one place that knows how.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PAGED, BECAUSE A MONTH IS NOT STRUCTURALLY BOUNDED
 *
 * The tempting argument is that the cap bounds the row count: NZ$20 at a few cents a
 * call is a few hundred rows, comfortably under PostgREST's 1000. **That argument is
 * false, and the way it fails matters.** A `blocked` row costs zero cents — the cap
 * refuses the call, records it, and the counter does not move. So a client looping
 * against a disabled feature writes rows for free, without limit, and this read is the
 * one the cap itself depends on.
 *
 * Truncated at 1000, it would return a spend *lower* than the truth, which re-allows
 * calls the cap should refuse. A silent under-count in the direction of spending more
 * money is exactly the failure `paging.ts` was written for.
 */
export async function readMonthSpendCents(
  db: Db,
  centreId: string,
  fromIso: string,
): Promise<number> {
  const rows = await fetchAll<{ cents_estimate: number }>('readMonthSpendCents', (a, b) =>
    db
      .from('ai_requests')
      .select('cents_estimate')
      .eq('centre_id', centreId)
      .gte('created_at', fromIso)
      .order('created_at', { ascending: true })
      .range(a, b),
  );

  return rows.reduce((sum, r) => sum + (r.cents_estimate ?? 0), 0);
}

/**
 * The most recent calls, for the settings screen.
 *
 * Bounded by `limit` rather than paged: this is a "what has been happening" list, not a
 * report, and a manager who needs the full history has the CSV export. Structural
 * reason, recorded in `bounded-queries.test.ts`.
 */
export async function listAiRequests(
  db: Db,
  centreId: string,
  limit = 50,
): Promise<AiRequest[]> {
  const { data, error } = await db
    .from('ai_requests')
    .select(COLUMNS)
    .eq('centre_id', centreId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listAiRequests: ${error.message}`);
  return (data ?? []).map((r) => toRequest(r as Row));
}
