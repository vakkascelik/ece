-- 0016 — messages between kaiako and whānau
--
-- A thread is about a child, or about the centre. Nothing else, and no group chats: a thread
-- whose audience is "several families" is one where a parent can be quoted to another parent,
-- and there is no version of that a centre wants to explain afterwards.
--
-- APPEND-ONLY, LIKE EVERYTHING ELSE THAT IS A RECORD OF COMMUNICATION
--
-- A message cannot be edited or deleted. This is the record of what a centre told a family
-- about their child, and "what did you tell us on the 12th" is a question that gets asked. An
-- editable message history is not a record of anything.
--
-- The visible consequence is that a typo stays. That is the correct trade, and it is why the
-- UI shows what is about to be sent rather than pretending it can be taken back.

create table if not exists public.message_threads (
  id         uuid primary key default gen_random_uuid(),
  centre_id  uuid not null references public.centres(id) on delete cascade,

  /**
   * The child this thread is about, or null for a thread with the centre itself.
   *
   * Null threads are for things that are not about a specific child — a billing question, a
   * change of address. Their audience is the guardian who started it plus staff, tracked by
   * `started_by` rather than by guardianship.
   */
  child_id   uuid references public.children(id) on delete cascade,
  subject    text not null,

  started_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  /** Closed rather than deleted; reopening is a new message. */
  closed_at  timestamptz,

  constraint message_threads_subject_present check (length(trim(subject)) > 0)
);

create index if not exists message_threads_centre_idx on public.message_threads (centre_id, created_at desc);
create index if not exists message_threads_child_idx  on public.message_threads (child_id) where child_id is not null;

create table if not exists public.messages (
  id         bigserial primary key,
  thread_id  uuid not null references public.message_threads(id) on delete cascade,
  author_id  uuid references auth.users(id) on delete set null,
  body       text not null,
  at         timestamptz not null default now(),

  /**
   * When the other side first read it.
   *
   * A single timestamp rather than per-recipient receipts. A thread has two sides — the centre
   * and one family — so "has the other side seen this" is a single fact, and per-user receipts
   * would turn a message list into a surveillance surface for whoever reads it first.
   */
  read_at    timestamptz,

  constraint messages_body_present check (length(trim(body)) > 0)
);

create index if not exists messages_thread_idx on public.messages (thread_id, at);

-- ---------------------------------------------------------------------------
-- Who is in a thread
-- ---------------------------------------------------------------------------

/**
 * May the caller see this thread?
 *
 * SECURITY DEFINER because it reads `message_threads` and `children`, both under RLS, and is
 * called from the policy on `messages` — which would otherwise recurse.
 */
create or replace function public.caller_in_thread(p_thread uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.message_threads t
     where t.id = p_thread
       and (
         -- Staff at the centre. A message to a family is centre business, not one educator's:
         -- the person who wrote it may be on leave when the reply arrives.
         t.centre_id in (select public.caller_staff_centre_ids())
         -- A guardian of the child it is about.
         or (t.child_id is not null and t.child_id in (select public.caller_ward_ids()))
         -- Or, for a thread about no child, whoever started it.
         or (t.child_id is null and t.started_by = auth.uid())
       )
   )
$$;

revoke execute on function public.caller_in_thread(uuid) from public, anon;
grant  execute on function public.caller_in_thread(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.message_threads enable row level security;
alter table public.messages        enable row level security;

drop policy if exists message_threads_select on public.message_threads;
create policy message_threads_select on public.message_threads
  for select using (public.caller_in_thread(id));

/**
 * Either side may start a thread.
 *
 * A parent starting one is the point of the feature — a centre that can message families but
 * cannot be messaged back has built a broadcast channel, not a conversation. A parent may only
 * start one about their own child, or about no child at all.
 */
drop policy if exists message_threads_insert on public.message_threads;
create policy message_threads_insert on public.message_threads
  for insert with check (
    (started_by is null or started_by = auth.uid())
    and (
      centre_id in (select public.caller_staff_centre_ids())
      or (
        centre_id in (select public.caller_centre_ids())
        and (child_id is null or child_id in (select public.caller_ward_ids()))
      )
    )
  );

-- Closing a thread is staff-side housekeeping.
drop policy if exists message_threads_close on public.message_threads;
create policy message_threads_close on public.message_threads
  for update
  using      (centre_id in (select public.caller_staff_centre_ids()))
  with check (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (public.caller_in_thread(thread_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    public.caller_in_thread(thread_id)
    -- A message attributed to somebody else is worse than no message.
    and (author_id is null or author_id = auth.uid())
    -- Not into a closed thread. Reopening is a staff action.
    and not exists (
      select 1 from public.message_threads t
       where t.id = thread_id and t.closed_at is not null
    )
  );

/**
 * Marking read is the one UPDATE allowed, and only on the other side's messages.
 *
 * Confined to the `read_at` column by the grant below, so this cannot become an edit path. The
 * `author_id <> auth.uid()` clause stops somebody marking their own message read, which would
 * make the receipt meaningless.
 */
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update
  using (public.caller_in_thread(thread_id) and (author_id is null or author_id <> auth.uid()))
  with check (public.caller_in_thread(thread_id));

-- No DELETE policy, for anybody.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.message_threads from anon, authenticated, service_role;
revoke all on public.messages        from anon, authenticated, service_role;

grant select, insert on public.message_threads to authenticated, service_role;
grant update (closed_at) on public.message_threads to authenticated, service_role;

grant select, insert on public.messages to authenticated, service_role;
-- The only writable column after insert. Append-only in every other respect, enforced at the
-- privilege layer as well as the policy layer.
grant update (read_at) on public.messages to authenticated, service_role;
grant usage on sequence public.messages_id_seq to authenticated, service_role;

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'supabase_realtime not found — skipping';
end $$;
