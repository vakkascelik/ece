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
  },
];

export function centreByPath(path: string): Centre | undefined {
  return CENTRES.find((c) => c.path === path);
}

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
} as const;

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
  },
  {
    name: 'Toddler',
    ages: '2 to 3½ years',
    ratio: 'no more than 1 adult to 6–7 children',
    approach: 'Interest-based activities, guided by Te Whāriki.',
  },
  {
    name: 'Preschool',
    ages: '3½ to 5 years',
    ratio: 'no more than 1 adult to 7–8 children',
    approach: 'Play-based learning with a focus on the transition to school, guided by Te Whāriki.',
  },
] as const;
