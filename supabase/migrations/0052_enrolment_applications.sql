-- ---------------------------------------------------------------------------
-- 0052 — a family asks for a place
--
-- The public enrolment enquiry. Structurally this is `job_applications` (0024) again, and
-- the reasons that shaped that table are the reasons here — but the data is not the same
-- data, and the differences are the interesting part.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A SEPARATE TABLE, NOT A `children` ROW
--
-- The same argument `waitlist` makes and for a sharper reason. A stranger's claim about a
-- child is not a child record: writing it into `children` would put somebody who may
-- never attend into the roll, the ratio, the funding return and the retention schedule —
-- and it would be a record about a real child created by an unauthenticated caller who
-- may have no relationship to them at all.
--
-- Promotion to `children` + `guardians` + `enrolments` is done **by hand**, by the office,
-- after a conversation. There is deliberately no function that does it: the moment a
-- stranger's claim becomes the centre's record about a child is a moment somebody should
-- be accountable for.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS NOT ASKED, AND WHY
--
-- No date of birth, no NSN, no health information, no immunisation status. Every one of
-- them is genuinely useful for placing a child and every one is a special category of
-- personal information about a **third party** — the child — supplied by somebody this
-- product has not authenticated and cannot verify is their guardian.
--
-- The birth MONTH is asked instead, as free text alongside the message, because the real
-- question is "which room, roughly when" and a month answers it. A centre that needs the
-- date gets it at enrolment, from a person they have met, with a document.
--
-- This is the same line 0024 draws when it refuses to accept a CV attachment: the value of
-- the extra field is not close to the cost of holding it.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.enrolment_application_status as enum
    ('new', 'contacted', 'waitlisted', 'enrolled', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

comment on type public.enrolment_application_status is
  'enrolled = promoted to a real child record by hand. declined = the centre said no. withdrawn = the family did.';

create table if not exists public.enrolment_applications (
  id            uuid primary key default gen_random_uuid(),
  centre_id     uuid not null references public.centres(id) on delete cascade,

  -- The adult making the enquiry. The person this centre will ring back.
  contact_name  text not null,
  email         text not null,
  phone         text,

  /**
   * What the family calls the child. A first name is what a centre needs to hold a
   * conversation and is the least this can be.
   */
  child_name    text not null,

  /**
   * Free text, and deliberately not a date.
   *
   * "March 2024" is what a parent types and is enough to answer which room and roughly
   * when. A `date` column would invite the form to ask for a date of birth, which is a
   * third party's personal information given by somebody nobody has authenticated.
   */
  child_born    text,

  /** When they hope to start. A month is enough; the column is a date because the form
      offers a picker and a real answer is more useful here than in the field above. */
  wanted_from   date,

  /** Days of the week, 1 = Monday, matching `waitlist.wanted_days`. */
  wanted_days   smallint[],

  message       text,

  status        public.enrolment_application_status not null default 'new',
  moved_by      uuid references auth.users(id) on delete set null,
  moved_at      timestamptz,

  created_at    timestamptz not null default now(),

  /*
    The same six length caps `job_applications` carries, and for the reason 0027 records:
    the function restates them so a caller who is not the form gets a sentence rather than
    a constraint violation. The table is what actually stops a megabyte being stored.
  */
  constraint enrolment_applications_contact_len check (length(contact_name) between 1 and 200),
  constraint enrolment_applications_email_len   check (length(email) between 3 and 320),
  constraint enrolment_applications_phone_len   check (phone is null or length(phone) <= 40),
  constraint enrolment_applications_child_len   check (length(child_name) between 1 and 200),
  constraint enrolment_applications_born_len    check (child_born is null or length(child_born) <= 40),
  constraint enrolment_applications_message_len check (message is null or length(message) <= 4000),
  constraint enrolment_applications_days_valid  check (
    wanted_days is null or wanted_days <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  -- `moved_by` and `moved_at` move together or not at all, so a row cannot claim somebody
  -- acted without saying when. Same pairing as `waitlist_resolution_complete`.
  constraint enrolment_applications_moved_complete check ((moved_by is null) = (moved_at is null))
);

comment on table public.enrolment_applications is
  'A public enrolment enquiry: a stranger''s claim about a child, held apart from `children` until the office promotes it by hand. No date of birth, no NSN, no health information — see the header of 0052.';

create index if not exists enrolment_applications_centre_idx
  on public.enrolment_applications (centre_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Office only, both directions. An educator has no reason to read a queue of enquiries and
-- a parent still less — the same reasoning `waitlist` records: it is a list of who else is
-- asking, and who is ahead of them.
--
-- Note there is no INSERT policy at all. The public write path is the definer function
-- below, and staff have no reason to file one by hand — an enquiry that arrives by phone
-- is a `waitlist` row, which is the table that already exists for it.
-- ---------------------------------------------------------------------------

alter table public.enrolment_applications enable row level security;

drop policy if exists enrolment_applications_select on public.enrolment_applications;
create policy enrolment_applications_select on public.enrolment_applications
  for select using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

drop policy if exists enrolment_applications_update on public.enrolment_applications;
create policy enrolment_applications_update on public.enrolment_applications
  for update
  using      (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

/*
 * DELETE is granted, which `waitlist` refuses.
 *
 * 0024 grants it on `job_applications` for a reason that applies here more strongly: this
 * table is written by unauthenticated strangers, so it will accumulate spam and mistakes,
 * and a centre that cannot remove a junk row about a named child is stuck holding personal
 * information it never wanted. The Privacy Act cuts the same way — IPP 9 says do not keep
 * it longer than needed, and "needed" for a duplicate submission is zero.
 */
drop policy if exists enrolment_applications_delete on public.enrolment_applications;
create policy enrolment_applications_delete on public.enrolment_applications
  for delete using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

revoke all on public.enrolment_applications from anon, authenticated, service_role;
grant select, update, delete on public.enrolment_applications to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The public write path
--
-- The second function in this schema an unauthenticated caller may execute, and the design
-- is `submit_job_application`'s exactly: returns void so it discloses nothing, resolves the
-- centre from a slug so a forged call cannot choose a tenant, rate-limited by a count
-- against the table, and idempotent while an enquiry is open so it cannot be used to test
-- whether an address has enquired.
-- ---------------------------------------------------------------------------

create or replace function public.submit_enrolment_application(
  p_centre_slug  text,
  p_contact_name text,
  p_email        text,
  p_child_name   text,
  p_phone        text default null,
  p_child_born   text default null,
  p_wanted_from  date default null,
  p_wanted_days  smallint[] default null,
  p_message      text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_centre uuid;
  v_recent int;
begin
  /*
    Every length the table constrains, restated. 0027 exists because the first version of
    the sibling function validated three fields and the table constrained six, so a direct
    RPC call got a raw constraint violation from a function advertising itself as the layer
    that produces a sentence. The only caller who reaches these is one not using the form —
    which is exactly the caller this function exists to be safe against.
  */
  if p_contact_name is null or length(trim(p_contact_name)) not between 1 and 200 then
    raise exception 'A contact name is required, up to 200 characters.';
  end if;

  if p_email is null or position('@' in p_email) < 2 or length(trim(p_email)) > 320 then
    raise exception 'A valid email address is required.';
  end if;

  if p_child_name is null or length(trim(p_child_name)) not between 1 and 200 then
    raise exception 'The child''s name is required, up to 200 characters.';
  end if;

  if length(coalesce(p_phone, '')) > 40 then
    raise exception 'Please keep the phone number under 40 characters.';
  end if;

  if length(coalesce(p_child_born, '')) > 40 then
    raise exception 'Please keep the birth month short, for example "March 2024".';
  end if;

  if length(coalesce(p_message, '')) > 4000 then
    raise exception 'Please keep the message under 4000 characters.';
  end if;

  if p_wanted_days is not null and not (p_wanted_days <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'Days must be numbers from 1 (Monday) to 7.';
  end if;

  -- A slug, never a centre id. A client-supplied uuid on an unauthenticated form is an
  -- invitation to write into another tenant, and this function bypasses RLS.
  select c.id into v_centre from public.centres c where c.slug = p_centre_slug;
  if v_centre is null then
    raise exception 'Unknown centre.';
  end if;

  -- Flood guard, per centre, on the same loose threshold as 0024: set to catch automation
  -- rather than a busy afternoon, because a real family refused because a stranger was
  -- spamming has been failed by this.
  select count(*) into v_recent
    from public.enrolment_applications
   where centre_id = v_centre
     and created_at > now() - interval '1 minute';

  if v_recent >= 10 then
    raise exception 'Too many enquiries have been received just now. Please try again in a few minutes.';
  end if;

  /*
    Idempotent while an enquiry is open, returning quietly rather than raising.

    A double-clicked submit must not create two rows, and an error saying "you have already
    enquired" is an oracle — it tells anybody who asks whether an address has enquired at
    this centre, which for an enrolment enquiry discloses that a named family is looking at
    a named service. Same reasoning as the uniform response on password recovery.

    Scoped on the email AND the child's name: one family enquiring about a second child is
    a different enquiry, and collapsing them would silently lose the sibling.
  */
  if exists (
    select 1 from public.enrolment_applications
     where centre_id = v_centre
       and lower(email) = lower(trim(p_email))
       and lower(child_name) = lower(trim(p_child_name))
       and status in ('new', 'contacted', 'waitlisted')
  ) then
    return;
  end if;

  insert into public.enrolment_applications (
    centre_id, contact_name, email, phone, child_name, child_born,
    wanted_from, wanted_days, message
  ) values (
    v_centre,
    trim(p_contact_name),
    trim(p_email),
    nullif(trim(coalesce(p_phone, '')), ''),
    trim(p_child_name),
    nullif(trim(coalesce(p_child_born, '')), ''),
    p_wanted_from,
    p_wanted_days,
    nullif(trim(coalesce(p_message, '')), '')
  );
end $$;

comment on function public.submit_enrolment_application(text, text, text, text, text, text, date, smallint[], text) is
  'The second write an unauthenticated caller may perform in this schema. Returns void so it discloses nothing, resolves the centre from a slug so a forged call cannot choose a tenant, rate-limited per centre, and idempotent while an enquiry is open so it cannot be used to test whether a family has enquired.';

/*
 * Granted to `anon`, which makes this the SECOND such function in the schema.
 *
 * `scripts/security-review.ts` check 8 names the anon-executable definer functions and
 * explains why each is safe. Its message was written about one function; adding a second
 * without rewriting it would leave a check whose explanation is true of half its subject,
 * which 0024's own comment says is worse than no check. The message is rewritten in the
 * same commit as this grant.
 */
revoke execute on function public.submit_enrolment_application(text, text, text, text, text, text, date, smallint[], text) from public;
grant  execute on function public.submit_enrolment_application(text, text, text, text, text, text, date, smallint[], text)
  to anon, authenticated, service_role;
