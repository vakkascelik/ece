import { Children, type ReactNode } from 'react';

/**
 * A labelled, collapsible group of nav links.
 *
 * WHY THIS EXISTS
 *
 * The rail renders every capability-filtered link into one column. For an educator that is
 * thirteen links and workable; for an owner it is twenty-one, and the screens opened every
 * hour sit visually equal to the ones opened twice a year. The order in `layout.tsx` was
 * already argued line by line in its comments — this makes that reasoning visible instead of
 * leaving it to somebody reading the source.
 *
 * WHY `<details>` AND NOT A BUTTON WITH STATE
 *
 * Because it collapses with **no JavaScript at all**. `<details>` is focusable, operable with
 * Enter and Space, announced as expanded or collapsed, and works before React hydrates — the
 * same argument `HelpNote` makes for the `?` beside every heading, and the same reason the
 * kiosk's PIN pad is drawn in the page rather than summoning a keyboard.
 *
 * An earlier version of this file argued *against* collapsing, on the grounds that it would
 * make the rail a client component with storage on every screen. **That was wrong**, and wrong
 * in the direction that matters: it was the load-bearing reason for not building something
 * somebody had asked for. A `<details>` costs nothing, and the open/closed state is a cookie
 * read on the server — see `navGroups.ts`.
 *
 * DEFAULT OPEN, NEVER DEFAULT CLOSED
 *
 * Attendance is opened dozens of times a day on a tablet at the door. Shipping it behind a tap
 * would put that tap in front of the most-used screen in the product for everybody, in order to
 * tidy a rail for the few people who want it tidy. Collapsing is opt-in and remembered; a
 * person who never touches it never pays for it.
 *
 * WHY IT RENDERS NOTHING WHEN EMPTY
 *
 * Every child arrives as `can(role, …) && <NavLink/>`, so a group can filter down to nothing. A
 * heading left standing over an empty list would be worse than the flat list it replaced:
 * "Money" rendered to an educator tells them money screens exist, which is the presentation
 * half of the argument `roles.spec.ts` makes about an empty custody panel — the heading is the
 * disclosure, not the rows under it. A *collapsed* group is not that: it says a group is there
 * and says how to see inside it.
 *
 * `.filter(Boolean)` after `Children.toArray` is belt-and-braces and is kept deliberately.
 * `toArray` already drops `null`, `undefined` and booleans, so with today's `&&` children the
 * filter removes nothing; it earns its place the first time somebody writes a group whose
 * children are built some other way.
 *
 * STILL ONE LANDMARK
 *
 * `<details>` is not a landmark, so six of them inside the one `<nav>` is still one navigation
 * region with six headings — which is what lets a screen reader user skim the six words rather
 * than entering six regions to find out what they are.
 */
export function NavGroup({
  label,
  open,
  children,
}: {
  label: string;
  /**
   * Read from the cookie by `layout.tsx`. Open unless somebody has said otherwise — see
   * `navGroups.ts` for why the cookie stores what is *closed* rather than what is open.
   */
  open: boolean;
  children: ReactNode;
}) {
  const items = Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;

  return (
    <details className="nav-group" data-group={label.toLowerCase()} open={open}>
      {/*
        The heading is inside the summary, not beside it. `<summary>` takes heading content, so
        this stays an `<h3>` in the document outline — a screen reader user still gets the six
        words when they list headings — while also being the control that opens the group. Two
        separate elements would let the heading and the control drift apart, which is the same
        mistake `aria-current` avoids by being both the state and the selector.
      */}
      <summary>
        <h3>{label}</h3>
        {/*
          The chevron, and it is `aria-hidden`. `<details>` already announces expanded or
          collapsed, so a glyph in the accessible name would say it twice. It rotates off the
          element's own `open` state in CSS, so there is no second source of truth to keep in
          step — the same reason the current nav item is styled off `aria-current`.
        */}
        <svg
          className="nav-group-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </summary>
      <ul>
        {items.map((item, index) => (
          // Index keys: this list is a fixed sequence of JSX literals in `layout.tsx`,
          // never reordered and never keyed by data, so the index *is* the identity.
          <li key={index}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
