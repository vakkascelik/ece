import { StyleSheet, Text, View } from 'react-native';
import {
  compareBySeverity,
  displayName,
  formatAge,
  formatDays,
  isUnderTwo,
  missingConsents,
  type Child,
  type ConsentState,
  type Enrolment,
  type HealthCondition,
} from '@ece/core';
import { color, font, space, theme } from '../theme';
import { Flag } from './Flag';

/**
 * One child, read-only.
 *
 * Read-only for Phase 1 on purpose: the writes this app needs are attendance,
 * incidents and daily notes, which are append-only and are what Phase 2 makes work
 * offline. Enrolment and whānau details are edited at a desk on wifi, and putting
 * an edit form here would create exactly the edit-conflict problem the offline
 * design avoids by not having one.
 *
 * The critical allergy is at the top of the card, spelled out with its response
 * plan. An educator reads this while something is happening, so "Peanuts" alone is
 * not enough — where the EpiPen is kept is the useful part.
 */
export function ChildCard({
  child,
  conditions,
  consents,
  enrolment,
  showConsentGaps,
}: {
  child: Child;
  conditions: HealthCondition[];
  consents: ConsentState[];
  enrolment: Enrolment | undefined;
  showConsentGaps: boolean;
}) {
  const sorted = [...conditions].sort(compareBySeverity);
  const critical = sorted.filter((c) => c.severity === 'anaphylaxis' || c.severity === 'severe');
  const other = sorted.filter((c) => !critical.includes(c));
  const gaps = showConsentGaps ? missingConsents(consents) : [];

  return (
    <View style={[theme.card, critical.length > 0 && styles.criticalCard]}>
      <Text style={styles.name}>{displayName(child)}</Text>

      <View style={[theme.row, { marginTop: space['1'] }]}>
        <Text style={theme.muted}>{formatAge(child.dateOfBirth)}</Text>
        {isUnderTwo(child.dateOfBirth) && <Flag tone="quiet">under 2</Flag>}
      </View>

      {critical.length > 0 && (
        <View style={styles.criticalBlock}>
          {critical.map((c) => (
            <View key={c.id} style={{ marginBottom: space['1'] }}>
              <View style={theme.row}>
                <Flag tone="critical">{c.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe'}</Flag>
                <Text style={styles.criticalName}>{c.name}</Text>
              </View>
              {c.responsePlan ? (
                <Text style={styles.plan}>{c.responsePlan}</Text>
              ) : (
                // An anaphylaxis entry with no plan looks handled and is not. Say so
                // rather than leaving a blank line.
                <Text style={styles.noPlan}>No response plan recorded — ask the manager.</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {other.length > 0 && (
        <View style={[theme.row, { marginTop: space['2'] }]}>
          {other.map((c) => (
            <Flag key={c.id} tone={c.severity ? 'warn' : 'quiet'}>
              {c.name}
            </Flag>
          ))}
        </View>
      )}

      <View style={[theme.row, { marginTop: space['3'] }]}>
        <Text style={styles.meta}>
          {enrolment ? formatDays(enrolment.days) : 'Not enrolled'}
        </Text>
        {gaps.length > 0 && (
          <Flag tone="warn">{`${gaps.length} consent${gaps.length === 1 ? '' : 's'} unanswered`}</Flag>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  criticalCard: { borderColor: '#eccec4' },
  name: { fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.ink },
  criticalBlock: {
    marginTop: space['3'],
    backgroundColor: color.breachSoft,
    borderRadius: 8,
    padding: space['3'],
  },
  criticalName: { fontSize: font.size.mobileBase, fontWeight: font.weight.semibold, color: color.ink },
  plan: { fontSize: font.size.base, color: color.ink, marginTop: space['1'] },
  noPlan: { fontSize: font.size.base, color: color.breach, marginTop: space['1'] },
  meta: { fontSize: font.size.base, color: color.inkMuted },
});
