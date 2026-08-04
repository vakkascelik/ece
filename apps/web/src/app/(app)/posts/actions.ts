'use server';

import { revalidatePath } from 'next/cache';
import {
  archivePost,
  attachChildToMedia,
  createMediaRow,
  createPost,
  deleteMedia,
  mediaStoragePath,
  publishPost,
  type MediaAudience,
  type MediaItem,
} from '@ece/api';
import { MEDIA_BUCKET, POST_KIND_LABELS, type PostKind } from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability } from '@/lib/auth';
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

  try {
    await createPost(db, ctx.centre.id, {
      kind,
      title,
      body,
      childIds,
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
