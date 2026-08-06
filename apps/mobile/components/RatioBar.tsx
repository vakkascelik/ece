import { StyleSheet, Text, View } from 'react-native';
import type { RatioAssessment } from '@ece/core';
import { color, font, radius, space } from '../theme';
import { Flag } from './Flag';

/**
 * The ratio, pinned above the roll and never scrolled away.
 *
 * The plan's requirement, and it is the reason this screen exists: a ratio you have
 * to go and find is a ratio nobody looks at. This one is in the way.
 *
 * `pendingCount` is shown because queued sign-ins are already counted in the ratio.
 * An educator seeing "within ratio" needs to know whether that includes the three
 * children they signed in with no signal — it does, and saying so is the difference
 * between trusting the number and not.
 *
 * Connectivity itself is **not** shown here any more. It moved to `OfflineStrip`, which the
 * pack makes a separate element: this block is about the room's staffing, and mixing "you
 * are offline" into it made the two conditions look like one thing. What stays is the one
 * sentence tying them together — how many of these counts the office has not seen yet.
 */
export function RatioBar({
  ratio,
  pendingCount,
}: {
  ratio: RatioAssessment;
  pendingCount: number;
}) {
  const tone = ratio.status === 'breach' ? 'critical' : ratio.status === 'at-limit' ? 'warn' : 'ok';
  const bg =
    ratio.status === 'breach'
      ? color.breachSoft
      : ratio.status === 'at-limit'
        ? color.warnSoft
        : color.okSoft;
  const border =
    ratio.status === 'breach'
      ? color.breachBorder
      : ratio.status === 'at-limit'
        ? color.warnBorder
        : color.okBorder;
  const fg =
    ratio.status === 'breach' ? color.breach : ratio.status === 'at-limit' ? color.warn : color.ok;

  // Occupancy toward the limit — the same definition as the web ratio block, and for the
  // same reason: the pack's own caption for this bar does not describe the bar. In breach the
  // roll is already past what these adults cover, so it reads full.
  const capacity = ratio.present + ratio.headroomTwoAndOver;
  const fillPercent =
    ratio.status === 'breach' || capacity === 0
      ? 100
      : Math.min(100, Math.round((ratio.present / capacity) * 100));

  return (
    <View
      style={[styles.bar, { backgroundColor: bg, borderColor: border }]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Flag tone={tone}>
          {ratio.status === 'breach'
            ? `Ratio breach — ${ratio.shortfall} more needed`
            : ratio.status === 'at-limit'
              ? 'At limit'
              : 'Within ratio'}
        </Flag>
      </View>

      {/* 28/600. The number is read across a room, which is the whole reason this screen
          is not a table. */}
      <Text style={styles.counts}>
        {ratio.adultsPresent} kaiako · {ratio.present}{' '}
        {ratio.present === 1 ? 'tamaiti' : 'tamariki'}
      </Text>
      <Text style={styles.detail}>
        {ratio.underTwo} under 2 · {ratio.twoAndOver} aged 2 and over · requires{' '}
        {ratio.adultsRequired}
      </Text>

      {/*
        12px track, and `accessibilityElementsHidden` because the lines above and below say
        the same thing in words. A bar announced as a bar is noise; a bar that is the only
        carrier of a number is a failure.
      */}
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${fillPercent}%`, backgroundColor: fg }]} />
      </View>

      {ratio.warning && <Text style={styles.warning}>{ratio.warning}</Text>}

      {/*
        Kept from the pre-pack version, because the reasoning still holds and the pack has
        no equivalent: queued sign-ins are already counted above. An educator seeing "within
        ratio" needs to know whether that includes the three children they signed in with no
        signal. It does, and saying so is the difference between trusting the number and not.
      */}
      {pendingCount > 0 && (
        <Text style={styles.includes}>
          Includes {pendingCount} not yet sent to the office.
        </Text>
      )}

      {/*
        Until the bands have been checked against Schedule 2, the screen says so. A
        compliance indicator that might be wrong is more dangerous than none, because
        somebody will rely on it.
      */}
      {!ratio.verified && ratio.present > 0 && (
        <Text style={styles.unverified}>
          Ratio figures not yet checked against the regulations — treat as a prompt.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderWidth: 1,
    // 16 on mobile cards, against 10 on web controls. The pack's radius for a block this
    // size held in one hand.
    borderRadius: radius.lg,
    padding: space['4'],
    marginBottom: space['3'],
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'], marginBottom: space['2'] },
  counts: {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.semibold,
    color: color.ink,
  },
  detail: {
    fontSize: font.size.mobileBase,
    fontWeight: font.weight.medium,
    color: color.ink,
    marginTop: space['1'],
  },
  track: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    overflow: 'hidden',
    marginTop: space['3'],
  },
  fill: { height: '100%', borderRadius: radius.pill },
  includes: { fontSize: font.size.sm, color: color.inkMuted, marginTop: space['2'] },
  warning: {
    fontSize: font.size.mobileBase,
    color: color.ink,
    fontWeight: font.weight.medium,
    marginTop: space['2'],
  },
  unverified: { fontSize: font.size.sm, color: color.warn, marginTop: space['2'] },
});
