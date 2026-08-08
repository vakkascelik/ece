/**
 * The boundary between this product and an external model provider.
 *
 * `privacy-statement.md` already states the rule this file implements, about the Sentry
 * scrubber that came before it:
 *
 *   > That scrubbing has its own tests, because a bug in it does not produce a wrong
 *   > screen — it sends a child's medical information to a third party.
 *
 * Same rule, higher stakes: Sentry receives an error message when something breaks;
 * this receives a payload every time somebody presses a button.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DESIGN IS AN ALLOWLIST, AND THAT IS THE WHOLE IDEA
 *
 * The obvious implementation takes a rich object and strips the dangerous fields. That
 * is a denylist, and a denylist is wrong the moment somebody adds a field — silently,
 * in the direction of disclosure, with no error and no test failure.
 *
 * So a payload is built from `number | boolean | null` **only**. There is no string
 * field to leak through: not a name, not a note, not a reference. A caller who wants to
 * send a child's name cannot express it in this type, and `assertNoFreeText` proves at
 * runtime what the type claims at compile time.
 *
 * The one place text is permitted is `labels`, which is checked against a fixed
 * vocabulary the caller declares up front. A period label like "Feb-Mar 2026" is typed
 * by a manager, so it is not automatically safe — it is checked, not trusted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES NOT DO
 *
 * It does not make free text safe. There is no scrubber here for a pānui draft or an
 * incident narrative, because scrubbing free text is a losing game: a name this product
 * has never seen, a nickname, a street, a car — none of it is enumerable. The tier that
 * sends staff-typed text needs a recorded consent and a named provider in the privacy
 * statement instead, and it is deliberately not built on this function.
 */

/** A value that cannot carry a name. Deliberately no `string`. */
export type Scalar = number | boolean | null;

export interface ModelPayload {
  /**
   * The figures. Keys are developer-authored constants, values are numbers this product
   * computed — neither comes from a person.
   */
  figures: Record<string, Scalar>;
  /**
   * The only text allowed out, and only from a fixed vocabulary the caller declares.
   * A period label is typed by somebody, so it is checked rather than trusted.
   */
  labels?: string[];
}

/** Everything wrong with a payload, rather than the first thing wrong with it. */
export class RedactionError extends Error {
  constructor(public readonly problems: string[]) {
    super(`refusing to send: ${problems.join('; ')}`);
    this.name = 'RedactionError';
  }
}

/**
 * Anything that looks like a person, a document, or a way to reach somebody.
 *
 * These exist for the case the type system cannot see — a value that arrived as `any`
 * from a JSON boundary, or a key somebody built by concatenation. Belt and braces on
 * top of the allowlist, not the primary defence.
 */
const FORBIDDEN = [
  { name: 'an email address', re: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  { name: 'something shaped like a date of birth', re: /\b\d{4}-\d{2}-\d{2}\b/ },
  // An NSN is a Ministry identifier for one child. Nine or ten digits in a row is a
  // deliberately wide net.
  { name: 'something shaped like an NSN', re: /\b\d{9,10}\b/ },
  { name: 'a UUID', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
];

/**
 * Phone numbers, checked against a separator-stripped copy rather than in place.
 *
 * The first version matched separators positionally — `(\+?64|0)[\s-]?\d[\s-]?\d{2,4}…`
 * — and `021 555 1234` walked straight through it, because the pattern assumed where
 * the spaces would fall. People write a phone number every way there is.
 *
 * So the separators are removed first and the test is then simply "a leading 0 or +64
 * followed by at least seven more digits". Caught by the test rather than by review,
 * which is the whole argument for having the test: a redactor that silently stops
 * redacting looks exactly like one that works.
 */
const PHONE = /(\+?64|0)\d{7,}/;
const stripSeparators = (s: string) => s.replace(/[\s()\-.]/g, '');

/**
 * Refuse a payload that could carry personal information, naming every reason.
 *
 * **It throws rather than sanitising.** A function that quietly removed the offending
 * value would send a subtly wrong figure and nobody would learn that a caller had built
 * the payload incorrectly. Refusing is loud, happens in development, and is the only
 * behaviour whose failure mode is "the feature does not work" rather than "a child's
 * details left the country".
 */
export function assertNoFreeText(payload: ModelPayload, allowedLabels: readonly string[]): void {
  const problems: string[] = [];

  for (const [key, value] of Object.entries(payload.figures)) {
    if (typeof value === 'string') {
      // Unreachable through the type, reachable through `any` at a JSON boundary.
      problems.push(`figure "${key}" is text, and only numbers may be sent`);
      continue;
    }
    if (value !== null && typeof value !== 'number' && typeof value !== 'boolean') {
      problems.push(`figure "${key}" is neither a number nor a boolean`);
      continue;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      // NaN and Infinity are not figures; they are a bug upstream, and a model asked to
      // explain them will invent a reason.
      problems.push(`figure "${key}" is not a finite number`);
    }
  }

  const allowed = new Set(allowedLabels);
  for (const label of payload.labels ?? []) {
    if (!allowed.has(label)) {
      // The label is NOT echoed into the message. Quoting the rejected value into an
      // error that lands in a log is the same disclosure one step removed — the exact
      // reasoning `actionError` records for Postgres messages.
      problems.push('a label was not in the declared vocabulary');
      continue;
    }
    for (const { name, re } of FORBIDDEN) {
      if (re.test(label)) problems.push(`a declared label contains ${name}`);
    }
    if (PHONE.test(stripSeparators(label))) {
      problems.push('a declared label contains something shaped like a phone number');
    }
  }

  for (const key of Object.keys(payload.figures)) {
    for (const { name, re } of FORBIDDEN) {
      if (re.test(key)) problems.push(`a figure name contains ${name}`);
    }
    if (PHONE.test(stripSeparators(key))) {
      problems.push('a figure name contains something shaped like a phone number');
    }
  }

  if (problems.length > 0) throw new RedactionError(problems);
}

/**
 * The one function `packages/ai` may call to build a body.
 *
 * Named for what it guarantees rather than what it does, so a call site reads as the
 * assertion it is. Returns a frozen object: a caller cannot enrich the payload with a
 * name after it has been checked, which is the shape the mistake would actually take.
 */
export function redactForModel(
  payload: ModelPayload,
  allowedLabels: readonly string[],
): Readonly<ModelPayload> {
  assertNoFreeText(payload, allowedLabels);
  return Object.freeze({
    figures: Object.freeze({ ...payload.figures }),
    ...(payload.labels ? { labels: Object.freeze([...payload.labels]) as string[] } : {}),
  });
}
