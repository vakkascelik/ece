-- ---------------------------------------------------------------------------
-- 0086 — where the child lives
--
-- Required by two independent sources, which is why it comes before the rest of the §6-1
-- work:
--
--   1. **Funding Handbook §6-1**, read 2026-09-04. An enrolment record must include "the
--      child's official name, date of birth, and **home/residential address**, and the
--      child's preferred surname and first name (if any)".
--   2. **The ELI schema.** `ChildEnrolment` carries `PrimaryResidentialAddress` as a
--      **required** element, plus an optional nillable `SecondaryResidentialAddress`.
--
-- Until now this product held addresses only on `guardians.address` (0004:97). A child
-- living with a grandparent while the primary contact is a parent elsewhere had no
-- recorded address at all, and `llm-wiki/wiki/eli-integration.md` has named it as the
-- `ChildEnrolment` blocker since 2026-09-02.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- STRUCTURED, NOT FREE TEXT, AND THE SCHEMA IS WHY
--
-- `guardians.address` is one `text` column. The obvious move was to copy that shape onto
-- the child. **It would not serialise.** `ChildEnrolmentAddress`, read from the XSD on
-- 2026-09-04:
--
--     Address1Line     String100   required
--     Address2Line     String100   optional, nillable
--     AddressCity      String100   required
--     AddressCountry   String100   optional, nillable
--     AddressPostCode  String100   optional, nillable
--
-- Two of the five are **required**, so a free-text address would have to be split into
-- street and city at the boundary — and splitting a New Zealand address by guesswork puts
-- the suburb in the street field on a return to the Crown. That is precisely the kind of
-- inference [AGENTS.md §5](../../AGENTS.md) forbids, and it would be invisible: the
-- message would validate.
--
-- So the fields are stored as the interface asks for them, and the `String100` bounds are
-- enforced HERE rather than at serialisation. A paste of a 140-character address should be
-- refused while somebody is looking at the form, not silently truncated later by a
-- serialiser nobody is watching.
--
-- `guardians.address` is left alone. It is not on the wire and it is somebody's postal
-- address for a newsletter, not a funding field.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A TABLE, NOT TEN COLUMNS ON `children`
--
-- Two addresses × five fields is ten columns, eight of them nullable, on the most-read
-- table in the product: `listChildren` is called from thirteen places, including the roll
-- and the ratio surfaces, none of which want an address. Widening that read for data only
-- the enrolment screen uses is the wrong trade, and ten nullable columns to express "up to
-- two of something" is the shape that invites an eleventh.
--
-- The table also earns its own audit trail, which matters more than it sounds: an address
-- change is a fact somebody may later need to date, and `audit_trigger()` gives that for
-- free once the row lives somewhere.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- REPLACED IN PLACE, NOT SUPERSEDED
--
-- `unique (child_id, kind)` means a child has at most one primary and one secondary
-- address, and a move is an UPDATE. Deliberately unlike `child_booking_schedule` (0085),
-- which supersedes with an effective window — because a funding claim is computed against
-- the days and times the agreement stated at the time, and is **not** computed against an
-- address. So the history an address needs is the audit log, which records who changed
-- which column and when, not an effective-dated chain nobody would query.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO COLUMN GRANT NEEDED, CHECKED RATHER THAN ASSUMED
--
-- `children` and `enrolments` both carry table-wide grants; only `centres` is
-- column-scoped. Measured before writing: `authenticated` holds SELECT, INSERT, UPDATE and
-- DELETE on `children` and its column-privilege counts equal its thirteen columns in every
-- verb. This is a new table, so it needs its own table grant and no column grant at all —
-- and after 0047/0048 and 0066/0082 the reflex to add one everywhere is worth resisting
-- where it would be misleading.
-- ---------------------------------------------------------------------------

create table if not exists public.child_addresses (
  id                uuid primary key default gen_random_uuid(),
  child_id          uuid not null references public.children(id) on delete cascade,

  -- 'primary' or 'secondary', matching the two the schema allows. A CHECK rather than an
  -- enum, for the reason 0080 gives: adding a third is then a deliberate migration, and
  -- `alter type … add value` cannot be undone.
  kind              text not null,

  address1_line     text not null,
  address2_line     text,
  address_city      text not null,
  address_country   text,
  address_post_code text,

  recorded_at       timestamptz not null default now(),
  -- Staff, not the parent. The parent's attestation covers the accuracy of the enrolment
  -- record as a whole (§6-1 item 5) and is a separate field on `enrolments`; this is
  -- whoever typed it in.
  recorded_by       uuid references auth.users(id) on delete set null,

  constraint child_addresses_kind_known
    check (kind in ('primary', 'secondary')),
  constraint child_addresses_one_per_kind
    unique (child_id, kind),

  -- The two the schema requires must actually say something. `not null` alone would accept
  -- a single space, which serialises as a present-but-empty required element.
  constraint child_addresses_line1_present
    check (length(trim(address1_line)) > 0),
  constraint child_addresses_city_present
    check (length(trim(address_city)) > 0),

  -- String100, from the XSD. Refused here so a long address is a sentence on a form rather
  -- than a silent truncation in a serialiser.
  constraint child_addresses_within_string100
    check (
      length(address1_line) <= 100
      and (address2_line is null or length(address2_line) <= 100)
      and length(address_city) <= 100
      and (address_country is null or length(address_country) <= 100)
      and (address_post_code is null or length(address_post_code) <= 100)
    )
);

create index if not exists child_addresses_child_idx
  on public.child_addresses (child_id, kind);

comment on table public.child_addresses is
  'Where a child lives. Required by Funding Handbook 6-1 as part of the enrolment record, and by the ELI ChildEnrolment event which carries PrimaryResidentialAddress as a required element. Structured rather than free text because ChildEnrolmentAddress requires Address1Line and AddressCity separately, and splitting a free-text address by guesswork would put the suburb in the street field on a Crown return. At most one primary and one secondary per child; a move is an UPDATE and its history is the audit log, because no funding figure is computed against an address.';

comment on column public.child_addresses.kind is
  'primary or secondary, matching the two addresses the ELI schema allows. PrimaryResidentialAddress is required on ChildEnrolment; SecondaryResidentialAddress is optional and nillable, for a child with two households.';

comment on column public.child_addresses.recorded_by is
  'Whoever entered it. NOT a parent attestation - 6-1 item 5 wants a dated parent signature on the accuracy of the enrolment record as a whole, which is a separate field on enrolments.';

alter table public.child_addresses enable row level security;

-- Verb-split, with the delete USING written character-identical to the insert WITH CHECK —
-- 0025's lesson, and the class assertion in `rls_isolation.sql` compares the two.
drop policy if exists child_addresses_select on public.child_addresses;
create policy child_addresses_select on public.child_addresses
  for select using (public.caller_may_see_child(child_id));

drop policy if exists child_addresses_write_insert on public.child_addresses;
create policy child_addresses_write_insert on public.child_addresses
  for insert with check (public.caller_may_enrol(child_id));

drop policy if exists child_addresses_write_update on public.child_addresses;
create policy child_addresses_write_update on public.child_addresses
  for update
  using (public.caller_may_enrol(child_id))
  with check (public.caller_may_enrol(child_id));

drop policy if exists child_addresses_write_delete on public.child_addresses;
create policy child_addresses_write_delete on public.child_addresses
  for delete using (public.caller_may_enrol(child_id));

/*
  `caller_may_enrol` (0085) reused rather than a new predicate, and the name is worth a
  word because it says "enrol" on a table about addresses.

  Its body is exactly the question this table needs answered — owner or manager at the
  child's own centre — and §6-1 puts the address IN the enrolment record, so the name is
  less of a stretch than it first looks. A second predicate with an identical body would be
  the duplication that `caller_is_staff_for_child` and `caller_may_see_child` already
  avoid by being genuinely different questions.

  A parent reads their child's address, via `caller_may_see_child`, and cannot change it.
  That is the same split as the booking schedule: the family supplies the facts, the service
  records them, and the record of what the service holds is the service's to maintain.
*/

revoke all on public.child_addresses from anon, authenticated, service_role;
grant select, insert, update, delete on public.child_addresses to authenticated, service_role;

-- DELETE is granted so a secondary address can be removed when a family consolidates
-- households. There is nothing evidential here to protect: the audit log holds the change.

drop trigger if exists child_addresses_audit on public.child_addresses;
create trigger child_addresses_audit
  after insert or update or delete on public.child_addresses
  for each row execute function public.audit_trigger();
