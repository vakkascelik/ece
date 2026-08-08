import { describe, expect, it } from 'vitest';
import { CAPABILITIES, MEMBER_ROLES, can, type Capability, type MemberRole } from '../index';

/**
 * What each role may be offered, and — the reason this file exists — what a `kiosk`
 * may not.
 *
 * `CAPABILITIES` lists roles per capability, so adding a role to `MEMBER_ROLES`
 * grants it nothing and **the compiler says nothing either**. That silence is the
 * correct default and a bad way to learn about it: the next role added will also pass
 * typecheck holding no capabilities, whether or not that was intended. Asserted here
 * so the intent is written down rather than inferred from an absence.
 *
 * None of this is a security boundary. Postgres is — see `tenancy-and-rls`. This
 * decides which links get drawn.
 */

const capabilities = Object.keys(CAPABILITIES) as Capability[];

describe('role capabilities', () => {
  it('finds the capabilities at all, so a broken import cannot pass vacuously', () => {
    expect(capabilities.length).toBeGreaterThan(8);
    expect(MEMBER_ROLES).toContain('kiosk');
  });

  it('grants a kiosk nothing whatsoever', () => {
    // A door tablet in an entrance. Every screen in this product is either a
    // child's record or a way of writing one, and the device is unattended.
    const held = capabilities.filter((c) => can('kiosk', c));
    expect(held).toEqual([]);
  });

  it('still grants an owner everything', () => {
    // The control that makes the assertion above mean something: a `can()` broken to
    // return false for everybody would satisfy it perfectly.
    const held = capabilities.filter((c) => can('owner', c));
    expect(held).toEqual(capabilities);
  });

  it('never lets a parent read a custody arrangement', () => {
    // A custody arrangement is a record ABOUT the guardians, so it must not be
    // readable BY them. Pinned here because it is the one capability whose omission
    // would look like an oversight to somebody tidying this list.
    expect(can('parent', 'viewCustody')).toBe(false);
    expect(can('educator', 'viewCustody')).toBe(false);
    expect(can('manager', 'viewCustody')).toBe(true);
  });

  it('answers false for an absent role rather than throwing', () => {
    // Server components call this with whatever the session produced, which may be
    // null while a membership is being resolved.
    expect(can(null, 'manageCentre')).toBe(false);
    expect(can(undefined, 'recordDailyPractice')).toBe(false);
  });

  it('lists only real roles in every capability', () => {
    /*
      Honest about its own value: `as const satisfies Record<string, readonly
      MemberRole[]>` already makes a typo a TS2820, verified by mutating `'manager'`
      to `'managers'`. This is the backstop for the day somebody loosens that clause
      to `Record<string, readonly string[]>` to make an unrelated error go away — at
      which point a typo silently grants nothing to a role nobody has, which reads at
      a glance exactly like a role that has been granted something.
    */
    const roles = new Set<string>(MEMBER_ROLES);
    for (const capability of capabilities) {
      for (const role of CAPABILITIES[capability] as readonly MemberRole[]) {
        expect(roles.has(role), `${capability} names an unknown role: ${role}`).toBe(true);
      }
    }
  });
});
