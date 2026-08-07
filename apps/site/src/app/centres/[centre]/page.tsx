import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Photo } from '../../Photo';
import { PHOTOS } from '@/lib/photos';
import { CENTRE_FACTS, centreByPath } from '@/lib/centres';

/**
 * One centre.
 *
 * NO LONGER STATICALLY GENERATED, and `generateStaticParams` is gone with the reason.
 *
 * It used to say: "generateStaticParams means both pages are HTML at build time, with no server
 * work per visit. Nothing on this page comes from a database, so there is nothing to be stale
 * about." All true, and it broke the Content Security Policy — a prerendered page cannot carry
 * the per-request nonce the policy names, and because the policy also carries `'strict-dynamic'`
 * a browser must ignore `'self'`, so every script on the page was refused. The root layout is
 * now `force-dynamic`; `generateStaticParams` overrode it for exactly these two routes, which is
 * why they stayed `●` in the build output after everything else went dynamic. See the layout.
 *
 * The valid paths are still enumerated — `centreByPath` returns undefined and this calls
 * `notFound()`, so an unknown centre is a 404 rather than a render. That was always the real
 * guard; the param list was only a build hint.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 * No licensed capacity, no Ministry service number, no ERO summary, no named staff. Every one of
 * those is either absent from their own site or known only from a third-party directory that returned
 * 403 to a direct fetch.
 *
 * Photographs of the premises ARE here as of 2026-08-07, taken from their own site — the seven that
 * show no child. The four that show children are still withheld pending written consent for public
 * use; see `lib/photos.ts`. `CONTENT-GAPS.md` lists each with what it would
 * take to close it. A page that guesses a capacity is a page that misinforms a parent about
 * whether there is room for their child.
 *
 * No map embed either — a link out to a maps search instead. An iframe is a third party on a page
 * aimed at parents of three-month-olds, and the CSP forbids frames for that reason.
 */
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

      {/*
        The same two photographs on both centre pages, and that is a gap rather than a shortcut: their
        old site had no per-centre photography either, so there is nothing to tell them apart with.
        Recorded in CONTENT-GAPS.md rather than papered over by showing a different room on each and
        implying it belongs to that site.
      */}
      <div className="photo-row">
        <Photo photo={PHOTOS.entrance} priority />
        <Photo photo={PHOTOS.playground} />
      </div>

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

      {/* Leads with the offer rather than the absence — see the note on the same block in
          `enrolment/page.tsx`. */}
      <div className="gap">
        <strong>Ask us about the team here, and this centre&rsquo;s licence details.</strong> We are
        not publishing either until they have been confirmed with us —{' '}
        <Link href="/contact">get in touch</Link> and we will answer anything in the meantime.
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
