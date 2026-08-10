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
 * The action is singular on purpose. An empty screen with three buttons is asking somebody
 * who has just arrived to make a decision they have no basis for.
 *
 * `action` IS REQUIRED, AND SOMETIMES IT IS A SENTENCE
 *
 * The design handover asks for it to be required, so that every empty state names what
 * happens next rather than the absence — "No posts yet" is a dead end.
 *
 * It is required, and it is a union rather than a button. Two of the three screens using
 * this have nothing a reader can press: there is no control that makes a kaiako post, and
 * none that enrols a child from a parent's phone. A required button would have put one there
 * anyway, which is how a screen comes to offer something that does not work — and the pack's
 * own note on Pānui already refused exactly that.
 *
 * So `{ label, onPress }` when there is something to do, and `{ next }` when there is not.
 * `next` is still an answer to "what happens now"; it is just an answer the reader does not
 * have to act on. What neither may be is a promise this product does not keep: the handover's
 * suggested wording — "you'll get a notification" — is **not true here**, because push has
 * never run on a real device and is in `unverified-claims`.
 */
type EmptyAction =
  | { label: string; onPress: () => void; tone?: 'primary' | 'secondary' }
  /** What will happen without the reader doing anything. Must be true. */
  | { next: string };

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: EmptyAction;
}) {
  if ('next' in action) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {/*
          Not a disabled button and not a greyed one. There is nothing to press, and drawing
          something that looks pressable and is not is worse than drawing nothing.
        */}
        <Text style={styles.next}>{action.next}</Text>
      </View>
    );
  }

  const primary = action.tone !== 'secondary';

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
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
  /* In ink rather than muted: it is the answer to the question the screen raises, so it
     should not read as the smallest print on a screen that is already nearly empty. */
  next: {
    fontSize: font.size.mobileBase,
    color: color.ink,
    lineHeight: 24,
    marginTop: space['4'],
  },
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
