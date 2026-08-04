-- 0010 — how many adults are here
--
-- The ratio needs two numbers and 0009 only produces one. Children are signed in;
-- the adult count has to come from somewhere.
--
-- WHY THIS IS A TABLE AND NOT A BROWSER COOKIE
--
-- The obvious shortcut is a control on the attendance screen holding the number in
-- local state or a cookie. It would work, and it would quietly destroy the thing
-- Phase 3 is built on: ratio history as licensing evidence. A ratio you cannot
-- reconstruct for 10:40 last Tuesday — because half of it was in somebody's browser
-- — is not evidence of anything.
--
-- So it is recorded, append-only, exactly like attendance. "How many adults were
-- present at any moment" then answers from the same kind of query as "which children
-- were here", and the ratio at any past instant is derivable rather than lost.
--
-- WHY IT IS A COUNT AND NOT STAFF SIGN-IN
--
-- Modelling individual staff attendance means rosters, qualifications, breaks, and
-- who counts toward a ratio while on their break — a real feature that belongs with
-- the rest of centre operations, not smuggled in here. A count entered by the person
-- looking at the room is honest about being a human assertion, and it is what the
-- paper sheet on the wall already is.

create table if not exists public.staff_count_events (
  id          bigserial primary key,
  centre_id   uuid not null references public.centres(id) on delete cascade,

  -- Adults counting toward the ratio, as asserted by whoever recorded it.
  adults      smallint not null,

  at          timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  -- Same idempotency contract as attendance, so the mobile outbox can carry these too.
  client_uuid uuid not null unique,
  note        text,
  created_at  timestamptz not null default now(),

  -- A licence caps a centre at a few hundred children; an adult count in the
  -- thousands is a typo, and a negative one is a bug.
  constraint staff_count_plausible check (adults between 0 and 200),
  constraint staff_count_not_future check (at <= now() + interval '2 hours'),
  constraint staff_count_not_ancient check (at > now() - interval '14 days')
);

comment on table public.staff_count_events is
  'Append-only record of how many adults were present. Makes the ratio at any past moment reconstructible, which is what Phase 3 treats as licensing evidence.';

create index if not exists staff_count_centre_at_idx on public.staff_count_events (centre_id, at desc);

/**
 * Adults present now, per the most recent count recorded today.
 *
 * Zero when nothing has been recorded today — which is correct rather than convenient.
 * An unrecorded count is not "probably the same as yesterday"; it is unknown, and a
 * ratio computed against yesterday's staffing would be confidently wrong. Zero makes
 * the room read as a breach, which is the failure direction that gets noticed.
 */
create or replace function public.adults_present_now(p_centre uuid)
returns integer language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select sce.adults
       from public.staff_count_events sce
      where sce.centre_id = p_centre
        and sce.at >= public.centre_day_start(p_centre)
      order by sce.at desc, sce.id desc
      limit 1),
    0
  )
$$;

alter table public.staff_count_events enable row level security;

-- Staff only. A parent has no business asserting how many educators are in the
-- building, and the number feeds a compliance figure.
drop policy if exists staff_count_select on public.staff_count_events;
create policy staff_count_select on public.staff_count_events
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists staff_count_insert on public.staff_count_events;
create policy staff_count_insert on public.staff_count_events
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- No UPDATE, no DELETE. Same reasoning as attendance: a correction is a new count.

revoke all on public.staff_count_events from anon, authenticated, service_role;
grant select, insert on public.staff_count_events to authenticated, service_role;
grant usage on sequence public.staff_count_events_id_seq to authenticated, service_role;

revoke execute on function public.adults_present_now(uuid) from public, anon;
grant  execute on function public.adults_present_now(uuid) to authenticated, service_role;

do $$ begin
  alter publication supabase_realtime add table public.staff_count_events;
exception
  when duplicate_object then null;
  when undefined_object then raise notice 'supabase_realtime not found — skipping';
end $$;
