# Offboarding a centre

What to do when a centre stops using the product, and the defect that made it impossible
until 2026-08-04.

## The defect, because it explains the shape of everything below

A centre row could not be deleted. Not by an owner, not by the service role, not by hand
in the SQL editor. Every attempt failed with:

```
insert or update on table "audit_events" violates foreign key constraint
"audit_events_centre_id_fkey"
```

An *insert* failure, while deleting. The mechanism:

1. `delete from centres where id = …` removes the centre row.
2. Postgres cascades to `children`, and onward to health, attendance and consent.
3. Each of those tables carries the audit trigger, which inserts a row recording the
   deletion — with `centre_id` pointing at the centre from step 1.
4. That centre is already gone, so the foreign key rejects the audit row and the whole
   transaction aborts.

Five phases had shipped with no way to remove a customer. Nothing in the type system, the
policies, or the 164-assertion RLS suite could have surfaced it, because none of them
tries to delete a tenant. **The Phase 6 end-to-end fixture found it by needing to clean up
after itself.**

Migration `0020_offboarding.sql` drops the foreign key — deliberately, not as a
workaround. `audit_events` is an append-only ledger, and a ledger has to outlive its
subject; a foreign key asserts the opposite. The column, the index and the RLS policy all
remain, so a surviving row names a centre that no longer exists and is therefore invisible
to every authenticated caller, which is the right visibility for it.

## There is no button

Offboarding is an operator procedure against the service role, not a feature. That is a
choice: a control that erases a centre, placed in the UI of a product used by tired people
at 5pm, is a support incident with a countdown on it. It is also rare enough that a
runbook is the right interface.

## The procedure

### 1. Export, before anything is removed

The centre is legally responsible for its own records, and some of them it is required to
keep after it stops trading. Handing over nothing and deleting everything would leave a
centre in breach.

- **Evidence binder** — `/compliance/binder`, printed to PDF. The dated document a
  reviewer would ask for.
- **Funding preparation** — `/funding` for each period they may still be audited on.
- **The data itself** — `npm run drill:restore -- --out <somewhere>` produces one JSON
  file per table. Not elegant, and complete. **Not into a cloud-synced folder**; see
  [backup-and-restore](backup-and-restore.md).
- Confirm in writing what was handed over and when.

### 2. Archive, and let it sit

```sql
update public.centres set archived_at = now() where id = '<uuid>';
```

Reversible, and it stops the centre appearing as active while the rest of this runs.
Deleting on the day somebody says they are leaving is how a centre that changes its mind
loses everything.

### 3. Revoke access

```sql
update public.memberships set revoked_at = now() where centre_id = '<uuid>';
```

Every predicate in every policy joins a **live** membership, so this alone ends all
access — no policy needs changing and no account needs deleting yet.

### 4. Wait out the retention period

Per [retention](retention.md): the working assumption is seven years after the enrolment
ends, and **the seven-year figure is unverified**. This is the step where that matters
most, because it is the step that cannot be undone. Do not compress it to tidy up a
database.

### 5. Purge the children

```sql
select * from public.children_due_for_purge(7);
select public.purge_child('<uuid>', 'centre offboarded, retention period elapsed');
select public.purge_orphaned_guardians();
```

Owner-only, archived-only, reason recorded before deletion. Then
`npm run sweep:media` — a photo whose database row is gone is a file nobody can find and
nobody has deleted.

### 6. Remove the tenant

```sql
delete from public.centres where id = '<uuid>';
```

Cascades through everything still attached, including the append-only tables — a
referential action runs as the table owner, so the append-only guarantee is intact and is
simply not a guarantee against dropping the tenant.

The audit ledger survives, holding field names, timestamps and actor UUIDs for accounts
that are themselves about to go. No personal information about any child remains in it,
which is the whole reason the trigger was written to record column names in the first
place.

### 7. Remove the accounts

Only accounts that belong to *no other* centre. A manager who works at two services must
keep their login.

### 8. Write it down

Date, who authorised it, what was exported, what was deleted, and what was left. Nobody
will remember in three years and somebody will ask.

## What the product still cannot do

- **No self-service export.** Every step above needs a developer with the service-role
  key. That is acceptable at one centre and would not be at ten.
- **No scheduled retention sweep.** Step 4 depends on somebody remembering a date years
  away, which is not a plan. See [retention](retention.md).
- **No Storage export.** `drill:restore` covers the database. The photos are objects in a
  private bucket and there is no tool that packages them up.

---

*Last updated 2026-08-04. Steps 1–8 have never been run end to end against a real centre.
Step 6 has been run several hundred times, by the e2e fixture, which is the only reason it
works at all.*
