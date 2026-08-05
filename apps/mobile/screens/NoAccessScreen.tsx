import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { color, font, radius, space, target, theme } from '../theme';
import { EmptyState } from '../components/EmptyState';
import { useSession } from '../state/SessionProvider';

/**
 * A working account with no centre.
 *
 * This is a **waiting room, not an error**, and the copy has to say so. It is the ordinary state
 * between an account existing and somebody adding it to a centre — which is a different person's
 * job, done at a different time. The web app takes the same line at `app/no-access/page.tsx`, and
 * the wording is deliberately close so a person who reaches it on both surfaces reads the same
 * explanation.
 *
 * It is also what a revoked educator sees, and that is correct without being said out loud: every
 * policy predicate joins a *live* membership, so revoking access ends it on the next request. A
 * screen that announced "your access was removed" would be a worse version of a conversation
 * their manager should be having with them.
 */
export function NoAccessScreen() {
  const { signOut, retry } = useSession();

  return (
    <ScrollView contentContainerStyle={[theme.content, styles.centre]}>
      {/*
        The pack's copy, and "Nau mai" is doing work here: this is the screen somebody
        reaches when everything went right and one other person has not finished their part.
        "Check again" calls `retry()` rather than doing nothing, because the thing that
        changes the answer happens on a different device and there is no push for it.
      */}
      <EmptyState
        title="Nau mai. No centre yet."
        body="Your invitation is still to be accepted by your centre."
        action={{ label: 'Check again', onPress: () => void retry(), tone: 'secondary' }}
      />

      <Text style={[theme.muted, styles.para]}>
        If you were using this app before, your access may have been changed. Your manager will
        know.
      </Text>

      <Pressable
        style={styles.button}
        onPress={() => void signOut()}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
      >
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flexGrow: 1, justifyContent: 'center' },
  para: { marginTop: space['3'] },
  button: {
    minHeight: target.comfortable,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space['6'],
  },
  buttonText: { color: color.ink, fontSize: font.size.mobileBase, fontWeight: '600' },
});
