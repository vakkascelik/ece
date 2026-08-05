import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { POST_KIND_LABELS } from '@ece/core';
import { space, theme } from '../theme';
import { PostCard } from '../components/PostCard';
import { useFeed } from '../data/useFeed';
import { useSession } from '../state/SessionProvider';

/**
 * What the centre has published. The same screen for staff and whānau, with one word different.
 *
 * WHY ONE SCREEN AND NOT TWO
 *
 * The content is identical — the policies decide what comes back, not the component. A staff
 * member sees drafts excluded because `publishedAt` is null, and a parent sees only the posts and
 * media their consents allow, both enforced in Postgres. Writing two screens to render the same
 * rows differently would mean two places for the consent gate to be got wrong.
 *
 * The heading changes because the audience's own word for it changes: `Pānui` is what whānau call
 * it, with the macron, because `panui` without one is a different word.
 */
export function PanuiScreen() {
  const { isParent, online } = useSession();
  const { feed, loading, error, reload } = useFeed();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return (
    <FlatList
      style={theme.screen}
      contentContainerStyle={theme.content}
      data={feed}
      keyExtractor={(post) => post.id}
      refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={() => void onRefresh()} />}
      ListHeaderComponent={
        <View>
          <Text style={theme.h1}>{isParent ? POST_KIND_LABELS.panui : 'Posts'}</Text>
          {!online && (
            <Text style={[theme.muted, { marginBottom: space['3'] }]}>
              Offline — showing the last update.
            </Text>
          )}
          {error && <Text style={theme.error}>{error}</Text>}
        </View>
      }
      ListEmptyComponent={
        <Text style={theme.muted}>
          {isParent
            ? 'Nothing from the kaiako yet.'
            : 'Nothing published yet. Posts are written on the web app.'}
        </Text>
      }
      renderItem={({ item }) => (
        <View style={{ marginBottom: space['4'] }}>
          <PostCard post={item} />
        </View>
      )}
    />
  );
}
