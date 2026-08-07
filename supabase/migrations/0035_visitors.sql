-- ---------------------------------------------------------------------------
-- 0035 — the visitor book
--
-- Who was on site, and when they left. The cheapest table in the product and one of
-- the first things asked for after an incident: a contractor, a relieving teacher, a
-- grandparent waiting in the foyer, an ERO reviewer. It has been a spiral notebook on
-- a shelf by the door.
--
-- WHY A ROW WITH A NULLABLE SIGN-OUT, AND NOT TWO EVENTS
--
-- `attendance_events` records in and out as separate append-only rows, because a
-- child has a persistent identity that both events hang off and because those events
-- underpin a funding claim. A visitor has neither. There is nothing to join a second
-- event to except the first one, so the pair would be a row with extra steps — and
-- the append-only discipline buys nothing here, since nobody is claiming money
-- against a plumber.
--
-- So: one mutable row, signed out by setting a column, with the audit trigger
-- recording any change. `DELETE` is withheld for the same reason as everywhere else
-- in this phase.
-- ---------------------------------------------------------------------------

create table if not exists public.visitors (
  id            uuid primary key default gen_random_uuid(),
  centre_id     uuid not null references public.centres(id) on delete cascade,

  full_name     text not null,
  organisation  text,
  /**
   * Why they came and who they came to see, as two fields.
   *
   * "Contractor" and "here to see the manager about the roof" answer different
   * questions, and after an incident the second is the one that matters — it is how
   * you work out whether an adult was ever alone with children.
   */
  purpose       text,
  visiting      text,

  signed_in_at  timestamptz not null,
  signed_out_at timestamptz,

  recorded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint visitors_name_present check (length(trim(full_name)) > 0),
  constraint visitors_not_future check (signed_in_at <= now() + interval '2 hours'),
  constraint visitors_out_after_in check (signed_out_at is null or signed_out_at >= signed_in_at)
);

comment on table public.visitors is
  'Who was on site. One mutable row per visit; signing out sets a column. No DELETE grant exists — a visit that happened is evidence.';

create index if not exists visitors_centre_idx on public.visitors (centre_id, signed_in_at desc);
-- Partial: "who is still in the building" is the question asked in an evacuation, and
-- it is asked while the building is on fire.
create index if not exists visitors_on_site_idx on public.visitors (centre_id)
  where signed_out_at is null;

-- ---------------------------------------------------------------------------
-- Policies — staff at the centre, the same one-liner as 0034
-- ---------------------------------------------------------------------------

alter table public.visitors enable row level security;

drop policy if exists visitors_select on public.visitors;
create policy visitors_select on public.visitors
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists visitors_write_insert on public.visitors;
create policy visitors_write_insert on public.visitors
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (recorded_by is null or recorded_by = auth.uid())
  );

drop policy if exists visitors_write_update on public.visitors;
create policy visitors_write_update on public.visitors
  for update using (centre_id in (select public.caller_staff_centre_ids()))
          with check (centre_id in (select public.caller_staff_centre_ids()));

-- No DELETE policy and no DELETE grant. A visitor book somebody can remove a name
-- from is not a visitor book.

revoke all on public.visitors from anon, authenticated, service_role;
grant select, insert, update on public.visitors to authenticated, service_role;

drop trigger if exists visitors_audit on public.visitors;
create trigger visitors_audit
  after insert or update or delete on public.visitors
  for each row execute function public.audit_trigger();
