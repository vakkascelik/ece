import { StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space } from '../theme';

export type FlagTone = 'critical' | 'warn' | 'ok' | 'quiet';

/**
 * A status flag.
 *
 * Always a symbol AND a word, never colour alone (WCAG 1.4.1). About one man in
 * twelve cannot reliably separate the red from the green, and what these carry is
 * "this child could stop breathing" — so the information survives without colour,
 * and on a sun-washed tablet screen in a playground it has to.
 *
 * `accessibilityLabel` spells the tone out, because a screen reader announcing
 * "triangle Anaphylaxis" is not the same as "Critical: Anaphylaxis".
 */
export function Flag({ tone, children }: { tone: FlagTone; children: string }) {
  const t = TONES[tone];
  return (
    <View style={[styles.base, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text
        style={[styles.text, { color: t.fg }]}
        accessibilityLabel={`${t.spoken}: ${children}`}
      >
        {t.symbol} {children}
      </Text>
    </View>
  );
}

const TONES: Record<FlagTone, { bg: string; fg: string; border: string; symbol: string; spoken: string }> = {
  critical: { bg: color.breachSoft, fg: color.breach, border: '#eccec4', symbol: '▲', spoken: 'Critical' },
  warn: { bg: color.warnSoft, fg: color.warn, border: '#ecdcb8', symbol: '●', spoken: 'Warning' },
  ok: { bg: color.okSoft, fg: color.ok, border: '#c8ddd1', symbol: '✓', spoken: 'Confirmed' },
  quiet: { bg: color.surfaceSunken, fg: color.inkMuted, border: color.line, symbol: '◌', spoken: 'Note' },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space['2'],
    paddingVertical: 3,
  },
  text: { fontSize: font.size.sm, fontWeight: font.weight.medium },
});
