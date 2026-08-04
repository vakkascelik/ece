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

function required(name: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (process.env as any)[name] as string | undefined;
  if (!value) throw new Error(`Missing ${name}. Set it in .env.local at the repo root.`);
  return value;
}

export const supabase = createClient(
  required('EXPO_PUBLIC_SUPABASE_URL'),
  required('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
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
