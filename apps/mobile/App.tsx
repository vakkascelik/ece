import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  listChildren,
  listConsentsByChild,
  listCurrentEnrolments,
  listHealthByChild,
  listMyCentres,
  loadSession,
} from '@ece/api';
import {
  activeRole,
  hasCriticalCondition,
  type Centre,
  type Child,
  type ConsentState,
  type Enrolment,
  type HealthCondition,
  type Session,
} from '@ece/core';
import { supabase } from './lib/supabase';
import { ChildCard } from './components/ChildCard';
import { color, font, radius, space, target, theme } from './theme';

/**
 * Both apps run off one query layer: this screen calls the same `listChildren`,
 * `listHealthByChild` and `listConsentsByChild` as the web roll. No tenant filter
 * and no guardianship filter appears in either — the policies decide, so a parent
 * signing in here sees their own child and an educator sees the room, from
 * identical code.
 *
 * One screen, no navigator. Phase 2 adds attendance and is where routing starts to
 * earn its weight; adding it now would be scaffolding around two views.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [activeCentre, setActiveCentre] = useState<string | null>(null);
  const [roll, setRoll] = useState<{
    children: Child[];
    health: Map<string, HealthCondition[]>;
    consents: Map<string, ConsentState[]>;
    enrolments: Map<string, Enrolment>;
  }>({ children: [], health: new Map(), consents: new Map(), enrolments: new Map() });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadIdentity = useCallback(async () => {
    const s = await loadSession(supabase);
    setSession(s);
    if (!s) {
      setCentres([]);
      setActiveCentre(null);
      return null;
    }
    const cs = await listMyCentres(supabase);
    setCentres(cs);
    // Never guessed when there is a choice — the same rule as the web app. A
    // manager of two sites reading the wrong room's allergies is the failure this
    // avoids.
    setActiveCentre((prev) => (prev && cs.some((c) => c.id === prev) ? prev : cs.length === 1 ? cs[0].id : null));
    return s;
  }, []);

  const loadRoll = useCallback(async (centreId: string) => {
    const [children, health, consents, enrolments] = await Promise.all([
      listChildren(supabase, centreId),
      listHealthByChild(supabase, centreId),
      listConsentsByChild(supabase, centreId),
      listCurrentEnrolments(supabase, centreId),
    ]);
    const byChild = new Map<string, Enrolment>();
    for (const e of enrolments) byChild.set(e.childId, e);
    setRoll({ children, health, consents, enrolments: byChild });
  }, []);

  const reload = useCallback(async () => {
    try {
      const s = await loadIdentity();
      setStatus('ready');
      if (!s) return;
    } catch (err) {
      setMessage((err as Error).message);
      setStatus('error');
    }
  }, [loadIdentity]);

  useEffect(() => {
    reload();
    // Re-read on sign-in and sign-out. Without this the screen keeps showing the
    // previous user's roll until the app restarts — which on a shared staffroom
    // tablet means showing one family another family's medical records.
    const { data } = supabase.auth.onAuthStateChange(() => reload());
    return () => data.subscription.unsubscribe();
  }, [reload]);

  useEffect(() => {
    if (!activeCentre) return;
    loadRoll(activeCentre).catch((err) => {
      setMessage((err as Error).message);
      setStatus('error');
    });
  }, [activeCentre, loadRoll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
      if (activeCentre) await loadRoll(activeCentre);
    } finally {
      setRefreshing(false);
    }
  }, [reload, loadRoll, activeCentre]);

  const role = session && activeCentre ? activeRole({ ...session, activeCentreId: activeCentre }) : null;
  const isParent = role === 'parent';
  const centre = centres.find((c) => c.id === activeCentre);

  // Anything that could become an emergency goes to the top of the scroll, rather
  // than wherever the alphabet puts it. Then children with any health note, then
  // everyone else — alphabetical within each group so the order is still
  // predictable to someone looking for a specific child.
  const rank = (childId: string): number => {
    const conditions = roll.health.get(childId) ?? [];
    if (hasCriticalCondition(conditions)) return 0;
    return conditions.length > 0 ? 1 : 2;
  };
  const ordered = [...roll.children].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.lastName.localeCompare(b.lastName),
  );

  return (
    <SafeAreaView style={theme.screen}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={theme.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {status === 'loading' && <ActivityIndicator />}
        {status === 'error' && <Text style={theme.error}>{message}</Text>}

        {status === 'ready' && !session && <Text style={theme.body}>Not signed in.</Text>}

        {status === 'ready' && session && centres.length === 0 && (
          <Text style={theme.muted}>No centres yet — an owner or manager needs to add you.</Text>
        )}

        {status === 'ready' && session && centres.length > 1 && (
          <View style={{ marginBottom: space['4'] }}>
            <Text style={theme.h2}>Centre</Text>
            {centres.map((c) => {
              const selected = c.id === activeCentre;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setActiveCentre(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.pick, selected && styles.pickOn]}
                >
                  <Text style={[theme.body, selected && styles.pickOnText]}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {centre && (
          <>
            <Text style={theme.h1}>{isParent ? 'Your tamariki' : centre.name}</Text>
            <Text style={[theme.muted, { marginBottom: space['4'] }]}>
              {isParent
                ? centre.name
                : `${roll.children.length} enrolled`}
            </Text>

            {roll.children.length === 0 ? (
              <Text style={theme.muted}>
                {isParent
                  ? 'No children are linked to you at this centre yet.'
                  : 'Nobody is enrolled yet.'}
              </Text>
            ) : (
              ordered.map((child) => (
                <ChildCard
                  key={child.id}
                  child={child}
                  conditions={roll.health.get(child.id) ?? []}
                  consents={roll.consents.get(child.id) ?? []}
                  enrolment={roll.enrolments.get(child.id)}
                  showConsentGaps={!isParent}
                />
              ))
            )}
          </>
        )}

        {status === 'ready' && session && centres.length > 1 && !activeCentre && (
          <Text style={theme.muted}>Choose a centre to see its roll.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pick: {
    minHeight: target.comfortable,
    justifyContent: 'center',
    paddingHorizontal: space['3'],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    marginBottom: space['2'],
  },
  pickOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  pickOnText: { fontWeight: font.weight.semibold, color: color.accent },
});
