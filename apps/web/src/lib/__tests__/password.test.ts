import { describe, expect, it } from 'vitest';
import { passwordProblem } from '../password';

describe('passwordProblem', () => {
  it('rejects fewer than 10 characters', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 10/);
    expect(passwordProblem('123456789', '123456789')).toMatch(/at least 10/);
  });

  it('rejects a mismatched confirmation', () => {
    expect(passwordProblem('long enough now', 'long enough noW')).toMatch(/do not match/);
  });

  it('accepts ten characters that match', () => {
    expect(passwordProblem('1234567890', '1234567890')).toBeNull();
  });

  // Length is the only rule on purpose: composition requirements produce
  // Password1! and nothing else. A passphrase with spaces must survive.
  it('imposes no composition rules', () => {
    expect(passwordProblem('correct horse battery', 'correct horse battery')).toBeNull();
  });
});
