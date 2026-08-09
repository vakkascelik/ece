-- ---------------------------------------------------------------------------
-- 0050 — how many children this service is licensed for
--
-- Occupancy is the number every operator of more than one site asks for, and until now
-- this product **could not compute it at all**: it knows how many children attended and
-- has never known how many it is allowed. A percentage needs a denominator, and the
-- denominator is on a piece of paper from the Ministry that nobody has typed in.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS NOT STATED, AND IT IS THE DEFAULT
--
-- The same contract as `sleep_check_minutes` (0033) and `drill_interval_days` (0034), and
-- for the same reason. A default of 50, or of anything, would make every centre's
-- occupancy report a number derived from a figure the centre never gave — and it would
-- look exactly like a real one. There is no safe guess: a licence is between 10 and 150
-- places depending on the service, and being wrong by a factor of three produces a report
-- somebody might act on.
--
-- So the screen shows the attendance counts, which are real, and says plainly that
-- occupancy needs a figure nobody has entered. `unverified-claims` has the standing rule
-- this follows: if you cannot source a figure, make the product say so.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE GRANT IS IN THIS FILE, NOT THE NEXT ONE
--
-- `centres` carries **column-level** UPDATE grants, not a table-wide one. 0047 added
-- `ai_features` without its grant and Postgres refused the whole statement before any
-- policy ran — which broke the entire settings form, because `updateCentre` builds one
-- UPDATE from every changed field. A feature nobody had enabled broke three that already
-- worked, and it took 0048 to fix.
--
-- The lesson is not "remember the grant", it is "the grant belongs in the same migration
-- as the column". See `conventions.md`.
-- ---------------------------------------------------------------------------

alter table public.centres
  add column if not exists licensed_places integer;

comment on column public.centres.licensed_places is
  'Children this service is licensed for, as stated by the centre. NULL means not stated — the occupancy report then declines to compute a percentage rather than guessing a denominator.';

-- A licence is for a positive number of children. Zero is not a licensed service and a
-- negative one is a typo; both would silently poison every percentage derived from it.
-- No upper bound: the largest licensed services in New Zealand are around 150 places, but
-- that is a fact about today's market rather than a rule, and a CHECK that refused a
-- lawful licence would be a support call this product cannot win.
alter table public.centres
  drop constraint if exists centres_licensed_places_positive;
alter table public.centres
  add constraint centres_licensed_places_positive
  check (licensed_places is null or licensed_places > 0);

-- The column grant, in the same migration as the column. Without it an owner cannot save
-- ANY setting, not merely this one.
grant update (licensed_places) on public.centres to authenticated, service_role;
