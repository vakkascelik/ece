import { describe, expect, it } from 'vitest';
import { checkSpend, estimateCents, MONTHLY_CAP_CENTS, OPUS_5_PRICING } from '../modelSpend';

describe('estimateCents', () => {
  it('prices a realistic narrative call', () => {
    // ~2k in, ~1k out on Opus 5: $0.01 + $0.025 = $0.035 → 4 cents rounded up.
    expect(estimateCents(2_000, 1_000)).toBe(4);
  });

  it('rounds UP, never down', () => {
    /*
      The direction is the whole point. This figure only ever decides whether to refuse
      the next call, so rounding down lets a centre drift past its cap a hundredth of a
      cent at a time — invisibly, until the bill arrives.
    */
    expect(estimateCents(1, 1)).toBe(1);
    expect(estimateCents(0, 0)).toBe(0);
  });

  it('weights output more heavily than input, because the price list does', () => {
    expect(estimateCents(0, 1_000_000)).toBe(OPUS_5_PRICING.outputPerMTokUsd * 100);
    expect(estimateCents(1_000_000, 0)).toBe(OPUS_5_PRICING.inputPerMTokUsd * 100);
    expect(estimateCents(0, 1_000_000)).toBeGreaterThan(estimateCents(1_000_000, 0));
  });

  it('takes a price list, so a price change is data rather than a code change', () => {
    expect(estimateCents(1_000_000, 0, { inputPerMTokUsd: 1, outputPerMTokUsd: 1 })).toBe(100);
  });
});

describe('checkSpend', () => {
  it('allows a centre that has turned it on and spent nothing', () => {
    const v = checkSpend({ aiFeatures: true, spentCents: 0 });
    expect(v.allowed).toBe(true);
    expect(v.allowed && v.remainingCents).toBe(MONTHLY_CAP_CENTS);
  });

  it('refuses a centre that has NOT turned it on, and says so specifically', () => {
    // Not "you have run out" — a centre that never enabled this should not be told it
    // has exhausted an allowance it never asked for.
    const v = checkSpend({ aiFeatures: false, spentCents: 0 });
    expect(v).toMatchObject({ allowed: false, reason: 'disabled' });
  });

  it('checks the switch BEFORE the cap', () => {
    // Both conditions failing must report the switch, which is the one the reader can
    // act on and the one that is actually true.
    const v = checkSpend({ aiFeatures: false, spentCents: 99_999 });
    expect(v).toMatchObject({ allowed: false, reason: 'disabled' });
  });

  it('refuses at the cap, not merely past it', () => {
    expect(checkSpend({ aiFeatures: true, spentCents: MONTHLY_CAP_CENTS })).toMatchObject({
      allowed: false,
      reason: 'cap-reached',
    });
    expect(checkSpend({ aiFeatures: true, spentCents: MONTHLY_CAP_CENTS - 1 }).allowed).toBe(true);
  });

  it('takes an explicit cap, so a test does not depend on the constant', () => {
    expect(checkSpend({ aiFeatures: true, spentCents: 50, capCents: 50 })).toMatchObject({
      allowed: false,
      reason: 'cap-reached',
    });
  });

  it('reports spend even when refusing, so a screen can say how much', () => {
    expect(checkSpend({ aiFeatures: true, spentCents: 2_500 }).spentCents).toBe(2_500);
    expect(checkSpend({ aiFeatures: false, spentCents: 300 }).spentCents).toBe(300);
  });
});
