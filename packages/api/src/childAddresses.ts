/**
 * Where a child lives — reads and writes for `0086`.
 *
 * `child_addresses` was migrated, secured and RLS-tested in the previous commit and left with
 * **zero readers or writers**, which is exactly the condition `0085` was criticised for one commit
 * before that. This is the layer that makes it reachable.
 *
 * WHY THE TABLE EXISTS, FROM TWO INDEPENDENT SOURCES
 *
 * Funding Handbook §6-1 requires an enrolment record to contain *"the child's official name, date
 * of birth, and home/residential address"*, and ELI's `ChildEnrolment` carries
 * `PrimaryResidentialAddress` as a **required** element. Until `0086` an address existed only on
 * `guardians.address`, so a child living with a grandparent while the primary contact was a parent
 * elsewhere had no recorded address at all.
 *
 * NO TENANT FILTERING HERE, as everywhere in this package. `child_addresses` has no `centre_id`;
 * the tenant is resolved through the child, by `caller_may_see_child` for reads and
 * `caller_may_enrol` for writes. The asymmetry is deliberate and asserted in `rls_isolation.sql`:
 * an educator may read where a child goes home to, because they hand the child over at the door,
 * and may not rewrite it. A guardian may read their own child's and may not write it either — the
 * family supplies the fact, the service records it.
 *
 * THE PAIR `(child_id, kind)` IS THE IDENTITY, NOT THE `id`
 *
 * Both writers key on it, because `unique (child_id, kind)` makes that pair the row's real identity
 * while the surrogate `id` is an implementation detail. A child has a home address and possibly a
 * second household; that is two named slots, not a list, so nothing here needs to tell two rows of
 * the same kind apart because there cannot be two. This is the opposite call from
 * `bookingSchedule.ts`, where the rows genuinely are a list and the `id` is the only thing
 * distinguishing one Tuesday block from another — and if the two writers here disagreed about what
 * identifies an address, `saveChildAddress` would replace a row `deleteChildAddress` could not find.
 */

import type { AddressKind, ChildAddress } from '@ece/core';
import { fetchAll } from './paging';
import type { Db } from './index';

const ADDRESS_COLUMNS =
  'id, child_id, kind, address1_line, address2_line, address_city, address_country, address_post_code';

interface AddressRow {
  id: string;
  child_id: string;
  kind: string;
  address1_line: string;
  address2_line: string | null;
  address_city: string;
  address_country: string | null;
  address_post_code: string | null;
}

const toAddress = (r: AddressRow): ChildAddress => ({
  id: r.id,
  childId: r.child_id,
  kind: r.kind as AddressKind,
  address1Line: r.address1_line,
  address2Line: r.address2_line,
  addressCity: r.address_city,
  addressCountry: r.address_country,
  addressPostCode: r.address_post_code,
});

/**
 * Every recorded address for the given children.
 *
 * Paged, though the unique constraint bounds it at two rows per child: the caller controls
 * `childIds`, and the readiness surface that names which enrolments are incomplete will pass a
 * whole roll. Two hundred children is four hundred rows, close enough to PostgREST's cap that
 * relying on the arithmetic staying true is the assumption `bounded-queries.test.ts` exists to
 * refuse.
 */
export async function listChildAddresses(db: Db, childIds: string[]): Promise<ChildAddress[]> {
  if (childIds.length === 0) return [];
  const rows = await fetchAll<AddressRow>('listChildAddresses', (from, to) =>
    db
      .from('child_addresses')
      .select(ADDRESS_COLUMNS)
      .in('child_id', childIds)
      // `primary` happens to sort before `secondary`, which is also the order a person expects.
      // Ordered explicitly all the same: that coincidence is not a contract, and an unordered
      // read can render differently between two page loads.
      .order('child_id')
      .order('kind')
      .range(from, to),
  );
  return rows.map(toAddress);
}

export interface ChildAddressInput {
  childId: string;
  kind: AddressKind;
  address1Line: string;
  address2Line?: string | null;
  addressCity: string;
  addressCountry?: string | null;
  addressPostCode?: string | null;
}

/**
 * A blank optional field is stored as null, never as `''`.
 *
 * An empty box and an untouched one are the same fact, and `''` in a nillable element would put a
 * present-but-empty value on a return — the same class of defect as the blank required field the
 * database refuses with `child_addresses_line1_present`.
 */
const orNull = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/**
 * Record or replace an address.
 *
 * An upsert on `(child_id, kind)` rather than a read-then-insert-or-update, which would be two
 * round trips racing each other for a row the unique constraint permits only one of.
 *
 * The two required fields are trimmed and passed straight through. If somebody submits whitespace
 * the CHECK refuses it and the message below carries the constraint name, rather than this function
 * inventing a validation message the database would have produced anyway — the form validates for
 * the sake of a helpful sentence, not because the database needs help.
 *
 * `recorded_at` is set in the payload rather than left to `default now()`, and that is the whole
 * reason this needs a comment: on the UPDATE half of an upsert a column default does not fire, so
 * the column would go on reporting when the child's *first* address was typed in while the address
 * itself changed underneath it. `saveCensusDetails` sets `updated_at` the same way for the same
 * reason, and that precedent is why there is no trigger for it.
 */
export async function saveChildAddress(
  db: Db,
  input: ChildAddressInput,
  recordedBy: string | null,
): Promise<void> {
  const { data, error } = await db
    .from('child_addresses')
    .upsert(
      {
        child_id: input.childId,
        kind: input.kind,
        address1_line: input.address1Line.trim(),
        address2_line: orNull(input.address2Line),
        address_city: input.addressCity.trim(),
        address_country: orNull(input.addressCountry),
        address_post_code: orNull(input.addressPostCode),
        recorded_at: new Date().toISOString(),
        recorded_by: recordedBy,
      },
      { onConflict: 'child_id,kind' },
    )
    .select('id');
  if (error) throw new Error(`saveChildAddress: ${error.message}`);
  // Zero-row check, as everywhere in this package: under RLS a refusal is "matched nothing",
  // which PostgREST reports as success with an empty array.
  if (!data || data.length === 0) {
    throw new Error(
      'saveChildAddress: nothing was written. Either the child does not exist or the policy refused it.',
    );
  }
}

/**
 * Remove an address.
 *
 * Keyed on `(child_id, kind)` for the reason the header gives. Available at all — unlike on the
 * append-only ledgers — because a second household entered against the wrong child has to be
 * removable, and because "this child no longer has a second household" is a real change that
 * clearing the fields cannot express: the required two cannot be blanked.
 */
export async function deleteChildAddress(db: Db, childId: string, kind: AddressKind): Promise<void> {
  const { data, error } = await db
    .from('child_addresses')
    .delete()
    .eq('child_id', childId)
    .eq('kind', kind)
    .select('id');
  if (error) throw new Error(`deleteChildAddress: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      'deleteChildAddress: nothing was deleted. Either there is no such address or the policy refused it.',
    );
  }
}
