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
 */
export function RatioBar({
  ratio,
  pendingCount,
  online,
}: {
  ratio: RatioAssessment;
  pendingCount: number;
  online: boolean;
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

  return (
    <View
      style={[styles.bar, { backgroundColor: bg, borderColor: border }]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <Flag tone={tone}>
          {ratio.status === 'breach'
            ? `Over ratio — ${ratio.shortfall} more needed`
            : ratio.status === 'at-limit'
              ? 'At the limit'
              : 'Within ratio'}
        </Flag>
        {!online && <Flag tone="quiet">offline</Flag>}
        {pendingCount > 0 && <Flag tone="quiet">{`${pendingCount} to send`}</Flag>}
      </View>

      <Text style={styles.numbers}>
        {ratio.adultsPresent} {ratio.adultsPresent === 1 ? 'adult' : 'adults'} · {ratio.present}{' '}
        {ratio.present === 1 ? 'child' : 'children'} ({ratio.underTwo} under 2) · needs{' '}
        {ratio.adultsRequired}
      </Text>

      {ratio.warning && <Text style={styles.warning}>{ratio.warning}</Text>}

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
    borderRadius: radius.md,
    padding: space['3'],
    marginBottom: space['4'],
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'], marginBottom: space['2'] },
  numbers: { fontSize: font.size.base, color: color.ink },
  warning: {
    fontSize: font.size.mobileBase,
    color: color.ink,
    fontWeight: font.weight.medium,
    marginTop: space['2'],
  },
  unverified: { fontSize: font.size.sm, color: color.warn, marginTop: space['2'] },
});
