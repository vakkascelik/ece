-- 0011 — staff records: first aid, police vetting, practising certificates
--
-- The part of compliance that is pure record-keeping, and the part a centre most often
-- gets caught by — not because anybody is careless, but because certificates expire
-- quietly and nothing tells you until somebody asks.
--
-- WHY EXPIRY DURATIONS ARE NOT IN THIS SCHEMA
--
-- There is no "first aid certificates last 2 years" anywhere here. Each record carries
-- the `expires_on` printed on the actual document, because the validity period depends
-- on the issuer, the course, and the year it was issued, and hard-coding a duration
-- would silently overwrite what the certificate says. The centre types what is on the
-- paper; the app does arithmetic on that and nothing else.
--
-- WHY `person_name` IS NOT NULL BUT `user_id` IS
--
-- Relievers. A centre holds a police vetting result for somebody who covers two days a
-- term and has no app account, and the record has to exist anyway. So the name is the
-- required field and the account link is optional — which is the opposite of how most
-- of this schema works, for a good reason.

do $$ begin
  create type public.staff_record_kind as enum (
    'first_aid',
    'police_vetting',
    'safety_check',
    'practising_certificate',
    'child_protection_training',
    'other'
  );
exception when duplicate_object then null; end $$;

comment on type public.staff_record_kind is
  'police_vetting and safety_check are distinct: vetting is the Police result, the safety check is the wider assessment a service must complete for a children''s worker.';

create table if not exists public.staff_records (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres(id) on delete cascade,

  -- Optional: relievers and contractors have records and no login.
  user_id      uuid references auth.users(id) on delete set null,
  person_name  text not null,
  role_note    text,

  kind         public.staff_record_kind not null,
  -- Certificate or vetting reference, so a record can be matched to the paper.
  reference    text,
  issued_on    date,
  -- Null means "does not expire", which is true of some training and of nothing else.
  expires_on   date,

  /**
   * Who sighted the original document, and when.
   *
   * Not decoration. A centre is expected to have seen the actual certificate rather
   * than a claim that one exists, so "we have a record" and "somebody checked the
   * document" are different facts and the second is the one that survives a review.
   */
  sighted_by   uuid references auth.users(id) on delete set null,
  sighted_at   timestamptz,

  note         text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),

  constraint staff_records_name_present check (length(trim(person_name)) > 0),
  constraint staff_records_dates_ordered check (expires_on is null or issued_on is null or expires_on >= issued_on),
  -- Sighting is a pair or neither. A sighted_at with nobody attached is not evidence.
  constraint staff_records_sighting_complete check ((sighted_by is null) = (sighted_at is null))
);

comment on table public.staff_records is
  'Certificates, vetting and training per person. expires_on is whatever the document says; no validity period is assumed here.';

create index if not exists staff_records_centre_idx on public.staff_records (centre_id) where archived_at is null;
create index if not exists staff_records_expiry_idx on public.staff_records (centre_id, expires_on) where archived_at is null;
create index if not exists staff_records_user_idx   on public.staff_records (user_id) where user_id is not null;

alter table public.staff_records enable row level security;

/**
 * Owners and managers see the centre's records. An educator sees their own.
 *
 * The second half matters and is easy to leave out. A police vetting result is
 * personal information about the person it concerns, and the Privacy Act gives them a
 * right of access to it (IPP 6) — so an educator being unable to see their own record
 * in the app that holds it would be the product getting in the way of a statutory
 * right. What they must not see is everybody else's.
 */
drop policy if exists staff_records_select on public.staff_records;
create policy staff_records_select on public.staff_records
  for select using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
    or user_id = auth.uid()
  );

-- Only owners and managers maintain them. An educator reading their own record is not
-- an educator editing their own vetting result.
drop policy if exists staff_records_write on public.staff_records;
create policy staff_records_write on public.staff_records
  for all
  using      (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
    -- Sighting cannot be attributed to somebody else: the whole value of the field is
    -- that a named person says they saw the document.
    and (sighted_by is null or sighted_by = auth.uid())
  );

revoke all on public.staff_records from anon, authenticated, service_role;
grant select, insert, update on public.staff_records to authenticated;
-- No DELETE. A lapsed certificate that was quietly removed is indistinguishable from
-- one that never existed, and "we had a current first aid certificate in March" is the
-- question a review asks. Archiving closes a record; `archived_at` is in the update.
grant select, insert, update on public.staff_records to service_role;
