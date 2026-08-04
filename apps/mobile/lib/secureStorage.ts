import * as SecureStore from 'expo-secure-store';

/**
 * Encrypted session storage for Supabase auth, backed by the device keystore.
 *
 * StoreDash (shop-admin-app) already uses expo-secure-store rather than
 * AsyncStorage, and that choice matters more here than it does for a shop.
 * AsyncStorage is an unencrypted file: on a rooted or jailbroken device, or one
 * restored from an unencrypted backup, anything in it is readable. The token
 * stored here authorises reads of children's records — names, health notes,
 * custody arrangements — so it belongs in the keystore.
 *
 * SecureStore caps a value at 2048 bytes and Supabase sessions can exceed that
 * once a JWT carries a few custom claims. Rather than fail at some future point
 * with a confusing error mid-login, values are chunked across numbered keys.
 */

const CHUNK = 1800; // headroom under the 2048-byte platform limit
const COUNT_SUFFIX = '__chunks';

const countKey = (key: string) => `${key}${COUNT_SUFFIX}`;
const chunkKey = (key: string, i: number) => `${key}__${i}`;

async function clearChunks(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const count = raw ? Number(raw) : 0;
  if (!Number.isFinite(count) || count <= 0) return;
  await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))),
  );
  await SecureStore.deleteItemAsync(countKey(key));
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const raw = await SecureStore.getItemAsync(countKey(key));
    if (!raw) return SecureStore.getItemAsync(key);

    const count = Number(raw);
    if (!Number.isFinite(count) || count <= 0) return null;

    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i))),
    );
    // A missing chunk means a partial write or a partial wipe. Returning the
    // surviving fragments would hand Supabase a corrupt session and produce a
    // parse error at an unhelpful moment; treating it as absent forces a clean
    // re-login, which is the recoverable outcome.
    if (parts.some((p) => p === null)) {
      await clearChunks(key);
      return null;
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    await clearChunks(key);

    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    // Large value: remove any single-key leftover so getItem cannot read a
    // stale short session in preference to the chunked one.
    await SecureStore.deleteItemAsync(key);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));

    await Promise.all(chunks.map((part, i) => SecureStore.setItemAsync(chunkKey(key, i), part)));
    // Written last, so an interrupted write leaves no count and getItem falls
    // back to "absent" rather than reconstructing a truncated token.
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};
