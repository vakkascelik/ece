import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { listChildren, listConsentsByChild, listHealthByChild } from '@ece/api';
import { displayName, missingConsents, type Child, type ConsentState, type HealthCondition } from '@ece/core';
import { space, theme } from '../theme';
import { ChildCard } from '../components/ChildCard';
import { EmptyState } from '../components/EmptyState';
import { useSession } from '../state/SessionProvider';
import { supabase } from '../lib/supabase';

/**
 * A parent's own children.
 *
 * `listChildren` is the same call the roll makes. It returns one child here and thirty on a
 * staff device, because the policy on `children` keys on guardianship as well as centre — the
 * query has no filter in it and must not grow one. If this screen ever shows a child who is not
 * theirs, the bug is in a policy, not here.
 *
 * **No ratio bar and no sign-in buttons.** A parent has no `recordDailyPractice` capability, and
 * the ratio is a compliance figure about the centre's staffing rather than something a family is
 * owed on a phone.
 *
 * This is where `ChildCard`'s consent props finally get real values. On the roll they are passed
 * empty, because an educator at the door cannot fix a missing consent and the list has to stay
 * scannable. Here a gap is exactly what the parent can act on.
 */
export function TamarikiScreen() {
  const navigation = useNavigation<{ navigate: (screen: string, params: object) => void }>();
  const { activeCentre } = useSession();

  const [children, setChildren] = useState<Child[]>([]);
  const [health, setHealth] = useState<Map<string, HealthCondition[]>>(new Map());
  const [consents, setConsents] = useState<Map<string, ConsentState[]>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCentre) return;
    try {
      const [kids, conditions, consentMap] = await Promise.all([
        listChildren(supabase, activeCentre),
        listHealthByChild(supabase, activeCentre),
        listConsentsByChild(supabase, activeCentre),
      ]);
      setChildren(kids);
      setHealth(conditions);
      setConsents(consentMap);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your tamariki.');
    }
  }, [activeCentre]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <FlatList
      style={theme.screen}
      contentContainerStyle={theme.content}
      data={children}
      keyExtractor={(c) => c.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      ListHeaderComponent={error ? <Text style={theme.error}>{error}</Text> : null}
      ListEmptyComponent={
        // The pack's copy. "Your centre links your child to your account" says whose job it
        // is, which the previous wording buried behind "ask them if this looks wrong" —
        // a sentence that invites somebody to worry before telling them the process is
        // normal. The action goes to Messages because that is the only thing they can
        // actually do about it from a phone.
        <EmptyState
          title="No tamariki linked yet"
          body="Your centre links your child to your account."
          action={{
            label: 'Message the centre',
            // 'Messages' is a sibling *tab*, not a route in this stack. React Navigation
            // bubbles an unmatched navigate up to the parent navigator, which is where it
            // resolves. Like everything else in this app, unverified on a device — see
            // unverified-claims item 15.
            onPress: () => navigation.navigate('Messages', {}),
          }}
        />
      }
      renderItem={({ item }) => {
        const theirConsents = consents.get(item.id) ?? [];
        const gaps = missingConsents(theirConsents);
        return (
          <Pressable
            style={{ marginBottom: space['4'] }}
            onPress={() =>
              navigation.navigate('Child', { childId: item.id, name: displayName(item) })
            }
            accessibilityRole="button"
            accessibilityLabel={
              gaps.length > 0
                ? `${displayName(item)}, ${gaps.length} consents still needed`
                : displayName(item)
            }
          >
            <ChildCard
              child={item}
              conditions={health.get(item.id) ?? []}
              consents={theirConsents}
              // The one screen where a consent gap is actionable by the person reading it.
              showConsentGaps
            />
          </Pressable>
        );
      }}
    />
  );
}
