import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { color, font } from '../theme';
import { RollScreen } from '../screens/RollScreen';
import { PanuiScreen } from '../screens/PanuiScreen';
import { MessagesScreen } from '../screens/MessagesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();

/**
 * Staff: owner, manager, educator.
 *
 * **The roll is first and is the initial route**, because the app exists to be opened at 7.30 with
 * a parent at the door. Anything that makes the roll a destination rather than the home screen
 * costs a tap forty times a morning.
 *
 * No icons. A four-item tab bar with words is unambiguous, and an icon set is a design project
 * with an accessibility surface of its own — a picture of a clipboard means "roll" only to
 * somebody who already knows. `tabBarLabel` is what a screen reader announces either way.
 *
 * Deliberately absent: compliance, funding, invoices, people. Those are office work done sitting
 * down with a keyboard, they are on the web app, and an educator has no capability for them —
 * putting them here would be four tabs that refuse.
 */
export function StaffTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.inkMuted,
        tabBarLabelStyle: { fontSize: font.size.sm },
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.line },
      }}
    >
      <Tab.Screen name="Roll" component={RollScreen} options={{ tabBarLabel: 'Roll' }} />
      <Tab.Screen name="Panui" component={PanuiScreen} options={{ tabBarLabel: 'Posts' }} />
      <Tab.Screen name="Messages" component={MessagesScreen} options={{ tabBarLabel: 'Messages' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'Settings' }} />
    </Tab.Navigator>
  );
}
