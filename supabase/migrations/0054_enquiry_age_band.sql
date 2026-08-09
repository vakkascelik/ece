-- ---------------------------------------------------------------------------
-- 0054 — the enquiry asks for an age band, not a child's name
--
-- A correction to 0052, which I wrote without reading the page that had already decided
-- this. `apps/site/src/app/enrolment/page.tsx` has carried the decision since the site was
-- built:
--
--     "When an enquiry form is built it will collect the guardian's details and a coarse
--      age band, and it will not ask for a child's name or date of birth."
--
-- and it gives two reasons, both of which survive scrutiny better than my `not null`:
--
--   1. `docs/tenant-little-pearls.md` records that this tenant holds **zero personal
--      information**, and that no child record goes in until professional indemnity
--      insurance is in place. A public endpoint writing an identifiable under-five into
--      this database crosses the line that doc exists to hold — with the weakest lawful
--      basis in the product, because nobody has signed anything and no consent
--      conversation has happened.
--
--   2. **The centre does not need a child's name to phone a guardian back.**
--
-- 0052 said the first name was "the least this can be". That was reasoning from the
-- table outwards. Reasoning from the family inwards, it is not needed at all: the enquiry
-- is a request for a conversation with an *adult*, and the adult's name is already there.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT CHANGES
--
--   * `child_name` becomes nullable. Not dropped: a centre that has met a family and is
--     recording an enquiry taken by phone may reasonably hold one, and the column is where
--     it goes. **The public form does not ask for it**, which is a different statement from
--     the column not existing, and the honest one.
--   * `child_born` is dropped. "March 2024" is a date of birth with the day filed off; it
--     is finer than a band and invites exactly the field the page refuses.
--   * `child_age_band` replaces it, with three values. Coarse on purpose — it answers
--     "which room, roughly when" and nothing else. `expecting` is a real case: families
--     join waitlists before the child is born, and a nullable birth month could not say so.
-- ---------------------------------------------------------------------------

alter table public.enrolment_applications
  alter column child_name drop not null;

alter table public.enrolment_applications
  drop column if exists child_born;

alter table public.enrolment_applications
  add column if not exists child_age_band text;

alter table public.enrolment_applications
  drop constraint if exists enrolment_applications_born_len;

alter table public.enrolment_applications
  drop constraint if exists enrolment_applications_band_known;
alter table public.enrolment_applications
  add constraint enrolment_applications_band_known check (
    child_age_band is null or child_age_band in ('expecting', 'under-2', '2-and-over')
  );

comment on column public.enrolment_applications.child_age_band is
  'How old the child is, coarsely: expecting | under-2 | 2-and-over. Deliberately not a date of birth — see 0054 and apps/site enrolment page.';
comment on column public.enrolment_applications.child_name is
  'Optional, and the PUBLIC FORM DOES NOT ASK FOR IT. Present for an enquiry the office takes by phone from a family it has spoken to.';

-- ---------------------------------------------------------------------------
-- The function, replaced
--
-- The old signature is dropped rather than left beside the new one. Two overloads of a
-- name on the allowlist in `review:security` would both be reachable by `anon`, and the
-- allowlist is keyed by name — so the old one would remain callable, still demanding a
-- child's name, with nothing reporting it. A superseded public write path is not a
-- deprecation, it is a second door.
-- ---------------------------------------------------------------------------

drop function if exists public.submit_enrolment_application(
  text, text, text, text, text, text, date, smallint[], text);

create or replace function public.submit_enrolment_application(
  p_centre_slug    text,
  p_contact_name   text,
  p_email          text,
  p_child_age_band text default null,
  p_phone          text default null,
  p_wanted_from    date default null,
  p_wanted_days    smallint[] default null,
  p_message        text default null
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
  if p_contact_name is null or length(trim(p_contact_name)) not between 1 and 200 then
    raise exception 'A contact name is required, up to 200 characters.';
  end if;

  if p_email is null or position('@' in p_email) < 2 or length(trim(p_email)) > 320 then
    raise exception 'A valid email address is required.';
  end if;

  if p_child_age_band is not null
     and p_child_age_band not in ('expecting', 'under-2', '2-and-over') then
    raise exception 'Please choose one of the age options.';
  end if;

  if length(coalesce(p_phone, '')) > 40 then
    raise exception 'Please keep the phone number under 40 characters.';
  end if;

  if length(coalesce(p_message, '')) > 4000 then
    raise exception 'Please keep the message under 4000 characters.';
  end if;

  if p_wanted_days is not null and not (p_wanted_days <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'Days must be numbers from 1 (Monday) to 7.';
  end if;

  select c.id into v_centre from public.centres c where c.slug = p_centre_slug;
  if v_centre is null then
    raise exception 'Unknown centre.';
  end if;

  select count(*) into v_recent
    from public.enrolment_applications
   where centre_id = v_centre
     and created_at > now() - interval '1 minute';

  if v_recent >= 10 then
    raise exception 'Too many enquiries have been received just now. Please try again in a few minutes.';
  end if;

  /*
    The idempotency key loses the child's name and gains the band.

    0052 keyed on email AND child name so a family enquiring about a second child was not
    swallowed. Without a name that property needs another carrier, and the band is the one
    available: a family with a baby and a three-year-old sends two enquiries with different
    bands, and both land.

    What this cannot separate is twins — two children in the same band from the same
    address inside one open enquiry collapse to one row. Stated rather than hidden: the
    fix is a conversation, which is what the enquiry is for, and it is a better outcome
    than asking every family for a child's name to disambiguate a rare case.
  */
  if exists (
    select 1 from public.enrolment_applications
     where centre_id = v_centre
       and lower(email) = lower(trim(p_email))
       and coalesce(child_age_band, '') = coalesce(p_child_age_band, '')
       and status in ('new', 'contacted', 'waitlisted')
  ) then
    return;
  end if;

  insert into public.enrolment_applications (
    centre_id, contact_name, email, phone, child_age_band,
    wanted_from, wanted_days, message
  ) values (
    v_centre,
    trim(p_contact_name),
    trim(p_email),
    nullif(trim(coalesce(p_phone, '')), ''),
    p_child_age_band,
    p_wanted_from,
    p_wanted_days,
    nullif(trim(coalesce(p_message, '')), '')
  );
end $$;

comment on function public.submit_enrolment_application(text, text, text, text, text, date, smallint[], text) is
  'The public enrolment enquiry. Guardian details and a COARSE AGE BAND — never a child''s name or date of birth, see 0054. Returns void, resolves the centre from a slug, rate-limited and idempotent per (email, band) while an enquiry is open.';

revoke execute on function public.submit_enrolment_application(text, text, text, text, text, date, smallint[], text) from public;
grant  execute on function public.submit_enrolment_application(text, text, text, text, text, date, smallint[], text)
  to anon, authenticated, service_role;
