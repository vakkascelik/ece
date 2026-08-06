/**
 * Did this session come from a recovery link, or from somebody typing a password?
 *
 * WHY THIS EXISTS
 *
 * `/reset-password` used to check only "is there a signed-in user" and then call
 * `updateUser({ password })`, which GoTrue accepts on session authority alone. So anyone who
 * walked up to an unlocked, signed-in browser could set a new password **without knowing the old
 * one**, and the `signOut({ scope: 'others' })` that follows would lock the real owner out of every
 * other device. `/account` demands the current password for exactly that reason, and this repo has
 * a recorded note rejecting the weaker design in those words — the route contradicted it.
 *
 * WHY A CLAIM AND NOT A COOKIE
 *
 * The first design was a short-lived cookie set by `/auth/confirm` on a successful exchange. It
 * would have worked against a script and not against the actual threat: `httpOnly` stops
 * JavaScript, not a person with devtools open on the machine they are already sitting at, who can
 * add a cookie by hand. The gate has to be something they cannot mint.
 *
 * So it is a claim inside the access token, which GoTrue signs. MEASURED rather than assumed, by
 * creating a throwaway user and comparing the two tokens:
 *
 *   password sign-in : amr = [{ method: 'password', timestamp: … }]
 *   recovery link     : amr = [{ method: 'otp',      timestamp: … }]
 *
 * and the two sessions have different `session_id`s, so a recovery link is a new session rather
 * than a re-labelling of the one already in the browser.
 *
 * THE RULE IS AN ABSENCE, NOT A PRESENCE
 *
 * "was not established with a password" rather than "was established with otp". A future GoTrue
 * version, or a login method this app does not have yet, could introduce another mailbox-proving
 * method — and the safe default is that anything new is allowed to reset, while a password session
 * is not. An MFA session is `[password, totp]`, which contains `password`, so it is correctly
 * refused: holding a second factor does not substitute for knowing the current password.
 */

interface AmrEntry {
  method?: string;
}

/**
 * The authentication methods recorded in an access token.
 *
 * Decoding without verifying is safe **only because the caller has already validated the same
 * token with `auth.getUser()`**, which asks GoTrue whether it is genuine and unexpired. Reading a
 * claim out of a token nobody validated would be trusting the client. Callers must do both, and
 * `describeResetEligibility` below is the shape that makes that hard to get wrong.
 */
export function amrMethods(accessToken: string): string[] {
  const payload = accessToken.split('.')[1];
  if (!payload) return [];
  try {
    // `base64url`, not `base64`: a JWT segment uses `-` and `_`, and Buffer's plain base64 decoder
    // silently produces different bytes for a token containing either.
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      amr?: AmrEntry[];
    };
    if (!Array.isArray(claims.amr)) return [];
    return claims.amr.map((entry) => entry.method).filter((m): m is string => typeof m === 'string');
  } catch {
    // A token this malformed is not a session anybody should be resetting a password from.
    return [];
  }
}

export function isRecoverySession(accessToken: string): boolean {
  const methods = amrMethods(accessToken);
  // An empty `amr` is refused rather than allowed. It means the token did not say how it was
  // obtained, and "we could not tell" must not open the one route that skips the current-password
  // check.
  return methods.length > 0 && !methods.includes('password');
}
