-- ---------------------------------------------------------------------------
-- 0026 — two defects found by tracing logic flows rather than by a failing test
--
-- 1. The live roll ignored `corrects`, so a superseded event could decide whether a child
--    was in the building.
-- 2. `job_applications`' own CHECK constraint made it impossible to delete a staff account.
--
-- Both were invisible to every gate: the schema is valid, the types line up, and each has a
-- comment that describes the behaviour somebody intended.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. attendance_today must not return an event that has been corrected
--
-- The view picks the latest event per child with `distinct on (child_id) ... order by
-- child_id, at desc, id desc` and has no notion of a superseded row. That is wrong in the
-- direction that matters, and the mechanism is worth stating because it is counter-intuitive:
--
-- A correction carries the time the event SHOULD have had. So correcting a sign-in that was
-- recorded at 15:00 to its real 08:05 inserts a row with an *earlier* `at` than the row it
-- supersedes — and `order by at desc` therefore prefers the **superseded** one. The correction
-- is ignored precisely when it moves a time backwards, which is the common case: somebody
-- noticing at 15:00 that a child was never signed in this morning.
--
-- What that does on the roll:
--
--  - A child signed out by mistake and corrected back stays absent, so they are off the roll
--    and out of the ratio while standing in the room.
--  - `event_id` is handed to the UI as the thing a further correction points at, so a second
--    correction attaches to the already-superseded event. The chain becomes two siblings and
--    `resolveCorrections` then discards the original while both corrections stay live.
--
-- The funding reader already selected `corrects` and called `resolveCorrections`; the ratio
-- replay did not, and was fixed in the same commit as this migration. This view was the third
-- reader of the same append-only table, disagreeing with both about which rows are live.
--
-- `security_invoker = on` is restated explicitly. `create or replace view` preserves
-- reloptions, but this is the property that stops the view returning every centre's roll to
-- any caller, and the RLS suite asserts it — restating costs nothing and removes the need to
-- know whether replace preserves it.
-- ---------------------------------------------------------------------------

/*
 * The index the new predicate needs. `corrects` is null for almost every row, so a partial
 * index is both smaller and exactly what an anti-join over "rows that correct something"
 * probes. Without it the `not exists` degrades to a scan of the table on every roll render.
 */
create index if not exists attendance_events_corrects_idx
  on public.attendance_events (corrects)
  where corrects is not null;

create or replace view public.attendance_today
with (security_invoker = on) as
  select distinct on (ae.child_id)
         ae.child_id,
         c.centre_id,
         ae.id as event_id,
         ae.kind,
         ae.at,
         ae.recorded_by
    from public.attendance_events ae
    join public.children c on c.id = ae.child_id
   where ae.at >= public.centre_day_start(c.centre_id)
     -- Deliberately NOT limited to today. A correction recorded the next morning for
     -- yesterday's event still supersedes it, and scoping this subquery to the day window
     -- would let the original reappear on the roll overnight.
     and not exists (
       select 1 from public.attendance_events s where s.corrects = ae.id
     )
   order by ae.child_id, ae.at desc, ae.id desc;

comment on view public.attendance_today is
  'The latest LIVE event per child today. Excludes events that a correction supersedes — a '
  'correction usually carries an EARLIER time than the row it replaces, so ordering by `at` '
  'alone preferred the superseded row and left a corrected child off the roll. See 0026.';


-- ---------------------------------------------------------------------------
-- 2. A staff account could not be deleted once it had moved an application
--
-- `job_applications_status_change_complete` required `status_changed_at` and
-- `status_changed_by` to be both null or both set. `status_changed_by` references
-- `auth.users` with `on delete set null` — so deleting a user is an UPDATE that sets one half
-- to null, CHECK constraints are enforced on that UPDATE, and the delete fails:
--
--   23514: new row for relation "job_applications" violates check constraint
--          "job_applications_status_change_complete"
--
-- Measured against the live database, not reasoned about. The effect is that offboarding
-- anybody who had ever moved an application through a stage was impossible — and the error
-- names a recruitment constraint, which is the last place somebody deleting a staff account
-- would look.
--
-- THE CONSTRAINT WAS ALSO WRONG AS A STATEMENT ABOUT THE DOMAIN. It was written to keep "who
-- decided this, and when" answerable. But `(at set, by null)` is not half a record — it is the
-- honest description of a move made by somebody whose account has since been removed. The
-- state that is genuinely useless is the reverse: a name with no time. So the invariant
-- becomes one-directional.
--
-- The UI already renders this correctly, which is luck rather than foresight: the page falls
-- back to showing just the date when there is no user to name.
-- ---------------------------------------------------------------------------

alter table public.job_applications
  drop constraint if exists job_applications_status_change_complete;

alter table public.job_applications
  add constraint job_applications_status_change_complete
  check (status_changed_by is null or status_changed_at is not null);

comment on constraint job_applications_status_change_complete on public.job_applications is
  'If we know who moved it, we know when. Not the reverse: `on delete set null` on '
  'status_changed_by means a move by a since-deleted account legitimately has a time and no '
  'name, and requiring symmetry made deleting that account impossible — see 0026.';
