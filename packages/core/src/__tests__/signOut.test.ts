import { describe, expect, it } from 'vitest';
import { describeSignOut } from '../signOut';

describe('describeSignOut', () => {
  it('allows sign-out with nothing queued, and says nothing', () => {
    expect(describeSignOut({ unsent: 0, dead: 0 })).toEqual({ allowed: true, warning: null });
  });

  it('refuses while anything is still sendable', () => {
    // The case this exists for. Sign-out clears the outbox, so proceeding would discard the
    // only record that these children are in the building.
    const v = describeSignOut({ unsent: 3, dead: 0 });
    expect(v.allowed).toBe(false);
    if (v.allowed) throw new Error('unreachable');
    expect(v.unsent).toBe(3);
  });

  it('names the number rather than saying "unsaved changes"', () => {
    // "You have unsaved changes" is a dialogue people dismiss without reading. "3 sign-ins"
    // is a fact about children.
    const v = describeSignOut({ unsent: 3, dead: 0 });
    if (v.allowed) throw new Error('unreachable');
    expect(v.message).toContain('3 sign-ins and sign-outs');
    expect(v.message).not.toMatch(/unsaved/i);
  });

  it('uses the singular for one event', () => {
    const v = describeSignOut({ unsent: 1, dead: 0 });
    if (v.allowed) throw new Error('unreachable');
    expect(v.message).toContain('1 sign-in or sign-out');
    expect(v.message).not.toContain('1 sign-ins');
  });

  it('tells the person what to do instead of only refusing', () => {
    const v = describeSignOut({ unsent: 2, dead: 0 });
    if (v.allowed) throw new Error('unreachable');
    // A refusal with no route forward is a person stuck on a tablet at 9am.
    expect(v.message).toMatch(/Send them first/);
    expect(v.message).toMatch(/by hand/);
  });

  it('allows sign-out when the only entries are permanently refused', () => {
    // Waiting cannot rescue a dead entry — the event aged out, or the membership was revoked.
    // Blocking on it would trap somebody on the device forever.
    const v = describeSignOut({ unsent: 0, dead: 2 });
    expect(v.allowed).toBe(true);
    if (!v.allowed) throw new Error('unreachable');
    expect(v.warning).toContain('2 records');
    expect(v.warning).toContain('refused');
  });

  it('warns about dead entries in a way that reaches a manager', () => {
    const v = describeSignOut({ unsent: 0, dead: 1 });
    if (!v.allowed) throw new Error('unreachable');
    expect(v.warning).toContain('1 record');
    // The roll is wrong and only a person can fix it, so the warning has to say so.
    expect(v.warning).toMatch(/Tell a manager/);
  });

  it('prioritises the block over the warning when both are present', () => {
    // Unsent work is recoverable and dead work is not, so the recoverable case wins: send
    // what can be sent, and only then discuss what cannot.
    const v = describeSignOut({ unsent: 1, dead: 5 });
    expect(v.allowed).toBe(false);
  });
});
