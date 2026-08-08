/**
 * Security review, as queries against the live schema rather than as a reading of the
 * migrations.
 *
 * WHY THIS IS A SCRIPT AND NOT A DOCUMENT
 *
 * Because a security review written by reading migration files is a review of what
 * somebody *intended*. The database is the thing that decides. Six of the checks below
 * would pass a code reading and can only be answered by asking Postgres: whether RLS is
 * actually enabled, what a role has actually been granted, whether a `SECURITY DEFINER`
 * function has a pinned `search_path`, and whether a permissive policy that looks narrow
 * is being widened by a second policy on the same verb.
 *
 * It is also repeatable, which a document is not. This is the sort of finding that comes
 * back: the drift that produced it was invisible the first time.
 *
 * Every check states what a failure would MEAN, not just that it failed. "audit_events has
 * an UPDATE grant" is only alarming if you already know the audit trail is the thing that
 * survives a purge.
 *
 *   npm run review:security
 */

interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'ok';
  check: string;
  detail: string;
}

const findings: Finding[] = [];
const add = (f: Finding) => findings.push(f);

async function run(sql: string): Promise<Record<string, unknown>[]> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const res = await client.query(sql);
      return res.rows;
    } finally {
      await client.end();
    }
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    throw new Error('Set SUPABASE_DB_URL, or SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.');
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${body.slice(0, 400)}\n  statement: ${sql.slice(0, 160)}`);
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * The tables that must be append-only against EVERY role, including `service_role`.
 *
 * Append-only here is not a nicety. `audit_events` is what survives a child's record being
 * purged, and it is the only evidence that the record existed and was deliberately deleted.
 * `attendance_events` and `payments` are claims about money. `consent_events` is the defence
 * if a consent decision is ever questioned. `messages` is a record of what was said to a
 * family. If any of these can be rewritten, the thing they exist to prove is unprovable.
 *
 * `ai_requests` is here for a reason the others are not: the month's spend cap is computed
 * by summing one of its columns. An editable usage record does not merely lose evidence —
 * it disables the control that reads it, and does so in the direction of spending money.
 */
const APPEND_ONLY = [
  'audit_events',
  'attendance_events',
  'staff_count_events',
  'consent_events',
  'messages',
  'payments',
  'ai_requests',
];

async function main() {
  console.log('\n  Security review — against the live schema\n');

  // -------------------------------------------------------------------------
  // 1. RLS enabled, and policies present, on every table
  // -------------------------------------------------------------------------
  const tables = await run(`
    select c.relname as name,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`);

  // Reachability decides the severity. A table with RLS off is only exposed if an API role
  // has a grant on it — PostgREST shows nothing a role cannot select. The first version of
  // this check called an unreachable table CRITICAL, and a review that cries critical at
  // something nobody can reach trains its reader to skim.
  const reachable = new Set(
    (
      await run(`
        select distinct table_name from information_schema.role_table_grants
         where table_schema = 'public' and grantee in ('anon', 'authenticated')`)
    ).map((r) => String(r.table_name)),
  );

  const noRls = tables.filter((t) => !t.rls);
  const noRlsReachable = noRls.filter((t) => reachable.has(String(t.name)));
  const noPolicies = tables.filter(
    (t) => Number(t.policies) === 0 && reachable.has(String(t.name)),
  );

  add({
    severity: noRlsReachable.length > 0 ? 'critical' : noRls.length === 0 ? 'ok' : 'low',
    check: `RLS enabled on all ${tables.length} tables`,
    detail:
      noRls.length === 0
        ? 'every table in public has row level security on'
        : noRlsReachable.length > 0
          ? `WITHOUT RLS AND GRANTED TO AN API ROLE: ${noRlsReachable
              .map((t) => t.name)
              .join(', ')} — every row, in every centre, to anyone holding the anon key`
          : `without RLS but unreachable, no grant to anon or authenticated: ${noRls
              .map((t) => t.name)
              .join(', ')} — protected by an absence rather than by a rule`,
  });

  add({
    severity: noPolicies.length === 0 ? 'ok' : 'critical',
    check: 'every reachable table has at least one policy',
    detail:
      noPolicies.length === 0
        ? 'no table is granted to an API role without a policy in front of it'
        : `GRANTED BUT NO POLICIES: ${noPolicies.map((t) => t.name).join(', ')}`,
  });

  // -------------------------------------------------------------------------
  // 2. Append-only, in the policies AND in the grants
  // -------------------------------------------------------------------------
  // COLUMN privileges, not just table privileges — and this correction is the point.
  // The first version read only `role_table_grants`, which shows table-level grants.
  // `messages.read_at` carries a column-level UPDATE grant, so the check reported "no
  // UPDATE grant" on a table that has one. A review that misses the exact mechanism the
  // schema uses on purpose — column-scoped grants, because a policy restricts rows and
  // only a grant restricts columns — is a review of something other than this schema.
  const writeGrants = await run(`
    select table_name, grantee, privilege_type, column_name
      from information_schema.column_privileges
     where table_schema = 'public'
       and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
       and table_name in (${APPEND_ONLY.map((t) => `'${t}'`).join(', ')})
       and grantee in ('anon', 'authenticated', 'service_role', 'public')
     order by table_name, column_name`);

  // `messages.read_at` is the one intended exception: marking a message read is a fact
  // about the reader, not about what was said. Anything else here is a defect.
  const ALLOWED = new Set(['messages.read_at']);
  const unexpected = writeGrants.filter(
    (g) => !ALLOWED.has(`${g.table_name}.${g.column_name}`),
  );

  add({
    severity: unexpected.length === 0 ? 'ok' : 'critical',
    check: 'append-only tables are writable only where intended',
    detail:
      unexpected.length === 0
        ? `${APPEND_ONLY.length} tables, and the only UPDATE grant in any of them is ` +
          'messages.read_at. Not even service_role can rewrite the rest, which is the only ' +
          'reason a purged child leaves evidence behind'
        : unexpected
            .map((g) => `${g.table_name}.${g.column_name}: ${g.privilege_type} to ${g.grantee}`)
            .join('; '),
  });

  const writePolicies = await run(`
    select tablename, policyname, cmd, roles::text as roles
      from pg_policies
     where schemaname = 'public'
       and tablename in (${APPEND_ONLY.map((t) => `'${t}'`).join(', ')})
       and cmd in ('UPDATE', 'DELETE', 'ALL')
     order by tablename, policyname`);

  // One expected entry: `messages_mark_read`, which exists precisely because
  // `messages.read_at` has a column-scoped UPDATE grant. Anything else means a policy is
  // permitting a rewrite on a table whose whole purpose is that it cannot be rewritten.
  const EXPECTED_WRITE_POLICIES = new Set(['messages.messages_mark_read']);
  const unexpectedPolicies = writePolicies.filter(
    (p) => !EXPECTED_WRITE_POLICIES.has(`${p.tablename}.${p.policyname}`),
  );

  add({
    severity: unexpectedPolicies.length === 0 ? 'ok' : 'medium',
    check: 'append-only tables have no unexpected UPDATE/DELETE policy',
    detail:
      unexpectedPolicies.length === 0
        ? 'the only write policy on any of them is messages_mark_read, which pairs with the ' +
          'read_at column grant. Everything else is refused twice: no policy and no grant'
        : unexpectedPolicies
            .map((p) => `${p.tablename}.${p.policyname} (${p.cmd} for ${p.roles})`)
            .join('; '),
  });

  // -------------------------------------------------------------------------
  // 3. Policies with no GRANT behind them, and grants with no policy in front
  // -------------------------------------------------------------------------
  // Postgres tests the table privilege BEFORE any policy. Perfect policies with no grant
  // are unreachable; a grant with no policy shows everything. Both have happened here:
  // all of 0001 was unreachable until the grants were made explicit.
  const grantGaps = await run(`
    with policy_verbs as (
      select tablename as t,
             case when cmd = 'ALL' then 'SELECT' else cmd end as verb
        from pg_policies where schemaname = 'public'
    ),
    grants as (
      -- Table-level AND column-level. Most write policies here are backed by a
      -- column-scoped grant on purpose: granting update on only (name,
      -- moe_service_number, timezone) is how the slug and the id are made unchangeable,
      -- which no policy can express. Reading only role_table_grants reported nine working
      -- features as broken. (No backticks in this comment — it lives inside a template
      -- literal, and one of them ends the string with a parse error 200 lines away.)
      select table_name as t, privilege_type as verb
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated'
      union
      select table_name as t, privilege_type as verb
        from information_schema.column_privileges
       where table_schema = 'public' and grantee = 'authenticated'
    )
    select distinct p.t as table_name, p.verb
      from policy_verbs p
      left join grants g on g.t = p.t and g.verb = p.verb
     where g.t is null
     order by p.t, p.verb`);

  add({
    severity: grantGaps.length === 0 ? 'ok' : 'low',
    check: 'no policy is unreachable for want of a GRANT',
    detail:
      grantGaps.length === 0
        ? 'every verb that has a policy also has a grant to `authenticated`'
        : grantGaps.map((g) => `${g.table_name}: policy for ${g.verb}, no grant`).join('; ') +
          ' — these policies can never fire, which is safe but means the feature is broken',
  });

  // -------------------------------------------------------------------------
  // 4. SECURITY DEFINER functions: search_path pinned, and who can execute
  // -------------------------------------------------------------------------
  // A definer function without a pinned search_path is the classic Postgres privilege
  // escalation: the caller creates `public.some_table` in a schema earlier on their path
  // and the function operates on theirs instead. Every predicate in this schema is a
  // definer function, so one unpinned function is the whole tenant boundary.
  const definers = await run(`
    select p.proname as name,
           p.prosecdef as definer,
           coalesce(array_to_string(p.proconfig, ', '), '') as config,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
     order by p.proname`);

  const unpinned = definers.filter((d) => !String(d.config).includes('search_path'));
  add({
    severity: unpinned.length === 0 ? 'ok' : 'critical',
    check: `all ${definers.length} SECURITY DEFINER functions pin search_path`,
    detail:
      unpinned.length === 0
        ? 'no definer function can be redirected to a caller-controlled schema'
        : `UNPINNED: ${unpinned.map((d) => `${d.name}(${d.args})`).join(', ')}`,
  });

  // The predicate helpers must not be executable by `anon`. `anon` has no JWT, so
  // auth.uid() is null and they would return nothing — but a function reachable before
  // authentication is a function whose behaviour has to be reasoned about, and the one
  // that must never be reachable is child_consent_for_audience, which is the consent gate.
  const definerGrants = await run(`
    select p.proname as name,
           coalesce(array_to_string(p.proacl, ' | '), 'default (public execute)') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
     order by p.proname`);

  const anonExecutable = definerGrants.filter(
    (d) => String(d.acl).includes('anon=') || String(d.acl) === 'default (public execute)',
  );

  /**
   * Functions that are reachable by `anon` on purpose.
   *
   * This allowlist exists because the finding above used to explain itself with "each returns
   * nothing without a JWT, so this is defence in depth rather than a hole". That sentence was
   * true of every definer function in the schema until 0024, and it is **false** of
   * `submit_job_application`, which is designed to work without a JWT — it is the careers form
   * on the public website.
   *
   * Leaving the old wording would have been worse than having no check: a reader would have
   * been told the one genuinely public function returns nothing, which is the opposite of true.
   * Naming it here keeps the message honest AND keeps the check useful, because a *new*
   * accidental grant still surfaces instead of hiding behind an already-noisy finding.
   *
   * Adding a name to this list is a security decision. What it costs is stated in
   * `supabase/migrations/0024_recruitment.sql`: the total capability conferred by holding the
   * anon key becomes exactly what these functions do.
   */
  const INTENTIONALLY_ANON = new Map([
    [
      'submit_job_application',
      'the public careers form — returns void, resolves the centre from a slug, rate-limited in SQL (0024)',
    ],
  ]);

  const unexpectedlyAnon = anonExecutable.filter((d) => !INTENTIONALLY_ANON.has(String(d.name)));
  const deliberate = anonExecutable.filter((d) => INTENTIONALLY_ANON.has(String(d.name)));

  add({
    severity: unexpectedlyAnon.length === 0 ? 'ok' : 'low',
    check: 'no definer function is reachable by `anon` except the ones meant to be',
    detail:
      unexpectedlyAnon.length > 0
        ? `NOT ON THE ALLOWLIST: ${unexpectedlyAnon.map((d) => d.name).join(', ')} — ` +
          'each returns nothing without a JWT, so this is defence in depth rather than a hole, ' +
          'but nothing has recorded why it is reachable'
        : deliberate.length === 0
          ? 'none carry an explicit anon grant or a default public ACL'
          : `deliberate and recorded: ${deliberate
              .map((d) => `${d.name} (${INTENTIONALLY_ANON.get(String(d.name))})`)
              .join('; ')}`,
  });

  /*
   * The other half of the allowlist: a name on it that no longer exists.
   *
   * A stale entry is how an allowlist stops being a decision and becomes a comment. If
   * `submit_job_application` is renamed or its grant revoked, this says so rather than letting
   * the list quietly protect nothing.
   */
  const staleAllowlist = [...INTENTIONALLY_ANON.keys()].filter(
    (name) => !anonExecutable.some((d) => String(d.name) === name),
  );
  if (staleAllowlist.length > 0) {
    add({
      severity: 'low',
      check: 'the anon-definer allowlist has no stale entries',
      detail:
        `allowlisted but not actually reachable by anon: ${staleAllowlist.join(', ')} — ` +
        'either the grant was revoked (in which case whatever called it is broken) or the ' +
        'function was renamed and the list was not updated',
    });
  }

  // -------------------------------------------------------------------------
  // 5. Permissive SELECT policies that widen a narrower one
  // -------------------------------------------------------------------------
  // The Phase 4 defect: permissive policies are OR'd, and `FOR ALL` covers SELECT. The
  // consent gate hid media from whānau and not at all from educators, because a second
  // permissive policy matched the same verb. A condition that must hold for EVERY reader
  // belongs in a RESTRICTIVE policy.
  const selectPolicies = await run(`
    select tablename, count(*) filter (where permissive = 'PERMISSIVE') as permissive_count,
           count(*) filter (where permissive = 'RESTRICTIVE') as restrictive_count,
           string_agg(policyname || ' (' || cmd || '/' || permissive || ')', ', '
                      order by policyname) as policies
      from pg_policies
     where schemaname = 'public' and cmd in ('SELECT', 'ALL')
     group by tablename
    having count(*) filter (where permissive = 'PERMISSIVE') > 1
     order by tablename`);

  add({
    severity: selectPolicies.length === 0 ? 'ok' : 'medium',
    check: 'exactly one permissive read path per table',
    detail:
      selectPolicies.length === 0
        ? 'no table has two permissive SELECT-capable policies, so adding a write policy ' +
          'cannot widen a read. 0022 split fourteen FOR ALL policies to establish this — ' +
          'the shape that produced the Phase 4 consent leak is now absent rather than ' +
          'individually checked'
        : selectPolicies.map((p) => `${p.tablename}: ${p.policies}`).join(' | ') +
          '  ← each needs reading as an OR. A condition that must hold for every reader must be RESTRICTIVE',
  });

  const restrictive = await run(`
    select tablename, policyname, cmd
      from pg_policies
     where schemaname = 'public' and permissive = 'RESTRICTIVE'
     order by tablename`);
  add({
    severity: restrictive.length > 0 ? 'ok' : 'medium',
    check: 'the consent gate is a RESTRICTIVE policy',
    detail:
      restrictive.length > 0
        ? restrictive.map((r) => `${r.tablename}.${r.policyname} (${r.cmd})`).join('; ')
        : 'NO restrictive policies exist — the media consent gate is permissive and therefore OR-able',
  });

  // -------------------------------------------------------------------------
  // 6. Column-level grants that a policy cannot express
  // -------------------------------------------------------------------------
  // A policy restricts rows; only a grant restricts columns. `invitations.token_hash` is
  // the case that matters: a caller who can read the hash can brute-force an invitation
  // offline, and no row policy can hide one column.
  // SELECT and UPDATE only. INSERT is *required* — the web app hashes the token and
  // inserts it — and the first version of this check flagged that as HIGH, which is the
  // kind of false positive that gets a whole review ignored.
  const tokenHash = await run(`
    select grantee, privilege_type
      from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'invitations'
       and column_name = 'token_hash'
       and privilege_type in ('SELECT', 'UPDATE')
       and grantee in ('anon', 'authenticated')`);
  add({
    severity: tokenHash.length === 0 ? 'ok' : 'high',
    check: 'invitations.token_hash cannot be read or rewritten by an API role',
    detail:
      tokenHash.length === 0
        ? 'INSERT only, which the invite flow needs. No SELECT, so the hash never comes ' +
          'back out — a caller who could read it could brute-force the token offline, and ' +
          'no row policy can hide a single column'
        : tokenHash.map((t) => `${t.grantee} has ${t.privilege_type}`).join('; '),
  });

  // -------------------------------------------------------------------------
  // 7. Storage: the media bucket must be private
  // -------------------------------------------------------------------------
  const buckets = await run(`select id, public from storage.buckets order by id`);
  const publicBuckets = buckets.filter((b) => b.public);
  add({
    severity: publicBuckets.length === 0 ? 'ok' : 'critical',
    check: 'no storage bucket is public',
    detail:
      publicBuckets.length === 0
        ? `${buckets.length} bucket(s), all private — a photo is reachable only through a ` +
          'signed URL, which is what makes withdrawing consent effective rather than cosmetic'
        : `PUBLIC: ${publicBuckets.map((b) => b.id).join(', ')} — every photo in these is ` +
          'readable by anyone with the URL, consent or no consent',
  });

  // -------------------------------------------------------------------------
  // 8. anon should be able to do essentially nothing
  // -------------------------------------------------------------------------
  const anonGrants = await run(`
    select table_name, string_agg(distinct privilege_type, ', ' order by privilege_type) as privs
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon'
     group by table_name
     order by table_name`);
  add({
    severity: anonGrants.length === 0 ? 'ok' : 'high',
    check: 'the anon role has no table grants in public',
    detail:
      anonGrants.length === 0
        ? 'an unauthenticated caller with the anon key reaches no table at all'
        : anonGrants.map((g) => `${g.table_name}: ${g.privs}`).join('; '),
  });

  // -------------------------------------------------------------------------
  // 9. Views must not be a way around RLS
  // -------------------------------------------------------------------------
  // A view runs as its owner unless `security_invoker` is on. `centre_members` joins
  // auth.users, so without security_invoker it would publish every email in the project.
  const views = await run(`
    select c.relname as name,
           coalesce((
             select option_value from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker'
           ), 'off') as security_invoker
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
     order by c.relname`);
  const definerViews = views.filter((v) => String(v.security_invoker) !== 'true' && String(v.security_invoker) !== 'on');
  add({
    severity: definerViews.length === 0 ? 'ok' : 'high',
    check: `all ${views.length} views run as the invoker`,
    detail:
      definerViews.length === 0
        ? 'no view bypasses the caller’s policies'
        : `RUNS AS OWNER: ${definerViews.map((v) => v.name).join(', ')} — these see every row ` +
          'regardless of who is asking',
  });

  // -------------------------------------------------------------------------
  // 10. Nothing outside public that authenticated can reach directly
  // -------------------------------------------------------------------------
  const authSchemaGrants = await run(`
    select table_schema, table_name, grantee, string_agg(distinct privilege_type, ', ') as privs
      from information_schema.role_table_grants
     where table_schema in ('auth', 'storage')
       and grantee in ('anon', 'authenticated')
     group by table_schema, table_name, grantee
     order by table_schema, table_name`);
  const authUsersReadable = authSchemaGrants.filter(
    (g) => g.table_schema === 'auth' && g.table_name === 'users',
  );
  add({
    severity: authUsersReadable.length === 0 ? 'ok' : 'critical',
    check: 'auth.users is not granted to anon or authenticated',
    detail:
      authUsersReadable.length === 0
        ? 'every email address in the project stays behind member_email(), which self-guards ' +
          'on shared membership. Supabase’s own hint for the broken-view symptom was to ' +
          'grant this, and following it would have published the lot'
        : authUsersReadable.map((g) => `${g.grantee}: ${g.privs}`).join('; '),
  });

  // -------------------------------------------------------------------------
  // 11. Audit coverage keeps up with the schema
  // -------------------------------------------------------------------------
  // 0005 applied the trigger to ten tables. Phases 3–5 added twelve more and nothing
  // extended it, so the audit log stopped describing the product in April and nobody
  // noticed — a missing audit row looks exactly like a quiet day. `staff_records` was the
  // worst of it: that table IS the licensing evidence, and an expiry date could be edited
  // with no trace.
  const auditGaps = await run(`
    select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('attendance_events', 'staff_count_events', 'consent_events',
                             'messages', 'payments', 'audit_events',
                             'medication_administrations', 'sleep_checks', 'safety_checks',
                             'excursion_consents', 'excursion_headcounts', 'staff_attendance_events',
                             -- 0049: a usage record, and the row is its own record.
                             'ai_requests',
                             'criteria', 'criteria_sets', 'schema_migrations',
                             'push_tokens', 'notification_preferences', 'notifications',
                             'invitations')
       and not exists (
         select 1 from pg_trigger t
          where t.tgrelid = c.oid and not t.tgisinternal
            and t.tgname = c.relname || '_audit')
     order by c.relname`);

  add({
    severity: auditGaps.length === 0 ? 'ok' : 'high',
    check: 'every table that should be audited carries the trigger',
    detail:
      auditGaps.length === 0
        ? 'no consequential table can be changed without a record of who changed which ' +
          'column, and when. Append-only tables and per-person settings are excluded by name'
        : `NO AUDIT TRIGGER: ${auditGaps.map((g) => g.name).join(', ')} — changes to these ` +
          'leave no trace at all',
  });

  // -------------------------------------------------------------------------
  // 12. An issued invoice cannot be edited
  // -------------------------------------------------------------------------
  // The README claimed this before it was true. The line policy required `status =
  // 'draft'`, and nothing stopped the status being set back to draft — three ordinary
  // statements and the amount a family was billed differs from the amount they were shown.
  const freeze = await run(`
    select count(*)::int as n from pg_trigger
     where tgrelid = 'public.invoices'::regclass
       and not tgisinternal and tgname = 'invoices_transition'`);
  add({
    severity: Number(freeze[0]?.n) === 1 ? 'ok' : 'high',
    check: 'an issued invoice cannot be reverted to draft',
    detail:
      Number(freeze[0]?.n) === 1
        ? 'the transition trigger is in place: no return to draft, no reinstating a void, ' +
          'and the reference, recipient, period and issue date are fixed once issued'
        : 'THE TRANSITION TRIGGER IS MISSING — an owner can set an issued invoice back to ' +
          'draft, edit the lines, and re-issue it',
  });

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  const order = { critical: 0, high: 1, medium: 2, low: 3, ok: 4 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const label = {
    critical: 'CRITICAL',
    high: 'HIGH    ',
    medium: 'MEDIUM  ',
    low: 'LOW     ',
    ok: 'ok      ',
  } as const;

  for (const f of findings) {
    console.log(`  ${label[f.severity]}  ${f.check}`);
    console.log(`            ${f.detail}\n`);
  }

  const bad = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  console.log(
    `  ${findings.filter((f) => f.severity === 'ok').length}/${findings.length} checks clean, ` +
      `${bad.length} at high or critical.\n`,
  );

  // Medium and low are for a human to read; only critical and high fail the run, because a
  // gate that fires on an advisory is a gate somebody turns off.
  if (bad.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
