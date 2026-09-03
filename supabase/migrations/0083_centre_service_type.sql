-- ---------------------------------------------------------------------------
-- 0083 — what kind of service this is
--
-- Until now `centres` could not say what kind of early learning service it was, at all.
-- Not the licence it holds, not how it operates. That single absence blocks four separate
-- things, which is why it is worth two columns rather than one:
--
--   1. The ratio schedule. `assessRatio` takes both tables as arguments precisely so a
--      different service type can supply different ones, three modules forward them
--      faithfully, and NO call site has ever passed one — so a sessional, home-based or
--      hospital-based service silently gets the all-day centre-based bands. See
--      unverified-claims item 51.
--   2. The RS7 return's `AdvanceMonthCounts`, which wants forward counts of all-day,
--      sessional and parent-led operating days.
--   3. The Ministry's 50-service capability requirement, which is stated ACROSS service
--      types — so a product that cannot record the distinction cannot answer it.
--   4. Home-based, sessional and kindergarten are three of the eight mandatory
--      functionalities and none of them is modelled.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY TWO COLUMNS AND NOT ONE, WHICH IS THE WHOLE DESIGN
--
-- Because the licence a service holds and the way it operates are different facts, and
-- conflating them would have produced a column that answers neither question.
--
-- `licence_type` is a statutory fact: what the Ministry licensed. Three values.
-- `service_model` is operational: how the service runs, which is what RS7 asks about and
-- what decides a ratio schedule. Also three values, and NOT the same three.
--
-- A kindergarten and a full-day education-and-care centre hold the SAME licence type and
-- have different service models. A home-based service is its own licence type. So one
-- column would have forced a choice between answering the licensing question and
-- answering the funding question.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS NOT STATED, AND IT IS THE DEFAULT
--
-- Same contract as `licensed_places` (0050), `sleep_check_minutes` (0033) and
-- `drill_interval_days` (0034). No default, because every default here is a claim about a
-- Crown licence that nobody typed in. Guessing "education and care" would be right most
-- of the time and catastrophic the rest: it would select a ratio schedule, and being
-- wrong about that is being wrong about how many adults a room needs.
--
-- So the ratio caveat keeps saying which schedule it used, and will keep saying it until
-- the other schedules are transcribed. This column is the input those callers need; it is
-- not by itself the fix. See unverified-claims item 51.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TEXT WITH A CHECK, NOT AN ENUM — DELIBERATE, AND FOR ONE REASON
--
-- `ratio_source` (0040) is a Postgres enum, so there is precedent for either. A CHECK is
-- right here because `licence_type`'s value list is DISPUTED between two Crown pages
-- (see below), so it is the list most likely to need changing. Extending a CHECK is one
-- migration; `alter type ... add value` cannot run inside a transaction in every context
-- and cannot remove a value at all. Same reasoning as `code_sets.domain` in 0080.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE GRANT IS IN THIS FILE. THIS IS THE THIRD TIME THAT SENTENCE HAS BEEN NEEDED.
--
-- `centres` has a table-level SELECT grant, so both columns are readable the moment they
-- exist and need no read grant. UPDATE is COLUMN-SCOPED — measured before writing this,
-- nine columns: ai_features, drill_interval_days, licensed_places,
-- medication_requires_witness, moe_service_number, name, ratio_source,
-- sleep_check_minutes, timezone.
--
-- `updateCentre` builds ONE update statement from every changed field, so a column
-- missing from that grant does not break its own feature — it breaks the entire settings
-- form, with `42501 permission denied for table centres`, naming the table and not the
-- column. That is 0047, fixed by 0048. Then 0066 added `incidents.room_id`, checked the
-- INSERT grants and not the UPDATE grants, and no incident draft could be corrected for
-- six days until 0082.
--
-- The rule is not "check the grants". 0066 checked the grants. It is CHECK THEM PER VERB.
-- ---------------------------------------------------------------------------

alter table public.centres
  add column if not exists licence_type text;

alter table public.centres
  add column if not exists service_model text;

-- ---------------------------------------------------------------------------
-- The licence types, and the disagreement that is recorded rather than resolved.
--
-- Source: Ministry of Education, "Licences to operate in early childhood education and
-- care", retrieved 2026-09-03. It names exactly three licensed service types, and states
-- that playgroups "are not licensed, but they can choose to be certified".
--
-- AND THE MINISTRY'S OWN REGULATORY-FRAMEWORK PAGE DISAGREES. "Laws and regulations for
-- early learning services", retrieved the same day, names FOUR: "centre-based services —
-- including kindergartens, playcentres, education and care services, puna reo, reo rua
-- education and care", "home-based services", "hospital-based services", and "Te Kōhanga
-- Reo" as its own licensed type.
--
-- So the two pages disagree on granularity and on whether Te Kōhanga Reo is a separate
-- licence type. The licensing page is used here because it is the page about licences,
-- and the disagreement is written down instead of being smoothed over: this CHECK may be
-- wrong, and if a service tells us it holds a kōhanga reo licence, the correct response is
-- to extend the list in a new migration citing what they were told — NOT to file them
-- under education and care because the constraint refused them.
--
-- unverified-claims item 51 is this, and it stays OPEN. A column existing does not make a
-- classification verified.
-- ---------------------------------------------------------------------------
alter table public.centres
  drop constraint if exists centres_licence_type_known;
alter table public.centres
  add constraint centres_licence_type_known
  check (licence_type is null or licence_type in ('education_and_care', 'home_based', 'hospital_based'));

comment on column public.centres.licence_type is
  'The licence this service holds: education_and_care, home_based or hospital_based. NULL means not stated, which is the default — no value is guessed, because a guess here selects a ratio schedule. Source: MoE "Licences to operate in early childhood education and care", retrieved 2026-09-03. The MoE regulatory-framework page names four types and treats Te Kōhanga Reo separately; that disagreement is unresolved and recorded in unverified-claims item 51. Extend this list in a new migration rather than mapping an unlisted licence onto one of these.';

-- ---------------------------------------------------------------------------
-- The service models, which have a better source than the licence types do.
--
-- These three come from the ELI schema itself. `RS7AdvanceMonthCounts` enumerates exactly
-- `AllDayDaysCount`, `SessionalDaysCount` and `ParentLedDaysCount` — so the Ministry's own
-- machine-readable contract for the RS7 return names this axis and its three values.
-- Retrieved from https://eli.minedu.govt.nz/eli.xsd on 2026-09-03.
--
-- That is a stronger citation than a web page, and worth noting as such: the element names
-- ARE the classification, not a description of one. It is also the axis Schedule 2 turns on
-- for ratios — the all-day and sessional tables differ for the 2-and-over band — so one
-- column serves the return and the ratio schedule both.
--
-- What this does NOT settle is which model a given licence implies. A kindergarten may be
-- sessional or all-day; that is a fact about the service, so the service states it.
-- ---------------------------------------------------------------------------
alter table public.centres
  drop constraint if exists centres_service_model_known;
alter table public.centres
  add constraint centres_service_model_known
  check (service_model is null or service_model in ('all_day', 'sessional', 'parent_led'));

comment on column public.centres.service_model is
  'How this service operates: all_day, sessional or parent_led. NULL means not stated. Source: the ELI schema''s RS7AdvanceMonthCounts, which enumerates AllDayDaysCount, SessionalDaysCount and ParentLedDaysCount — retrieved from https://eli.minedu.govt.nz/eli.xsd on 2026-09-03. This is the axis the RS7 advance-month counts need AND the axis Schedule 2 distinguishes for ratios, which is why it is separate from licence_type.';

-- The column grant, in the same migration as the columns, per verb. Without the UPDATE
-- grant an owner cannot save ANY setting, not merely these two.
grant update (licence_type, service_model) on public.centres to authenticated, service_role;
