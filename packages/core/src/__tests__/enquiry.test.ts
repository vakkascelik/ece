import { describe, expect, it } from 'vitest';
import { enquiryProblem, isPastDate, ENQUIRY_LIMITS } from '../enquiry';

const ok = { contactName: 'Whaea Mere', email: 'mere@example.test' };

describe('enquiryProblem', () => {
  it('accepts the least an enquiry can be: a name and an address', () => {
    // No child's name, no date of birth, no phone. The centre rings the adult back.
    expect(enquiryProblem(ok)).toBeNull();
  });

  it('asks for a name and an address, in words a person can act on', () => {
    expect(enquiryProblem({ ...ok, contactName: '   ' })).toBe('Please tell us your name.');
    expect(enquiryProblem({ ...ok, email: 'nope' })).toBe(
      'Please give an email address we can reply to.',
    );
  });

  it('mirrors the database rule on email rather than being cleverer than it', () => {
    /*
      `position('@' in email) > 1` in SQL. A stricter regex here would reject addresses the
      table accepts, which is a form refusing something the product can store — and
      deliverability is not a thing a pattern can decide.
    */
    expect(enquiryProblem({ ...ok, email: 'a@b' })).toBeNull();
    expect(enquiryProblem({ ...ok, email: '@nolocalpart.test' })).not.toBeNull();
  });

  it('enforces every length the table constrains, not some of them', () => {
    // 0027 exists because a version of the careers validator checked three fields out of
    // six, so a caller who was not the form got a raw constraint violation from a function
    // advertising itself as the layer that produces a sentence.
    expect(enquiryProblem({ ...ok, contactName: 'x'.repeat(ENQUIRY_LIMITS.contactName + 1) })).not.toBeNull();
    expect(enquiryProblem({ ...ok, email: `${'x'.repeat(ENQUIRY_LIMITS.email)}@e.test` })).not.toBeNull();
    expect(enquiryProblem({ ...ok, phone: '9'.repeat(ENQUIRY_LIMITS.phone + 1) })).not.toBeNull();
    expect(enquiryProblem({ ...ok, message: 'x'.repeat(ENQUIRY_LIMITS.message + 1) })).not.toBeNull();
  });

  it('accepts each length exactly at the limit', () => {
    // Off-by-one in the safe direction is still a form refusing something the table allows.
    expect(enquiryProblem({ ...ok, contactName: 'x'.repeat(ENQUIRY_LIMITS.contactName) })).toBeNull();
    expect(enquiryProblem({ ...ok, phone: '9'.repeat(ENQUIRY_LIMITS.phone) })).toBeNull();
    expect(enquiryProblem({ ...ok, message: 'x'.repeat(ENQUIRY_LIMITS.message) })).toBeNull();
  });

  it('refuses a start date that is not a date, and allows none at all', () => {
    expect(enquiryProblem({ ...ok, wantedFrom: 'next March' })).toBe('That start date is not a date.');
    expect(enquiryProblem({ ...ok, wantedFrom: '' })).toBeNull();
    expect(enquiryProblem({ ...ok, wantedFrom: '2026-09-01' })).toBeNull();
  });

  it('has NO branch for a child name, and that is the point', () => {
    /*
      The form does not ask for one — see 0054, the site's enrolment page, and
      `tenant-little-pearls.md`. Passing one is not an error here because the field does not
      exist to be wrong: this asserts the shape of the input, so a `childName` appearing in
      it later shows up as a compile change rather than a quiet addition.
    */
    const keys = Object.keys(ok);
    expect(keys).not.toContain('childName');
    expect(JSON.stringify(enquiryProblem(ok))).not.toContain('child');
  });
});

describe('isPastDate', () => {
  it('compares ISO strings, never Dates', () => {
    /*
      `new Date('2026-01-01')` is midnight UTC, so comparing constructed Dates puts a
      family's January start date in the previous year for anybody behind UTC. String
      comparison on `YYYY-MM-DD` cannot pick up a timezone at all — the same reasoning as
      `xeroDate`, which is the third time this repo has fixed this shape.
    */
    expect(isPastDate('2026-01-01', '2026-08-09')).toBe(true);
    expect(isPastDate('2026-12-31', '2026-08-09')).toBe(false);
  });

  it('does not call today itself past', () => {
    // A family enquiring about a place starting today is asking for something real.
    expect(isPastDate('2026-08-09', '2026-08-09')).toBe(false);
  });
});
