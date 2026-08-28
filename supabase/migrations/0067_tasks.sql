-- ---------------------------------------------------------------------------
-- 0067 — tasks
--
-- The jobs a centre is carrying: a gate to fix, a light to replace, a hazard
-- somebody controlled this morning and has to come back to. 1Place calls them
-- tickets and Little Pearls has 73 of them open, which is the measure of what this
-- table has to absorb.
--
-- ONE OF 1PLACE'S THREE CATEGORIES IS DELIBERATELY NOT HERE
--
-- Theirs are Enrolment Enquiry, Hazard Identification and Maintenance. The first is
-- already a first-class thing in this product — `enrolment_applications`, an age
-- band, a waitlist, a conversion report and two screens. Importing enquiries as
-- generic tasks would fork a workflow that exists and is better, and would leave a
-- family's details in a table with no guardianship boundary on it. Only work about
-- the building lands here.
--
-- WHY FOUR STATUSES AND NOT TWO
--
-- Pending, Open, Resolved, Closed is more than the shape needs and it is the
-- vocabulary the staff at both centres have been using daily. Two axes are actually
-- being tracked — is anybody working on it, and has anybody checked the work — and
-- collapsing them would make a manager's "done but I have not looked at it yet"
-- unsayable. The migration off 1Place is hard enough without also retraining the
-- words.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.task_status as enum (
    'pending',
    'open',
    'resolved',
    'closed'
  );
exception when duplicate_object then null; end $$;

comment on type public.task_status is
  'Pending: filed, nobody has picked it up. Open: being worked. Resolved: the work is done. Closed: somebody checked it. The last two both require a resolution.';

do $$ begin
  create type public.task_priority as enum (
    'critical',
    'high',
    'medium',
    'low'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_category as enum (
    'maintenance',
    'hazard',
    'other'
  );
exception when duplicate_object then null; end $$;

comment on type public.task_category is
  'Deliberately three, not 1Place''s three. Enrolment enquiries are enrolment_applications and never tasks — see the header of 0067.';

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,
  room_id     uuid references public.rooms(id) on delete set null,

  title       text not null,
  detail      text,
  category    public.task_category  not null default 'maintenance',
  /**
   * Defaulted, unlike almost everything else in this schema.
   *
   * The house rule is that a default is the product asserting something nobody
   * checked, and it is why `drill_interval_days` and the criteria table ship empty.
   * That rule is about claims regarding the world — how often a drill is required,
   * what a ratio is. A priority is not a claim about the world; it is a hint about a
   * work queue, set by the person filing and changed freely by the next one. The
   * list is sorted by it, so a null would need a bucket of its own on every screen
   * to mean "nobody said", which is worse than starting in the middle.
   */
  priority    public.task_priority  not null default 'medium',
  status      public.task_status    not null default 'pending',

  /**
   * The day it is wanted by, in the centre's own calendar.
   *
   * A `date`, and **there is no `default current_date`** — the expression AGENTS.md
   * §4.3 forbids, and which three columns in this schema still carry. For the whole
   * New Zealand morning UTC is yesterday, so a default here would file half of every
   * day's tasks a day early. The caller computes this with `todayInZone()`.
   */
  due_on      date,

  /**
   * Who is doing it, or null.
   *
   * `auth.users`, not `staff_members`: this is a work queue, and a queue assigned to
   * somebody with no way to sign in is a queue nobody reads. An outside contractor
   * is an unassigned task whose detail names them.
   */
  assigned_to uuid references auth.users(id) on delete set null,

  /**
   * The hazard this task came out of, when it came out of one.
   *
   * One direction only. A hazard may spawn a task; a task does not own a hazard.
   * The register is the record of what was found, and it stays answerable whether or
   * not anybody opened a job about it — pointing the reference the other way would
   * make closing the task look like closing the hazard, which is exactly the
   * conflation `hazards.control` and `hazards.resolution` were split up to prevent.
   */
  hazard_id   uuid references public.hazards(id) on delete set null,

  resolution  text,
  resolved_at timestamptz,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint tasks_title_present check (length(trim(title)) > 0),

  /**
   * Finishing means saying how. The same constraint as `hazards`, for the same
   * reason and with more force: a task list where "Closed" carries no account of
   * what was done is a task list nobody trusts within a month, and the first time
   * somebody asks "was that gate actually fixed" there is no answer.
   */
  constraint tasks_resolution_complete check (
    (status in ('resolved', 'closed'))
      = (resolved_at is not null and length(trim(coalesce(resolution, ''))) > 0)
  ),
  constraint tasks_resolved_after_created check (resolved_at is null or resolved_at >= created_at)
);

comment on table public.tasks is
  'Work the centre is carrying — maintenance, hazard follow-up. Moving to resolved or closed requires a resolution; the CHECK refuses the transition otherwise. No DELETE grant: a task is closed, not tidied away.';

-- The queue as it is actually read: what is still live here, worst first, oldest
-- first inside a priority. Partial, because the closed ones are the majority within a
-- year and nobody opens them.
create index if not exists tasks_centre_live_idx
  on public.tasks (centre_id, priority, due_on nulls last, created_at)
  where status in ('pending', 'open');

create index if not exists tasks_centre_idx on public.tasks (centre_id, created_at desc);
create index if not exists tasks_assigned_idx on public.tasks (assigned_to, status)
  where assigned_to is not null and status in ('pending', 'open');
create index if not exists tasks_hazard_idx on public.tasks (hazard_id)
  where hazard_id is not null;

-- ---------------------------------------------------------------------------
-- Policies
--
-- Staff at the centre, nobody else — the 0034 boundary exactly. A task list is a
-- centre's internal account of what is broken, and `caller_staff_centre_ids()`
-- excludes the parent role by construction.
-- ---------------------------------------------------------------------------

alter table public.tasks enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists tasks_write_insert on public.tasks;
create policy tasks_write_insert on public.tasks
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists tasks_write_update on public.tasks;
create policy tasks_write_update on public.tasks
  for update using (centre_id in (select public.caller_staff_centre_ids()))
          with check (centre_id in (select public.caller_staff_centre_ids()));

-- No DELETE. A task that was filed is a record that somebody thought something was
-- wrong, and a queue that can be emptied silently proves nothing about the building.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.tasks from anon, authenticated, service_role;
grant select, insert, update on public.tasks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

drop trigger if exists tasks_audit on public.tasks;
create trigger tasks_audit
  after insert or update or delete on public.tasks
  for each row execute function public.audit_trigger();
