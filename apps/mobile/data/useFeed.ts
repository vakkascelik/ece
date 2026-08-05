import { useCallback, useEffect, useState } from 'react';
import {
  listChildren,
  listMediaForPosts,
  listPostChildren,
  listPosts,
  signMediaUrl,
} from '@ece/api';
import { displayName } from '@ece/core';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/SessionProvider';
import type { FeedPost } from '../components/PostCard';

/**
 * The pānui feed: what the centre has published, with its photographs.
 *
 * WHY THE URLS ARE SIGNED IN PARALLEL NOW
 *
 * They were signed in a sequential `for` loop — one round trip per photograph, awaited in turn.
 * Twenty posts with a dozen photos each is 240 serial requests before the screen renders, on
 * exactly the connection a centre has.
 *
 * The reason the loop existed is still respected: **signing is the consent gate.** A URL that
 * cannot be issued is the storage policy refusing a photograph of a child whose whānau have not
 * consented, and it must not fail the whole feed. `signMediaUrl` returns `null` rather than
 * throwing for that reason, so `Promise.all` is safe here — there is nothing to reject.
 *
 * A `null` URL renders as nothing at all. Not a broken-image icon and not an error: consent that
 * is not held is not a failure, and drawing attention to the gap would leak which child it was.
 */
export function useFeed() {
  const { activeCentre } = useSession();
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCentre) return;
    setLoading(true);
    try {
      // Twenty is a feed, not an archive. A parent scrolling back further is a feature nobody
      // has asked for, and fetching everything is how the 1000-row cap gets hit quietly.
      const posts = await listPosts(supabase, activeCentre, { limit: 20 });
      const ids = posts.map((p) => p.id);

      // The children are needed only to turn ids into names. Fetched alongside rather than
      // reusing the roll hook, so the two screens stay independent.
      const [links, mediaByPost, kids] = await Promise.all([
        listPostChildren(supabase, ids),
        listMediaForPosts(supabase, ids),
        listChildren(supabase, activeCentre),
      ]);
      const nameOf = new Map(kids.map((c) => [c.id, displayName(c)]));

      const built = await Promise.all(
        posts.map(async (post) => {
          const media = mediaByPost.get(post.id) ?? [];
          const withUrls = await Promise.all(
            media.map(async (item) => ({
              id: item.id,
              kind: item.kind,
              url: await signMediaUrl(supabase, item.storagePath),
            })),
          );
          return {
            id: post.id,
            kind: post.kind,
            title: post.title,
            body: post.body,
            publishedAt: post.publishedAt,
            childNames: (links.get(post.id) ?? []).map((id) => nameOf.get(id) ?? 'a child'),
            media: withUrls,
          } satisfies FeedPost;
        }),
      );

      setFeed(built);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the feed.');
    } finally {
      setLoading(false);
    }
  }, [activeCentre]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Drafts have no `publishedAt` and are nobody's business but the author's. */
  const published = feed.filter((p) => p.publishedAt !== null);

  return { feed: published, loading, error, reload: load };
}
