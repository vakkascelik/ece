import { Pressable, StyleSheet, Text } from 'react-native';
import { color, font, radius, space, target } from '../theme';

/**
 * The one control this whole app exists for.
 *
 * `target.primary` (64px) rather than the 44px floor, because it is tapped by
 * somebody with a child on one hip and a bag in the other hand. WCAG's 24px minimum
 * is a conformance floor and has nothing to say about that.
 *
 * Two labelled buttons, never a toggle. A mis-tap on a toggle silently records the
 * opposite of what happened, and attendance times decide funded hours.
 *
 * No spinner and no disabled state while it saves. The write goes to a local queue
 * and returns immediately, so there is nothing to wait for — a spinner here would be
 * theatre, and a disabled button would make a working app feel broken on a bad
 * connection. The pending badge on the card carries the "not sent yet" information.
 */
export function SignInButton({
  present,
  onPress,
  childName,
}: {
  present: boolean;
  onPress: () => void;
  childName: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={present ? `Sign ${childName} out` : `Sign ${childName} in`}
      style={({ pressed }) => [
        styles.base,
        present ? styles.out : styles.in,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, present ? styles.outLabel : styles.inLabel]}>
        {present ? 'Sign out' : 'Sign in'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: target.primary,
    minWidth: 120,
    paddingHorizontal: space['5'],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  in: { backgroundColor: color.accent, borderColor: color.accent },
  out: { backgroundColor: color.surface, borderColor: color.line },
  // No opacity fade: on a sunlit tablet a 0.7 alpha is invisible. A visible border
  // change is feedback somebody can actually see outdoors.
  pressed: { borderColor: color.ink },
  label: { fontSize: font.size.lg, fontWeight: font.weight.semibold },
  inLabel: { color: color.inkInverse },
  outLabel: { color: color.ink },
});
