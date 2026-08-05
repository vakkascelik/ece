import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space, target } from '../theme';

/**
 * An empty state, to the design pack's shape: one line of state at 18/600, one warm
 * sentence at 17/muted, and **at most one action**.
 *
 * Shared because the pack specifies three of these and they must not drift — the version
 * a parent meets on their first day (no tamariki linked) and the one they meet when the
 * feed is quiet should read as the same product. What they were before was a single line
 * of muted 15px text, which reads as a fault rather than as "nothing has happened yet".
 *
 * The action is optional and singular on purpose. An empty screen with three buttons is
 * asking somebody who has just arrived to make a decision they have no basis for.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; tone?: 'primary' | 'secondary' };
}) {
  const primary = action?.tone !== 'secondary';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action && (
        <Pressable
          style={[styles.button, primary ? styles.primary : styles.secondary]}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={[styles.label, primary ? styles.labelPrimary : styles.labelSecondary]}>
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space['5'] },
  title: {
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    color: color.ink,
    marginBottom: space['2'],
  },
  body: { fontSize: font.size.mobileBase, color: color.inkMuted, lineHeight: 24 },
  button: {
    // 56, the pack's comfortable target. Not 64: that is reserved for the primary action
    // on a screen somebody is trying to get past, which an empty state is not.
    minHeight: target.comfortable,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space['5'],
    paddingHorizontal: space['4'],
  },
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  label: { fontSize: font.size.mobileBase, fontWeight: font.weight.semibold },
  labelPrimary: { color: color.inkInverse },
  labelSecondary: { color: color.ink },
});
