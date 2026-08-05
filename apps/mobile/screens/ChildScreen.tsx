import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import {
  getChild,
  listConsents,
  listGuardiansOfChild,
  listHealthConditions,
  recordConsent,
} from '@ece/api';
import {
  CONSENT_DETAIL,
  REQUIRED_CONSENTS,
  formatAge,
  type Child,
  type ConsentKind,
  type ConsentState,
  type HealthCondition,
} from '@ece/core';
import { color, font, radius, space, target, theme } from '../theme';
import { Flag } from '../components/Flag';
import { useSession } from '../state/SessionProvider';
import { supabase } from '../lib/supabase';

/**
 * One child, for their whānau.
 *
 * Health and enrolment are read-only here. Consents are not — `recordConsent` includes `parent`
 * in the capability matrix, and a parent tapping "yes" to an excursion on their phone is the most
 * obviously useful thing this app does for a family.
 *
 * **No custody section, at all.** `viewCustody` excludes parents, and the reason is worth keeping
 * in front of whoever edits this file: a custody arrangement is a record *about* the guardians, so
 * it must not be readable *by* them. Rendering an empty heading would be worse than omitting it —
 * it would tell a parent that a court order exists.
 *
 * **Consent writes are not queued.** The outbox is for append-only observations of a moment whose
 * time cannot be re-derived. A consent decision is a deliberate act a person can repeat when they
 * have signal, and queueing it would show "consent given" on the phone while the restrictive
 * policy in Postgres still refuses the photograph — two sources of truth for the one rule that
 * must have exactly one.
 */
type ChildRoute = RouteProp<{ Child: { childId: string; name: string } }, 'Child'>;

export function ChildScreen() {
  const { params } = useRoute<ChildRoute>();
  const { session, centre } = useSession();

  const [child, setChild] = useState<Child | null>(null);
  const [conditions, setConditions] = useState<HealthCondition[]>([]);
  const [consents, setConsents] = useState<ConsentState[]>([]);
  const [ownGuardianId, setOwnGuardianId] = useState<string | null>(null);
  const [busy, setBusy] = useState<ConsentKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, health, current, whanau] = await Promise.all([
        getChild(supabase, params.childId),
        listHealthConditions(supabase, params.childId),
        listConsents(supabase, params.childId),
        listGuardiansOfChild(supabase, params.childId),
      ]);
      setChild(c);
      setConditions(health);
      setConsents(current);
      // Which guardian record is *this* person's, so a recorded decision is attributed to them
      // rather than to whoever happened to be holding the phone. Same resolution the web app does.
      setOwnGuardianId(whanau.find((g) => g.guardian.userId === session?.userId)?.guardian.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this record.');
    }
  }, [params.childId, session?.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (kind: ConsentKind, granted: boolean) => {
      setBusy(kind);
      try {
        await recordConsent(supabase, {
          childId: params.childId,
          kind,
          granted,
          givenBy: ownGuardianId,
        });
        await load();
      } catch {
        // Online-only, and it says so rather than pretending. Nothing is written locally, so the
        // screen still shows the truth.
        Alert.alert(
          'Not recorded',
          'That did not reach the centre. Check your connection and try again — nothing has been changed.',
        );
      } finally {
        setBusy(null);
      }
    },
    [params.childId, ownGuardianId, load],
  );

  if (error) {
    return (
      <ScrollView contentContainerStyle={theme.content}>
        <Text style={theme.error}>{error}</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={theme.screen} contentContainerStyle={theme.content}>
      {child && (
        <Text style={theme.muted}>
          {formatAge(child.dateOfBirth, centre?.timezone)}
          {child.iwi ? ` · ${child.iwi}` : ''}
        </Text>
      )}

      <View style={styles.block}>
        <Text style={theme.h2}>Health</Text>
        {conditions.length === 0 ? (
          <Text style={theme.muted}>Nothing recorded.</Text>
        ) : (
          conditions.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.name}>{c.name}</Text>
              {c.severity && (
                <Flag tone={c.severity === 'anaphylaxis' || c.severity === 'severe' ? 'critical' : 'warn'}>
                  {c.severity === 'anaphylaxis' ? 'Anaphylaxis' : c.severity}
                </Flag>
              )}
              {c.responsePlan && <Text style={theme.body}>{c.responsePlan}</Text>}
            </View>
          ))
        )}
        <Text style={[theme.muted, styles.note]}>
          Health details are recorded by the centre. Tell a kaiako if anything here is wrong or out
          of date.
        </Text>
      </View>

      <View style={styles.block}>
        <Text style={theme.h2}>Consents</Text>
        {!ownGuardianId && (
          <Text style={theme.muted}>
            The centre needs to add you as a guardian before you can record consent here.
          </Text>
        )}
        {REQUIRED_CONSENTS.map((kind) => {
          const current = consents.find((c) => c.kind === kind);
          return (
            <View key={kind} style={styles.card}>
              <Text style={styles.name}>{CONSENT_DETAIL[kind].label}</Text>
              {/* Verbatim from core. "In the private journal your whānau reads" and "on our
                  website and social media" are different questions and families answer them
                  differently — paraphrasing for a small screen would change what was asked. */}
              <Text style={theme.body}>{CONSENT_DETAIL[kind].detail}</Text>

              <Text style={[theme.muted, styles.note]}>
                {current === undefined
                  ? 'Not asked yet'
                  : current.granted
                    ? 'You have given this'
                    : 'You have declined this'}
              </Text>

              {ownGuardianId && (
                <View style={styles.buttons}>
                  {/* Two labelled buttons, never a switch. A mis-tap on a toggle silently records
                      the opposite of a decision about photographs of a child. */}
                  <Pressable
                    style={[styles.choice, styles.yes]}
                    disabled={busy !== null}
                    onPress={() => void decide(kind, true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Give consent for ${CONSENT_DETAIL[kind].label}`}
                  >
                    <Text style={styles.yesText}>Give</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.choice, styles.no]}
                    disabled={busy !== null}
                    onPress={() => void decide(kind, false)}
                    accessibilityRole="button"
                    accessibilityLabel={`Withhold consent for ${CONSENT_DETAIL[kind].label}`}
                  >
                    <Text style={styles.noText}>Withhold</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: space['5'] },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space['3'],
    marginTop: space['3'],
  },
  name: { fontSize: font.size.mobileBase, fontWeight: '600', color: color.ink, marginBottom: space['1'] },
  note: { fontSize: font.size.sm, marginTop: space['2'] },
  buttons: { flexDirection: 'row', gap: space['3'], marginTop: space['3'] },
  choice: {
    flex: 1,
    minHeight: target.comfortable,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
  },
  yes: { borderColor: color.okBorder, backgroundColor: color.okSoft },
  yesText: { color: color.ok, fontWeight: '600', fontSize: font.size.mobileBase },
  no: { borderColor: color.line, backgroundColor: color.surface },
  noText: { color: color.ink, fontWeight: '600', fontSize: font.size.mobileBase },
});
