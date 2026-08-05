/**
 * Posts, media, and messages between kaiako and whānau.
 *
 * Nothing here checks consent, and that is the point. The gate is two Postgres mechanisms — a
 * trigger on `media_children` that refuses an attachment, and a **restrictive** policy on
 * `media` that re-checks on every read. A consent check written here as well would be a third
 * implementation of a rule that must have exactly one, and it would be the one that drifts.
 *
 * `attachChildToMedia` therefore translates the trigger's error rather than pre-empting it: the
 * database is the authority and the message it raises is already written for a human.
 */

import { MEDIA_BUCKET, type PostKind } from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface Post {
  id: string;
  centreId: string;
  kind: PostKind;
  title: string;
  body: string;
  authorId: string | null;
  publishedAt: string | null;
  createdAt: string;
}

const POST_COLUMNS = 'id, centre_id, kind, title, body, author_id, published_at, created_at';

interface PostRow {
  id: string;
  centre_id: string;
  kind: PostKind;
  title: string;
  body: string;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
}

const toPost = (r: PostRow): Post => ({
  id: r.id,
  centreId: r.centre_id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  authorId: r.author_id,
  publishedAt: r.published_at,
  createdAt: r.created_at,
});

/**
 * The feed.
 *
 * A parent and an educator call the same function and get different rows: staff see everything
 * at the centre including drafts, and a parent sees published pānui plus posts naming their own
 * children. No filtering here — see 0013.
 */
export async function listPosts(
  db: Db,
  centreId: string,
  opts: { limit?: number } = {},
): Promise<Post[]> {
  const { data, error } = await db
    .from('posts')
    .select(POST_COLUMNS)
    .eq('centre_id', centreId)
    .is('archived_at', null)
    // Drafts have no published_at, so ordering by created_at keeps them with the day they were
    // written rather than sorting them to the bottom forever.
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw new Error(`listPosts: ${error.message}`);
  return (data as PostRow[]).map(toPost);
}

export async function getPost(db: Db, postId: string): Promise<Post | null> {
  const { data, error } = await db.from('posts').select(POST_COLUMNS).eq('id', postId).maybeSingle();
  if (error) throw new Error(`getPost: ${error.message}`);
  return data ? toPost(data as PostRow) : null;
}

export async function createPost(
  db: Db,
  centreId: string,
  input: { kind: PostKind; title: string; body: string; childIds?: string[]; publish?: boolean },
): Promise<Post> {
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from('posts')
    .insert({
      centre_id: centreId,
      kind: input.kind,
      title: input.title.trim(),
      body: input.body.trim(),
      author_id: auth.user?.id ?? null,
      published_at: input.publish ? new Date().toISOString() : null,
    })
    .select(POST_COLUMNS)
    .single();
  if (error) throw new Error(`createPost: ${error.message}`);
  const post = toPost(data as PostRow);

  const childIds = input.childIds ?? [];
  if (childIds.length > 0) {
    const { error: linkError } = await db
      .from('post_children')
      .insert(childIds.map((child_id) => ({ post_id: post.id, child_id })));
    if (linkError) {
      // The post exists and is about nobody, which for a learning moment means it reaches no
      // whānau at all. Louder than leaving it: a silently audience-less post looks published.
      throw new Error(
        `createPost: the post was created but naming the children failed (${linkError.message}). ` +
          `It currently reaches nobody — add them, or delete it.`,
      );
    }
  }

  return post;
}

/** Publishing is a separate act from writing, and it is what a notification hangs off. */
export async function publishPost(db: Db, postId: string): Promise<void> {
  const { error } = await db
    .from('posts')
    .update({ published_at: new Date().toISOString() })
    .eq('id', postId)
    .is('published_at', null);
  if (error) throw new Error(`publishPost: ${error.message}`);
}

export async function archivePost(db: Db, postId: string): Promise<void> {
  const { error } = await db
    .from('posts')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', postId);
  if (error) throw new Error(`archivePost: ${error.message}`);
}

export async function listPostChildren(db: Db, postIds: string[]): Promise<Map<string, string[]>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await db
    .from('post_children')
    .select('post_id, child_id')
    .in('post_id', postIds);
  if (error) throw new Error(`listPostChildren: ${error.message}`);
  const out = new Map<string, string[]>();
  for (const r of data as { post_id: string; child_id: string }[]) {
    const list = out.get(r.post_id);
    if (list) list.push(r.child_id);
    else out.set(r.post_id, [r.child_id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaKind = 'photo' | 'video' | 'document';
export type MediaAudience = 'journal' | 'public';

export interface MediaItem {
  id: string;
  centreId: string;
  postId: string | null;
  kind: MediaKind;
  audience: MediaAudience;
  storagePath: string;
  mimeType: string | null;
  caption: string | null;
  createdAt: string;
}

const MEDIA_COLUMNS =
  'id, centre_id, post_id, kind, audience, storage_path, mime_type, caption, created_at';

interface MediaRow {
  id: string;
  centre_id: string;
  post_id: string | null;
  kind: MediaKind;
  audience: MediaAudience;
  storage_path: string;
  mime_type: string | null;
  caption: string | null;
  created_at: string;
}

const toMedia = (r: MediaRow): MediaItem => ({
  id: r.id,
  centreId: r.centre_id,
  postId: r.post_id,
  kind: r.kind,
  audience: r.audience,
  storagePath: r.storage_path,
  mimeType: r.mime_type,
  caption: r.caption,
  createdAt: r.created_at,
});

/**
 * Media for a set of posts.
 *
 * Anything whose consent has been withdrawn simply is not in the result — the restrictive policy
 * removed it. So a caller cannot tell the difference between "no photos" and "photos you may no
 * longer see", which is correct: the alternative announces to an educator that a family withdrew
 * consent, on a screen where that is nobody's business.
 */
export async function listMediaForPosts(
  db: Db,
  postIds: string[],
): Promise<Map<string, MediaItem[]>> {
  if (postIds.length === 0) return new Map();
  // Paged: photographs are the fastest-growing table in the product. A page of twenty posts
  // with a dozen photos each is 240 rows, so the cap is only a few screens away — and a
  // truncated read means a whānau member's child is missing from a post they were in.
  const rows = await fetchAll<MediaRow>('listMediaForPosts', (from, to) =>
    db
      .from('media')
      .select(MEDIA_COLUMNS)
      .in('post_id', postIds)
      .order('created_at')
      .order('id')
      .range(from, to),
  );

  const out = new Map<string, MediaItem[]>();
  for (const row of rows) {
    if (!row.post_id) continue;
    const item = toMedia(row);
    const list = out.get(row.post_id);
    if (list) list.push(item);
    else out.set(row.post_id, [item]);
  }
  return out;
}

/**
 * Where an upload should go.
 *
 * `<centre_id>/<uuid>.<ext>` — the first segment is the tenant, which is what lets the storage
 * policy say "your centre only" without joining anything.
 */
export function mediaStoragePath(centreId: string, filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : 'bin';
  // Not the original filename. It can carry a child's name, and a storage path is visible in
  // more places than a database column.
  return `${centreId}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/g, '')}`;
}

export async function createMediaRow(
  db: Db,
  input: {
    centreId: string;
    postId: string | null;
    kind: MediaKind;
    audience: MediaAudience;
    storagePath: string;
    mimeType?: string | null;
    byteSize?: number | null;
    caption?: string | null;
  },
): Promise<MediaItem> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('media')
    .insert({
      centre_id: input.centreId,
      post_id: input.postId,
      kind: input.kind,
      audience: input.audience,
      storage_path: input.storagePath,
      mime_type: input.mimeType ?? null,
      byte_size: input.byteSize ?? null,
      caption: input.caption?.trim() || null,
      uploaded_by: auth.user?.id ?? null,
    })
    .select(MEDIA_COLUMNS)
    .single();
  if (error) throw new Error(`createMediaRow: ${error.message}`);
  return toMedia(data as MediaRow);
}

export type AttachOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Tag a child in a piece of media.
 *
 * **This is where consent is enforced**, by a trigger in Postgres. The error it raises already
 * names the child and says what to do, so it is passed through rather than replaced — a generic
 * "consent required" here would be a worse message than the database's own.
 */
export async function attachChildToMedia(
  db: Db,
  mediaId: string,
  childId: string,
): Promise<AttachOutcome> {
  const { error } = await db.from('media_children').insert({ media_id: mediaId, child_id: childId });
  if (!error) return { ok: true };
  // 23514 is the check_violation the consent trigger raises.
  if (error.code === '23514' || /consent/i.test(error.message)) {
    return { ok: false, reason: error.message };
  }
  throw new Error(`attachChildToMedia: ${error.message}`);
}

/**
 * A time-limited URL for a private object.
 *
 * The bucket is private, so this is the only way to display media. Signing goes through the
 * caller's own client, which means the storage policy — and through it the consent gate — decides
 * whether a URL can be issued at all. A withdrawn consent stops the URL being issuable rather
 * than merely hiding the row.
 *
 * Short expiry on purpose. A signed URL is a bearer token for a photograph of a child, and it
 * will end up in a browser cache and possibly a chat message.
 */
export async function signMediaUrl(
  db: Db,
  storagePath: string,
  expiresInSeconds = 900,
): Promise<string | null> {
  const { data, error } = await db.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  // Null rather than throwing: the usual cause is that the caller may no longer read it, which
  // is the gate working, and one hidden photo should not fail a whole feed.
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function deleteMedia(db: Db, item: MediaItem): Promise<void> {
  // Storage first. Deleting the row first and failing here would leave an unreferenced object
  // that no policy can reach and nothing knows about; the sweeper catches the reverse.
  await db.storage.from(MEDIA_BUCKET).remove([item.storagePath]);
  const { error } = await db.from('media').delete().eq('id', item.id);
  if (error) throw new Error(`deleteMedia: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageThread {
  id: string;
  centreId: string;
  childId: string | null;
  subject: string;
  startedBy: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface Message {
  id: number;
  threadId: string;
  authorId: string | null;
  body: string;
  at: string;
  readAt: string | null;
}

export async function listThreads(db: Db, centreId: string): Promise<MessageThread[]> {
  // Paged: a thread per child per topic, kept after the child leaves.
  const rows = await fetchAll<{
    id: string;
    centre_id: string;
    child_id: string | null;
    subject: string;
    started_by: string | null;
    created_at: string;
    closed_at: string | null;
  }>('listThreads', (from, to) =>
    db
      .from('message_threads')
      .select('id, centre_id, child_id, subject, started_by, created_at, closed_at')
      .eq('centre_id', centreId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
  return (
    rows as {
      id: string;
      centre_id: string;
      child_id: string | null;
      subject: string;
      started_by: string | null;
      created_at: string;
      closed_at: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    centreId: r.centre_id,
    childId: r.child_id,
    subject: r.subject,
    startedBy: r.started_by,
    createdAt: r.created_at,
    closedAt: r.closed_at,
  }));
}

export async function startThread(
  db: Db,
  input: { centreId: string; childId: string | null; subject: string; body: string },
): Promise<MessageThread> {
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('message_threads')
    .insert({
      centre_id: input.centreId,
      child_id: input.childId,
      subject: input.subject.trim(),
      started_by: auth.user?.id ?? null,
    })
    .select('id, centre_id, child_id, subject, started_by, created_at, closed_at')
    .single();
  if (error) throw new Error(`startThread: ${error.message}`);

  const thread = data as { id: string; centre_id: string; child_id: string | null; subject: string; started_by: string | null; created_at: string; closed_at: string | null };
  await sendMessage(db, thread.id, input.body);

  return {
    id: thread.id,
    centreId: thread.centre_id,
    childId: thread.child_id,
    subject: thread.subject,
    startedBy: thread.started_by,
    createdAt: thread.created_at,
    closedAt: thread.closed_at,
  };
}

export async function listMessages(db: Db, threadId: string): Promise<Message[]> {
  // Paged: a thread about one child runs for as long as they attend, and messages are
  // append-only so nothing ever leaves it. Truncating the oldest thousand would drop the
  // start of a conversation, which is exactly the part somebody scrolls back to find.
  const rows = await fetchAll<{
    id: number;
    thread_id: string;
    author_id: string | null;
    body: string;
    at: string;
    read_at: string | null;
  }>('listMessages', (from, to) =>
    db
      .from('messages')
      .select('id, thread_id, author_id, body, at, read_at')
      .eq('thread_id', threadId)
      .order('at')
      .order('id')
      .range(from, to),
  );
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    authorId: r.author_id,
    body: r.body,
    at: r.at,
    readAt: r.read_at,
  }));
}

/** Append-only. There is no edit and no delete, in the policies or the grants. */
export async function sendMessage(db: Db, threadId: string, body: string): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db
    .from('messages')
    .insert({ thread_id: threadId, author_id: auth.user?.id ?? null, body: body.trim() });
  if (error) throw new Error(`sendMessage: ${error.message}`);
}

/** Marks the *other* side's messages read. The policy refuses your own. */
export async function markThreadRead(db: Db, threadId: string): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .is('read_at', null)
    .neq('author_id', auth.user?.id ?? '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`markThreadRead: ${error.message}`);
}

export async function closeThread(db: Db, threadId: string): Promise<void> {
  const { error } = await db
    .from('message_threads')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw new Error(`closeThread: ${error.message}`);
}
