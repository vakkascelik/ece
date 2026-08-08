import { describe, expect, it } from 'vitest';
import {
  assertNoFreeText,
  redactForModel,
  RedactionError,
  type ModelPayload,
} from '../redaction';

const LABELS = ['Feb-Mar 2026', 'Apr-May 2026'] as const;

const payload = (over: Partial<ModelPayload> = {}): ModelPayload => ({
  figures: { overdueCents: 245_500, breachMinutes: 0, complete: true, sleepInterval: null },
  ...over,
});

describe('redactForModel', () => {
  it('passes a payload of numbers, booleans and nulls', () => {
    const out = redactForModel(payload(), LABELS);
    expect(out.figures.overdueCents).toBe(245_500);
    expect(out.figures.sleepInterval).toBeNull();
  });

  it('freezes what it returns', () => {
    /*
      The mistake this prevents is not malice, it is order of operations: check the
      payload, then add the child's name to it. A frozen object makes that a runtime
      error at the point of the mistake rather than a disclosure at the point of the
      call.
    */
    const out = redactForModel(payload(), LABELS);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.figures)).toBe(true);
    expect(() => {
      (out.figures as Record<string, unknown>).childName = 'Tāne';
    }).toThrow();
  });

  it('refuses text in a figure, whatever the type says', () => {
    // Unreachable through the type; reachable through `any` at a JSON boundary, which
    // is exactly where this would happen.
    const smuggled = { figures: { childName: 'Tāne Smith' } } as unknown as ModelPayload;
    expect(() => redactForModel(smuggled, LABELS)).toThrow(RedactionError);
  });

  it('refuses a label outside the declared vocabulary', () => {
    expect(() => redactForModel(payload({ labels: ['Tāne Smith'] }), LABELS)).toThrow(
      RedactionError,
    );
  });

  it('does NOT echo the rejected value into the error', () => {
    /*
      An error message lands in a log, and a log is a third party one step removed —
      the same reasoning `actionError` records for Postgres messages quoting the value
      that violated a constraint.
    */
    try {
      redactForModel(payload({ labels: ['Tāne Smith, 12 Example St'] }), LABELS);
      throw new Error('should have refused');
    } catch (e) {
      expect((e as Error).message).not.toContain('Tāne');
      expect((e as Error).message).not.toContain('Example St');
    }
  });

  it('accepts a declared label', () => {
    expect(redactForModel(payload({ labels: ['Feb-Mar 2026'] }), LABELS).labels).toEqual([
      'Feb-Mar 2026',
    ]);
  });

  it('reports every problem, not just the first', () => {
    // A caller fixing one refusal at a time round-trips for as long as they have
    // mistakes. Naming them all is the difference between one fix and four.
    const bad = {
      figures: { a: 'text', b: NaN, 'contact@example.com': 1 },
    } as unknown as ModelPayload;
    try {
      assertNoFreeText(bad, LABELS);
      throw new Error('should have refused');
    } catch (e) {
      expect((e as RedactionError).problems.length).toBeGreaterThanOrEqual(3);
    }
  });

  describe('the shapes that must never leave', () => {
    const cases: Array<[string, string]> = [
      ['an email address', 'parent@example.com'],
      ['an NZ mobile', '021 555 1234'],
      ['an NZ mobile with country code', '+64 21 555 1234'],
      ['a date of birth', '2022-04-17'],
      ['an NSN', '123456789'],
      ['a child id', '11111111-1111-4111-8111-111111111111'],
    ];

    for (const [what, value] of cases) {
      it(`refuses ${what} in a label`, () => {
        // Declared as allowed AND still refused — the vocabulary check is not the only
        // gate, because a developer can declare a vocabulary carelessly.
        expect(() => redactForModel(payload({ labels: [value] }), [value])).toThrow(
          RedactionError,
        );
      });

      it(`refuses ${what} in a figure NAME`, () => {
        const bad = { figures: { [value]: 1 } } as ModelPayload;
        expect(() => redactForModel(bad, LABELS)).toThrow(RedactionError);
      });
    }
  });

  it('refuses NaN and Infinity, which are a bug rather than a figure', () => {
    // A model asked to explain NaN will invent a reason for it, confidently.
    expect(() => redactForModel({ figures: { x: NaN } }, LABELS)).toThrow(RedactionError);
    expect(() => redactForModel({ figures: { x: Infinity } }, LABELS)).toThrow(RedactionError);
  });

  it('lets an ordinary money figure through untouched', () => {
    // The guard must not be so wide that real payloads cannot be built. $2,455.00 in
    // cents is six digits and must not trip the NSN net, which starts at nine.
    expect(redactForModel({ figures: { cents: 245_500 } }, LABELS).figures.cents).toBe(245_500);
  });
});
