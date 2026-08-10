import type { ReactNode } from 'react';

/**
 * The question mark beside a heading or a control, and the sentence behind it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY `<details>` AND NOT A TOOLTIP
 *
 * Because a tooltip is meaning available only to a mouse. This codebase already
 * refused one for exactly that reason — `AttendanceRow` carried the response plan for
 * a child's medical condition in a `title` attribute, which is invisible to a keyboard,
 * to a touch screen, and to most screen readers, and it was removed rather than styled.
 * A `title` on a help affordance would repeat that mistake in the one place whose whole
 * job is explaining things.
 *
 * `<details>` is a real disclosure: focusable, operable with Enter and Space, announced
 * as expanded or collapsed, and readable when the text is what somebody needs. It is
 * also **server-rendered with no JavaScript at all**, which matters here more than it
 * usually would. A tap on this product's roll that lands before React hydrates does
 * nothing, silently — that cost a long diagnosis on 2026-08-09 (see [[offline-outbox]]).
 * Help that is dead for the first second of a page is help that is broken exactly when
 * a new person is looking for it, and a client component would also put this on every
 * screen's bundle for the sake of one paragraph.
 *
 * The precedent is `RatioBanner`'s "Which rule is this?", which is the same shape.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ACCESSIBLE NAME IS NOT "?"
 *
 * The glyph is `aria-hidden` and the real name is a question — "What is Attendance?".
 * Twenty controls all named "?" is a screen-reader user's list of twenty identical
 * buttons, which is the same defect as the roll's twenty "Sign in" buttons that
 * `aria-label` already fixes there.
 *
 * The target is `--target-min`, because WCAG 2.2 AA adds 2.5.8 Target Size and the
 * audit gates on `wcag22aa`. A 16px question mark would fail it.
 */
export function HelpNote({
  /** Names the thing being explained. Becomes "What is {label}?" for a screen reader. */
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="help">
      <summary className="help-mark">
        <span aria-hidden="true">?</span>
        <span className="visually-hidden">What is {label}?</span>
      </summary>
      {/*
        role="note" rather than a bare div: this is an aside about the thing beside it,
        which is what `note` means, and it is the same role the roll uses for a child's
        critical-condition flag.
      */}
      <div className="help-body" role="note">
        {children}
      </div>
    </details>
  );
}
