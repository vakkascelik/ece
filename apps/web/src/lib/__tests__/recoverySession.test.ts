import { describe, expect, it } from 'vitest';
import { amrMethods, isRecoverySession } from '../recoverySession';

/**
 * Tokens are built here rather than fetched, but the two real shapes below were **measured** from
 * live GoTrue by creating a throwaway user, signing in with a password, and separately verifying a
 * recovery link: `password` gives `amr: [{ method: 'password' }]` and a recovery link gives
 * `amr: [{ method: 'otp' }]`. If that ever changes, these tests are describing the old world — the
 * probe is in the wiki entry for this fix.
 */
function token(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature-not-checked-here`;
}

const at = 1_786_045_907;

describe('isRecoverySession', () => {
  it('allows a session that came from a recovery link', () => {
    expect(isRecoverySession(token({ amr: [{ method: 'otp', timestamp: at }] }))).toBe(true);
  });

  it('refuses a session that came from a password', () => {
    // The defect. Anyone at an unlocked, signed-in browser could set a new password without
    // knowing the old one, then lock the real holder out of every other device.
    expect(isRecoverySession(token({ amr: [{ method: 'password', timestamp: at }] }))).toBe(false);
  });

  it('refuses an MFA session, because a second factor is not the current password', () => {
    // aal2 is [password, totp]. Holding a phone does not substitute for knowing the password, and
    // /account exists for this case.
    expect(
      isRecoverySession(
        token({ aal: 'aal2', amr: [{ method: 'password' }, { method: 'totp' }] }),
      ),
    ).toBe(false);
  });

  it('allows another mailbox-proving method it has not seen before', () => {
    // The rule is "not established with a password" rather than "established with otp", so a
    // method GoTrue adds later is allowed rather than silently locked out of password recovery.
    expect(isRecoverySession(token({ amr: [{ method: 'magiclink' }] }))).toBe(true);
    expect(isRecoverySession(token({ amr: [{ method: 'email' }] }))).toBe(true);
  });

  it('refuses a token that does not say how it was obtained', () => {
    // "We could not tell" must not open the one route that skips the current-password check.
    expect(isRecoverySession(token({ sub: 'u1' }))).toBe(false);
    expect(isRecoverySession(token({ amr: [] }))).toBe(false);
    expect(isRecoverySession(token({ amr: 'not-an-array' }))).toBe(false);
  });

  it('refuses a malformed token instead of throwing', () => {
    // An exception here would surface as a 500 on the reset page rather than a refusal.
    expect(isRecoverySession('')).toBe(false);
    expect(isRecoverySession('not.a.jwt')).toBe(false);
    expect(isRecoverySession('onlyonesegment')).toBe(false);
  });
});

describe('amrMethods', () => {
  it('decodes base64url, not plain base64', () => {
    // A JWT segment uses - and _ . Decoding with the plain base64 alphabet silently yields
    // different bytes, so a token containing either character would parse as garbage and the
    // session would be refused for the wrong reason.
    const claims = { amr: [{ method: 'otp' }], note: 'a?b?c>>>~~~ ÿ' };
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(encoded).not.toBe(Buffer.from(JSON.stringify(claims)).toString('base64'));
    expect(amrMethods(`h.${encoded}.s`)).toEqual(['otp']);
  });

  it('drops entries with no method rather than yielding undefined', () => {
    expect(amrMethods(token({ amr: [{ timestamp: at }, { method: 'otp' }] }))).toEqual(['otp']);
  });
});
