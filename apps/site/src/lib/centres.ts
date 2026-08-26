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
 * `hours` and `ages` were both corrected by the centre on 2026-08-26, relayed by the owner, and
 * both moved in the direction that matters to a parent: the day is **half an hour shorter** than
 * the old site said, and the youngest age accepted is **three months older**.
 *
 * That is the whole reason these live in one place. The 2018 site said 7.30am–6.00pm and 3 months,
 * and those figures had been copied into a page description, a rooms description and a JSON-LD
 * block — four files that would have drifted apart the first time one of them was edited alone.
 *
 * It also closes CONTENT-GAPS.md gap 7. A third-party directory claimed Mt Roskill opened at
 * 7.00am and the rule was "their own site wins until the centre says otherwise". The centre has
 * now said otherwise, so the directory is not merely outvoted, it is superseded.
 */
export const CENTRE_FACTS = {
  hours: 'Weekdays, 7.30am to 5.30pm',
  ages: '6 months to 5 years',
  structure: 'Not-for-profit, community established',
  careersEmail: 'career@littlepearls.org.nz',
  tagline: 'Every child is precious like a pearl',
  /**
   * Visit windows, from the manager's own enrolment reply to families (2026-08-17, relayed by the
   * owner with the family's details removed). The email gives two conflicting pairs — 9.30–11.00 /
   * 1.00–3.00 in one paragraph and 9–11 / 2–4 in another — and the owner confirmed the first.
   *
   * The *reason* travels with the times because it is the kind of fact that makes a rule read as
   * care rather than as gatekeeping: the windows exist so visits do not land on the children's
   * lunch and sleep.
   */
  visitWindows: '9.30–11.00am or 1.00–3.00pm',
  visitNote: 'booked ahead, and timed so a visit never lands on lunch or sleep',
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
 * ICONS NOW, AND THIS COMMENT USED TO ARGUE THE OPPOSITE. It said "text links and not icons" and
 * gave three reasons; the owner asked for icons on 2026-08-16 to shorten the footer, and the reasons
 * did not all survive contact with that request equally. What held: an icon-only link still needs an
 * accessible name, so each link carries a visually-hidden `<span>` with the platform's name — the
 * `name` field here is that text, not decoration. What bent: the marks are drawn from primitives in
 * `SocialIcon.tsx` and tinted `currentColor` — simplified geometric forms, not the trademarks — so
 * the recolouring problem this comment worried about is sidestepped rather than solved. The note in
 * that file says what to revisit if anybody wants the exact brand marks.
 *
 * `x.com` is recorded as supplied. Their current footer still shows a bird, so their own icon is a
 * generation out of date — the risk words did not have, and icons do. The drawn X is at least ours
 * to update.
 */
export const SOCIAL_LINKS = [
  { name: 'Facebook', href: 'https://www.facebook.com/LittlePearlsEducareCentre' },
  { name: 'Instagram', href: 'https://www.instagram.com/littlepearlsnz/' },
  { name: 'X', href: 'https://x.com/littlepearls_nz' },
  { name: 'Flickr', href: 'https://www.flickr.com/people/littlepearls/' },
] as const;

/**
 * The rooms, with the ratios **the centre manager confirmed on 2026-08-17** — in the enrolment
 * reply the centre sends to interested families, relayed by the owner (the family's details were
 * redacted and are nowhere in this repo).
 *
 * That confirmation is the one the original fix brief had been waiting for since the site was
 * built: "before changing the numbers, confirm each figure with the centre manager and use
 * whatever they confirm." So the hedged ranges read off their 2018 website ("no more than 1 adult
 * to 3–4 children") give way to the numbers they actually tell families today, stated plainly.
 * The toddler figure moved the most — 1:5 against the old site's 1:6–7 — and the manager's is the
 * one that wins, because it is current and it is theirs.
 *
 * STILL NEVER A REGULATORY CLAIM. The same email says the ratios "exceed the standards set by the
 * Ministry of Education", and that sentence is deliberately NOT here. **Correction, 2026-08-18:**
 * this used to justify the omission partly on the grounds that "nobody has sourced Schedule 2".
 * Somebody has now, and the tables are verified — so the regulation being unread is no longer the
 * reason. The reason is the manager's own instruction for the site's voice: plain, no claims that
 * bind or build expectations. The numbers are what they staff to; a public promise about a
 * statutory minimum is a different sentence and still does not belong on a marketing page.
 */
export const ROOMS = [
  {
    name: 'Infant',
    // 6 months, not 3 — corrected by the centre 2026-08-26. Must agree with CENTRE_FACTS.ages,
    // which starts at the same number; a test asserts it rather than trusting the two to be
    // edited together.
    ages: '6 months to 2 years',
    ratio: '1 adult to 3 children',
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
    ratio: '1 adult to 5 children',
    approach: 'Interest-based activities, guided by Te Whāriki.',
    photo: 'playKitchen',
  },
  {
    name: 'Preschool',
    ages: '3½ to 5 years',
    ratio: '1 adult to 7–8 children',
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
