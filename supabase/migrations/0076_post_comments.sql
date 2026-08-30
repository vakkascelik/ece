-- ---------------------------------------------------------------------------
-- 0076 — comments on posts, the moderation state, and pinning
--
-- Phase 10b of docs/doorway-without-infocare.md, from the 2026-08-30 Educa screenshots.
-- Educa reports on comments in three of its ten reports — Usage Overview counts "stories
-- vs. comments", plus a Parent Engagement Graph and a Stories and Comments report — and
-- this schema had no table for them at all. A grep of every migration for "comment"
-- returned nothing but `comment on table` DDL.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS DOES NOT TOUCH `posts_select`
--
-- The tempting shape is a visibility clause of its own: staff at the centre, or a
-- guardian of a child named on the post, or anyone at the centre for a pānui. That is
-- `posts_select` (0013) copied, and a copy of a guardianship rule is the thing this repo
-- has been bitten by. `post_strands` (0058) already established the alternative and its
-- header explains it: a policy's USING clause may reference another table, and that
-- reference is itself subject to the referenced table's RLS for the calling session. So
--
--     post_id in (select id from public.posts)
--
-- already means "posts this caller may read", with the staff/guardian/pānui branches
-- evaluated once, in the place that owns them. This migration adds no branch to the
-- visibility of a post and changes no existing policy.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- MODERATION IS THREE STATES, AND "AUTO-APPROVED" IS NOT "APPROVED BY SOMEBODY"
--
-- Educa's default is "Approved Comments Only", with "Auto Approve" and "Disable" beside
-- it, chosen per post. The default is copied here because it is the right one for a
-- service publishing about other people's children: a comment naming a second child
-- should not appear under a learning moment before anybody has read it.
--
-- A comment is therefore pending, approved, or declined — and `moderated_by` is
-- separate from `approved_at` on purpose. An auto-approved comment has `approved_at`
-- set and `moderated_by` null, which is a true and distinguishable fact: nobody read
-- it. Folding those together — stamping the author, or the post's author, as the
-- approver — would put a person's name against a decision they never made, in a table
-- a family can ask to see.
--
-- WHAT THERE IS NO STATE FOR: editing. There is no UPDATE on `body` in the grants and
-- no DELETE at all, which is `messages` (0016) and `evidence_photos` (0075) again. A
-- declined comment stays, declined. This is a deliberate difference from Educa, where a
-- comment can be removed: what a centre published to a family, and what a family said
-- back, is a record of a relationship, and the centre is the party with the power in it.
-- If a comment must actually be destroyed — a mistaken disclosure about another child —
-- that is a deletion request under the Privacy Act, handled by a person with the service
-- role, not a button in a feed.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.comment_mode as enum ('approved_first', 'auto', 'disabled');
exception when duplicate_object then null; end $$;

comment on type public.comment_mode is
  'Per-post: whether a comment appears at once, waits for a kaiako, or cannot be left. Default approved_first.';

alter table public.posts
  add column if not exists comment_mode public.comment_mode not null default 'approved_first';

/**
 * Pinned to the top of the feed.
 *
 * A timestamp rather than a boolean, for the reason every other flag in this schema is:
 * "pinned, and since when" answers a question a boolean cannot, and two posts pinned on
 * different days have an order without a second column. Null is the ordinary state.
 */
alter table public.posts
  add column if not exists pinned_at timestamptz;

create index if not exists posts_pinned_idx on public.posts (centre_id, pinned_at desc)
  where pinned_at is not null and archived_at is null;

-- ---------------------------------------------------------------------------
-- The comments
-- ---------------------------------------------------------------------------

create table if not exists public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,

  /**
   * Null when the account is deleted, the same `on delete set null` every authored row
   * in this schema uses. The comment survives the account because the conversation it
   * was part of did.
   */
  author_id   uuid references auth.users(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now(),

  /** Visible to the post's audience from this moment. Set by the trigger in `auto` mode. */
  approved_at timestamptz,
  /** Refused. Stays for the record; see the header for why nothing is deleted. */
  declined_at timestamptz,
  /**
   * Who decided — null when the post's mode approved it without anybody reading it.
   * Not a redundant copy of `approved_at`: see the header.
   */
  moderated_by uuid references auth.users(id) on delete set null,

  constraint post_comments_body_present check (length(trim(body)) > 0),
  /* A comment is pending, approved or declined. Never two of them. */
  constraint post_comments_one_outcome
    check (approved_at is null or declined_at is null),
  /* A person cannot have decided nothing. The reverse is allowed — that is auto-approval. */
  constraint post_comments_moderator_decided
    check (moderated_by is null or approved_at is not null or declined_at is not null)
);

comment on table public.post_comments is
  'Whānau and kaiako replies to a post. Append-only: no UPDATE on body, no DELETE. Moderated per the post''s comment_mode.';

create index if not exists post_comments_post_idx
  on public.post_comments (post_id, created_at);

/* The moderation queue: the only rows a kaiako has to act on. Partial, because on a busy
   site the pending set is a rounding error against the approved one. */
create index if not exists post_comments_pending_idx
  on public.post_comments (post_id)
  where approved_at is null and declined_at is null;

-- ---------------------------------------------------------------------------
-- The gate at insert
-- ---------------------------------------------------------------------------

/**
 * Refuse a comment the post does not accept, and auto-approve where the post says so.
 *
 * SECURITY DEFINER and reading `posts` directly, the same shape as `enforce_media_consent`
 * (0013). The mode belongs to the post, not to the commenter, so it cannot be a WITH CHECK
 * on a column the caller supplies — a client that sets `approved_at` itself would be
 * approving its own comment, which is the whole thing moderation exists to stop.
 *
 * `approved_at` and `declined_at` are forced to their correct values here rather than
 * merely defaulted, for exactly that reason: whatever the caller sent is discarded.
 */
create or replace function public.enforce_comment_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode      public.comment_mode;
  v_published timestamptz;
  v_archived  timestamptz;
begin
  select p.comment_mode, p.published_at, p.archived_at
    into v_mode, v_published, v_archived
    from public.posts p
   where p.id = new.post_id;

  if v_mode is null then
    raise exception 'No such post.' using errcode = 'check_violation';
  end if;

  /*
    A draft has no audience, so a comment on one would be a reply to something nobody has
    been shown. Staff can see drafts — this is the one place that visibility must not
    become a way to start a conversation early.
  */
  if v_published is null then
    raise exception 'That post has not been published yet.' using errcode = 'check_violation';
  end if;

  if v_archived is not null then
    raise exception 'That post has been archived.' using errcode = 'check_violation';
  end if;

  if v_mode = 'disabled' then
    raise exception 'Comments are turned off for that post.' using errcode = 'check_violation';
  end if;

  new.declined_at := null;
  new.moderated_by := null;
  new.approved_at := case when v_mode = 'auto' then now() else null end;

  return new;
end $$;

drop trigger if exists post_comments_mode on public.post_comments;
create trigger post_comments_mode
  before insert on public.post_comments
  for each row execute function public.enforce_comment_mode();

/**
 * Moderation is a decision, and a decision is attributable.
 *
 * The column grant below lets a kaiako write `approved_at`, `declined_at` and
 * `moderated_by`, but nothing makes the third agree with the first two — an UPDATE
 * setting `approved_at` and leaving `moderated_by` null would be indistinguishable from
 * auto-approval, which is precisely the distinction the header says this table keeps.
 * So the trigger stamps it from `auth.uid()` rather than trusting the client to.
 */
create or replace function public.stamp_comment_moderator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.approved_at is distinct from old.approved_at)
     or (new.declined_at is distinct from old.declined_at) then
    new.moderated_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists post_comments_moderator on public.post_comments;
create trigger post_comments_moderator
  before update on public.post_comments
  for each row execute function public.stamp_comment_moderator();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.post_comments enable row level security;

/**
 * Who reads a comment.
 *
 * The first clause delegates the entire audience question to `posts` — see the header.
 * The second is this table's own rule and it is the reason the delegation is not enough
 * on its own: a comment that has not been approved is not part of the post yet. Its
 * author may see it, because otherwise they type something and it vanishes; staff at the
 * centre may see it, because somebody has to moderate it. Nobody else, including the
 * other whānau who can read the post.
 */
drop policy if exists post_comments_select on public.post_comments;
create policy post_comments_select on public.post_comments
  for select using (
    post_id in (select id from public.posts)
    and (
      approved_at is not null
      or author_id = auth.uid()
      or post_id in (
        select id from public.posts
         where centre_id in (select public.caller_staff_centre_ids())
      )
    )
  );

/**
 * Who may leave one.
 *
 * Anybody who can read the post, writing as themselves. `author_id = auth.uid()` is the
 * same anti-impersonation condition `posts_write_insert` carries, and it matters more
 * here: a post is written by staff, a comment is written by a family, and a comment
 * attributed to the wrong parent is a sentence in somebody else's mouth about a child.
 *
 * The subquery is `posts` with no further condition, so a parent may comment exactly
 * where they may read — and the trigger above decides whether it appears.
 */
drop policy if exists post_comments_insert on public.post_comments;
create policy post_comments_insert on public.post_comments
  for insert
  with check (
    author_id = auth.uid()
    and post_id in (select id from public.posts)
  );

/**
 * Who moderates.
 *
 * Staff at the post's centre, and no author exception: a parent approving their own
 * comment is the moderation queue with an opt-out. INSERT and UPDATE are separate
 * policies rather than one `FOR ALL`, which 0022 split fourteen policies to achieve and
 * `review:security` check 5 exists to keep — `FOR ALL` covers SELECT, so a table with
 * both would carry two permissive read paths that OR together.
 *
 * There is no DELETE policy and no DELETE grant. See the header.
 */
drop policy if exists post_comments_moderate on public.post_comments;
create policy post_comments_moderate on public.post_comments
  for update
  using (
    post_id in (
      select id from public.posts
       where centre_id in (select public.caller_staff_centre_ids())
    )
  )
  with check (
    post_id in (
      select id from public.posts
       where centre_id in (select public.caller_staff_centre_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Privileges
--
-- The column list is the real boundary on what a moderator can change: with a bare
-- `grant update`, a kaiako could rewrite the body of a parent's comment and leave it
-- attributed to them. Postgres tests the table privilege before it reaches the policy,
-- so this refuses first and refuses loudly.
-- ---------------------------------------------------------------------------

revoke all on public.post_comments from anon, authenticated, service_role;
grant select, insert on public.post_comments to authenticated, service_role;
grant update (approved_at, declined_at, moderated_by) on public.post_comments
  to authenticated, service_role;

drop trigger if exists post_comments_audit on public.post_comments;
create trigger post_comments_audit
  after insert or update or delete on public.post_comments
  for each row execute function public.audit_trigger();
