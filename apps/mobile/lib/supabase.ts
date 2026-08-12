import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { secureStorage } from './secureStorage';

/**
 * Supabase client for the mobile app.
 *
 * Only ever the anon key. Expo inlines every `EXPO_PUBLIC_*` value into the
 * shipped binary, so anything put here is readable by anyone who downloads the
 * app and unzips it. The service-role key would hand a stranger every centre's
 * children — it must never appear in this workspace.
 *
 * Which is the argument for enforcing tenancy in Postgres rather than in the
 * client: a mobile client cannot be trusted to filter, because a mobile client
 * can be modified.
 */

/**
 * THE VALUE IS PASSED IN. LOOKING IT UP BY NAME IS WHY THIS APP COULD NEVER BE BUILT.
 *
 * This read `(process.env as any)[name]` — a computed access — and Metro only substitutes
 * **static** `process.env.EXPO_PUBLIC_X` member expressions. A dynamic lookup is invisible to the
 * bundler, so nothing was ever inlined, and in a release binary `process.env` holds none of these.
 * Every built app therefore threw `Missing EXPO_PUBLIC_SUPABASE_URL` at module load and died before
 * a screen rendered, whatever the build environment was set to.
 *
 * It survived because the only way this app had ever been run is a dev server, which populates
 * `process.env` at runtime — so the dynamic form works in development and **only** in development.
 * The first AAB ever produced from this repo is what exposed it: the bundle contained the variable
 * NAME as a string and neither value, which is the signature of exactly this mistake. Confirmed by
 * exporting locally with both variables set and finding them still absent.
 *
 * So the name is now only for the error message, and the value arrives as a static expression the
 * bundler can see and replace. `push.ts` and `SettingsScreen.tsx` already read theirs statically and
 * were never affected.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local at the repo root.`);
  return value;
}

export const supabase = createClient(
  required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  {
    auth: {
      // React Native has no localStorage, so the store is explicit. Encrypted
      // rather than AsyncStorage: this token authorises reads of children's
      // records, and AsyncStorage is a plain file on disk.
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      // No URL to parse on native, and leaving this on makes Supabase look for
      // one and warn on every cold start.
      detectSessionInUrl: false,
    },
  },
);
