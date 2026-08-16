import type { Metadata } from 'next';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { Photo } from '../Photo';
import { PHOTOS } from '@/lib/photos';
import Link from 'next/link';
import { CENTRE_FACTS, ROOMS } from '@/lib/centres';

export const metadata: Metadata = {
  title: 'Our rooms',
  description:
    'Three age-group rooms at Little Pearls: Infant (3 months to 2 years), Toddler (2 to 3½) and ' +
    'Preschool (3½ to 5), all guided by Te Whāriki.',
};

/**
 * The three rooms.
 *
 * The ratios are the figures **the centre manager confirmed on 2026-08-17** — see the provenance
 * note on `ROOMS` in `lib/centres.ts`. They are stated as the centre's own staffing, plainly,
 * which is what the original fix brief asked for once a confirmation existed.
 *
 * Still no claim about a regulatory minimum. The manager's email says the ratios "exceed the
 * standards set by the Ministry of Education"; that stays off the page both because the minimum
 * has never been sourced here (the platform's own ratio tables carry
 * `RATIO_TABLES_VERIFIED = false` for the same reason) and because the manager's direction for
 * the site's voice is explicit: plain and warm, no claims that bind or build expectations. The
 * numbers do the reassuring on their own.
 */
export default function RoomsPage() {
  return (
    <>
      {/* "Warm in winter, cool in summer" is the manager's heating-and-cooling fact from the
          enrolment email, said the way a parent hears it rather than as building services. */}
      <PageBand eyebrow="Infant · Toddler · Preschool" title="Our rooms">
        Three age-group rooms, for children {CENTRE_FACTS.ages}, at both centres — each warm in
        winter and cool in summer.
      </PageBand>

      <div className="page">
      {ROOMS.map((room, i) => (
        <section key={room.name} className="aside-grid">
          {/* Between rooms, not before the first — a mark that separates, not a decoration that
              repeats. `.rule-span` because a hairline inside a grid would otherwise take a column
              and sit under one half of the row above it. */}
          {i > 0 && <hr className="rule rule-span" aria-hidden="true" />}
          <div className="prose">
            {/*
              `Room 1 of 3` rather than the age band, which is directly below it in the `<dl>`, and
              rather than the room name, which is the heading. An eyebrow that restates the thing
              under it is a line of text doing nothing.

              The eyebrow's own pearl dot stays at 9px here. The growing 18/24/30 version of it is on
              the homepage strip, where the three sit together and the growth is legible; three rooms
              a screenful apart cannot show a size relationship, so repeating it here would be the
              gesture without the meaning.
            */}
            <Eyebrow>Room {i + 1} of 3</Eyebrow>
            <h2 className="section-title">{room.name}</h2>
            <dl className="facts">
            <dt>Ages</dt>
            <dd>{room.ages}</dd>
            <dt>Adult to child ratio</dt>
            {/*
              "(as published by the centre)" USED TO FOLLOW THIS AND IT IS GONE.

              It was there to keep the site from implying a compliance claim the platform itself
              refuses to make — see the note at the top of this file, which still holds. What it
              actually did on the page was hedge the centre's own staffing on the centre's own
              website, in front of a parent, in their own accent colour. On a third-party directory
              that attribution is honest; here the centre *is* the publisher, so the phrase reads as
              the service quietly declining to stand behind its own number.

              Removing it is not a rule-5 problem. Rule 5 forbids asserting an unsourced regulatory
              figure. This is sourced — it is their published ratio, in `lib/centres.ts` — and it is
              still stated as what they staff to and never as what a regulation requires. The two
              claims that ARE about a regulatory minimum ("higher than required ratios", "more than
              the minimum number of staff required by the Ministry") remain off the site entirely;
              CONTENT-GAPS.md gap 6 tracks both.
            */}
            <dd>{room.ratio}</dd>
            </dl>
            <p>{room.approach}</p>
          </div>
          {/* Named by the room's own `photo` key, so this cannot drift out of step with the list. */}
          <aside>
            <Photo photo={PHOTOS[room.photo]} />
          </aside>
        </section>
      ))}

        <div className="callout">
          <p style={{ margin: 0 }}>
            Not sure which room your child would start in?{' '}
            <Link href="/enrolment">Send an enquiry</Link> and we will tell you what is available.
          </p>
        </div>
      </div>
    </>
  );
}
