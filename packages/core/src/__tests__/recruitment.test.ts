import { describe, expect, it } from 'vitest';
import {
  APPLICATION_LIMITS,
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  OPEN_APPLICATION_STATUSES,
  applicationProblem,
  isOpenApplication,
} from '../recruitment';

const ok = { applicantName: 'Aroha Ngata', email: 'aroha@example.org' };

describe('applicationProblem', () => {
  it('accepts a name and an email and nothing else', () => {
    // The form must be answerable by somebody on a phone who has not decided which centre yet.
    expect(applicationProblem(ok)).toBeNull();
  });

  it('requires a name that is not only whitespace', () => {
    expect(applicationProblem({ ...ok, applicantName: '   ' })).toMatch(/name/i);
  });

  it('accepts an address the database accepts, and rejects one it does not', () => {
    // The rule is the table's: an @ that is not the first character. A stricter pattern here
    // would reject addresses the constraint permits, which is a form refusing valid input.
    expect(applicationProblem({ ...ok, email: 'a@b' })).toBeNull();
    expect(applicationProblem({ ...ok, email: '@example.org' })).toMatch(/email/i);
    expect(applicationProblem({ ...ok, email: 'nope' })).toMatch(/email/i);
  });

  it('rejects a message one character over the constraint', () => {
    // Off by one here means a check constraint violation reaches the applicant instead of a
    // sentence, so the boundary is asserted on both sides of itself.
    expect(applicationProblem({ ...ok, message: 'x'.repeat(APPLICATION_LIMITS.message) })).toBeNull();
    expect(applicationProblem({ ...ok, message: 'x'.repeat(APPLICATION_LIMITS.message + 1) })).toMatch(
      /4000/,
    );
  });

  it('rejects a start date that is not a day', () => {
    expect(applicationProblem({ ...ok, availableFrom: '2026-09-01' })).toBeNull();
    expect(applicationProblem({ ...ok, availableFrom: '2026-02-31' })).toMatch(/date/i);
    expect(applicationProblem({ ...ok, availableFrom: '01/09/2026' })).toMatch(/date/i);
  });

  it('treats an omitted start date as fine, because most applicants do not know one', () => {
    expect(applicationProblem({ ...ok, availableFrom: '' })).toBeNull();
    expect(applicationProblem({ ...ok, availableFrom: undefined })).toBeNull();
  });
});

describe('the status vocabulary', () => {
  it('labels every status, so no screen can render a raw enum value', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(APPLICATION_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('keeps declined and withdrawn distinct in the wording', () => {
    // Collapsing them to "Closed" loses whose decision it was, which is the part somebody
    // asks about a year later.
    expect(APPLICATION_STATUS_LABELS.declined).not.toEqual(APPLICATION_STATUS_LABELS.withdrawn);
    expect(APPLICATION_STATUS_LABELS.withdrawn).toMatch(/applicant/i);
  });

  /**
   * This pins the list that `submit_job_application` duplicates in SQL.
   *
   * The migration decides whether a repeat submission is a duplicate of a live application by
   * testing `status in ('new','reviewing','interview','offered')`. If somebody adds a status
   * here and not there, a person in the new state could be silently deduplicated — or worse,
   * could no longer be, and would get a second row per submit. The two lists cannot be shared
   * across SQL and TypeScript, so this fails on any change and sends the reader to the file.
   */
  it('holds open statuses exactly as 0024_recruitment.sql lists them', () => {
    expect([...OPEN_APPLICATION_STATUSES]).toEqual(['new', 'reviewing', 'interview', 'offered']);
    expect(isOpenApplication('hired')).toBe(false);
    expect(isOpenApplication('declined')).toBe(false);
    expect(isOpenApplication('withdrawn')).toBe(false);
  });
});
