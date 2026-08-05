/**
 * The one password rule, shared by every screen that sets one: accepting an
 * invitation, changing a password, and resetting a forgotten one. Three copies
 * of "at least 10" is how one screen ends up accepting 8.
 *
 * Length over composition rules. NIST dropped the mixed-character advice years
 * ago because it produces Password1! and nothing else.
 */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 10) {
    return 'Use at least 10 characters. Longer is better than more symbols.';
  }
  if (password !== confirm) return 'Those two passwords do not match.';
  return null;
}
