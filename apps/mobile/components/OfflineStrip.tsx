import { StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space } from '../theme';

/**
 * "Offline · 3 sign-ins waiting to send".
 *
 * Pending-blue, never amber, and that is the most important line in this file. A queued
 * write in a concrete-walled centre is **normal**, not a fault. Amber here would train
 * educators to ignore amber, and the next amber thing they ignore is a ratio breach.
 *
 * It sits above the list and never over it. A strip that floats over the roll covers a
 * child, and the one it covers is the one nobody signs in.
 *
 * NO PULSE, DELIBERATELY
 *
 * The pack specifies a 2s opacity pulse for the equivalent strip on the *web* tablet
 * screen, disabled under reduced motion. Not reproduced here: the same pack argues a
 * queued write is an ordinary state, and a pulsing element is how a screen says "attend to
 * me now". Animating it would contradict the reason it is blue. A pulse would also need an
 * `AccessibilityInfo` reduced-motion listener to be honest about vestibular disorders, for
 * a decoration nobody asked for.
 */
export function OfflineStrip({
  online,
  pendingCount,
  syncing = false,
}: {
  online: boolean;
  pendingCount: number;
  /** A flush is in flight. Distinct from "offline": the work is leaving right now. */
  syncing?: boolean;
}) {
  // Nothing queued and a connection: there is nothing true to say, so say nothing. An
  // "all synced" banner is a permanent line of screen furniture reporting the absence of
  // news.
  if (pendingCount === 0 && online) return null;

  const sentence = sentenceFor({ online, pendingCount, syncing });

  // `summary`, not `status`: React Native has no `status` role — that is a web ARIA value and
  // it typechecks nowhere. `alert` would be wrong on its own terms, because a queued write is
  // not an alert. `summary` plus a polite live region is what RatioBar already uses.
  return (
    <View style={styles.strip} accessibilityRole="summary" accessibilityLiveRegion="polite">
      {/* The glyph is in the visible string but out of the accessible name — "counterclockwise
          arrows" read before the sentence is noise, and the sentence carries everything. */}
      <Text style={styles.text} accessibilityLabel={sentence}>
        {'↻ '}
        {sentence}
      </Text>
    </View>
  );
}

/**
 * The four true sentences this strip can say.
 *
 * Split out because the wording *is* the feature — an educator decides whether to trust the
 * ratio above it from this line. Not exported and not unit-tested, which is a real gap: the
 * mobile workspace has no test runner at all. Recorded in the wiki rather than papered over
 * with an export that pretends a test exists.
 */
function sentenceFor({
  online,
  pendingCount,
  syncing,
}: {
  online: boolean;
  pendingCount: number;
  syncing?: boolean;
}): string {
  const items = `${pendingCount} sign-in${pendingCount === 1 ? '' : 's'}`;

  if (pendingCount === 0) {
    // Offline with an empty queue. Worth saying, because the *next* tap will queue.
    return 'Offline · sign-ins will be saved on this device';
  }
  if (syncing) return `Sending · ${items} on their way`;
  if (!online) return `Offline · ${items} waiting to send`;
  // Online with a queue: a flush is due or has failed a round. Naming the count is what
  // stops "waiting to send" reading as "lost".
  return `${items} waiting to send`;
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: color.pendingSoft,
    borderWidth: 1,
    borderColor: color.pendingBorder,
    borderRadius: radius.md,
    paddingVertical: space['3'],
    paddingHorizontal: space['3'],
    marginBottom: space['3'],
  },
  text: { fontSize: font.size.base, color: color.pending, fontWeight: font.weight.medium },
});
