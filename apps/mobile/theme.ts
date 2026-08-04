/**
 * The mobile theme — the same tokens the web app reads, expressed as a StyleSheet.
 *
 * `@ece/core/tokens` is plain data for exactly this reason: the two surfaces share
 * a vocabulary without sharing components. An educator holding a child needs large
 * targets and one-handed reach; a manager at a desk needs density. Uniform
 * components would be wrong for both. What must not diverge is the meaning — the
 * same green means the same thing in both apps.
 */

import { StyleSheet } from 'react-native';
import { color, font, radius, space, target } from '@ece/core';

export { color, font, radius, space, target };

export const theme = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space['4'], paddingBottom: space['8'] },

  h1: {
    fontSize: font.size['2xl'],
    fontWeight: font.weight.semibold,
    color: color.ink,
    marginBottom: space['1'],
  },
  h2: {
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    color: color.inkMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: space['2'],
  },
  // 17, not 15. Read at arm's length, standing, often in poor light.
  body: { fontSize: font.size.mobileBase, color: color.ink },
  muted: { fontSize: font.size.base, color: color.inkMuted },
  error: { fontSize: font.size.base, color: color.breach },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space['4'],
    marginBottom: space['3'],
  },

  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['2'] },

  /**
   * Minimum interactive size.
   *
   * WCAG 2.2 requires 24px; that is a compliance floor, not a usable target. 56 is
   * what survives being tapped by someone with a child on one hip and a bag in the
   * other hand, which is the actual condition this app is used in.
   */
  tap: { minHeight: target.comfortable, justifyContent: 'center' },
  tapPrimary: { minHeight: target.primary, justifyContent: 'center' },
});
