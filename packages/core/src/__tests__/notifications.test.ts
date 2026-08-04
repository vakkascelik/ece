import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  deliverableAt,
  deliverableNow,
  inQuietHours,
  POST_KIND_LABELS,
  REO,
  wantsKind,
  type NotificationPreferences,
} from '../notifications';

const NZ = 'Pacific/Auckland';
const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  ...DEFAULT_PREFERENCES,
  ...over,
});

/** An instant, given a New Zealand wall clock. NZST (+12) in August. */
const nzst = (day: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 7, day, hh - 12, mm));

/** NZDT (+13) in January. */
const nzdt = (day: number, hh: number, mm = 0) =>
  new Date(Date.UTC(2026, 0, day, hh - 13, mm));

describe('inQuietHours — the window wraps midnight', () => {
  it('is quiet in the evening and the small hours, and not in the day', () => {
    // 20:00 → 07:00. A plain `from <= now < until` comparison is inside-out for this, which is
    // the majority configuration.
    const p = prefs();
    expect(inQuietHours(p, nzst(4, 21, 30), NZ)).toBe(true);
    expect(inQuietHours(p, nzst(5, 2, 0), NZ)).toBe(true);
    expect(inQuietHours(p, nzst(5, 6, 59), NZ)).toBe(true);
    expect(inQuietHours(p, nzst(5, 7, 0), NZ)).toBe(false);
    expect(inQuietHours(p, nzst(5, 14, 0), NZ)).toBe(false);
    expect(inQuietHours(p, nzst(5, 19, 59), NZ)).toBe(false);
    expect(inQuietHours(p, nzst(5, 20, 0), NZ)).toBe(true);
  });

  it('handles a same-day window such as a nap-time block', () => {
    const p = prefs({ quietFrom: '12:00', quietUntil: '14:00' });
    expect(inQuietHours(p, nzst(4, 11, 59), NZ)).toBe(false);
    expect(inQuietHours(p, nzst(4, 12, 0), NZ)).toBe(true);
    expect(inQuietHours(p, nzst(4, 13, 59), NZ)).toBe(true);
    expect(inQuietHours(p, nzst(4, 14, 0), NZ)).toBe(false);
    expect(inQuietHours(p, nzst(4, 22, 0), NZ)).toBe(false);
  });

  it('treats an identical from and until as all day quiet', () => {
    // Somebody who sets both the same has asked for silence. Reading it as "always send" would
    // be the opposite of why they touched the setting.
    const p = prefs({ quietFrom: '09:00', quietUntil: '09:00' });
    expect(inQuietHours(p, nzst(4, 3, 0), NZ)).toBe(true);
    expect(inQuietHours(p, nzst(4, 15, 0), NZ)).toBe(true);
  });

  it('is never quiet when the setting is off', () => {
    expect(inQuietHours(prefs({ quietHours: false }), nzst(4, 2, 0), NZ)).toBe(false);
  });

  it('compares against the centre wall clock, not UTC', () => {
    // 09:00 UTC on 4 August is 21:00 in Auckland — quiet. The same instant is not quiet in UTC.
    const at = new Date(Date.UTC(2026, 7, 4, 9, 0));
    expect(inQuietHours(prefs(), at, NZ)).toBe(true);
    expect(inQuietHours(prefs(), at, 'UTC')).toBe(false);
  });

  it('follows the clocks across daylight saving', () => {
    // 21:00 local is quiet in both January (NZDT, +13) and August (NZST, +12), which are
    // different UTC instants. A hard-coded offset gets one of them wrong.
    expect(inQuietHours(prefs(), nzdt(15, 21, 0), NZ)).toBe(true);
    expect(inQuietHours(prefs(), nzst(4, 21, 0), NZ)).toBe(true);
    expect(inQuietHours(prefs(), nzdt(15, 15, 0), NZ)).toBe(false);
    expect(inQuietHours(prefs(), nzst(4, 15, 0), NZ)).toBe(false);
  });
});

describe('wantsKind', () => {
  it('respects each switch independently', () => {
    const p = prefs({ posts: true, messages: false, attendance: false, reminders: true });
    expect(wantsKind(p, 'post')).toBe(true);
    expect(wantsKind(p, 'message')).toBe(false);
    expect(wantsKind(p, 'attendance')).toBe(false);
    expect(wantsKind(p, 'reminder')).toBe(true);
  });

  it('has attendance off by default', () => {
    // A parent does not need a push notification when their child is signed in. They were
    // standing there.
    expect(DEFAULT_PREFERENCES.attendance).toBe(false);
    expect(DEFAULT_PREFERENCES.posts).toBe(true);
    expect(DEFAULT_PREFERENCES.messages).toBe(true);
  });
});

describe('deliverableAt — the decision gets written down', () => {
  it('returns the same instant outside quiet hours', () => {
    const at = nzst(4, 15, 0);
    expect(deliverableAt(prefs(), 'post', at, NZ)?.getTime()).toBe(at.getTime());
  });

  it('holds an evening notification until the morning', () => {
    // 21:30 local, quiet until 07:00 → 9.5 hours later.
    const at = nzst(4, 21, 30);
    const when = deliverableAt(prefs(), 'post', at, NZ);
    expect(when).not.toBeNull();
    expect((when!.getTime() - at.getTime()) / 3_600_000).toBeCloseTo(9.5, 5);
  });

  it('holds an early-morning notification only until 07:00 the same day', () => {
    // 02:00 local — the window has not wrapped yet from here, so the wait is 5 hours, not 29.
    const at = nzst(5, 2, 0);
    const when = deliverableAt(prefs(), 'post', at, NZ);
    expect((when!.getTime() - at.getTime()) / 3_600_000).toBeCloseTo(5, 5);
  });

  it('releases exactly at the boundary rather than a minute late', () => {
    const at = nzst(4, 20, 0);
    const when = deliverableAt(prefs(), 'post', at, NZ);
    expect((when!.getTime() - at.getTime()) / 3_600_000).toBeCloseTo(11, 5);
  });

  it('returns null for a kind the person has switched off', () => {
    // Null means never, which is different from "later". A held notification and a refused one
    // must not be confused, or switching a kind off would just delay it.
    expect(deliverableAt(prefs(), 'attendance', nzst(4, 15, 0), NZ)).toBeNull();
    expect(deliverableAt(prefs({ posts: false }), 'post', nzst(4, 15, 0), NZ)).toBeNull();
  });

  it('sends immediately when quiet hours are off, even at 3am', () => {
    const at = nzst(5, 3, 0);
    expect(deliverableAt(prefs({ quietHours: false }), 'post', at, NZ)?.getTime()).toBe(
      at.getTime(),
    );
  });
});

describe('deliverableNow', () => {
  it('is the same decision without the scheduling', () => {
    expect(deliverableNow(prefs(), 'post', nzst(4, 15, 0), NZ)).toBe(true);
    expect(deliverableNow(prefs(), 'post', nzst(4, 22, 0), NZ)).toBe(false);
    expect(deliverableNow(prefs(), 'attendance', nzst(4, 15, 0), NZ)).toBe(false);
  });
});

describe('vocabulary', () => {
  it('keeps macrons, which are not optional', () => {
    // `panui` without one is a different word, and getting it wrong in front of Māori families
    // is worse than not trying.
    expect(REO.whanau).toBe('whānau');
    expect(REO.panui).toBe('pānui');
    expect(REO.tamariki).toBe('tamariki');
    expect(POST_KIND_LABELS.panui).toBe('Pānui');
  });

  it('labels every post kind', () => {
    expect(Object.keys(POST_KIND_LABELS).sort()).toEqual([
      'daily_update',
      'learning_moment',
      'panui',
    ]);
  });
});
