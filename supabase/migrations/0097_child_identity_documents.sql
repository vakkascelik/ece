-- ---------------------------------------------------------------------------
-- 0097 — an identity document was sighted, and deliberately NOT which one
--
-- `AST28` asks for the data flow that creates an NSN **with an identity document present**.
-- The application answers currently say, in as many words: "There is no identity-document
-- verification anywhere in the product — no birth-certificate or passport field, no
-- sighted-by/sighted-at pair on the child record, though that exact pattern is used for
-- immunisation and staff records. AST28's 'identification document is not present' path is
-- therefore the *only* path we could implement today, which is the wrong way round."
--
-- This is that pattern, arriving on the child record.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES NOT STORE, AND IT IS THE DECISION IN THIS MIGRATION
--
-- **The document number.** Not the birth certificate registration number, not the passport
-- number. `staff_records` stores a `reference` and that is right there — a practising
-- certificate number is a professional registration a teacher publishes on a wall. A child's
-- passport number is not that, and this database already holds enough about a four-year-old.
--
-- Whether the NSI interface *transmits* a document number is in the NSI GINS specification,
-- which we do not hold and have asked for. If it does, that is a migration made against a read
-- specification with a stated purpose — which is the opposite of storing it now in case.
--
-- What identity verification actually needs to record is that a person **sighted** a document,
-- which kind, and when. That is what a service would be asked to evidence, and it is what this
-- table holds.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE KIND IS AN UNRESOLVABLE CODE, LIKE THE CENSUS'S SIX
--
-- The document types come from the NSI specification. `0080` reserves a domain per field the
-- ELI schema types as `LookupCode` and does not enumerate, and ships every one of them EMPTY —
-- so this adds `identity_document` to that list and ships it empty too. A value here is
-- unresolvable until the Ministry publishes the list, which is a readiness gap the product can
-- report rather than an enum somebody invented.
--
-- Inventing three plausible values — birth certificate, passport, whatever — is precisely what
-- AGENTS §7 forbids, and it would be worse here than usual: a wrong identity-document
-- vocabulary on a Crown interface is not a cosmetic mistake.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- MANY ROWS PER CHILD, NOT ONE
--
-- Re-sighting a document later is a new act by a new person on a new date, and flattening it
-- onto the child would lose who checked and when. Same reasoning as `attendance_verifications`
-- (0061), and the same reason `detail_confirmations` could not be reused for §6-7.
-- ---------------------------------------------------------------------------

alter table public.code_sets
  drop constraint if exists code_sets_domain_known;

alter table public.code_sets
  add constraint code_sets_domain_known check (domain in (
    'gender',
    'ethnic_group',
    'iwi',
    'language',
    'staff_role',
    'qualification',
    'playcentre_qualification',
    'wait_time',
    'closure_reason',
    -- 0097. From the NSI specification, which we do not hold; ships empty like the other nine.
    'identity_document'
  ));

create table if not exists public.child_identity_documents (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid not null references public.children(id) on delete cascade,

  /*
    Which kind of document. A `LookupCode` with the same 10-character bound the census codes
    carry and NO foreign key to `codes` — the same treatment `0081` gives the census columns and
    `0088` gives `closure_reason`. An unresolvable code belongs on a readiness report, not in a
    rejected write.
  */
  kind         text,

  /*
    The sighting. A pair or neither — 0011's rule, in 0011's words: "A timestamp with nobody
    attached is not evidence."
  */
  sighted_by   uuid references auth.users(id) on delete set null,
  sighted_at   timestamptz,

  note         text,

  recorded_at  timestamptz not null default now(),
  recorded_by  uuid references auth.users(id) on delete set null,

  constraint child_identity_documents_sighting_complete
    check ((sighted_by is null) = (sighted_at is null)),

  constraint child_identity_documents_kind_within_lookup_bound
    check (kind is null or length(kind) <= 10),

  constraint child_identity_documents_kind_not_blank
    check (kind is null or length(trim(kind)) > 0)
);

create index if not exists child_identity_documents_child_idx
  on public.child_identity_documents (child_id, sighted_at desc);

comment on table public.child_identity_documents is
  'That an identity document was sighted for a child, by whom and when - the evidence AST28''s "identification document is present" path needs. DELIBERATELY DOES NOT STORE THE DOCUMENT NUMBER: a practising certificate number is a professional registration, a child''s passport number is not, and whether the NSI interface transmits one is in a specification we do not hold. Many rows per child, because re-sighting later is a new act by a new person. The kind is an unresolvable LookupCode from the NSI specification; code_sets reserves the domain and ships it EMPTY.';

comment on column public.child_identity_documents.kind is
  'Document type, a LookupCode with no published list. Text with the LookupCode length bound and NO foreign key to codes - the same treatment 0081 gives the census code columns. Inventing plausible values here would be a wrong identity vocabulary on a Crown interface.';

alter table public.child_identity_documents enable row level security;

/*
  `caller_may_see_child` to read and `caller_may_enrol` to write — character-identical to
  `child_addresses` (0086), and for the same reason: this is a fact about the child's record
  that the office keeps, not something a parent maintains. A guardian reads their own child's
  row through `caller_may_see_child`; only somebody who may enrol may record a sighting, because
  the sighting is an assertion by the service that a person looked at a document.

  Verb-split, delete USING character-identical to the insert WITH CHECK — 0025's lesson, and
  there is a class assertion comparing the two.
*/

drop policy if exists child_identity_documents_select on public.child_identity_documents;
create policy child_identity_documents_select on public.child_identity_documents
  for select using (public.caller_may_see_child(child_id));

drop policy if exists child_identity_documents_write_insert on public.child_identity_documents;
create policy child_identity_documents_write_insert on public.child_identity_documents
  for insert with check (public.caller_may_enrol(child_id));

drop policy if exists child_identity_documents_write_update on public.child_identity_documents;
create policy child_identity_documents_write_update on public.child_identity_documents
  for update
  using (public.caller_may_enrol(child_id))
  with check (public.caller_may_enrol(child_id));

drop policy if exists child_identity_documents_write_delete on public.child_identity_documents;
create policy child_identity_documents_write_delete on public.child_identity_documents
  for delete using (public.caller_may_enrol(child_id));

revoke all on public.child_identity_documents from anon, authenticated, service_role;
grant select, insert, update, delete on public.child_identity_documents to authenticated, service_role;

/*
  Audited. Who recorded that a document was sighted, and who changed it afterwards, is the
  question an identity check exists to answer. `audit_trigger()` resolves the centre through
  `child_id`, which has been in its list since 0059.
*/
drop trigger if exists child_identity_documents_audit on public.child_identity_documents;
create trigger child_identity_documents_audit
  after insert or update or delete on public.child_identity_documents
  for each row execute function public.audit_trigger();

/*
  ASSERTED, and it creates what it needs — 0094's inline check took an early return on a
  database with no staff members and that looked like coverage in a diff.
*/
do $$
declare
  v_child uuid;
  v_id    uuid;
  v_rows  integer;
  v_ok    boolean := false;
begin
  select id into v_child from public.children limit 1;
  if v_child is null then
    raise exception '0097: no children, so the constraints could not be exercised';
  end if;

  -- Half a sighting is not evidence.
  begin
    insert into public.child_identity_documents (child_id, sighted_at)
    values (v_child, now());
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '0097: a sighting date with nobody attached was accepted';
  end if;

  insert into public.child_identity_documents (child_id, kind, note)
  values (v_child, null, '0097 self-check')
  returning id into v_id;

  select count(*) into v_rows
    from public.audit_events
   where entity = 'child_identity_documents' and entity_id = v_id::text;

  delete from public.child_identity_documents where id = v_id;

  if v_rows = 0 then
    raise exception '0097: the audit trigger did not record an insert';
  end if;
end $$;
