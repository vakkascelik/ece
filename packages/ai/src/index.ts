/**
 * @ece/ai — the only place this product talks to an external model provider.
 *
 * Server-only. It must never be imported from `packages/core` (which the mobile app
 * bundles) or from a client component: this module reads an API key, and anything a
 * browser or an Expo binary can reach is public. `check:bundle` is the tripwire — if
 * `first-load-js` moves after a change here, an import crossed a boundary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT WILL NOT DO
 *
 * It takes an already-redacted payload and returns prose. It does not read the
 * database, so it cannot widen what gets sent by fetching "just one more field", and it
 * has no tools — an agent with a Supabase connection would be a second write path
 * around RLS, and RLS is the security boundary.
 *
 * It also never decides anything. `assessRatio`, `overdueChecks` and `summariseArrears`
 * decide; this phrases. See `docs/claude-api-plan.md` §2 for why the reverse is refused.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTHING HERE HAS EVER RUN AGAINST THE REAL API
 *
 * There is no `ANTHROPIC_API_KEY` in this repo's environment, so every path below is
 * exercised against an injected fake and the live one is untested by construction.
 * Recorded in `unverified-claims` rather than implied by the code looking finished.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  estimateCents,
  redactForModel,
  type ModelPayload,
} from '@ece/core';

/** Which surface asked. A constant, never a label anybody types — it reaches the audit row. */
export type AiFeature = 'compliance-narrative' | 'accounts-narrative' | 'funding-variance';

export type AiOutcome = 'ok' | 'refused' | 'blocked' | 'error';

export interface AiResult {
  outcome: AiOutcome;
  /** The prose, when there is any. Always a draft for a person to check. */
  text: string | null;
  /** Why there is not, in a sentence a manager can read. */
  message: string | null;
  inputTokens: number;
  outputTokens: number;
  centsEstimate: number;
}

/**
 * The bit of the SDK this module uses, named so a test can supply it.
 *
 * A hand-written structural type rather than the SDK's own: the point is to make the
 * surface this product depends on visible in one place. It is two calls wide, and if it
 * ever grows past that, the growth is the thing to look at.
 */
export interface ModelClient {
  messages: {
    create(body: Record<string, unknown>): Promise<{
      stop_reason?: string | null;
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
}

/**
 * The real client, or null when there is no key.
 *
 * Null rather than throwing: a centre with the feature switched on and a deployment with
 * no key configured should see "not available", not a stack trace. The caller turns that
 * into a `blocked` audit row.
 */
export function modelClient(): ModelClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey }) as unknown as ModelClient;
}

export const MODEL = 'claude-opus-5';

/**
 * The instruction, held as a constant for two reasons.
 *
 * It is the **stable prefix** for prompt caching — it must come first and must not vary
 * per request, or nothing caches. And it is the sentence that decides whether output
 * reads as a finding or as a draft, which makes it worth reviewing in one place rather
 * than assembling per call site.
 */
const SYSTEM = [
  'You write short, plain summaries of figures for a New Zealand early childhood centre.',
  '',
  'You are given numbers this product already calculated. Explain what they show in two or',
  'three sentences a centre manager could put in a report, in New Zealand English.',
  '',
  'Rules that matter more than style:',
  '- Use only the numbers given. Do not estimate, extrapolate, or infer a figure that is absent.',
  '- If the numbers do not support a conclusion, say what they do show and stop.',
  '- Never state or imply that the centre is compliant, or in breach of any regulation.',
  '  You are not being given the rules, only the counts.',
  '- No headings, no bullet points, no preamble. Just the sentences.',
].join('\n');

/**
 * Ask for a summary of figures that have already been redacted.
 *
 * `allowedLabels` is the caller's declared vocabulary — the only text permitted out, and
 * checked rather than trusted. `redactForModel` throws if the payload could carry a
 * name; that throw is deliberately **not** caught here, because a caller that built an
 * unsafe payload has a bug and should see it, not get a polite `blocked`.
 */
export async function summariseFigures(input: {
  client: ModelClient;
  payload: ModelPayload;
  allowedLabels: readonly string[];
  question: string;
}): Promise<AiResult> {
  const safe = redactForModel(input.payload, input.allowedLabels);

  const body = {
    model: MODEL,
    max_tokens: 16_000,
    // Cached: the instruction is identical on every call, so it is the prefix. The
    // figures come after it and vary, which is the order caching needs.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Adaptive is the default on Opus 5; stated anyway so a reader knows it was a
    // decision. `max_tokens` caps thinking and text together, hence the headroom above.
    thinking: { type: 'adaptive' },
    // Summarising figures is not intelligence-sensitive. Swept downward on purpose.
    output_config: { effort: 'medium' },
    messages: [
      {
        role: 'user',
        content: `${input.question}\n\n${JSON.stringify(safe)}`,
      },
    ],
  };

  let response: Awaited<ReturnType<ModelClient['messages']['create']>>;
  try {
    response = await input.client.messages.create(body);
  } catch {
    /*
      A network failure, a rate limit, or a rejected request.

      The provider's own message is deliberately dropped rather than passed through: an
      API error quotes the offending request back, and the request contains the centre's
      figures. Same reasoning as `actionError.ts`, which exists because Postgres does the
      identical thing with the value that violated a constraint.

      Zero tokens, because none were billed — a failed request that recorded an estimate
      would make the spend cap refuse calls for spend that never happened.
    */
    return {
      outcome: 'error',
      text: null,
      message: 'The summary could not be generated just now. The figures above are unaffected.',
      inputTokens: 0,
      outputTokens: 0,
      centsEstimate: 0,
    };
  }

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const centsEstimate = estimateCents(inputTokens, outputTokens);

  /*
    CHECKED BEFORE READING `content`, WHICH IS THE WHOLE REASON THIS BRANCH EXISTS.

    A refusal is an HTTP 200 with an empty `content` array. Code that reads
    `content[0].text` unconditionally does not throw — it renders `undefined` — so the
    failure would surface as a blank panel nobody could explain. Plausible here: a
    childcare product's figures sit next to incidents and injuries.
  */
  if (response.stop_reason === 'refusal') {
    return {
      outcome: 'refused',
      text: null,
      message: 'The model declined to summarise this. Nothing is wrong with your figures.',
      inputTokens,
      outputTokens,
      centsEstimate,
    };
  }

  const text = (response.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();

  if (!text) {
    return {
      outcome: 'error',
      text: null,
      message: 'The summary came back empty. The figures above are unaffected.',
      inputTokens,
      outputTokens,
      centsEstimate,
    };
  }

  return { outcome: 'ok', text, message: null, inputTokens, outputTokens, centsEstimate };
}
