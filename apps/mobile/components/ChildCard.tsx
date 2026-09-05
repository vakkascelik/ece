import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  compareBySeverity,
  displayName,
  formatAge,
  initials,
  isUnderTwo,
  missingConsents,
  type Child,
  type ConsentState,
  type HealthCondition,
} from '@ece/core';
import { color, font, radius, space, theme } from '../theme';
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
  showConsentGaps,
  present = false,
  since = null,
  pending = false,
  action,
}: {
  child: Child;
  conditions: HealthCondition[];
  consents: ConsentState[];
  showConsentGaps: boolean;
  present?: boolean;
  since?: string | null;
  /**
   * The row's control, rendered inside the header row beside the name.
   *
   * A slot rather than a `onSignIn` prop, because the whānau screens use this same card
   * with no action at all and a parent must never be handed a sign-in button — the
   * capability check would refuse the write, but a button that fails is worse than no
   * button.
   */
  action?: ReactNode;
  /**
   * The event behind this state is still in the outbox.
   *
   * Shown as a badge rather than hidden, because an educator needs to know the
   * difference between "the office can see this" and "this is on my tablet". A
   * pending sign-in is a normal state on a bad connection, not an error — which is why
   * it gets the neutral tone and not the warning one.
   */
  pending?: boolean;
}) {
  const sorted = [...conditions].sort(compareBySeverity);
  const critical = sorted.filter((c) => c.severity === 'anaphylaxis' || c.severity === 'severe');
  const other = sorted.filter((c) => !critical.includes(c));
  const gaps = showConsentGaps ? missingConsents(consents) : [];

  return (
    <View style={[theme.card, critical.length > 0 && styles.criticalCard]}>
      {/*
        The pack's row: 48px initials, the name and its chips, then the action. The action
        used to sit in a separate block *below* the card, which cost a whole row of vertical
        space per child and put the button nearer the next child's name than to its own.
      */}
      <View style={styles.head}>
        {/* Initials, not a photograph. A roll showing children's faces cannot be held up in
            a room or left open on a bench, which is exactly how this screen is used. */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText} accessibilityElementsHidden>
            {initials(child)}
          </Text>
        </View>

        <View style={styles.headWho}>
          <Text style={styles.name}>{displayName(child)}</Text>
          <View style={[theme.row, { marginTop: space['1'] }]}>
            <Text style={theme.muted}>{formatAge(child.dateOfBirth)}</Text>
            {isUnderTwo(child.dateOfBirth) && <Flag tone="quiet">under 2</Flag>}
            {present ? (
              <Flag tone="ok">
                {since
                  ? `In ${new Date(since).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}`
                  : 'Here'}
              </Flag>
            ) : null}
            {pending && <Flag tone="quiet">waiting to send</Flag>}
          </View>
        </View>

        {action}
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

      {/*
        THE ENROLMENT LINE IS GONE, AND IT WAS SAYING SOMETHING FALSE ON EVERY CARD.

        It read `enrolment ? formatDays(enrolment.days) : 'Not enrolled'`. **Both call sites pass
        `enrolment={undefined}`** — `RollScreen` and `TamarikiScreen`, since the prop was added —
        and neither ever fetched an enrolment, because `useRoll` loads children, attendance, health
        and the adult count and nothing else. So the ternary had exactly one reachable branch and
        every child on the roll was labelled **"Not enrolled"**, on a screen whose entire contents
        are enrolled children.

        Removed rather than wired, and the choice is deliberate. Wiring it means fetching enrolments
        AND `child_booking_schedule` down the mobile path — because as of 2026-09-04 funding computes
        from the schedule, so rendering `enrolments.days` here would reproduce on the phone the exact
        disagreement [[unverified-claims]] item 53 names on the web: a day pattern beside a figure
        the money came from a different pattern. That is a real feature with an offline story, not a
        label.

        And the day pattern is not what this screen is for. The roll answers who is here now; an
        educator at the door cannot act on which weekdays a child is booked. The same judgement the
        child record made about an empty "Learning" tab: a line that cannot be made true is worse
        than an absent one.

        The row survives for the consent flag, and now renders only when there is one — previously
        it was always present because the false text always filled it.
      */}
      {gaps.length > 0 && (
        <View style={[theme.row, { marginTop: space['3'] }]}>
          <Flag tone="warn">{`${gaps.length} consent${gaps.length === 1 ? '' : 's'} unanswered`}</Flag>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  criticalCard: { borderColor: color.breachBorder },
  head: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  headWho: { flex: 1, minWidth: 0 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: font.size.mobileBase, fontWeight: font.weight.semibold, color: color.inkMuted },
  // 17/600, the pack's ChildCard name size. Was 18, which is the web roll's.
  name: { fontSize: font.size.mobileBase, fontWeight: font.weight.semibold, color: color.ink },
  criticalBlock: {
    marginTop: space['3'],
    backgroundColor: color.breachSoft,
    borderRadius: 8,
    padding: space['3'],
  },
  criticalName: { fontSize: font.size.mobileBase, fontWeight: font.weight.semibold, color: color.ink },
  plan: { fontSize: font.size.base, color: color.ink, marginTop: space['1'] },
  noPlan: { fontSize: font.size.base, color: color.breach, marginTop: space['1'] },
});
