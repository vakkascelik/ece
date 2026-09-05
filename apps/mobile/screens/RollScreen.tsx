import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { color, font, space, theme } from '../theme';
import { ChildCard } from '../components/ChildCard';
import { EmptyState } from '../components/EmptyState';
import { OfflineStrip } from '../components/OfflineStrip';
import { RatioBar } from '../components/RatioBar';
import { SignInButton } from '../components/SignInButton';
import { useRoll } from '../data/useRoll';
import { useSession } from '../state/SessionProvider';
import { enqueue } from '../lib/outbox';

/**
 * The roll. The reason this app is opened every morning, and the only screen that has to work
 * with no signal.
 *
 * ONE TAP FROM COLD
 *
 * It is the first tab and the initial route for staff, every card carries its own button, and
 * there is no navigation, no search and no confirmation dialogue between opening the app and
 * signing a child in. That matters because it happens forty times between 7.30 and 9.00 with a
 * queue of parents waiting, and every extra tap is multiplied by forty.
 *
 * WRITES NEVER WAIT ON THE NETWORK
 *
 * A tap writes to the local outbox and returns. The card shows a pending badge until the event
 * lands. No spinner and no disabled button: on a bad connection those make a working app feel
 * broken, and the write genuinely has succeeded — locally, which is the only place that matters
 * for the next thirty seconds.
 */
export function RollScreen() {
  const { centre, session, online, refreshQueue, syncNow } = useSession();
  const { roll, ordered, loading, reload } = useRoll();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncNow();
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [syncNow, reload]);

  const toggle = useCallback(
    async (childId: string, present: boolean) => {
      /*
       * The device clock is the recorded time, and it decides funded hours. A tablet whose clock
       * has drifted more than two hours ahead will have this refused by
       * `attendance_not_future` — which the outbox now classifies as retry-later rather than
       * permanent, so it lands on its own once real time catches up.
       */
      await enqueue(
        'attendance',
        { childId, kind: present ? 'out' : 'in', at: new Date().toISOString() },
        // Tagged with whoever is signed in. `recordAttendance` stamps `recorded_by` at flush time,
        // so an untagged row could be sent by the next person's token and recorded under their
        // name — permanently, in a table nobody can update.
        session?.userId ?? null,
      );
      await refreshQueue();
      // Fire and forget: the tap has already been recorded locally and the roll already reflects
      // it through the queue merge. Awaiting the network here is the thing this design avoids.
      void syncNow().then(() => void reload());
    },
    [refreshQueue, syncNow, reload, session?.userId],
  );

  return (
    <FlatList
      style={theme.screen}
      contentContainerStyle={theme.content}
      data={ordered}
      keyExtractor={(entry) => entry.child.id}
      refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={() => void onRefresh()} />}
      ListHeaderComponent={
        <View>
          {/* "Roll" is the screen; the centre is the context under it. The centre's name was
              the h1, which reads as a page about the centre rather than about the room. */}
          <Text style={theme.h1}>Roll</Text>
          {centre && <Text style={styles.where}>{centre.name}</Text>}

          {/* First thing on the screen, always. Not a report somebody goes and finds. */}
          <RatioBar ratio={roll.ratio} pendingCount={roll.pendingCount} />

          {/* Above the list, never over it — a strip that floats covers a child, and the one
              it covers is the one nobody signs in. */}
          <OfflineStrip online={online} pendingCount={roll.pendingCount} />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          title="Nobody is enrolled yet"
          body="A manager enrols tamariki on the web app, and the roll starts here tomorrow morning."
          /* No button: nothing on this phone enrols a child, and the sentence already names
             who does it and where. */
          action={{ next: 'Once somebody is enrolled, they appear here and can be signed in.' }}
        />
      }
      renderItem={({ item }) => (
        <View style={styles.row}>
          <ChildCard
            child={item.child}
            conditions={item.conditions}
            // Consent gaps belong on the whānau screens and on the office web app. An educator at
            // the door cannot fix a missing consent, so surfacing it here would be noise in the
            // one place that must stay scannable.
            consents={[]}
            showConsentGaps={false}
            present={item.present}
            since={item.since}
            pending={item.pending}
            action={
              <SignInButton
                present={item.present}
                childName={item.child.preferredName || item.child.firstName}
                onPress={() => void toggle(item.child.id, item.present)}
              />
            }
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: space['3'] },
  where: { fontSize: font.size.sm, color: color.inkMuted, marginBottom: space['3'] },
});
