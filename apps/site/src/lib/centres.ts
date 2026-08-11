/**
 * The two centres, as facts with provenance.
 *
 * EVERY VALUE HERE WAS OBSERVED ON THEIR OWN SITE
 *
 * littlepearls.org.nz, cross-checked against `docs/tenant-little-pearls.md`, which agrees on
 * every contact detail. Nothing is inferred and nothing comes from a third-party directory —
 * `apps/site/CONTENT-GAPS.md` lists what that leaves out and why each gap is still open.
 *
 * Deliberately a module in this app rather than a database read. The public site has no Supabase
 * dependency: `centres` is revoked from `anon` in `supabase/migrations/0001_tenancy.sql`, and
 * these five fields change roughly never. A build-time constant is also reviewable in a diff,
 * which a row is not.
 *
 * THE SLUGS MATCH THE PLATFORM'S ON PURPOSE
 *
 * `little-pearls-mt-albert` and `little-pearls-mt-roskill` are the real `centres.slug` values.
 * They are not used to query anything today, but if the enquiry form ever posts a centre to the
 * platform it will post a slug rather than a uuid — so keeping the two in step now avoids a
 * mapping table later. `0001_tenancy.sql` deliberately withholds `grant update` on that column
 * because it appears in URLs; that decision is what makes relying on it safe.
 */

import { PHOTOS } from './photos';

export interface Centre {
  /** The URL segment on this site. Short, because it is typed and shared. */
  path: string;
  /** The platform's `centres.slug`. */
  platformSlug: string;
  /** Their own name for the place, mana whenua name first, as their site does it. */
  name: string;
  shortName: string;
  street: string;
  suburb: string;
  postcode: string;
  phone: string;
  /** Tel: href form. Kept beside the display form so neither is derived wrongly. */
  phoneHref: string;
  email: string;
  /**
   * Where the pin goes on the map, and the one field here that did NOT come off their own site.
   *
   * **Geocoded 2026-08-07** through the Google Geocoding API, from the `street`, `suburb` and
   * `postcode` above. Both came back `location_type: ROOFTOP` — Google's strongest result, meaning
   * a known street address rather than an interpolated point on a road — with `partial_match`
   * absent and a `formatted_address` identical to what is written here, down to the postcode. That
   * is the check; the numbers are recorded rather than the query, so nothing re-geocodes at request
   * time.
   *
   * WHY NOT JUST HAND GOOGLE THE ADDRESS STRING, which the Static Maps API will geocode for you.
   * Because then the pin is decided per request by a service whose answer nobody has looked at, and
   * a childcare centre pinned to the wrong building is a parent standing outside a stranger's house
   * with a three-month-old. Geocoding once, checking the result, and committing it makes the pin a
   * reviewable value in a diff — the same argument that keeps this whole file out of the database.
   */
  lat: number;
  lng: number;
}

export const CENTRES: readonly Centre[] = [
  {
    path: 'mt-albert',
    platformSlug: 'little-pearls-mt-albert',
    name: 'Ōwairaka / Mt Albert',
    shortName: 'Mt Albert',
    street: '2a Lorraine Avenue',
    suburb: 'Mount Albert, Auckland',
    postcode: '1025',
    phone: '+64 9 815 2277',
    phoneHref: '+6498152277',
    email: 'contact@littlepearls.org.nz',
    lat: -36.8951734,
    lng: 174.7238665,
  },
  {
    path: 'mt-roskill',
    platformSlug: 'little-pearls-mt-roskill',
    name: 'Puketāpapa / Mt Roskill',
    shortName: 'Mt Roskill',
    street: '3 Radnor Road',
    suburb: 'Mount Roskill, Auckland',
    postcode: '1041',
    phone: '+64 9 216 7838',
    phoneHref: '+6492167838',
    email: 'mtroskill@littlepearls.org.nz',
    lat: -36.9080103,
    lng: 174.7387794,
  },
];

export function centreByPath(path: string): Centre | undefined {
  return CENTRES.find((c) => c.path === path);
}

/**
 * The value the careers form's "either centre" option submits.
 *
 * Deliberately not a `platformSlug`, and deliberately not in `careers/actions.ts` — a `'use server'`
 * file may only export async functions, so a constant there fails the build. It lives with the
 * centres because that is what it is: the third option in a list of two.
 *
 * It cannot reach the database. The action maps a choice to slugs from `CENTRES`, and
 * `submit_job_application` resolves the slug itself and refuses one it does not recognise.
 */
export const EITHER_CENTRE = 'either';

/**
 * Shared facts that are true of both centres.
 *
 * `hours` is the one to be careful with: their site says 7.30am–6.00pm, and a third-party
 * directory says Mt Roskill opens at 7.00am. Their own site wins until the centre says otherwise,
 * and the disagreement is recorded in CONTENT-GAPS.md rather than averaged away.
 */
export const CENTRE_FACTS = {
  hours: 'Weekdays, 7.30am to 6.00pm',
  ages: '3 months to 5 years',
  structure: 'Not-for-profit, community established',
  careersEmail: 'career@littlepearls.org.nz',
  tagline: 'Every child is precious like a pearl',
  /**
   * Both centres are in Auckland, so this is a constant rather than a lookup — but it is
   * written down rather than assumed, because the enrolment form compares a family's start
   * date against "today" and a server running UTC calls a New Zealand morning yesterday.
   * That would tell somebody a start date of today had already been.
   */
  timezone: 'Pacific/Auckland',
} as const;

/**
 * Their social accounts, as supplied by the owner and carried over from their current site.
 *
 * TEXT LINKS AND NOT ICONS, WHICH IS A DEPARTURE FROM THEIR CURRENT FOOTER.
 *
 * Theirs is four circular glyphs with no visible text. Three reasons this is words instead. The
 * `img-src` policy is `'self' data:`, so every icon would have to be a committed asset or an
 * inlined path — and the inlined route is the one the developer credit's comment already refuses
 * for somebody else's mark, because a drawn logo is one `fill` away from being recoloured against
 * its own guidelines. Four platform marks is four of that problem. Second, an icon-only link needs
 * an accessible name supplied separately, and a name that exists only for screen readers is a name
 * nobody proofreads. Third, this site is typographic the whole way down; a row of logo bubbles is
 * the one place it would stop being.
 *
 * The account names are deliberately not abbreviated to handles. "Instagram" is what somebody is
 * looking for; `@littlepearlsnz` is what they find when they get there.
 *
 * `x.com` is recorded as supplied. Their current footer still shows a bird, so the icon is a
 * generation out of date — another small argument for words, which do not go stale.
 */
export const SOCIAL_LINKS = [
  { name: 'Facebook', href: 'https://www.facebook.com/LittlePearlsEducareCentre' },
  { name: 'Instagram', href: 'https://www.instagram.com/littlepearlsnz/' },
  { name: 'X', href: 'https://x.com/littlepearls_nz' },
  { name: 'Flickr', href: 'https://www.flickr.com/people/littlepearls/' },
] as const;

/**
 * The rooms, with the ratios **their site publishes**.
 *
 * Quoted as the centre's own statement, never as a regulatory figure. The platform's own ratio
 * tables carry `RATIO_TABLES_VERIFIED = false` and render a notice saying nobody has checked them
 * against Schedule 2 — so this site does not get to imply a compliance claim the product itself
 * refuses to make.
 */
export const ROOMS = [
  {
    name: 'Infant',
    ages: '3 months to 2 years',
    ratio: 'no more than 1 adult to 3–4 children',
    approach:
      'A home-like room built on respect. Their programme draws on Pikler and RIE, the schema concept, and Te Whāriki.',
    /*
     * `photo` is a key into `PHOTOS`, held here rather than matched by index in the page.
     *
     * The page used to be able to do `PHOTO_LIST[i]`, and that is a bug waiting for whoever reorders
     * these three rooms: it would keep rendering and quietly show the preschool room under "Infant".
     * A named key breaks the build instead.
     */
    photo: 'infantRoom',
  },
  {
    name: 'Toddler',
    ages: '2 to 3½ years',
    ratio: 'no more than 1 adult to 6–7 children',
    approach: 'Interest-based activities, guided by Te Whāriki.',
    photo: 'playKitchen',
  },
  {
    name: 'Preschool',
    ages: '3½ to 5 years',
    ratio: 'no more than 1 adult to 7–8 children',
    approach: 'Play-based learning with a focus on the transition to school, guided by Te Whāriki.',
    photo: 'preschoolRoom',
  },
] as const satisfies readonly {
  name: string;
  ages: string;
  ratio: string;
  approach: string;
  // Constrained to the keys that exist, so a typo or a removed photograph is a type error.
  photo: keyof typeof PHOTOS;
}[];
