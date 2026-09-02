-- ---------------------------------------------------------------------------
-- 0080 — Ministry reference code sets, effective-dated, and deliberately empty
--
-- The ELI interface types ethnicity, iwi, language, gender, staff role and
-- qualification as `LookupCode` — a 1-to-10 character string — and enumerates none
-- of them. `AST55` of the vendor assessment asks how this system will handle updates
-- to those lists, and states the expectation plainly: every value must carry an
-- effective start date and an effective end date.
--
-- Today this product has none of that. Enumerations are expressed three ways — 36
-- Postgres enum types, CHECK constraints, and TypeScript unions — and **not one of
-- them can carry a date**. A Postgres enum structurally cannot. So `children.ethnicities`
-- is free text, `children.iwi` is free text, and a qualification code has nowhere to
-- live at all.
--
-- WHY THIS SHIPS EMPTY, AND WHY THAT IS THE POINT
--
-- The obvious next commit seeds these tables with ethnicity and qualification codes.
-- It must not be written. AGENTS.md §7 forbids seeding invented regulatory content by
-- name, and a qualification code list is exactly that: a published Ministry
-- classification this repo has not read. A plausible-looking invented code is worse
-- than an empty table, because an empty table stops a screen and a wrong code reaches
-- a Crown return looking like a fact.
--
-- The precedent is `criteria` (0012), which has shipped empty since Phase 2 for the
-- same reason and whose comment says so: "a plausible-looking invented criterion is
-- worse than none". The criteria-gap feature cannot function until somebody imports a
-- checked set, and that is the correct shape. This is the second instance of it, which
-- is why `source` is `not null` here as it is there — **a set with no citation is not
-- usable as reference data**, and making the column mandatory is what stops one being
-- created by accident.
--
-- Where the lists are published, and whether the published form already carries the
-- effective dates or whether a vendor is expected to maintain them, is question 6 of
-- docs/eli-ministry-enquiry.md. Until that is answered, the mechanism exists and holds
-- nothing.
--
-- WHAT IS SOURCED HERE, AND IT IS ONLY TWO THINGS
--
--   1. The 10-character bound on `code`. `<xs:simpleType name="LookupCode">` restricts
--      to minLength 1, maxLength 10. Enforced below, so a code too long for the
--      interface is refused here rather than at the Ministry.
--   2. The list of domains. Each one is a field the ELI schema types as `LookupCode`
--      and does not enumerate. A CHECK rather than free text, so adding a domain is a
--      deliberate migration — the same argument the append-only grants make: a
--      capability that was always quietly there is not a decision.
--
-- Three code sets the schema *does* enumerate are NOT here, because a reference table
-- for a closed, sourced list is a table that can drift from the source: the staff age
-- bands, the leaving-teacher destinations and the pay parity attestation steps are
-- CHECK constraints in 0081 instead.
--
-- ONE DOMAIN IS A JUDGEMENT AND IS FLAGGED AS ONE
--
-- The schema uses `LookupCode` for a child's home languages and, separately, for the
-- languages a service uses. Whether those draw on one published list or two is
-- **unconfirmed**. They are one domain (`language`) here, because two domains holding
-- one list is the duplication AGENTS.md rule 4 exists to prevent and is much harder to
-- unpick later than splitting one domain in two. If the answer to enquiry question 6
-- is that they differ, this becomes a migration adding `service_language`.
-- ---------------------------------------------------------------------------

create table if not exists public.code_sets (
  id          uuid primary key default gen_random_uuid(),

  /**
   * Which list this is.
   *
   * Every value below is a field the ELI schema types as `LookupCode` and leaves
   * unenumerated. `language` covers both the child home-language and service-language
   * uses — see the header.
   */
  domain      text not null,

  /** Human name, e.g. "Ministry ethnicity codes, 2026". The naming is somebody else's. */
  name        text not null,

  /**
   * Where this came from. Mandatory, exactly as `criteria_sets.source` is mandatory:
   * a set with no citation cannot be defended when a return built on it is audited.
   */
  source      text not null,

  /** The published version or revision, where the source names one. */
  version     text,

  effective_from date,

  /**
   * Only one set per domain is current at a time. A partial unique index rather than a
   * boolean nobody maintains — the same mechanism as `criteria_sets_one_current`.
   */
  is_current  boolean not null default false,

  imported_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint code_sets_source_present check (length(trim(source)) > 0),
  constraint code_sets_name_present   check (length(trim(name)) > 0),

  constraint code_sets_domain_known check (domain in (
    'gender',
    'ethnic_group',
    'iwi',
    'language',
    'staff_role',
    'qualification',
    'playcentre_qualification',
    'wait_time',
    'closure_reason'
  ))
);

create unique index if not exists code_sets_one_current
  on public.code_sets (domain) where is_current;

comment on table public.code_sets is
  'Ministry reference code lists, one set per domain per version. Ships EMPTY on purpose: a code nobody sourced is worse than no code. See 0080 header and AGENTS.md §7.';

comment on column public.code_sets.source is
  'Mandatory citation. A set with no source is not usable as reference data for a Crown return.';

create table if not exists public.codes (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.code_sets(id) on delete cascade,

  /** The published value. Bounded at 10 characters by the ELI schema's `LookupCode`. */
  code        text not null,

  /** What it means, as published. Not this repo's paraphrase. */
  label       text not null,

  /**
   * The effective window, which is the whole reason this table exists rather than an
   * enum. `AST55` gives the Ministry's own worked example: a value effective from
   * 01/01/2000 to 31/05/2019, superseded by one effective from 01/06/2019 with no end.
   *
   * A null `effective_to` means open-ended, matching that example. It does NOT mean
   * "unknown" — a set imported without dates leaves both null, and a caller resolving
   * a code as at a date must treat that as "not dated" rather than "always valid".
   * The `overdue: null` contract, again.
   */
  effective_from date,
  effective_to   date,

  /** Display order where the source publishes one. Null sorts by code. */
  sort_order  smallint,

  created_at  timestamptz not null default now(),

  constraint codes_code_present check (length(trim(code)) > 0),
  constraint codes_code_within_lookup_bound check (length(code) <= 10),
  constraint codes_label_present check (length(trim(label)) > 0),
  constraint codes_dates_ordered
    check (effective_to is null or effective_from is null or effective_to >= effective_from),

  constraint codes_unique_per_set unique (set_id, code)
);

create index if not exists codes_set_idx on public.codes (set_id);

comment on table public.codes is
  'Values within a reference set, effective-dated per AST55. `code` is bounded at 10 characters by the ELI schema LookupCode type.';

comment on column public.codes.effective_to is
  'Null means open-ended, as in the Ministry AST55 example. A set imported with no dates at all leaves both null, which means "not dated" and not "always valid".';

-- ---------------------------------------------------------------------------
-- Policies and grants
--
-- National reference data, not tenant data: there is no `centre_id` and every centre
-- resolves the same code to the same meaning. So the read is unconditional and the
-- write belongs to an importer, exactly as 0012 did it for `criteria`.
--
-- `grant all` to service_role rather than insert/update, because an importer replacing
-- a superseded set has to be able to remove a row it wrote — and unlike the
-- append-only ledgers, nothing here is evidence of anything. A wrong ethnicity code is
-- corrected, not superseded.
-- ---------------------------------------------------------------------------

alter table public.code_sets enable row level security;
alter table public.codes     enable row level security;

drop policy if exists code_sets_select on public.code_sets;
create policy code_sets_select on public.code_sets for select using (true);

drop policy if exists codes_select on public.codes;
create policy codes_select on public.codes for select using (true);

-- No insert, update or delete policy for `authenticated`, and no grant either. A code
-- set is imported by a script that cites its source; a manager typing one into a screen
-- is how an invented code enters a funding return.
revoke all on public.code_sets from anon, authenticated, service_role;
revoke all on public.codes     from anon, authenticated, service_role;

grant select on public.code_sets to authenticated;
grant select on public.codes     to authenticated;

grant all on public.code_sets to service_role;
grant all on public.codes     to service_role;

-- No audit trigger on either table, and they are added to the reference-data exemption
-- in rls_isolation.sql in this same commit. The trigger could not attribute a row to a
-- tenant even if it fired — the same reasoning `criteria` and `curriculum_strands`
-- carry. What changed a set and when is the importer's business, and `source` plus
-- `version` plus `created_at` is the record of it.
