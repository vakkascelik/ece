import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CENTRES, CENTRE_FACTS, centreByPath } from '@/lib/centres';

/**
 * One centre.
 *
 * Statically generated — `generateStaticParams` means both pages are HTML at build time, with no
 * server work per visit. Nothing on this page comes from a database, so there is nothing to be
 * stale about.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 * No licensed capacity, no Ministry service number, no ERO summary, no photographs, no named
 * staff. Every one of those is either absent from their own site or known only from a third-party
 * directory that returned 403 to a direct fetch. `CONTENT-GAPS.md` lists each with what it would
 * take to close it. A page that guesses a capacity is a page that misinforms a parent about
 * whether there is room for their child.
 *
 * No map embed either — a link out to a maps search instead. An iframe is a third party on a page
 * aimed at parents of three-month-olds, and the CSP forbids frames for that reason.
 */
export function generateStaticParams() {
  return CENTRES.map((centre) => ({ centre: centre.path }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ centre: string }>;
}): Promise<Metadata> {
  const centre = centreByPath((await params).centre);
  if (!centre) return {};
  return {
    title: centre.name,
    description: `Little Pearls Educare Centre at ${centre.street}, ${centre.suburb}. ${CENTRE_FACTS.hours}, children ${CENTRE_FACTS.ages}.`,
    alternates: { canonical: `/centres/${centre.path}` },
  };
}

export default async function CentrePage({ params }: { params: Promise<{ centre: string }> }) {
  const centre = centreByPath((await params).centre);
  if (!centre) notFound();

  const mapQuery = encodeURIComponent(`${centre.street}, ${centre.suburb} ${centre.postcode}`);

  /*
    JSON-LD so a search result can show the address and phone number directly. `ChildCare` is the
    schema.org type for exactly this. Only fields whose values are verified are emitted — no
    openingHours beyond what their site publishes, no aggregateRating even though third-party sites
    carry strong review scores, because those are not ours to restate.
  */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ChildCare',
    name: `Little Pearls Educare Centre — ${centre.shortName}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: centre.street,
      addressLocality: centre.suburb,
      postalCode: centre.postcode,
      addressCountry: 'NZ',
    },
    telephone: centre.phone,
    email: centre.email,
    openingHours: 'Mo-Fr 07:30-18:00',
  };

  return (
    <>
      <h1>{centre.name}</h1>
      <p className="lede">
        Little Pearls Educare Centre, {centre.suburb}. {CENTRE_FACTS.hours}, for children{' '}
        {CENTRE_FACTS.ages}.
      </p>

      <h2>Find us</h2>
      <dl className="facts">
        <dt>Address</dt>
        <dd>
          {centre.street}
          <br />
          {centre.suburb} {centre.postcode}
        </dd>
        <dt>Phone</dt>
        <dd>
          <a href={`tel:${centre.phoneHref}`}>{centre.phone}</a>
        </dd>
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${centre.email}`}>{centre.email}</a>
        </dd>
        <dt>Hours</dt>
        <dd>{CENTRE_FACTS.hours}</dd>
      </dl>
      <p>
        <a href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}>
          Open this address in maps
        </a>
      </p>

      <h2>Rooms at this centre</h2>
      <p>
        Both centres run the same three age-group rooms — Infant, Toddler and Preschool.{' '}
        <Link href="/rooms">See what happens in each</Link>.
      </p>

      <div className="gap">
        <strong>Still to come on this page.</strong> Photographs of the centre, the team you would
        meet, and this centre&rsquo;s licence details. We are not publishing those until they have
        been confirmed with us — see <Link href="/contact">contact</Link> to ask anything in the
        meantime.
      </div>

      <div className="callout">
        <p style={{ margin: 0 }}>
          Want to look around? <Link href="/enrolment">Send us an enquiry</Link> or call{' '}
          <a href={`tel:${centre.phoneHref}`}>{centre.phone}</a>.
        </p>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
