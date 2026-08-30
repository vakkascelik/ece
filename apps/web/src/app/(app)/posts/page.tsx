import {
  listChildren,
  listCommentsForPosts,
  listCurriculumStrands,
  listMediaForPosts,
  listPostChildren,
  listPosts,
  signMediaUrl,
} from '@ece/api';
import { can, displayName, POST_KIND_LABELS, REO } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { Compose } from './Compose';
import { PostCard } from './PostCard';
import { PageHeader } from '../PageHeader';

/**
 * The feed — pānui, daily updates and learning moments.
 *
 * One route for two very different readers. Staff see drafts and can publish; a parent sees
 * published pānui plus posts naming their own children. Nothing here filters for that: the
 * policies in 0013 decide, so a parent and an educator call the same `listPosts`.
 *
 * Media that a family has withdrawn consent for is simply absent from the result — removed by the
 * restrictive policy, not hidden by this page. A caller cannot tell "no photos" from "photos you
 * may no longer see", which is correct: the alternative announces a withdrawal to whoever is
 * looking at the screen.
 */
export default async function PostsPage() {
  const ctx = await requireCtx();
  const db = await serverDb();
  const isStaff = can(ctx.role, 'recordDailyPractice');

  const posts = await listPosts(db, ctx.centre.id);
  const ids = posts.map((p) => p.id);

  const [childLinks, mediaByPost, commentsByPost, children, strands] = await Promise.all([
    listPostChildren(db, ids),
    listMediaForPosts(db, ids),
    /*
      Not gated on `isStaff`, unlike the two below. A comment thread is the one thing on
      this page a parent both reads and writes — `post_comments_select` returns the
      approved ones, their own however it is moving, and the pending queue only to staff.
    */
    listCommentsForPosts(db, ids),
    // Staff need the roster to name children in a post. A parent does not, and would only get
    // their own child back anyway.
    isStaff ? listChildren(db, ctx.centre.id) : Promise.resolve([]),
    // Reference data, not centre-scoped — fetched for staff only, the same reasoning as
    // the roster above: a parent composes nothing, so has no form to put this on.
    isStaff ? listCurriculumStrands(db) : Promise.resolve([]),
  ]);

  const nameOf = new Map(children.map((c) => [c.id, displayName(c)]));

  // Signed one at a time, because signing is what the storage policy checks — and a URL that
  // cannot be issued is exactly the consent gate reaching the file.
  const signed = new Map<string, string>();
  for (const items of mediaByPost.values()) {
    for (const item of items) {
      const url = await signMediaUrl(db, item.storagePath);
      if (url) signed.set(item.id, url);
    }
  }

  return (
    <>
      <PageHeader
        title={isStaff ? 'Posts' : POST_KIND_LABELS.panui + ' and learning moments'}
        subtitle={
          isStaff
            ? `What ${REO.whanau} at ${ctx.centre.name} see. Drafts are visible only to kaiako.`
            : `From the kaiako at ${ctx.centre.name}.`
        }
      />

      {isStaff && (
        <Compose
          children_={children.map((c) => ({ id: c.id, name: displayName(c) }))}
          strands={strands}
        />
      )}

      {posts.length === 0 ? (
        <div className="card">
          <p className="empty">
            {isStaff ? 'Nothing written yet.' : 'Nothing from the centre yet.'}
          </p>
        </div>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            kindLabel={POST_KIND_LABELS[post.kind]}
            childNames={(childLinks.get(post.id) ?? []).map((id) => nameOf.get(id) ?? 'a child')}
            media={(mediaByPost.get(post.id) ?? []).map((m) => ({
              id: m.id,
              kind: m.kind,
              audience: m.audience,
              caption: m.caption,
              url: signed.get(m.id) ?? null,
            }))}
            canManage={isStaff}
            /* Its author, or somebody accountable for what the centre publishes. Mirrors
               `posts_write_update` after 0028 — the policy is the boundary, this only decides
               whether the button is drawn. */
            canSteward={
              isStaff &&
              (post.authorId === null ||
                post.authorId === ctx.userId ||
                can(ctx.role, 'manageCentre'))
            }
            childOptions={children.map((c) => ({ id: c.id, name: displayName(c) }))}
            comments={commentsByPost.get(post.id) ?? []}
            canModerate={isStaff}
            viewerId={ctx.userId}
          />
        ))
      )}
    </>
  );
}
