-- ---------------------------------------------------------------------------
-- 0058 — Te Whāriki strands, and what this table refuses to hold
--
-- Tier 4 of docs/roadmap-phases-8-13.md: "tag a post to a Te Whāriki strand so the evidence
-- binder can show curriculum coverage." Lowest priority in the whole roadmap, by its own
-- ranking — Storypark and every incumbent in this market already owns years of portfolio
-- data, and this repo is not building a competing portfolio product. What it can do
-- cheaply is show which of the five strands a centre's own posts already touch, which is
-- compliance evidence, not pedagogy software.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE FIVE NAMES ARE SEEDED HERE RATHER THAN LEFT FOR AN IMPORT SCRIPT
--
-- `criteria` (0012) ships empty and is loaded only from a file a human has checked,
-- because Ministry licensing criteria are renumbered periodically and this repo has
-- already been burned once by a stale numbering. Te Whāriki's five strand names are a
-- different kind of fact — the top-level structure of a national curriculum document
-- unchanged since the 2017 revision, not a figure this product could get subtly out of
-- date the way a renumbered criterion would. So they are seeded directly, with `source`
-- carrying exactly what a criteria_sets row would.
--
-- What is NOT seeded, and will not be: goals or learning outcomes under each strand. That
-- is where the real detail and the real disagreement lives, transcribing it from memory
-- would be asserting curriculum content this repo has not checked, and a compliance
-- product that gets Te Whāriki's own words wrong is a worse failure than one that says
-- nothing. There is deliberately no column for it — see unverified-claims for the standing
-- caveat on the five names themselves, which have not been diffed character-by-character
-- against a primary-source copy of He Whāriki Mātauranga either, only transcribed from
-- what is common, consistent knowledge in this field. A macron in the wrong place here is
-- exactly the class of mistake `apps/site/src/app/layout.tsx`'s note on Fraunces already
-- cost this repo once.
-- ---------------------------------------------------------------------------

create table if not exists public.curriculum_strands (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name_en    text not null,
  name_reo   text not null,
  source     text not null,
  sort_order smallint not null unique
);

comment on table public.curriculum_strands is
  'The five Te Whāriki strands. Reference data, national rather than per-centre — see 0058''s header for why the names are seeded but no goal or outcome text is.';

insert into public.curriculum_strands (code, name_en, name_reo, source, sort_order) values
  ('wellbeing',     'Wellbeing',     'Mana Atua',
   'Te Whāriki: He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa — Early Childhood Curriculum, Ministry of Education (NZ), 2017. Strand names only; not diffed against a primary-source copy — see unverified-claims.', 1),
  ('belonging',     'Belonging',     'Mana Whenua',
   'Te Whāriki: He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa — Early Childhood Curriculum, Ministry of Education (NZ), 2017. Strand names only; not diffed against a primary-source copy — see unverified-claims.', 2),
  ('contribution',  'Contribution',  'Mana Tangata',
   'Te Whāriki: He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa — Early Childhood Curriculum, Ministry of Education (NZ), 2017. Strand names only; not diffed against a primary-source copy — see unverified-claims.', 3),
  ('communication',  'Communication', 'Mana Reo',
   'Te Whāriki: He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa — Early Childhood Curriculum, Ministry of Education (NZ), 2017. Strand names only; not diffed against a primary-source copy — see unverified-claims.', 4),
  ('exploration',   'Exploration',   'Mana Aotūroa',
   'Te Whāriki: He Whāriki Mātauranga mō ngā Mokopuna o Aotearoa — Early Childhood Curriculum, Ministry of Education (NZ), 2017. Strand names only; not diffed against a primary-source copy — see unverified-claims.', 5)
on conflict (code) do nothing;

-- Reference data: readable by anyone signed in, writable by nobody through the app. The
-- same shape as `criteria` — a centre cannot add a sixth strand or rename one from a form.
alter table public.curriculum_strands enable row level security;

drop policy if exists curriculum_strands_select on public.curriculum_strands;
create policy curriculum_strands_select on public.curriculum_strands
  for select using (true);

revoke all on public.curriculum_strands from anon, authenticated, service_role;
grant select on public.curriculum_strands to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The tag itself — the same shape as `post_children` (0013), on purpose.
-- ---------------------------------------------------------------------------

create table if not exists public.post_strands (
  post_id   uuid not null references public.posts(id) on delete cascade,
  strand_id uuid not null references public.curriculum_strands(id),
  primary key (post_id, strand_id)
);

create index if not exists post_strands_strand_idx on public.post_strands (strand_id);

comment on table public.post_strands is
  'Which Te Whāriki strand(s) a post touches, for the evidence binder''s curriculum-coverage section.';

alter table public.post_strands enable row level security;

/**
 * Visibility follows the post, not a second copy of `posts_select`'s logic.
 *
 * A policy's USING clause may reference another table, and that reference is itself
 * subject to the referenced table's own RLS for the calling session — so `post_id in
 * (select id from public.posts)` already returns exactly the posts this caller could see,
 * without restating the guardianship/staff/pānui branches `posts_select` (0013) encodes.
 * Duplicating that condition here would be a second copy with its own chance to drift.
 */
drop policy if exists post_strands_select on public.post_strands;
create policy post_strands_select on public.post_strands
  for select using (post_id in (select id from public.posts));

/**
 * Writable by whoever can write the post — the same staff-at-centre condition
 * `posts_write` (0013) uses, restated because a policy cannot delegate a WITH CHECK the
 * way SELECT can delegate through a subquery's own RLS.
 *
 * INSERT and DELETE, not a single `FOR ALL`. 0022 already split fourteen `FOR ALL`
 * policies across this schema for the exact reason `review:security` check 5 exists: `FOR
 * ALL` covers SELECT, so a table with both a `FOR SELECT` policy and a `FOR ALL` policy
 * carries two permissive read paths that OR together — precisely the shape that produced
 * the Phase 4 consent leak. `post_children_write` (0013) already made this split; this
 * table follows it rather than reintroducing the pattern 0022 exists to have removed. No
 * UPDATE policy: a tag is added or removed, never edited in place.
 */
drop policy if exists post_strands_write on public.post_strands;
drop policy if exists post_strands_write_insert on public.post_strands;
create policy post_strands_write_insert on public.post_strands
  for insert
  with check (post_id in (select id from public.posts where centre_id in (select public.caller_staff_centre_ids())));

drop policy if exists post_strands_write_delete on public.post_strands;
create policy post_strands_write_delete on public.post_strands
  for delete
  using (post_id in (select id from public.posts where centre_id in (select public.caller_staff_centre_ids())));

revoke all on public.post_strands from anon, authenticated, service_role;
grant select, insert, delete on public.post_strands to authenticated, service_role;

drop trigger if exists post_strands_audit on public.post_strands;
create trigger post_strands_audit
  after insert or update or delete on public.post_strands
  for each row execute function public.audit_trigger();
