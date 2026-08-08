/**
 * What a call costs, and when to stop making them.
 *
 * Pure, so the cap can be tested without a network and without a key. `packages/ai`
 * decides *whether* to call; this decides what that decision costs and when the answer
 * becomes no.
 */

/**
 * Claude Opus 5, US dollars per million tokens, as published on 2026-08-09.
 *
 * **A price list in code is a figure nobody here has re-checked since.** It is not read
 * from an invoice and it will be wrong the day Anthropic changes it — which is why
 * everything derived from it is named an *estimate*, in the column, in the type, and on
 * screen. Recorded in `unverified-claims`.
 */
export const OPUS_5_PRICING = { inputPerMTokUsd: 5, outputPerMTokUsd: 25 } as const;

/**
 * Cents this call probably cost, rounded **up**.
 *
 * Up rather than to-nearest, and the direction is the point: this figure only ever
 * decides whether to *refuse* the next call. Rounding down would let a centre drift past
 * a cap it set, one hundredth of a cent at a time, and the failure would be invisible
 * until the bill arrived. `toHours` floors for the mirror-image reason — under-claiming
 * the Crown is conservative — and the shared rule is that the estimate errs against the
 * party doing the estimating.
 */
export function estimateCents(
  inputTokens: number,
  outputTokens: number,
  pricing: { inputPerMTokUsd: number; outputPerMTokUsd: number } = OPUS_5_PRICING,
): number {
  const usd =
    (inputTokens / 1_000_000) * pricing.inputPerMTokUsd +
    (outputTokens / 1_000_000) * pricing.outputPerMTokUsd;
  return Math.ceil(usd * 100);
}

/**
 * What a centre may spend on this in a month, in cents.
 *
 * NZ$20. A constant rather than a per-centre column, deliberately: a column needs a
 * migration, a grant, a form field and a support conversation, and nobody has yet asked
 * for a different number. It exists to catch a loop, not to ration ordinary use — a
 * narrative report is a few cents, so this is hundreds of them.
 *
 * When a centre asks for a different figure, that is the moment it becomes a column.
 */
export const MONTHLY_CAP_CENTS = 2_000;

export type SpendVerdict =
  | { allowed: true; spentCents: number; remainingCents: number }
  | { allowed: false; reason: 'disabled' | 'cap-reached'; spentCents: number };

/**
 * May this centre make another call?
 *
 * Checked **before** the call, against what has already been recorded. Two refusals,
 * and they are different sentences to a reader: the centre has not turned the feature
 * on, or it has and has spent the month's allowance.
 *
 * The cap is checked against spend *so far*, not spend plus an estimate of this call —
 * the size of a response is not knowable in advance, and a cap that guessed would refuse
 * calls that would have fitted. The consequence is that the final call of a month may
 * cross the line by its own cost. That is a few cents and it is the right trade against
 * refusing on a guess.
 */
export function checkSpend(input: {
  aiFeatures: boolean;
  spentCents: number;
  capCents?: number;
}): SpendVerdict {
  const cap = input.capCents ?? MONTHLY_CAP_CENTS;

  // Checked first: a centre that has not turned this on should be told that, not told
  // it has run out of an allowance it never asked for.
  if (!input.aiFeatures) return { allowed: false, reason: 'disabled', spentCents: input.spentCents };

  if (input.spentCents >= cap) {
    return { allowed: false, reason: 'cap-reached', spentCents: input.spentCents };
  }

  return {
    allowed: true,
    spentCents: input.spentCents,
    remainingCents: cap - input.spentCents,
  };
}
