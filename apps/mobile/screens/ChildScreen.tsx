import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import {
  getChild,
  listAttendanceToday,
  listConsentRequests,
  listConsents,
  listGuardiansOfChild,
  listHealthConditions,
  recordConsent,
} from '@ece/api';
import {
  CONSENT_DETAIL,
  consentProgress,
  formatAge,
  initials,
  todayInZone,
  type Child,
  type ConsentKind,
  type ConsentRequest,
  type ConsentState,
  type HealthCondition,
} from '@ece/core';
import { color, font, radius, space, target, theme } from '../theme';
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
  const [requests, setRequests] = useState<ConsentRequest[]>([]);
  const [ownGuardianId, setOwnGuardianId] = useState<string | null>(null);
  const [signedInAt, setSignedInAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<ConsentKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, health, current, asks, whanau, attendance] = await Promise.all([
        getChild(supabase, params.childId),
        listHealthConditions(supabase, params.childId),
        listConsents(supabase, params.childId),
        // 0073. Without this the screen below says "Not asked yet" about a decision the
        // centre may have asked for three times, which is a false statement to make to a
        // family about their own child.
        listConsentRequests(supabase, params.childId),
        listGuardiansOfChild(supabase, params.childId),
        // Their own child only: the policy on attendance keys on guardianship, which the RLS
        // suite asserts directly ("cannot read another family's attendance either").
        centre ? listAttendanceToday(supabase, centre.id) : Promise.resolve([]),
      ]);
      setChild(c);
      setConditions(health);
      setConsents(current);
      setRequests(asks);
      const state = attendance.find((s) => s.childId === params.childId);
      setSignedInAt(state?.kind === 'in' ? state.at : null);
      // Which guardian record is *this* person's, so a recorded decision is attributed to them
      // rather than to whoever happened to be holding the phone. Same resolution the web app does.
      setOwnGuardianId(whanau.find((g) => g.guardian.userId === session?.userId)?.guardian.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this record.');
    }
  }, [params.childId, session?.userId, centre]);

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
        <View style={styles.head}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText} accessibilityElementsHidden>
              {initials(child)}
            </Text>
          </View>
          <View style={styles.headWho}>
            {/* 28/600. The pack's header, and the screen previously had none at all — only a
                muted age line under whatever the navigator put in the title bar. */}
            <Text style={styles.headName}>{child.preferredName || child.firstName}</Text>
            <Text style={styles.headMeta}>
              {/*
                `todayInZone(...)`, not the timezone itself. This line read
                `formatAge(child.dateOfBirth, centre?.timezone)` until 2026-08-06, and
                `formatAge`'s second argument is a **date**: passing 'Pacific/Auckland' throws
                `Not an ISO date`. Once a centre was chosen — which is always — opening this
                screen crashed. Nobody had noticed because nothing in this app has ever run on
                a device; see unverified-claims item 15.
              */}
              {formatAge(child.dateOfBirth, todayInZone(centre?.timezone))}
              {child.iwi ? ` · ${child.iwi}` : ''}
            </Text>
          </View>
        </View>
      )}

      {/* "Is my child there" is the question this screen is opened with, and it was not
          answerable here before. `ok` tint at 17/500, per the pack. */}
      {signedInAt && (
        <View style={styles.presentBlock}>
          <Text style={styles.presentText}>
            {'✓ '}Signed in at{' '}
            {new Date(signedInAt).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}{' '}
            today
          </Text>
        </View>
      )}

      <View style={styles.block}>
        {/*
          The eyebrow says what this section IS to the reader — read-only — before they try to
          change something and find they cannot. The pack's wording, and it is better than the
          bare "Health" it replaces for a reason worth keeping: a parent who taps a health entry
          expecting to fix a wrong allergy and gets nothing has learnt that the app is broken,
          not that the centre owns the record.
        */}
        <Text style={theme.h2}>Health · read-only</Text>
        {conditions.length === 0 ? (
          <Text style={theme.muted}>Nothing recorded.</Text>
        ) : (
          conditions.map((c) => {
            const severe = c.severity === 'anaphylaxis' || c.severity === 'severe';
            return (
              <View key={c.id} style={[styles.healthCard, severe ? styles.healthCritical : styles.healthWarn]}>
                <Text style={[styles.healthTitle, severe ? styles.textCritical : styles.textWarn]}>
                  {severe ? '▲ ' : '● '}
                  {c.name}
                </Text>
                {c.severity && (
                  <Text style={[styles.healthDetail, severe ? styles.textCritical : styles.textWarn]}>
                    {c.severity === 'anaphylaxis' ? 'Anaphylaxis' : c.severity}
                    {c.responsePlan ? ` · ${c.responsePlan}` : ''}
                  </Text>
                )}
                {!c.severity && c.responsePlan && (
                  <Text style={[styles.healthDetail, styles.textWarn]}>{c.responsePlan}</Text>
                )}
              </View>
            );
          })
        )}
        <Text style={[theme.muted, styles.note]}>
          Message the centre to change anything here.
        </Text>
      </View>

      <View style={styles.block}>
        <Text style={theme.h2}>Consents · you can change these</Text>
        {!ownGuardianId && (
          <Text style={theme.muted}>
            The centre needs to add you as a guardian before you can record consent here.
          </Text>
        )}
        {consentProgress(consents, requests).map((p) => {
          const kind = p.kind;
          return (
            <View key={kind} style={styles.card}>
              <Text style={styles.name}>{CONSENT_DETAIL[kind].label}</Text>
              {/* Verbatim from core. "In the private journal your whānau reads" and "on our
                  website and social media" are different questions and families answer them
                  differently — paraphrasing for a small screen would change what was asked. */}
              <Text style={theme.body}>{CONSENT_DETAIL[kind].detail}</Text>

              {/*
                THREE STATES, and the middle one is why 0073 exists.

                This used to read "Not asked yet" for anything unanswered, which after 0073 can
                be false — the centre may have asked, and telling a family nobody asked them is
                worse than saying nothing. `consentProgress` keeps "never asked" and "asked and
                waiting" apart, and the wording says which.

                The web app got this on 2026-08-29 and this screen did not, for half a day. It
                matters more here: mobile-app.md calls a parent tapping "yes" on their phone the
                most obviously useful thing this app does, so this is the screen the sentence is
                actually read on.
              */}
              <Text style={[theme.muted, styles.note]}>
                {p.state === 'answered'
                  ? p.granted
                    ? 'You have given this'
                    : 'You have declined this'
                  : p.state === 'awaiting'
                    ? `The centre asked on ${new Date(p.requestedAt).toLocaleDateString('en-NZ')} — still waiting on you`
                    : 'Not asked yet'}
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
  head: { flexDirection: 'row', alignItems: 'center', gap: space['3'], marginBottom: space['4'] },
  headWho: { flex: 1, minWidth: 0 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.inkMuted },
  headName: { fontSize: font.size['2xl'], fontWeight: font.weight.semibold, color: color.ink },
  headMeta: { fontSize: font.size.sm, color: color.inkMuted, marginTop: 2 },

  presentBlock: {
    backgroundColor: color.okSoft,
    borderRadius: radius.md,
    paddingVertical: space['3'],
    paddingHorizontal: space['4'],
  },
  presentText: { fontSize: font.size.mobileBase, fontWeight: font.weight.medium, color: color.ok },

  healthCard: { borderRadius: radius.md, padding: space['3'], marginTop: space['3'] },
  healthCritical: { backgroundColor: color.breachSoft },
  healthWarn: { backgroundColor: color.warnSoft },
  healthTitle: { fontSize: font.size.mobileBase, fontWeight: font.weight.semibold },
  healthDetail: { fontSize: font.size.base, lineHeight: 22, marginTop: space['1'] },
  textCritical: { color: color.breach },
  textWarn: { color: color.warn },

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
