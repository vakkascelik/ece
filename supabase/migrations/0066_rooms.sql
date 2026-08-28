-- ---------------------------------------------------------------------------
-- 0066 — rooms
--
-- The first migration of the 1Place replacement (docs/replacing-1place.md). It is
-- first because everything else in that plan hangs off it: tasks, checklist runs,
-- incidents and hazards are all read by staff as "which part of the building", and
-- until now this schema had no way to say so. `incidents.location` and `hazards.area`
-- are free text, which means the two centres have been spelling the same playground
-- three ways and no filter can group them.
--
-- WHY A PARENT CAN READ THIS TABLE, WHEN THEY CANNOT READ THE OTHER REGISTERS
--
-- 0034 established the house rule for anything that belongs to the building:
-- `caller_staff_centre_ids()`, because a parent is a member of the centre and the
-- obvious predicate hands them the hazard register. That rule is right there and it is
-- wrong here, for one concrete reason.
--
-- An incident is readable by the guardian of the child it is about — that is the whole
-- point of `acknowledged_at`. Once `incidents.room_id` exists, a staff-only `rooms`
-- table means the family reads "your child was hurt" with the place blanked out,
-- because the join is refused. The record would be *less* informative to its intended
-- audience than the paper form it replaced.
--
-- And the thing being disclosed is "Toddler Room" — a label the family says on the
-- phone every morning. The hazard register is a list of risks the centre has recorded
-- about itself; a room name is a noun. So: `caller_person_centre_ids()` for reads
-- (four human roles, kiosk excluded — a door tablet has no use for this), and
-- owner/manager for writes, because a room list is configuration rather than daily
-- practice.
--
-- The alternative was denormalising the room name onto every row that references one.
-- Rejected: the name then freezes at write time, renaming a room silently forks the
-- history into two labels for one place, and it puts the same string in five tables.
-- ---------------------------------------------------------------------------

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,

  name        text not null,
  /**
   * Display order, because alphabetical is wrong for this list.
   *
   * A centre reads its rooms youngest-first — Infant, Toddler, Preschool — and that
   * is neither alphabetical nor creation order. Ordering by name puts Carpark above
   * Infant on a screen used at speed.
   */
  sort        smallint not null default 0,

  /**
   * Archived, never deleted.
   *
   * A room that closes still has last year's incidents pointing at it, and the
   * evidence binder has to be able to render them. Archiving takes the room out of
   * every picker and leaves the history intact. There is no DELETE grant below, so
   * this is the only way out.
   */
  archived_at timestamptz,

  created_at  timestamptz not null default now(),

  constraint rooms_name_present check (length(trim(name)) > 0)
);

comment on table public.rooms is
  'Named spaces within a centre — Infant, Playground 1, Kitchen. Referenced by tasks, checklist runs, incidents, hazards and safety checks. Archived, never deleted, because closed rooms still hold history.';

comment on column public.rooms.archived_at is
  'Set when a room stops being used. It disappears from pickers and keeps its history. There is no DELETE grant on this table for anybody.';

/*
  Two live rooms called "Toddler" in one centre is a data-entry slip, and the cost
  lands later: every filter, every dropdown and every printed checklist becomes
  ambiguous, and nobody can tell which of the two last month's incidents were filed
  against. Case-insensitive because the slip is usually capitalisation.

  Scoped to live rooms only. Archiving "Toddler" and opening a new "Toddler" is a
  real thing a centre does after a rebuild, and the constraint must not block it.
*/
create unique index if not exists rooms_centre_live_name_idx
  on public.rooms (centre_id, lower(name))
  where archived_at is null;

create index if not exists rooms_centre_idx
  on public.rooms (centre_id, sort, name)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- The references
--
-- All nullable. Every one of these tables already holds rows recorded before rooms
-- existed, and a NOT NULL would require inventing a room for each of them — which is
-- the schema asserting something nobody checked. Null means "not recorded", and the
-- screens say that rather than guessing.
--
-- `on delete set null` rather than `restrict`: no DELETE grant exists on `rooms`, so
-- this can only ever fire from a `centres` cascade, and `restrict` there would have a
-- centre deletion fail against its own children's incidents.
-- ---------------------------------------------------------------------------

alter table public.incidents
  add column if not exists room_id uuid references public.rooms(id) on delete set null;

alter table public.hazards
  add column if not exists room_id uuid references public.rooms(id) on delete set null;

alter table public.safety_checks
  add column if not exists room_id uuid references public.rooms(id) on delete set null;

comment on column public.incidents.room_id is
  'Where it happened, when the centre has a room list. `location` remains for the free text that does not fit a room — the front path, a trip to the park.';

create index if not exists incidents_room_idx on public.incidents (room_id, occurred_at desc)
  where room_id is not null;
create index if not exists hazards_room_idx on public.hazards (room_id)
  where room_id is not null and resolved_at is null;

/*
  `safety_checks` is append-only and already carries a grant that names its columns
  by omission — `grant select, insert` with no UPDATE. Adding a column to an
  append-only table is safe; adding one to a table whose INSERT grant is column-scoped
  would not be, and this one is not scoped.
*/

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.rooms enable row level security;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select using (centre_id in (select public.caller_person_centre_ids()));

/*
  Writes are owner/manager. An educator who finds a hazard files it against a room
  that already exists; they do not invent the building's floor plan mid-shift, and a
  room created by accident pollutes every picker in the product until somebody
  notices.
*/
drop policy if exists rooms_write_insert on public.rooms;
create policy rooms_write_insert on public.rooms
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists rooms_write_update on public.rooms;
create policy rooms_write_update on public.rooms
  for update using (
            public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
          )
          with check (
            public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
          );

-- No DELETE policy and no DELETE grant. See `archived_at`.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.rooms from anon, authenticated, service_role;
grant select, insert, update on public.rooms to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

drop trigger if exists rooms_audit on public.rooms;
create trigger rooms_audit
  after insert or update or delete on public.rooms
  for each row execute function public.audit_trigger();
