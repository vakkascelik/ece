import { describe, expect, it } from 'vitest';
import {
  ageInMonths,
  compareBySeverity,
  consentFor,
  displayName,
  initials,
  formatAge,
  formatDays,
  isEnrolmentCurrent,
  isGranted,
  isMedicationCurrent,
  isUnderTwo,
  consentProgress,
  missingConsents,
  unaskedConsents,
  hasCriticalCondition,
  todayInZone,
  NZ_TIMEZONE,
  CONSENT_DETAIL,
  CONSENT_KINDS,
  REQUIRED_CONSENTS,
  type ConsentKind,
  type ConsentRequest,
  type ConsentState,
  type Enrolment,
  type HealthCondition,
  type MedicationAuthority,
} from '../children';

const condition = (over: Partial<HealthCondition>): HealthCondition => ({
  id: 'x',
  childId: 'c',
  kind: 'allergy',
  name: 'Thing',
  severity: null,
  responsePlan: null,
  resolvedAt: null,
  ...over,
});

describe('ageInMonths', () => {
  it('counts whole months', () => {
    expect(ageInMonths('2024-01-15', '2024-07-15')).toBe(6);
    expect(ageInMonths('2024-01-15', '2025-01-15')).toBe(12);
  });

  it('does not round up before the day of the month', () => {
    expect(ageInMonths('2024-01-15', '2024-07-14')).toBe(5);
    expect(ageInMonths('2024-01-15', '2024-07-16')).toBe(6);
  });

  it('handles a leap-day birthday', () => {
    // Born 29 Feb. On 28 Feb two years later they are one day short of two.
    expect(ageInMonths('2024-02-29', '2026-02-28')).toBe(23);
    expect(ageInMonths('2024-02-29', '2026-03-01')).toBe(24);
  });

  it('is negative for a date before birth', () => {
    expect(ageInMonths('2026-01-01', '2025-12-01')).toBeLessThan(0);
  });
});

describe('isUnderTwo — the regulated divide', () => {
  it('flips on the second birthday, not before or after', () => {
    expect(isUnderTwo('2024-03-10', '2026-03-09')).toBe(true);
    expect(isUnderTwo('2024-03-10', '2026-03-10')).toBe(false);
    expect(isUnderTwo('2024-03-10', '2026-03-11')).toBe(false);
  });

  it('counts 23 months as under and 24 as over', () => {
    expect(isUnderTwo('2024-01-01', '2025-12-01')).toBe(true);
    expect(isUnderTwo('2024-01-01', '2026-01-01')).toBe(false);
  });
});

describe('todayInZone — the bug that broke enrolment every NZ morning', () => {
  it('returns the New Zealand date, not the UTC date', () => {
    // 21:00 UTC on 4 August is 09:00 on 5 August in Auckland. UTC says the 4th
    // for the whole New Zealand morning, which made the enrolment form reject a
    // baby born that morning as "in the future" and dropped a same-day enrolment
    // off the roll until lunchtime.
    const nzMorning = new Date('2026-08-04T21:00:00Z');
    expect(todayInZone(NZ_TIMEZONE, nzMorning)).toBe('2026-08-05');
    expect(nzMorning.toISOString().slice(0, 10)).toBe('2026-08-04');
  });

  it('handles both sides of the New Zealand DST switch', () => {
    // NZDT (+13) through to early April, NZST (+12) after. 11:30 UTC is the same
    // calendar day in NZ under NZDT and the next day under... neither, but the
    // hour differs, and a naive fixed +12 would be wrong for half the year.
    const inNZDT = new Date('2026-01-15T11:30:00Z'); // 00:30 on the 16th, NZDT
    const inNZST = new Date('2026-06-15T11:30:00Z'); // 23:30 on the 15th, NZST
    expect(todayInZone(NZ_TIMEZONE, inNZDT)).toBe('2026-01-16');
    expect(todayInZone(NZ_TIMEZONE, inNZST)).toBe('2026-06-15');
  });

  it('pads single-digit months and days', () => {
    expect(todayInZone(NZ_TIMEZONE, new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05');
  });

  it('defaults to New Zealand', () => {
    const t = new Date('2026-08-04T21:00:00Z');
    expect(todayInZone(undefined, t)).toBe(todayInZone(NZ_TIMEZONE, t));
  });

  it('falls back to the device date rather than throwing on an unknown zone', () => {
    // A runtime without full ICU is a real possibility on Hermes. Signing a child
    // in must not fail because of it.
    const t = new Date(2026, 7, 4, 12, 0);
    expect(todayInZone('Not/AZone', t)).toBe('2026-08-04');
  });
});

describe('formatAge', () => {
  it('speaks in months until two, then years', () => {
    expect(formatAge('2024-01-01', '2024-02-01')).toBe('1 month');
    expect(formatAge('2024-01-01', '2025-07-01')).toBe('18 months');
    expect(formatAge('2024-01-01', '2026-01-01')).toBe('2 years');
    expect(formatAge('2024-01-01', '2026-04-01')).toBe('2y 3m');
  });
});

describe('consent is three-state, not a boolean', () => {
  const states: ConsentState[] = [
    { kind: 'photo_internal', granted: true, givenBy: 'g1', at: '2026-01-01T00:00:00Z' },
    { kind: 'photo_public', granted: false, givenBy: 'g1', at: '2026-01-01T00:00:00Z' },
  ];

  it('distinguishes refused from never asked', () => {
    expect(consentFor(states, 'photo_public')?.granted).toBe(false);
    expect(consentFor(states, 'sunscreen')).toBeUndefined();
    // Both are falsy, and they mean completely different things: one is a
    // decision to respect, the other is an unfinished enrolment.
    expect(isGranted(states, 'photo_public')).toBe(false);
    expect(isGranted(states, 'sunscreen')).toBe(false);
  });

  it('reports only unanswered required consents as missing', () => {
    // photo_public is refused, which is an answer, so it is not missing — and it
    // is not required in any case.
    expect(missingConsents(states)).toEqual(['medical_emergency', 'sunscreen', 'excursion']);
  });

  it('treats a fully answered child as complete', () => {
    const all: ConsentState[] = REQUIRED_CONSENTS.map((kind) => ({
      kind,
      granted: false,
      givenBy: null,
      at: '2026-01-01T00:00:00Z',
    }));
    // Every required consent refused is still complete. Refusal is an answer.
    expect(missingConsents(all)).toEqual([]);
  });

  it('gives every kind wording a parent could actually act on', () => {
    for (const kind of CONSENT_KINDS) {
      const { label, detail } = CONSENT_DETAIL[kind];
      expect(label.length).toBeGreaterThan(3);
      expect(detail.length).toBeGreaterThan(30);
    }
  });

  it('keeps the two photo consents separate', () => {
    // The distinction is the whole reason there are two kinds: families that
    // agree to the journal routinely refuse Facebook.
    expect(CONSENT_DETAIL.photo_internal.detail).not.toBe(CONSENT_DETAIL.photo_public.detail);
    expect(REQUIRED_CONSENTS).toContain('photo_internal');
    expect(REQUIRED_CONSENTS).not.toContain('photo_public');
  });
});

describe('asking is a fourth fact — 0073', () => {
  const asked = (kind: ConsentKind, requestedAt: string): ConsentRequest => ({
    kind,
    guardianId: 'g1',
    requestedAt,
    note: null,
  });

  it('separates never asked from asked and unanswered', () => {
    const progress = consentProgress([], [asked('sunscreen', '2026-03-04T00:00:00Z')]);
    const sunscreen = progress.find((p) => p.kind === 'sunscreen');
    const excursion = progress.find((p) => p.kind === 'excursion');

    // The distinction the schema could not express before 0073. Both are unanswered;
    // one is the centre waiting and the other is the centre not having asked.
    expect(sunscreen).toEqual({
      kind: 'sunscreen',
      state: 'awaiting',
      requestedAt: '2026-03-04T00:00:00Z',
    });
    expect(excursion).toEqual({ kind: 'excursion', state: 'unasked' });
  });

  it('lets an answer beat an ask that came after it', () => {
    /*
      A family answered in January; the office pressed the button again in March without
      looking. Treating the later ask as reopening the question would show a family as owing
      an answer they have already given, which is how a product nags somebody into ignoring
      it. Ordering deliberately puts the ask AFTER the answer.
    */
    const answered: ConsentState[] = [
      { kind: 'sunscreen', granted: true, givenBy: 'g1', at: '2026-01-01T00:00:00Z' },
    ];
    const progress = consentProgress(answered, [asked('sunscreen', '2026-03-04T00:00:00Z')]);
    expect(progress.find((p) => p.kind === 'sunscreen')).toEqual({
      kind: 'sunscreen',
      state: 'answered',
      granted: true,
      at: '2026-01-01T00:00:00Z',
    });
  });

  it('reports the most recent ask when a family has been chased', () => {
    const progress = consentProgress([], [
      asked('excursion', '2026-02-01T00:00:00Z'),
      asked('excursion', '2026-04-20T00:00:00Z'),
      asked('excursion', '2026-03-10T00:00:00Z'),
    ]);
    // Newest, not first and not last in the array — the input is deliberately unsorted.
    expect(progress.find((p) => p.kind === 'excursion')).toEqual({
      kind: 'excursion',
      state: 'awaiting',
      requestedAt: '2026-04-20T00:00:00Z',
    });
  });

  it('narrows the office list to what nobody has even been asked for', () => {
    const requests = [asked('sunscreen', '2026-03-04T00:00:00Z')];
    // `missingConsents` counts everything unanswered — the right number for "is this
    // enrolment finished". `unaskedConsents` is what the centre can act on alone.
    expect(missingConsents([])).toEqual([...REQUIRED_CONSENTS]);
    expect(unaskedConsents([], requests)).not.toContain('sunscreen');
    expect(unaskedConsents([], requests)).toContain('excursion');
  });

  it('is empty for a centre that has never used the feature', () => {
    // Every existing centre, on the day 0073 ships. The panel must render exactly as
    // before rather than showing every row as newly "not asked" in a different way.
    const progress = consentProgress([], []);
    expect(progress.every((p) => p.state === 'unasked')).toBe(true);
    expect(unaskedConsents([], [])).toEqual([...REQUIRED_CONSENTS]);
  });
});

describe('health', () => {
  it('sorts what could kill to the top', () => {
    const list = [
      condition({ name: 'Hayfever', severity: 'mild' }),
      condition({ name: 'Peanuts', severity: 'anaphylaxis' }),
      condition({ name: 'Dairy', severity: 'moderate' }),
      condition({ name: 'Gluten', severity: null, kind: 'dietary_requirement' }),
      condition({ name: 'Asthma', severity: 'severe' }),
    ];
    expect([...list].sort(compareBySeverity).map((c) => c.name)).toEqual([
      'Peanuts',
      'Asthma',
      'Dairy',
      'Hayfever',
      'Gluten',
    ]);
  });

  it('flags anaphylaxis and severe as critical, and ignores resolved ones', () => {
    expect(hasCriticalCondition([condition({ severity: 'anaphylaxis' })])).toBe(true);
    expect(hasCriticalCondition([condition({ severity: 'severe' })])).toBe(true);
    expect(hasCriticalCondition([condition({ severity: 'moderate' })])).toBe(false);
    expect(
      hasCriticalCondition([condition({ severity: 'anaphylaxis', resolvedAt: '2026-01-01' })]),
    ).toBe(false);
  });
});

describe('medication authorities expire', () => {
  const auth = (over: Partial<MedicationAuthority>): MedicationAuthority => ({
    id: 'm',
    childId: 'c',
    medicine: 'Amoxicillin',
    dose: '5ml',
    route: 'oral',
    instructions: null,
    authorisedBy: 'g1',
    authorisedAt: '2026-01-01T00:00:00Z',
    startsOn: '2026-01-01',
    expiresOn: '2026-01-10',
    ...over,
  });

  it('is not current before it starts or after it expires', () => {
    expect(isMedicationCurrent(auth({}), '2025-12-31')).toBe(false);
    expect(isMedicationCurrent(auth({}), '2026-01-05')).toBe(true);
    expect(isMedicationCurrent(auth({}), '2026-01-10')).toBe(true);
    expect(isMedicationCurrent(auth({}), '2026-01-11')).toBe(false);
  });

  it('treats a null expiry as open-ended', () => {
    expect(isMedicationCurrent(auth({ expiresOn: null }), '2030-01-01')).toBe(true);
  });
});

describe('enrolment', () => {
  const e = (over: Partial<Enrolment>): Enrolment => ({
    id: 'e',
    childId: 'c',
    centreId: 'ce',
    startDate: '2026-02-01',
    endDate: null,
    fundedHoursPerWeek: 20,
    twentyHoursEce: true,
    days: [1, 2, 3],
    notes: null,
    ...over,
  });

  it('is current from the start date, open-ended by default', () => {
    expect(isEnrolmentCurrent(e({}), '2026-01-31')).toBe(false);
    expect(isEnrolmentCurrent(e({}), '2026-02-01')).toBe(true);
    expect(isEnrolmentCurrent(e({}), '2030-01-01')).toBe(true);
  });

  it('ends on the end date inclusive', () => {
    expect(isEnrolmentCurrent(e({ endDate: '2026-06-30' }), '2026-06-30')).toBe(true);
    expect(isEnrolmentCurrent(e({ endDate: '2026-06-30' }), '2026-07-01')).toBe(false);
  });

  it('formats days in weekday order regardless of input order', () => {
    expect(formatDays([3, 1, 5])).toBe('Mon, Wed, Fri');
    expect(formatDays([])).toBe('No days set');
  });
});

describe('initials', () => {
  it('uses the preferred name and the surname', () => {
    expect(initials({ firstName: 'Anahera', lastName: 'Ngata', preferredName: 'Ana' })).toBe('AN');
    expect(initials({ firstName: 'Tāne', lastName: 'Māhuta', preferredName: null })).toBe('TM');
  });

  // The bug this function exists to avoid: displayName() would give "A(" here.
  it('never takes its letters from the bracketed display form', () => {
    expect(initials({ firstName: 'Anahera', lastName: 'Ngata', preferredName: 'Ana' })).not.toContain(
      '(',
    );
  });

  it('returns one letter rather than padding a mononym', () => {
    expect(initials({ firstName: 'Tāne', lastName: '', preferredName: null })).toBe('T');
  });

  it('does not split an astral character in half', () => {
    // U+20000, a CJK extension B ideograph: two UTF-16 code units, one character.
    const glyph = '\u{20000}';
    expect(initials({ firstName: glyph, lastName: 'Ngata', preferredName: null })).toBe(`${glyph}N`);
  });
});

describe('displayName', () => {
  it('shows the preferred name first, with the legal name in brackets', () => {
    expect(
      displayName({ firstName: 'Anahera', lastName: 'Test', preferredName: 'Ana' }),
    ).toBe('Ana (Anahera) Test');
  });

  it('does not repeat itself when the names match', () => {
    expect(displayName({ firstName: 'Ana', lastName: 'Test', preferredName: 'Ana' })).toBe('Ana Test');
    expect(displayName({ firstName: 'Ana', lastName: 'Test', preferredName: null })).toBe('Ana Test');
    expect(displayName({ firstName: 'Ana', lastName: 'Test', preferredName: '  ' })).toBe('Ana Test');
  });
});
