'use server';

import { revalidatePath } from 'next/cache';
import {
  addComment,
  archivePost,
  attachChildToMedia,
  createMediaRow,
  createPost,
  deleteMedia,
  mediaStoragePath,
  moderateComment,
  publishPost,
  setCommentMode,
  setPinned,
  type MediaAudience,
  type MediaItem,
} from '@ece/api';
import {
  COMMENT_MODE_LABELS,
  MEDIA_BUCKET,
  POST_KIND_LABELS,
  type CommentMode,
  type PostKind,
} from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability, requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();

export async function write(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const kind = str(form, 'kind') as PostKind;
  if (!(kind in POST_KIND_LABELS)) return { error: 'That is not a kind of post.' };

  const title = str(form, 'title');
  const body = str(form, 'body');
  if (!title) return { error: 'Give it a title.' };
  if (!body) return { error: 'There is nothing to say yet.' };

  const childIds = form.getAll('childIds').map((c) => c.toString());
  // A learning moment about nobody reaches nobody, because the audience is derived from the
  // children named. Better to refuse than to publish something that looks sent and arrives
  // nowhere.
  if (kind !== 'panui' && childIds.length === 0) {
    return { error: 'Name at least one child, or make it a pānui for the whole centre.' };
  }
  if (kind === 'panui' && childIds.length > 0) {
    return { error: 'A pānui goes to the whole centre, so it does not name children.' };
  }

  // Optional, and the form only offers it for a learning moment or daily update — see
  // Compose.tsx. A blank submission here is the normal case, not an error to catch.
  const strandIds = form.getAll('strandIds').map((s) => s.toString());

  try {
    await createPost(db, ctx.centre.id, {
      kind,
      title,
      body,
      childIds,
      strandIds,
      // Never publish straight from the compose form. An educator writing up a learning moment
      // should be able to look at it before forty families do.
      publish: false,
    });
  } catch (e) {
    return actionError(e, 'posts.write');
  }

  revalidatePath('/posts');
  return { ok: true };
}

export async function publish(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const postId = str(form, 'postId');
  if (!postId) return { error: 'Missing post.' };
  try {
    await publishPost(db, postId);
  } catch (e) {
    return actionError(e, 'posts.publish');
  }
  revalidatePath('/posts');
  return { ok: true };
}

export async function archive(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const postId = str(form, 'postId');
  if (!postId) return { error: 'Missing post.' };
  try {
    await archivePost(db, postId);
  } catch (e) {
    return actionError(e, 'posts.archive');
  }
  revalidatePath('/posts');
  return { ok: true };
}

/**
 * Leave a comment. 0076.
 *
 * `requireCtx`, not `requireCapability('recordDailyPractice')` — a comment from a family is
 * the whole point, and every other action on this page is staff-only. Who may comment on
 * *which* post is `post_comments_insert`'s question, and it delegates to `posts`, so a
 * parent reaches exactly the posts they can read. Nothing is re-checked here.
 */
export async function comment(_prev: unknown, form: FormData): Promise<Result> {
  await requireCtx();
  const db = await serverDb();
  const postId = str(form, 'postId');
  const body = str(form, 'body');
  if (!postId) return { error: 'Missing post.' };
  if (!body) return { error: 'There is nothing to send yet.' };
  try {
    await addComment(db, postId, body);
  } catch (e) {
    // The trigger's messages are written for a human — "Comments are turned off for that
    // post." — so `actionError` passes them through rather than replacing them.
    return actionError(e, 'posts.comment');
  }
  revalidatePath('/posts');
  return { ok: true };
}

export async function moderate(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const commentId = str(form, 'commentId');
  const decision = str(form, 'decision');
  if (!commentId) return { error: 'Missing comment.' };
  if (decision !== 'approve' && decision !== 'decline') return { error: 'Unknown decision.' };
  try {
    await moderateComment(db, commentId, decision);
  } catch (e) {
    return actionError(e, 'posts.moderate');
  }
  revalidatePath('/posts');
  return { ok: true };
}

/**
 * Pin or unpin.
 *
 * `recordDailyPractice` gets you to the action; `posts_write_update` (0028) decides whether
 * it changes a row — the author, an owner or a manager. An educator pinning a colleague's
 * post is filtered rather than refused, so it reports success and changes nothing, which is
 * why the button is only drawn for `canSteward`.
 */
export async function pin(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const postId = str(form, 'postId');
  if (!postId) return { error: 'Missing post.' };
  try {
    await setPinned(db, postId, str(form, 'pinned') === 'true');
  } catch (e) {
    return actionError(e, 'posts.pin');
  }
  revalidatePath('/posts');
  return { ok: true };
}

export async function commentMode(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();
  const postId = str(form, 'postId');
  const mode = str(form, 'mode') as CommentMode;
  if (!postId) return { error: 'Missing post.' };
  if (!(mode in COMMENT_MODE_LABELS)) return { error: 'That is not a comment setting.' };
  try {
    await setCommentMode(db, postId, mode);
  } catch (e) {
    return actionError(e, 'posts.commentMode');
  }
  revalidatePath('/posts');
  return { ok: true };
}

/**
 * Upload a photo and tag the children in it.
 *
 * The consent gate lives in Postgres, so this does not check consent — it *reacts* to being
 * refused, and undoes the upload when it is. That ordering is forced: the file has to exist
 * before there is a media row to attach a child to.
 *
 * The cleanup matters. Without it, a refused attachment leaves an object in storage and a media
 * row pointing at it with no children — invisible to every reader, and permanent.
 */
export async function attach(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const postId = str(form, 'postId');
  const file = form.get('file');
  const audience = (str(form, 'audience') || 'journal') as MediaAudience;
  const childIds = form.getAll('childIds').map((c) => c.toString());

  if (!postId) return { error: 'Missing post.' };
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a photo.' };
  if (audience !== 'journal' && audience !== 'public') return { error: 'Unknown audience.' };
  if (childIds.length === 0) {
    // Untagged media would bypass the gate entirely: no children means nothing to check.
    return { error: 'Say which children are in it. That is what the consent check needs.' };
  }

  const storagePath = mediaStoragePath(ctx.centre.id, file.name);

  const upload = await db.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });
  if (upload.error) {
    return { error: `Could not upload: ${upload.error.message}` };
  }

  let media: MediaItem;
  try {
    media = await createMediaRow(db, {
      centreId: ctx.centre.id,
      postId,
      kind: file.type.startsWith('video/') ? 'video' : file.type === 'application/pdf' ? 'document' : 'photo',
      audience,
      storagePath,
      mimeType: file.type || null,
      byteSize: file.size,
      caption: str(form, 'caption') || null,
    });
  } catch (e) {
    await db.storage.from(MEDIA_BUCKET).remove([storagePath]);
    return actionError(e, 'posts.attach');
  }

  for (const childId of childIds) {
    const outcome = await attachChildToMedia(db, media.id, childId);
    if (!outcome.ok) {
      // Refused by the gate. Take the file and the row back out rather than leaving a photo
      // nobody may see sitting in storage, and pass the database's own message through — it
      // already names the child and says what to do.
      await deleteMedia(db, media);
      return { error: outcome.reason };
    }
  }

  revalidatePath('/posts');
  return { ok: true };
}
