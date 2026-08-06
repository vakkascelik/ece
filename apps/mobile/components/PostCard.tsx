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
 * not be issued, and `signMediaUrl` says what that usually means: "the caller may no longer read
 * it, which is the gate working".
 *
 * WHAT A NULL URL ACTUALLY MEANS, AND WHY THE NOTICE STAYS
 *
 * It is **not** a withdrawn consent, and getting this wrong in either direction matters.
 *
 * The design pack requires that a photo whose consent was withdrawn renders nothing at all — no
 * placeholder, no notice, nothing announced, because a notice explaining the absence discloses
 * the family's decision. That requirement is already met, and it is met in the strongest possible
 * place: `media_consent_required` is a **restrictive** SELECT policy on `public.media`, so
 * withdrawing consent removes the *row*. The client never learns the photo existed. The RLS suite
 * asserts it directly — "withdrawing consent hides existing media from STAFF, not only from
 * whānau" — with `count(*) = 0`.
 *
 * So a row that arrives here with `url === null` is a **malfunction**: storage unreachable, a bad
 * path, a clock skew. Saying so is correct. Removing this notice on privacy grounds — which was
 * tried on 2026-08-06 — silences a real failure and buys no privacy at all, because the case it
 * was protecting never reaches this component.
 *
 * (What sent that change the wrong way was a comment on `signMediaUrl` claiming the usual cause of
 * a null URL is "the caller may no longer read it, which is the gate working". It cannot be: a
 * caller who may not read it has no row to sign. That comment is now corrected.)
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

      {/*
        A malfunction, not a consent decision — see the note above. Worded as a loading failure
        rather than "not available", which reads like a permission and is the one thing this is
        not.
      */}
      {unavailable > 0 && (
        <View style={{ marginTop: space['2'] }}>
          <Flag tone="quiet">
            {unavailable === 1 ? 'a photo could not be loaded' : `${unavailable} photos could not be loaded`}
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
