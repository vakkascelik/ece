import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
  listAttendanceToday,
  listChildren,
  listHealthByChild,
  listMyCentres,
  loadSession,
  readAdultsPresent,
  type AttendanceState,
} from '@ece/api';
import {
  activeRole,
  buildRoll,
  hasCriticalCondition,
  type Centre,
  type Child,
  type HealthCondition,
  type Roll,
  type Session,
} from '@ece/core';
import { supabase } from './lib/supabase';
import { enqueue, flush, pendingAttendance, type FlushReport } from './lib/outbox';
import { ChildCard } from './components/ChildCard';
import { RatioBar } from './components/RatioBar';
import { SignInButton } from './components/SignInButton';
import { color, font, radius, space, target, theme } from './theme';

/**
 * The roll, and the reason this app is opened every morning.
 *
 * ONE TAP FROM COLD
 *
 * The plan asked for three. The roll is the home screen and every card carries its own
 * button, so signing a child in is one tap after the app is open — no navigation, no
 * search, no confirmation dialog. That matters because it happens forty times between
 * 7:30 and 9:00 with a queue of parents waiting.
 *
 * WRITES NEVER WAIT ON THE NETWORK
 *
 * A tap writes to the local outbox and returns. The UI updates from local state
 * immediately and the card shows a pending badge until the event lands. There is no
 * spinner and no disabled button: on a bad connection those make a working app feel
 * broken, and the write has genuinely already succeeded — locally.
 *
 * A flush runs on mount, when the app returns to the foreground, and after each tap.
 * No connectivity library: the flush attempt *is* the connectivity check, and
 * `expo-network` would add a dependency to learn something the next request tells us
 * anyway.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [activeCentre, setActiveCentre] = useState<string | null>(null);

  const [children, setChildren] = useState<Child[]>([]);
  const [serverStates, setServerStates] = useState<AttendanceState[]>([]);
  const [health, setHealth] = useState<Map<string, HealthCondition[]>>(new Map());
  const [adults, setAdults] = useState(0);
  const [queued, setQueued] = useState<Awaited<ReturnType<typeof pendingAttendance>>>([]);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const centre = centres.find((c) => c.id === activeCentre);
  const role = session && activeCentre ? activeRole({ ...session, activeCentreId: activeCentre }) : null;
  const isParent = role === 'parent';

  // Re-read the local queue. Cheap, and called after every tap so the badge is honest.
  const refreshQueue = useCallback(async () => {
    setQueued(await pendingAttendance());
  }, []);

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
    // Never guessed when there is a choice — the same rule as the web app. A manager
    // of two sites reading the wrong room's ratio is the failure this avoids.
    setActiveCentre((prev) =>
      prev && cs.some((c) => c.id === prev) ? prev : cs.length === 1 ? cs[0].id : null,
    );
    return s;
  }, []);

  const loadRoll = useCallback(async (centreId: string) => {
    const [kids, states, conditions, adultCount] = await Promise.all([
      listChildren(supabase, centreId),
      listAttendanceToday(supabase, centreId),
      listHealthByChild(supabase, centreId),
      readAdultsPresent(supabase, centreId),
    ]);
    setChildren(kids);
    setServerStates(states);
    setHealth(conditions);
    setAdults(adultCount);
  }, []);

  /** Try to drain the queue, then re-read. Failure here is expected and not an error. */
  const sync = useCallback(
    async (centreId: string | null) => {
      let report: FlushReport | null = null;
      try {
        report = await flush(supabase);
        setOnline(true);
      } catch {
        // flush() only throws on something unexpected; a transient failure is
        // reported as `deferred`. Either way, treat it as being offline.
        setOnline(false);
      }
      if (report && report.deferred > 0) setOnline(false);
      await refreshQueue();

      if (centreId) {
        try {
          await loadRoll(centreId);
          setOnline(true);
        } catch {
          // Offline. The roll on screen is the last one fetched, merged with the
          // queue — stale reference data, current attendance. Which is the right
          // trade: an educator needs to know who is in the room now.
          setOnline(false);
        }
      }
    },
    [loadRoll, refreshQueue],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadIdentity();
        if (cancelled) return;
        setStatus('ready');
        if (s) await sync(null);
      } catch (err) {
        if (!cancelled) {
          setMessage((err as Error).message);
          setStatus('error');
        }
      }
    })();

    // Re-read on sign-in and sign-out. Without this a shared staffroom tablet keeps
    // showing the previous user's roll — which means one family's medical records.
    const { data } = supabase.auth.onAuthStateChange(() => {
      loadIdentity().catch(() => setOnline(false));
    });

    // Coming back to the foreground is the moment a device that was in a pocket has
    // signal again, and the best time to drain the queue without asking.
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sync(activeCentre);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
      appState.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadIdentity]);

  useEffect(() => {
    if (activeCentre) void sync(activeCentre);
  }, [activeCentre, sync]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await sync(activeCentre);
    } finally {
      setRefreshing(false);
    }
  }, [sync, activeCentre]);

  /** A tap. Local write, instant feedback, then an opportunistic flush. */
  const toggle = useCallback(
    async (childId: string, present: boolean) => {
      await enqueue('attendance', {
        childId,
        kind: present ? 'out' : 'in',
        // The device's clock, now. This is the time that will be recorded even if the
        // event does not reach the server for an hour, and it is the time that decides
        // funded hours.
        at: new Date().toISOString(),
      });
      // Re-read the queue first so the card flips before anything touches the network.
      await refreshQueue();
      void sync(activeCentre);
    },
    [refreshQueue, sync, activeCentre],
  );

  const roll: Roll = buildRoll({
    children,
    serverStates,
    queued,
    health,
    adultsPresent: adults,
    timeZone: centre?.timezone,
  });

  // Anything that could become an emergency first, then anyone with a health note,
  // then the rest — alphabetical within each group so the order stays predictable.
  const ordered = [...roll.entries].sort((a, b) => {
    const rank = (e: typeof a) =>
      hasCriticalCondition(e.conditions) ? 0 : e.conditions.length > 0 ? 1 : 2;
    return rank(a) - rank(b) || a.child.lastName.localeCompare(b.child.lastName);
  });

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

            {/* Staff only. A parent has no business seeing the centre's staffing ratio. */}
            {!isParent && (
              <RatioBar ratio={roll.ratio} pendingCount={roll.pendingCount} online={online} />
            )}

            {isParent && !online && (
              <Text style={[theme.muted, { marginBottom: space['3'] }]}>
                Offline — showing the last update.
              </Text>
            )}

            {roll.entries.length === 0 ? (
              <Text style={theme.muted}>
                {isParent
                  ? 'No children are linked to you at this centre yet.'
                  : 'Nobody is enrolled yet.'}
              </Text>
            ) : (
              ordered.map((entry) => (
                <View key={entry.child.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <ChildCard
                      child={entry.child}
                      conditions={entry.conditions}
                      consents={[]}
                      enrolment={undefined}
                      showConsentGaps={false}
                      present={entry.present}
                      since={entry.since}
                      pending={entry.pending}
                    />
                  </View>
                  <View style={styles.action}>
                    <SignInButton
                      present={entry.present}
                      childName={entry.child.firstName}
                      onPress={() => void toggle(entry.child.id, entry.present)}
                    />
                  </View>
                </View>
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
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] },
  action: { paddingTop: space['3'] },
});
