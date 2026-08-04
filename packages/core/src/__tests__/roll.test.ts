import { describe, expect, it } from 'vitest';
import { buildRoll } from '../roll';
import type { Child, HealthCondition } from '../children';

/**
 * The merge between server state and the offline queue.
 *
 * This is the part of offline that is easy to get subtly wrong, and every case below
 * is a real sequence: a tablet that lost signal mid-morning, a child signed in on one
 * device and out on another, a queue that has not drained yet.
 */

const child = (id: string, dateOfBirth: string): Child => ({
  id,
  centreId: 'centre',
  firstName: id,
  lastName: 'Test',
  preferredName: null,
  dateOfBirth,
  moeNsn: null,
  ethnicities: [],
  iwi: null,
  firstLanguage: null,
  gender: null,
  archivedAt: null,
});

// Ages chosen relative to a fixed reference so the bands are stable.
const baby = child('baby', '2025-06-01'); // under 2 for years to come
const toddler = child('toddler', '2021-01-01'); // comfortably over 2

const noHealth = new Map<string, HealthCondition[]>();

/** Asserts an entry exists as well as returning it. */
function entry(roll: ReturnType<typeof buildRoll>, index = 0) {
  const found = roll.entries[index];
  expect(found).toBeDefined();
  return found!;
}

describe('buildRoll', () => {
  it('shows a child the server says is in', () => {
    const roll = buildRoll({
      children: [baby],
      serverStates: [{ childId: 'baby', kind: 'in', at: '2026-08-04T20:00:00Z' }],
      queued: [],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(entry(roll).present).toBe(true);
    expect(entry(roll).pending).toBe(false);
    expect(roll.ratio.present).toBe(1);
  });

  it('shows a queued sign-in as present, and marks it pending', () => {
    const roll = buildRoll({
      children: [baby],
      serverStates: [],
      queued: [{ clientUuid: 'k1', childId: 'baby', kind: 'in', at: '2026-08-04T20:00:00Z' }],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(entry(roll).present).toBe(true);
    expect(entry(roll).pending).toBe(true);
    expect(roll.pendingCount).toBe(1);
  });

  it('COUNTS queued sign-ins in the ratio', () => {
    // The important one. If offline sign-ins were excluded, an educator would see
    // fewer children than are in the room — wrong in the dangerous direction.
    const roll = buildRoll({
      children: [baby, toddler],
      serverStates: [],
      queued: [
        { clientUuid: 'k1', childId: 'baby', kind: 'in', at: '2026-08-04T20:00:00Z' },
        { clientUuid: 'k2', childId: 'toddler', kind: 'in', at: '2026-08-04T20:01:00Z' },
      ],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(roll.ratio.present).toBe(2);
    expect(roll.ratio.underTwo).toBe(1);
    expect(roll.ratio.twoAndOver).toBe(1);
    // One under-2 and one over-2 needs two adults; one adult is a breach.
    expect(roll.ratio.status).toBe('breach');
  });

  it('lets a LATER server event win over an earlier queued one', () => {
    // A child signed in offline at 8:05 and signed out on a working tablet at 15:00
    // has gone home. "Queued always wins" would show them present all evening.
    const roll = buildRoll({
      children: [baby],
      serverStates: [{ childId: 'baby', kind: 'out', at: '2026-08-04T03:00:00Z' }],
      queued: [{ clientUuid: 'k1', childId: 'baby', kind: 'in', at: '2026-08-03T20:05:00Z' }],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(entry(roll).present).toBe(false);
    expect(entry(roll).pending).toBe(false);
  });

  it('lets a LATER queued event win over an earlier server one', () => {
    // And the other direction: signed out at lunch on the server, signed back in
    // offline at 13:00. "Server always wins" would lose the afternoon.
    const roll = buildRoll({
      children: [baby],
      serverStates: [{ childId: 'baby', kind: 'out', at: '2026-08-04T00:00:00Z' }],
      queued: [{ clientUuid: 'k1', childId: 'baby', kind: 'in', at: '2026-08-04T01:00:00Z' }],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(entry(roll).present).toBe(true);
    expect(entry(roll).pending).toBe(true);
    expect(entry(roll).since).toBe('2026-08-04T01:00:00Z');
  });

  it('takes the latest of several queued events for one child', () => {
    // Signed in, out, and in again while offline. Only the last one is the state.
    const roll = buildRoll({
      children: [baby],
      serverStates: [],
      queued: [
        { clientUuid: 'a', childId: 'baby', kind: 'in', at: '2026-08-04T20:00:00Z' },
        { clientUuid: 'b', childId: 'baby', kind: 'out', at: '2026-08-04T21:00:00Z' },
        { clientUuid: 'c', childId: 'baby', kind: 'in', at: '2026-08-04T22:00:00Z' },
      ],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(entry(roll).present).toBe(true);
    // All three still count as unsent work.
    expect(roll.pendingCount).toBe(3);
  });

  it('treats a child with no events at all as absent', () => {
    const roll = buildRoll({
      children: [baby, toddler],
      serverStates: [{ childId: 'baby', kind: 'in', at: '2026-08-04T20:00:00Z' }],
      queued: [],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(roll.entries.find((e) => e.child.id === 'toddler')?.present).toBe(false);
    expect(roll.ratio.present).toBe(1);
  });

  it('carries health conditions through for the card to flag', () => {
    const conditions = new Map<string, HealthCondition[]>([
      [
        'baby',
        [
          {
            id: 'h1',
            childId: 'baby',
            kind: 'allergy',
            name: 'Peanuts',
            severity: 'anaphylaxis',
            responsePlan: 'EpiPen in the office',
            resolvedAt: null,
          },
        ],
      ],
    ]);
    const roll = buildRoll({
      children: [baby],
      serverStates: [],
      queued: [],
      health: conditions,
      adultsPresent: 1,
    });
    expect(entry(roll).conditions).toHaveLength(1);
  });

  it('agrees with the server once the queue has drained', () => {
    // The convergence property: ordering by the event's own timestamp is what the
    // database does when it derives attendance_today, so the device and the server
    // reach the same answer rather than merely similar ones.
    const events = [
      { childId: 'baby', kind: 'in' as const, at: '2026-08-04T20:00:00Z' },
      { childId: 'baby', kind: 'out' as const, at: '2026-08-04T23:00:00Z' },
    ];
    const offline = buildRoll({
      children: [baby],
      serverStates: [],
      queued: events.map((e, i) => ({ clientUuid: `k${i}`, ...e })),
      health: noHealth,
      adultsPresent: 1,
    });
    const drained = buildRoll({
      children: [baby],
      // What the view returns: the latest event only.
      serverStates: [events[1]!],
      queued: [],
      health: noHealth,
      adultsPresent: 1,
    });
    expect(entry(offline).present).toBe(entry(drained).present);
    expect(entry(offline).since).toBe(entry(drained).since);
  });
});
