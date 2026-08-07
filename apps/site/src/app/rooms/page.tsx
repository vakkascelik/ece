import type { Metadata } from 'next';
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
 * The ratios are **their** published figures, quoted as their statement about their own staffing.
 * That framing is deliberate and it is not lawyerly hedging: the platform's own ratio tables carry
 * `RATIO_TABLES_VERIFIED = false` and render a notice on every screen saying nobody has checked
 * them against Schedule 2 of the regulations. It would be incoherent for the marketing site to
 * imply a regulatory compliance claim that the software refuses to make.
 *
 * Their site also says "higher than required ratios" and "more than the minimum number of staff
 * required by the Ministry of Education". Both are claims about a regulatory minimum, so neither
 * is repeated here until the minimum is sourced — see CONTENT-GAPS.md.
 */
export default function RoomsPage() {
  return (
    <>
      <h1>Our rooms</h1>
      <p className="lede">
        Three age-group rooms, for children {CENTRE_FACTS.ages}, at both centres.
      </p>

      {ROOMS.map((room, i) => (
        <section key={room.name}>
          {/* Between rooms, not before the first — a mark that separates, not a decoration that
              repeats. */}
          {i > 0 && <hr className="weave" aria-hidden="true" />}
          <h2>{room.name}</h2>
          <dl className="facts">
            <dt>Ages</dt>
            <dd>{room.ages}</dd>
            <dt>Adult to child ratio</dt>
            {/* Attributed, not asserted. See the note at the top of this file. */}
            <dd>
              {room.ratio} <span style={{ color: 'var(--teal-ink)' }}>(as published by the centre)</span>
            </dd>
          </dl>
          <p>{room.approach}</p>
          {/* Named by the room's own `photo` key, so this cannot drift out of step with the list. */}
          <Photo photo={PHOTOS[room.photo]} />
        </section>
      ))}

      <div className="callout">
        <p style={{ margin: 0 }}>
          Not sure which room your child would start in?{' '}
          <Link href="/enrolment">Send an enquiry</Link> and we will tell you what is available.
        </p>
      </div>
    </>
  );
}
