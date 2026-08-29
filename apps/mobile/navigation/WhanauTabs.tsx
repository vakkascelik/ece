import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { POST_KIND_LABELS } from '@ece/core';
import { color, font } from '../theme';
import { TamarikiScreen } from '../screens/TamarikiScreen';
import { ChildScreen } from '../screens/ChildScreen';
import { PanuiScreen } from '../screens/PanuiScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

export type TamarikiStackParams = {
  Tamariki: undefined;
  Child: { childId: string; name: string };
};

/**
 * A parent's children, then one of them.
 *
 * The only stack in the app. Everything a staff member does is on one screen by design; a parent
 * genuinely needs a second level, because the list of their children and the detail of one child
 * are different things and a family with three children should not scroll three full records.
 */
function TamarikiStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: true, headerTintColor: color.accent }}>
      <Stack.Screen
        name="Tamariki"
        component={TamarikiScreen}
        options={{ title: 'Your tamariki' }}
      />
      <Stack.Screen
        name="Child"
        component={ChildScreen}
        // The child's own name in the header, because a parent with three children needs to know
        // which record they are looking at before they read anything on it.
        options={({ route }) => ({ title: (route.params as TamarikiStackParams['Child']).name })}
      />
    </Stack.Navigator>
  );
}

/**
 * Whānau.
 *
 * **No roll and no ratio.** A parent has no `recordDailyPractice` capability, so those screens
 * would refuse — and the ratio is a compliance figure about the centre's staffing, not information
 * a family is owed on a phone. The policies would stop them regardless; not offering it is the
 * difference between a locked door and no door.
 *
 * **No compliance, funding, or people**, for the same reason.
 *
 * Tamariki is the initial route: the child is what a parent opened the app for.
 */
export function WhanauTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.inkMuted,
        tabBarLabelStyle: { fontSize: font.size.sm },
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.line },
        // PROBE, NOT A FIX — delete it if versionCode 6 still shows the box.
        // Every tab label on versionCode 4 rendered with a missing-glyph box above it.
        // It is not a JS placeholder: the installed `BottomTabItem` does
        // `if (icon === undefined) return null`, and no icon is given here. `✓` and `·`
        // render correctly on the same screen, so it is not a font gap either. The suspect
        // is the native Android tab bar via react-native-screens 4.x reserving a slot
        // regardless. An explicit `() => null` is the one cheap test, and it can only be
        // answered by a build — which is why it is riding this one.
        // Watch for the opposite failure: supplying the function makes `icon !== undefined`,
        // so the JS path now renders an empty icon container. If the box goes away but the
        // labels sit lower, that is this line, not the bug.
        tabBarIcon: () => null,
      }}
    >
      <Tab.Screen
        name="TamarikiStack"
        component={TamarikiStack}
        options={{ tabBarLabel: 'Tamariki' }}
      />
      <Tab.Screen
        name="Panui"
        component={PanuiScreen}
        // The macron is not optional: `panui` without one is a different word.
        options={{ tabBarLabel: POST_KIND_LABELS.panui }}
      />
      <Tab.Screen name="Messages" component={MessagesScreen} options={{ tabBarLabel: 'Messages' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}
