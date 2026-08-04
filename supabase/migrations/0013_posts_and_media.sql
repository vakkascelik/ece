-- 0013 — pānui, learning moments, and media that cannot exist without consent
--
-- The phase `has_consent()` was built for. Since 0004 it has been a function nobody called;
-- from here it decides whether a photograph of a child may be attached at all.
--
-- THE CONSENT GATE IS TWO MECHANISMS, NOT ONE
--
-- The plan asks for media to be "consent-gated at upload — refused server-side, not hidden".
-- That is necessary and not sufficient, because consent can be withdrawn *after* the upload.
-- Either mechanism alone fails:
--
--   * A trigger alone: a parent withdraws photo consent and last month's photos stay visible.
--     The withdrawal did nothing, which is the opposite of what it means.
--   * A policy alone: the upload succeeds, the file lands in storage, and the post shows a
--     silent gap. Nobody is told why, and the file exists.
--
-- So both. A trigger refuses the attachment outright with a message a human can act on, and
-- the read policy re-checks consent on every read so a withdrawal takes effect immediately
-- and retroactively.
--
-- WHICH CONSENT, AND WHY IT MATTERS THAT THERE ARE TWO
--
-- 0004 split photo consent into `photo_internal` (the private journal their whānau reads) and
-- `photo_public` (the website, social media, printed material) on the grounds that families
-- who agree to the first routinely refuse the second. `media.audience` is the other half of
-- that split: it decides which consent is required, so the distinction finally does work
-- rather than sitting in an enum.
--
-- Video is gated by the same consent as photographs. The consent wording says "Photos of your
-- child", which most services read as covering moving images — but it is a reading, not a
-- certainty. A centre that wants a separate video consent needs a new `consent_kind`, not a
-- looser gate here.

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.post_kind as enum ('learning_moment', 'daily_update', 'panui');
exception when duplicate_object then null; end $$;

comment on type public.post_kind is
  'panui is a notice to the whole centre. The other two are about named children and are seen only by their whānau.';

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres(id) on delete cascade,
  kind         public.post_kind not null,

  title        text not null,
  body         text not null,

  author_id    uuid references auth.users(id) on delete set null,
  /**
   * Null until published.
   *
   * A draft is invisible to whānau, which is the point: an educator writing up a learning
   * moment at 2pm should not be broadcasting half a sentence. Publishing is a deliberate act
   * and it is what a notification hangs off.
   */
  published_at timestamptz,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint posts_title_present check (length(trim(title)) > 0),
  constraint posts_body_present  check (length(trim(body)) > 0)
);

create index if not exists posts_centre_idx on public.posts (centre_id, published_at desc)
  where archived_at is null;

/**
 * Which children a post is about.
 *
 * Drives audience *and* nothing else — media consent is tracked per media item, not here,
 * because a post about three children can carry a photo of one of them.
 */
create table if not exists public.post_children (
  post_id  uuid not null references public.posts(id)    on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  primary key (post_id, child_id)
);

create index if not exists post_children_child_idx on public.post_children (child_id);

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.media_kind as enum ('photo', 'video', 'document');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.media_audience as enum ('journal', 'public');
exception when duplicate_object then null; end $$;

comment on type public.media_audience is
  'journal requires photo_internal consent; public requires photo_public. This is what makes the two-kind split in 0004 do work.';

create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres(id) on delete cascade,
  post_id      uuid references public.posts(id) on delete cascade,

  kind         public.media_kind not null,
  audience     public.media_audience not null default 'journal',

  /** Path within the `media` storage bucket. Never a public URL. */
  storage_path text not null unique,
  mime_type    text,
  byte_size    integer,
  caption      text,

  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint media_path_present check (length(trim(storage_path)) > 0)
);

create index if not exists media_post_idx   on public.media (post_id);
create index if not exists media_centre_idx on public.media (centre_id, created_at desc);

/** Which children appear in a piece of media. The row the consent gate guards. */
create table if not exists public.media_children (
  media_id uuid not null references public.media(id)    on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  primary key (media_id, child_id)
);

create index if not exists media_children_child_idx on public.media_children (child_id);

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

/**
 * Does this child currently have the consent an audience requires?
 *
 * SECURITY DEFINER, and deliberately **not** granted to `authenticated`. The question here is
 * "does this child have consent", not "may the caller read this child's consent" — the gate
 * has to be answerable while a policy is being evaluated, regardless of who is asking. Making
 * it callable directly would hand anybody an oracle for "does child X have photo consent".
 *
 * `has_consent()` from 0004 stays as the app-facing, `security invoker` version, which fails
 * closed for a caller who cannot see the child. Both exist on purpose.
 */
create or replace function public.child_consent_for_audience(
  p_child uuid,
  p_audience public.media_audience
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ce.granted
       from public.consent_events ce
      where ce.child_id = p_child
        and ce.kind = (case p_audience
                         when 'public' then 'photo_public'::public.consent_kind
                         else 'photo_internal'::public.consent_kind
                       end)
      order by ce.at desc, ce.id desc
      limit 1),
    -- Never asked is not permission. Same three-state reasoning as the consent UI: refused
    -- and unasked are different facts and neither of them is yes.
    false
  )
$$;

revoke execute on function public.child_consent_for_audience(uuid, public.media_audience)
  from public, anon, authenticated;

/**
 * Is every child in this media item covered?
 *
 * Takes a media id rather than a child id, which is the narrow surface that makes it safe to
 * grant: a caller can only ask about media, and asking about a media id they do not have is a
 * very weak oracle. `child_consent_for_audience` above is not granted at all.
 *
 * One child without consent hides the whole item. That is correct rather than harsh — a
 * photograph containing a child whose whānau said no cannot be shown because the other
 * children in it said yes.
 */
create or replace function public.media_consent_satisfied(p_media uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from public.media_children mc
      join public.media m on m.id = mc.media_id
     where mc.media_id = p_media
       and not public.child_consent_for_audience(mc.child_id, m.audience)
  )
$$;

comment on function public.media_consent_satisfied(uuid) is
  'True when every child tagged in this media has current consent for its audience. Re-evaluated on every read, so withdrawing consent hides existing media immediately.';

revoke execute on function public.media_consent_satisfied(uuid) from public, anon;
grant  execute on function public.media_consent_satisfied(uuid) to authenticated, service_role;

/**
 * Refuse the attachment at insert time, with a message somebody can act on.
 *
 * The read policy would hide it anyway. This exists so an educator finds out *while they are
 * uploading* rather than discovering later that a post has a silent gap in it — and so the
 * file does not sit in storage attached to nothing.
 */
create or replace function public.enforce_media_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audience public.media_audience;
  v_name     text;
begin
  select m.audience into v_audience from public.media m where m.id = new.media_id;
  if v_audience is null then
    raise exception 'No such media item.';
  end if;

  if not public.child_consent_for_audience(new.child_id, v_audience) then
    select coalesce(c.preferred_name, c.first_name) into v_name
      from public.children c where c.id = new.child_id;
    raise exception
      'No % consent recorded for %. Record the consent decision first, or remove them from this media.',
      case v_audience when 'public' then 'public sharing' else 'photo' end,
      coalesce(v_name, 'that child')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists media_children_consent on public.media_children;
create trigger media_children_consent
  before insert on public.media_children
  for each row execute function public.enforce_media_consent();

/**
 * Changing a media item's audience re-opens the question.
 *
 * Moving a journal photo to `public` needs `photo_public` consent from every child in it, and
 * without this a caption edit could quietly widen the audience of a photograph. The read
 * policy would still hide it — but silently, which is the failure mode this whole migration
 * is arranged to avoid.
 */
create or replace function public.enforce_media_audience_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.audience is distinct from old.audience then
    if exists (
      select 1 from public.media_children mc
       where mc.media_id = new.id
         and not public.child_consent_for_audience(mc.child_id, new.audience)
    ) then
      raise exception
        'Not every child in this media has consent for that audience.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists media_audience_change on public.media;
create trigger media_audience_change
  before update on public.media
  for each row execute function public.enforce_media_audience_change();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.posts          enable row level security;
alter table public.post_children  enable row level security;
alter table public.media          enable row level security;
alter table public.media_children enable row level security;

/**
 * Who sees a post.
 *
 * Staff see everything at their centre, drafts included. A parent sees published posts only,
 * and then only a pānui — a notice to the whole centre — or a post naming one of their own
 * children. A learning moment about somebody else's child is not theirs to read, which is the
 * same guardianship boundary as the rest of the schema.
 */
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select using (
    centre_id in (select public.caller_staff_centre_ids())
    or (
      published_at is not null
      and archived_at is null
      and centre_id in (select public.caller_centre_ids())
      and (
        kind = 'panui'
        or exists (
          select 1 from public.post_children pc
           where pc.post_id = posts.id
             and pc.child_id in (select public.caller_ward_ids())
        )
      )
    )
  );

-- Educators write these. It is the daily practice record, not office work.
drop policy if exists posts_write on public.posts;
create policy posts_write on public.posts
  for all
  using      (centre_id in (select public.caller_staff_centre_ids()))
  with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (author_id is null or author_id = auth.uid())
  );

drop policy if exists post_children_select on public.post_children;
create policy post_children_select on public.post_children
  for select using (
    public.caller_is_staff_for_child(child_id)
    or child_id in (select public.caller_ward_ids())
  );

drop policy if exists post_children_write on public.post_children;
create policy post_children_write on public.post_children
  for all
  using      (public.caller_is_staff_for_child(child_id))
  with check (public.caller_is_staff_for_child(child_id));

/**
 * Media: visible only while consent holds.
 *
 * The `media_consent_satisfied` clause is the retroactive half of the gate. Withdrawing photo
 * consent hides existing media on the next read, with no cleanup job and no cache to
 * invalidate — which is why consent is stored as events and read through a view rather than
 * cached as a flag.
 *
 * Staff are subject to it too. A photograph of a child whose whānau has withdrawn consent is
 * not one an educator should be browsing either, and exempting staff would leave the app
 * displaying something the family has refused.
 */
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select using (
    (
      centre_id in (select public.caller_staff_centre_ids())
      or exists (
        select 1 from public.media_children mc
         where mc.media_id = media.id
           and mc.child_id in (select public.caller_ward_ids())
      )
      -- Media attached to a pānui names no children and is visible to the centre.
      or exists (
        select 1 from public.posts p
         where p.id = media.post_id
           and p.kind = 'panui'
           and p.published_at is not null
           and p.centre_id in (select public.caller_centre_ids())
      )
    )
    and public.media_consent_satisfied(media.id)
  );

drop policy if exists media_write on public.media;
create policy media_write on public.media
  for all
  using      (centre_id in (select public.caller_staff_centre_ids()))
  with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (uploaded_by is null or uploaded_by = auth.uid())
  );

drop policy if exists media_children_select on public.media_children;
create policy media_children_select on public.media_children
  for select using (
    public.caller_is_staff_for_child(child_id)
    or child_id in (select public.caller_ward_ids())
  );

drop policy if exists media_children_write on public.media_children;
create policy media_children_write on public.media_children
  for all
  using      (public.caller_is_staff_for_child(child_id))
  with check (public.caller_is_staff_for_child(child_id));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.posts          from anon, authenticated, service_role;
revoke all on public.post_children  from anon, authenticated, service_role;
revoke all on public.media          from anon, authenticated, service_role;
revoke all on public.media_children from anon, authenticated, service_role;

grant select, insert, update, delete on public.posts         to authenticated, service_role;
grant select, insert, delete on public.post_children         to authenticated, service_role;
grant select, insert, delete on public.media_children        to authenticated, service_role;

-- Media: no wholesale UPDATE. `audience` and `caption` are the only editable fields, and
-- confining it by column means a storage_path cannot be repointed at a different file after
-- the consent check passed.
grant select, insert, delete on public.media to authenticated, service_role;
grant update (audience, caption) on public.media to authenticated, service_role;
