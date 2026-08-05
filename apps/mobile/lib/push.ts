import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Db } from '@ece/api';

/**
 * Registering this device to receive notifications.
 *
 * WHAT IS NOT VERIFIED
 *
 * None of this has ever run. Expo push needs a token from a real build on a real device, and this
 * project has not been through EAS. The code below is written from the documented API; it
 * typechecks and it bundles, and that is all that can honestly be claimed.
 *
 * Recorded in llm-wiki/wiki/unverified-claims.md alongside the airplane-mode drill, because a
 * thing that looks finished and has never executed once is worth naming rather than discovering.
 *
 * WHY IT FAILS QUIETLY
 *
 * Every failure path returns a reason instead of throwing. A parent whose notification permission
 * is off, or who is on a simulator, must still get a working app — losing the roll because push
 * could not be set up would be a much worse bug than not having push.
 */

export type RegisterOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: 'no-device' | 'denied' | 'no-project-id' | 'failed'; detail?: string };

/**
 * Android needs a channel to exist before anything can be delivered to it.
 *
 * Created with `HIGH` importance but no sound override, because these are notices about a child's
 * day, not alarms. A default channel that pings loudly is one a parent silences, which costs the
 * messages that mattered.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Centre updates',
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export async function registerForPush(db: Db): Promise<RegisterOutcome> {
  // A simulator cannot receive push. Worth distinguishing from a refusal, because the two need
  // different explanations to whoever is looking at the screen.
  if (!Device.isDevice) return { ok: false, reason: 'no-device' };

  try {
    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return { ok: false, reason: 'denied' };

    // Present in an EAS build; absent when running bare. Named explicitly so the failure is
    // "this build has no project id" rather than a cryptic token error.
    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((globalThis as any).expo?.modules?.ExpoUpdates?.projectId as string | undefined);
    if (!projectId) return { ok: false, reason: 'no-project-id' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // The row belongs to a person, and the policy checks it. Without a session there is nothing to
    // register against, and failing here is better than writing a row that RLS will refuse.
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) return { ok: false, reason: 'failed', detail: 'no signed-in user' };

    // Upsert on the token, not on the user: a person has several devices, and re-registering the
    // same device must not create a second row that then receives duplicates.
    const { error } = await db
      .from('push_tokens')
      .upsert(
        {
          /*
           * `user_id` WAS MISSING, AND EVERY CALL WOULD HAVE FAILED.
           *
           * The column is `not null` with no default (`0017_notifications.sql:26`) and the row
           * policy carries `with check (user_id = auth.uid())`. Without this line the insert is
           * refused every single time — and nobody noticed, because this function has never
           * executed on a device.
           *
           * It is fixed rather than deleted even though nothing calls it in this build. A latent
           * bug in a dormant path is a bug that surfaces the day somebody enables it, by which
           * time the reasoning is gone. See `unverified-claims.md` item 5.
           */
          user_id: auth.user.id,
          token,
          platform: Platform.OS,
          last_seen: new Date().toISOString(),
          // Clears a previous disable, which is the point of re-registering after a token was
          // reported dead.
          disabled_at: null,
        },
        { onConflict: 'token' },
      );
    if (error) return { ok: false, reason: 'failed', detail: error.message };

    return { ok: true, token };
  } catch (err) {
    return { ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Forget this device.
 *
 * Called on sign-out. Without it, a shared staffroom tablet keeps receiving notifications for
 * whoever was signed in last — which on this app means notices about children a new user may have
 * no relationship to.
 */
export async function unregisterPush(db: Db): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await db.from('push_tokens').delete().eq('token', token);
  } catch {
    // Best effort. A device that cannot reach the server on sign-out is a device that will be
    // cleaned up when the token is next reported dead.
  }
}

/**
 * How notifications behave while the app is open.
 *
 * Banners are suppressed in the foreground: a parent already looking at the feed does not need a
 * notification telling them about the post they are reading. The badge still updates.
 */
export function configureForegroundBehaviour(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowList: true,
    }),
  });
}
