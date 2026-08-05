import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from './state/SessionProvider';
import { RootNavigator } from './navigation/RootNavigator';

/**
 * The app: three providers and a navigator.
 *
 * This file was 416 lines and one component. It held eleven pieces of state, four effects, the
 * identity logic, the roll fetch, the feed fetch, the outbox flush and the entire render tree —
 * and it had no way to sign in, which is why nobody who installed it could use it.
 *
 * WHAT THE LAYERING IS FOR
 *
 * `SafeAreaProvider` is required by react-navigation and was missing entirely; the old code used
 * `react-native`'s `SafeAreaView`, which is iOS-only and does nothing about Android's status bar.
 *
 * `SessionProvider` sits **outside** the navigator on purpose. It owns the `onAuthStateChange` and
 * `AppState` subscriptions, and both must survive a tab change: put them in a screen and a shared
 * staffroom tablet keeps showing the previous educator's roll after they sign out, silently, with
 * no error to notice.
 *
 * `RootNavigator` decides what is on screen from one place — sign-in, no-access, choose-a-centre,
 * or the tabs — rather than screens navigating each other. On a device holding children's records,
 * two things that both believe they know whether somebody is signed in is one thing too many.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
