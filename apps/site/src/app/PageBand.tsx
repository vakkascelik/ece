import type { ReactNode } from 'react';
import { Eyebrow } from './Eyebrow';
import { Waves } from './Waves';

/**
 * The page header for every route that is not the homepage: the `<h1>` and its opening line, on a
 * shallow ocean band with a waterline under them.
 *
 * WHY THE INNER PAGES GET ONE AT ALL — this is an extrapolation and should be read as one.
 *
 * The handoff scopes its design to the homepage and says the header, the footer band and the pearl
 * are the shared pieces. Applying the direction to the whole site was asked for separately, and
 * there is no supplied design for these nine routes, so the rule used here is stated rather than
 * implied: **the ocean is where a page begins and ends, and the middle is paper.** The homepage
 * hero and this band are the same object at two depths.
 *
 * It is deliberately not a second hero. No pearl, no boat, no light source, two wave layers instead
 * of three, and a third of the vertical space — because a parent opening `/enrolment` came for a
 * phone number, not for an experience, and a full-height ocean on every route would be the coral
 * banner problem again in a different hue: the loudest thing on the page carrying the least of its
 * information.
 *
 * Two bands per page and no more, which is the handoff's own limit — this one and the footer.
 */
export function PageBand({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  /** The opening line. Prose, not a paragraph of body copy — it sits on the water. */
  children?: ReactNode;
}) {
  return (
    <section className="band-ocean band-ocean--page">
      <div className="band-ocean__inner wrap">
        <Eyebrow tone="ocean">{eyebrow}</Eyebrow>
        <h1>{title}</h1>
        {children && <p className="band-ocean__lede">{children}</p>}
      </div>
      <Waves variant="page" />
    </section>
  );
}
