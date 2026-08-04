import { describe, expect, it } from 'vitest';
import { __scrubForTest as scrub } from '../observability';

/**
 * The scrubbing is the part of the Sentry integration worth testing, because a bug
 * here does not produce a wrong screen — it sends a child's medical information to a
 * third party. Every case below is a real message shape from this stack.
 */
describe('error report scrubbing', () => {
  it('strips the value out of a Postgres unique violation', () => {
    const raw =
      'duplicate key value violates unique constraint "children_nsn_unique_per_centre"\n' +
      'Key (centre_id, moe_nsn)=(867e9853-7436-4af1-bf10-2ba13861cea0, 123456789) already exists.';
    const clean = scrub(raw);
    expect(clean).not.toContain('123456789');
    // The constraint name survives, which is the part that says what went wrong.
    expect(clean).toContain('children_nsn_unique_per_centre');
  });

  it('drops DETAIL and HINT lines, which echo the row', () => {
    const raw =
      'new row violates check constraint\nDETAIL: Failing row contains (Anahera, Peanuts, anaphylaxis).';
    const clean = scrub(raw);
    expect(clean).not.toContain('Anahera');
    expect(clean).not.toContain('Peanuts');
  });

  it('redacts email addresses', () => {
    expect(scrub('could not invite hine.rangi@example.co.nz')).not.toContain('hine.rangi');
  });

  it('redacts New Zealand phone numbers', () => {
    expect(scrub('contact 021 555 0100 failed')).not.toContain('555 0100');
    expect(scrub('contact 0215550100 failed')).not.toContain('0215550100');
  });

  it('redacts dates of birth but keeps uuids', () => {
    const clean = scrub('child 867e9853-7436-4af1-bf10-2ba13861cea0 born 2023-04-11 rejected');
    expect(clean).not.toContain('2023-04-11');
    // A uuid identifies a row without describing a person, and it is what makes a
    // report actionable at all.
    expect(clean).toContain('867e9853-7436-4af1-bf10-2ba13861cea0');
  });

  it('leaves an ordinary message alone', () => {
    const raw = 'permission denied for table children';
    expect(scrub(raw)).toBe(raw);
  });
});
