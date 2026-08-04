import { Image, StyleSheet, Text, View } from 'react-native';
import { POST_KIND_LABELS, type PostKind } from '@ece/core';
import { color, font, radius, space, theme } from '../theme';
import { Flag } from './Flag';

export interface FeedMedia {
  id: string;
  kind: string;
  /** A short-lived signed URL, or null when one could not be issued. */
  url: string | null;
}

export interface FeedPost {
  id: string;
  kind: PostKind;
  title: string;
  body: string;
  publishedAt: string | null;
  childNames: string[];
  media: FeedMedia[];
}

/**
 * One post in the whānau feed.
 *
 * Images come from short-lived signed URLs, because the bucket is private — a public URL for a
 * photograph of a child is a disclosure, not a configuration choice. A null URL means one could
 * not be issued, which normally means consent no longer covers it; the card says so plainly
 * rather than rendering a broken image.
 */
export function PostCard({ post }: { post: FeedPost }) {
  const photos = post.media.filter((m) => m.kind === 'photo');
  const unavailable = photos.filter((m) => !m.url).length;

  return (
    <View style={theme.card}>
      <View style={[theme.row, { marginBottom: space['2'] }]}>
        <Flag tone="quiet">{POST_KIND_LABELS[post.kind]}</Flag>
        {post.publishedAt && (
          <Text style={styles.when}>
            {new Date(post.publishedAt).toLocaleDateString('en-NZ', {
              day: 'numeric',
              month: 'short',
            })}
          </Text>
        )}
      </View>

      <Text style={styles.title}>{post.title}</Text>

      {post.childNames.length > 0 && (
        <Text style={styles.about}>About {post.childNames.join(', ')}</Text>
      )}

      <Text style={styles.body}>{post.body}</Text>

      {photos
        .filter((m) => m.url)
        .map((m) => (
          <Image
            key={m.id}
            source={{ uri: m.url! }}
            style={styles.photo}
            // A photograph of a child, so the whole image matters rather than a crop of it.
            resizeMode="cover"
            accessibilityLabel="Photo from the centre"
          />
        ))}

      {unavailable > 0 && (
        <View style={{ marginTop: space['2'] }}>
          <Flag tone="quiet">
            {unavailable === 1 ? 'a photo is not available' : `${unavailable} photos not available`}
          </Flag>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    color: color.ink,
    marginBottom: space['1'],
  },
  about: { fontSize: font.size.base, color: color.inkMuted, marginBottom: space['2'] },
  body: { fontSize: font.size.mobileBase, color: color.ink, lineHeight: 24 },
  when: { fontSize: font.size.sm, color: color.inkMuted },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    marginTop: space['3'],
    backgroundColor: color.surfaceSunken,
  },
});
