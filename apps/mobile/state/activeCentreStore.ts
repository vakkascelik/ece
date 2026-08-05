import * as SecureStore from 'expo-secure-store';

/**
 * Which centre this device was last looking at.
 *
 * WHY IT IS PERSISTED AT ALL
 *
 * It was not, and that was a defect. `activeCentre` lived in plain `useState`, so a manager of
 * two sites re-picked the centre on **every cold start** — including the one at 7.25am with a
 * queue of parents at the door, on the screen whose entire premise is one tap from cold.
 *
 * WHY IT IS A PREFERENCE AND NEVER A GRANT
 *
 * The same rule the web app applies to its `ece_centre` cookie: a stored value is a hint about
 * what to show first, and it is re-checked against live memberships on every identity read. A
 * value that does not match a current membership is discarded, not trusted.
 *
 * That is not the security boundary — RLS is, and a forged value would return nothing anyway.
 * It is so that a revoked educator gets a comprehensible screen instead of an empty roll for a
 * centre they no longer belong to.
 *
 * WHY SECURE STORE RATHER THAN ASYNC STORAGE
 *
 * Not because a centre id is a secret; it is a UUID. Because the session already lives in
 * SecureStore (`lib/secureStorage.ts`), and putting the two halves of "who is looking at what"
 * in two different stores means two things that can disagree after a restore or a reinstall.
 * One store, one lifetime.
 *
 * A centre id is well under the 2048-byte SecureStore limit, so this needs none of the chunking
 * the session storage does.
 */

const KEY = 'ece.activeCentreId';

export async function readActiveCentre(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // A keystore that will not read is not a reason to fail launching. The caller falls back to
    // asking which centre, which is the same screen a first-time user sees.
    return null;
  }
}

export async function writeActiveCentre(centreId: string | null): Promise<void> {
  try {
    if (centreId === null) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, centreId);
  } catch {
    // Losing the preference costs one tap next launch. Failing the sign-in or the centre switch
    // over it would cost the whole session.
  }
}
