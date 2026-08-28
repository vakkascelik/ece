-- ---------------------------------------------------------------------------
-- 0069 — hazard likelihood, consequence and review interval
--
-- 1Place's hazard form asks for Likelihood, Consequence, a Risk Score and a Frequency
-- Of Review. This schema has `risk` — one of low/medium/high — and `reviewed_at` with
-- nothing saying when the next one is due. Three of the four fields are missing.
--
-- THE ONE THING THIS MIGRATION REFUSES TO DO: BAND THE SCORE
--
-- The obvious version computes likelihood × consequence and maps the product onto
-- low/medium/high, replacing `risk` with something derived. Every risk-matrix product
-- does this, the bands look official, and **this repo cannot source them**.
--
-- A 5×5 grid banded at 15 and 8 is one convention. Banding at 12 and 6 is another.
-- Both are in wide use, neither is in any New Zealand ECE regulation this repo has
-- read, and the difference decides whether a hazard is reported to a manager as high
-- risk. AGENTS.md §4.5 is exactly about this: a compliance tool that is confidently
-- wrong is worse than no tool, because a manager who is told they are within
-- tolerance stops looking.
--
-- So: the product is stored, because multiplication is arithmetic and not a claim
-- about the world. The **band is not** — `risk` stays what a person decided, sitting
-- beside the score rather than being computed from it. The screen shows both and says
-- nothing about how they should relate. Recorded as an entry in
-- llm-wiki/wiki/unverified-claims.md, and it closes the day somebody sources a grid
-- Little Pearls is actually expected to use.
--
-- The two-sources-of-truth objection is real and is answered by not deriving either
-- from the other. `risk` is a judgement; `risk_score` is a measurement of two other
-- judgements. They are allowed to disagree, and a disagreement is information — it
-- means somebody looked at the numbers and decided differently, which is what
-- professional judgement is.
-- ---------------------------------------------------------------------------

alter table public.hazards
  add column if not exists likelihood  smallint,
  add column if not exists consequence smallint;

comment on column public.hazards.likelihood is
  'How likely, 1 (rare) to 5 (almost certain). The centre''s own assessment. Null until somebody makes one — a hazard recorded in thirty seconds in a playground is still a hazard.';

comment on column public.hazards.consequence is
  'How bad, 1 (negligible) to 5 (severe). Same scale direction as likelihood so the product reads the obvious way.';

alter table public.hazards drop constraint if exists hazards_likelihood_range;
alter table public.hazards
  add constraint hazards_likelihood_range
  check (likelihood is null or likelihood between 1 and 5);

alter table public.hazards drop constraint if exists hazards_consequence_range;
alter table public.hazards
  add constraint hazards_consequence_range
  check (consequence is null or consequence between 1 and 5);

/*
  Generated rather than written, so it cannot be inconsistent with its inputs — the
  failure mode that a hand-maintained duplicate always eventually produces, and which
  cost this repo two diverged copies of the design tokens before `tokens:check`
  existed.

  Null when either input is null, which is what `*` does with a null and is the right
  answer: a score derived from one number is not a score.
*/
alter table public.hazards
  add column if not exists risk_score smallint
  generated always as (likelihood * consequence) stored;

comment on column public.hazards.risk_score is
  'likelihood × consequence, 1–25. Arithmetic, not a verdict. NO BAND IS APPLIED — see the header of 0069 and unverified-claims. `risk` remains a person''s judgement and is not derived from this.';

/*
  How often this hazard is meant to be looked at again.

  Null means the centre has not stated an interval, and the product then shows how
  long it has been since `reviewed_at` without calling it overdue. The fifth outing of
  the `drill_interval_days` shape, and the reasoning has not changed: a default would
  be read as the rule.

  There is no stored `next_review_on`. It is `reviewed_at + interval` and deriving it
  costs nothing, while storing it creates a column that goes stale the moment either
  input changes.
*/
alter table public.hazards
  add column if not exists review_interval_days smallint;

comment on column public.hazards.review_interval_days is
  'Days between reviews of this hazard, as stated by the centre. NULL means not configured, and elapsed time is then shown without judgement. Not a regulatory figure.';

alter table public.hazards drop constraint if exists hazards_review_interval_sane;
alter table public.hazards
  add constraint hazards_review_interval_sane
  check (review_interval_days is null or review_interval_days between 1 and 730);

-- Open hazards that carry an interval, oldest review first: the list a manager works
-- through. Partial, because a closed hazard is not reviewed again.
create index if not exists hazards_review_due_idx
  on public.hazards (centre_id, reviewed_at nulls first)
  where resolved_at is null and review_interval_days is not null;

/*
  No new grant is needed.

  0034 granted `update` on the whole table rather than a column list, so these columns
  are already writable by the same callers under the same policies. Worth stating
  because the reverse — a column-scoped grant — would have made this migration
  silently incomplete: the columns would exist, the policy would allow the write, and
  Postgres would refuse it on a privilege check nobody thought to look at.

  `risk_score` is generated and cannot be written to by anybody, including
  service_role. That is the correct privilege for a derived value and it is free.
*/
