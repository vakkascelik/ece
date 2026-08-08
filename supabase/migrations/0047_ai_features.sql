-- ---------------------------------------------------------------------------
-- 0047 — the switch, before there is anything to switch on
--
-- A per-centre opt-in for anything that sends data to Anthropic's API. It is added
-- before the first call exists, and that order is the point: a feature that turns
-- itself on for a childcare centre is a feature that gets discovered by a parent.
--
-- DEFAULT FALSE, WHICH IS THE WHOLE COLUMN
--
-- The same reasoning as `ratio_source` in 0040. Every centre already in this database
-- is unchanged on deploy, and stays unchanged until somebody at that centre reads what
-- it does and turns it on. There is no migration that flips it, and there should never
-- be one.
--
-- WHAT IT GATES, AND WHAT IT DOES NOT
--
-- It gates *sending anything to a third-party model*. It does not gate a feature class,
-- because the interesting distinction is not "AI" — it is which data crosses a border.
-- `docs/claude-api-plan.md` tiers that: aggregates with no personal information at all,
-- versus staff-typed text that can contain a child's name. This flag is necessary for
-- both and sufficient for neither: the second tier needs a `consent_kind` as well, and
-- that is deliberately not this migration.
--
-- WHY IT IS NOT CALLED `ai_enabled`
--
-- Because a boolean named for a marketing category invites a future reader to hang a
-- second, unrelated feature off it. This names the thing it actually controls: whether
-- this centre's data may be sent to an external model provider.
-- ---------------------------------------------------------------------------

alter table public.centres
  add column if not exists ai_features boolean not null default false;

comment on column public.centres.ai_features is
  'Whether this centre permits data being sent to an external model provider (Anthropic). Default false; every existing centre is unchanged on deploy and stays that way until somebody turns it on. Gates the aggregate tier; the text tier additionally needs a recorded consent.';
