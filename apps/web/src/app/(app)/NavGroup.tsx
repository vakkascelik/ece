import { Children, type ReactNode } from 'react';

/**
 * A labelled group of nav links.
 *
 * WHY THIS EXISTS
 *
 * The rail renders every capability-filtered link into one flat column. For an educator
 * that is thirteen links and workable; for an owner it is twenty-one, and the screens
 * opened every hour sit visually equal to the ones opened twice a year. The order in
 * `layout.tsx` was already argued line by line in its comments — this makes that
 * reasoning visible instead of leaving it to somebody reading the source.
 *
 * WHY IT RENDERS NOTHING WHEN EMPTY
 *
 * Every child arrives as `can(role, …) && <NavLink/>`, so a group can filter down to
 * nothing. A heading left standing over an empty list would be worse than the flat list
 * it replaced: "Money" rendered to an educator tells them money screens exist, which is
 * the presentation half of the argument `roles.spec.ts` makes about an empty custody
 * panel — the heading is the disclosure, not the rows under it.
 *
 * `.filter(Boolean)` after `Children.toArray` is belt-and-braces and is kept deliberately.
 * `toArray` already drops `null`, `undefined` and booleans, so with today's `&&` children
 * the filter removes nothing; it earns its place the first time somebody writes a group
 * whose children are built some other way.
 *
 * WHY A FRAGMENT AND NOT SIX <nav> ELEMENTS
 *
 * Six landmarks would be worse than one. A screen reader user skimming landmarks would
 * meet "navigation, navigation, navigation…" and have to enter each to learn what it is;
 * a heading list gives them the six words directly. So this renders `<h3>` + `<ul>` into
 * the single `<nav>` that is already there.
 */
export function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;

  return (
    <>
      <h3>{label}</h3>
      <ul>
        {items.map((item, index) => (
          // Index keys: this list is a fixed sequence of JSX literals in `layout.tsx`,
          // never reordered and never keyed by data, so the index *is* the identity.
          <li key={index}>{item}</li>
        ))}
      </ul>
    </>
  );
}
