import type { Metadata } from 'next';
import Link from 'next/link';
import { CENTRES, CENTRE_FACTS } from '@/lib/centres';

export const metadata: Metadata = {
  title: 'Our centres',
  description:
    'Two Little Pearls centres in Auckland: Ōwairaka / Mt Albert and Puketāpapa / Mt Roskill. ' +
    'Addresses, phone numbers and hours.',
};

/**
 * The two centres as two places.
 *
 * Their existing "Our Centres" page describes the three *rooms* and never distinguishes the two
 * sites — so a parent cannot tell which centre is nearer, which one the on-site chef is at, or
 * what is different about either. The rooms have their own page now, and this one is about places.
 */
export default function CentresPage() {
  return (
    <>
      <h1>Our centres</h1>
      <p className="lede">
        Two {CENTRE_FACTS.structure.toLowerCase()} centres in Auckland, both open{' '}
        {CENTRE_FACTS.hours.toLowerCase()}, for children {CENTRE_FACTS.ages}.
      </p>

      <div className="grid">
        {CENTRES.map((centre) => (
          <div className="card" key={centre.path}>
            <h2 style={{ marginTop: 0 }}>{centre.name}</h2>
            <p>
              {centre.street}
              <br />
              {centre.suburb} {centre.postcode}
            </p>
            <p>
              <a href={`tel:${centre.phoneHref}`}>{centre.phone}</a>
              <br />
              <a href={`mailto:${centre.email}`}>{centre.email}</a>
            </p>
            <p>
              <Link className="btn btn-quiet" href={`/centres/${centre.path}`}>
                About {centre.shortName}
              </Link>
            </p>
          </div>
        ))}
      </div>

      <h2>What is the same at both</h2>
      <p>
        Both centres are open {CENTRE_FACTS.hours.toLowerCase()} and take children{' '}
        {CENTRE_FACTS.ages}. Both are guided by Te Whāriki, both are shoe-free inside, and both run
        the same three age-group rooms — <Link href="/rooms">Infant, Toddler and Preschool</Link>.
      </p>
    </>
  );
}
