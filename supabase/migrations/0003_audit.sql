-- 0003 — audit log
--
-- Early childhood education is a regulated setting, and after an incident the
-- question is always "who knew what, and when". A licensing review asks the same
-- thing about records. So mutations to anything consequential are recorded, and
-- the record cannot be edited by the people it is about.
--
-- Deliberately append-only: no UPDATE policy, no DELETE policy, for anybody
-- including owners. An audit log an owner can quietly edit is not evidence, and
-- being able to say "this cannot be altered" is most of its value.

create table if not exists public.audit_events (
  id          bigserial primary key,
  centre_id   uuid        not null references public.centres(id) on delete cascade,
  actor_id    uuid        references auth.users(id) on delete set null,
  action      text        not null,
  entity      text        not null,
  entity_id   text,
  -- What changed, not the whole row. Storing the full before/after of a child
  -- record would duplicate health and custody data into a table nobody thinks of
  -- as holding it — and audit rows outlive the records they describe.
  detail      jsonb       not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only record of consequential changes. No update or delete policy exists, by design.';
comment on column public.audit_events.detail is
  'Changed fields only. Never store health, custody or contact detail here — audit rows outlive the record they describe.';

create index if not exists audit_events_centre_at_idx on public.audit_events (centre_id, at desc);
create index if not exists audit_events_entity_idx    on public.audit_events (centre_id, entity, entity_id);

alter table public.audit_events enable row level security;

-- Read: anyone who administers the centre. An educator does not need the audit
-- log, and a parent certainly does not.
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events
  for select using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

-- Write: any member of the centre may append, because the app records the
-- actions of educators as well as managers. WITH CHECK pins the row to a centre
-- the caller belongs to and the actor to the caller — without the actor clause,
-- a member could write an entry blaming somebody else, which is worse than
-- having no log at all.
drop policy if exists audit_insert on public.audit_events;
create policy audit_insert on public.audit_events
  for insert with check (
    centre_id in (select public.caller_centre_ids())
    and (actor_id is null or actor_id = auth.uid())
  );

-- No UPDATE or DELETE policy. RLS denies by default, so omitting them is the
-- enforcement, not an oversight. Correcting a mistaken entry means appending a
-- correcting entry.

/**
 * Helper so application code records an event in one line and cannot forget the
 * actor or the centre.
 */
create or replace function public.record_audit(
  p_centre_id uuid,
  p_action    text,
  p_entity    text,
  p_entity_id text default null,
  p_detail    jsonb default '{}'::jsonb
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.audit_events (centre_id, actor_id, action, entity, entity_id, detail)
  values (p_centre_id, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
$$;

-- security invoker, not definer: the insert must be subject to the same policy
-- as a direct write, so a caller cannot use this function to log against a
-- centre they do not belong to.
