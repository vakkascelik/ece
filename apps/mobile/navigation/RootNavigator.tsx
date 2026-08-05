import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { color, space, theme } from '../theme';
import { useSession } from '../state/SessionProvider';
import { SignInScreen } from '../screens/SignInScreen';
import { NoAccessScreen } from '../screens/NoAccessScreen';
import { ChooseCentreScreen } from '../screens/ChooseCentreScreen';
import { StaffTabs } from './StaffTabs';
import { WhanauTabs } from './WhanauTabs';

/**
 * What is on screen, decided in one place.
 *
 * THE ORDER OF THESE CHECKS IS THE SAME AS THE WEB APP'S
 *
 * `apps/web/src/lib/auth.ts` resolves: no session → login; no membership → no-access; a centre
 * cookie that no live membership backs → discard it; one membership → auto-select; more than one
 * → ask. Mobile has to reach the same answers or the two surfaces disagree about who somebody is,
 * and the person holding both a phone and a laptop is the one who notices.
 *
 * This is a conditional render rather than a stack with guards. A guard that navigates on a state
 * change gives two sources of truth about which screen is showing — and the failure mode is a
 * signed-out user still looking at a roll, on a shared tablet, which is the failure this app can
 * least afford.
 */
export function RootNavigator() {
  const { status, message, session, centres, activeCentre, isParent, retry } = useSession();

  if (status === 'loading') {
    return (
      <View style={[theme.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={color.accent} />
      </View>
    );
  }

  if (status === 'error') {
    // Recoverable, which it was not before: the old screen went to `error` and the only refresh
    // path never re-read the identity, so a transient failure at launch needed the app killed.
    return (
      <ScrollView contentContainerStyle={[theme.content, { flexGrow: 1, justifyContent: 'center' }]}>
        <Text style={theme.h1}>Could not start</Text>
        <Text style={[theme.error, { marginTop: space['3'] }]}>{message}</Text>
        <Pressable
          onPress={() => void retry()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{ marginTop: space['5'] }}
        >
          <Text style={{ color: color.accent, fontWeight: '600' }}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!session) return <SignInScreen />;
  if (centres.length === 0) return <NoAccessScreen />;
  if (!activeCentre) return <ChooseCentreScreen />;

  return (
    <NavigationContainer>{isParent ? <WhanauTabs /> : <StaffTabs />}</NavigationContainer>
  );
}
