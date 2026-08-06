/**
 * The centre's own photographs, and the four that are deliberately not here.
 *
 * WHAT WAS TAKEN FROM THEIR OLD SITE AND WHAT WAS NOT
 *
 * Their existing site carries eleven photographs, named after Flickr ids. Every one was downloaded
 * and **looked at** rather than judged from its filename, and they split cleanly in two:
 *
 * - **Seven show the premises and nothing else** — the entrance, four rooms, the playground and the
 *   sandpit. Those are here. They are the centre's own photographs of the centre's own buildings, and
 *   nobody's consent is engaged by a picture of an empty room.
 * - **Four show identifiable children.** A group of five at a table looking straight at the camera, a
 *   toddler covered in paint, a child drawing, and two asleep on the floor. Those are **not** here and
 *   must not be added until the centre holds current written consent for **public** use, per
 *   `CONTENT-GAPS.md` gap 10.
 *
 * The distinction is not squeamishness, it is the same one the platform models in its schema:
 * `photo_internal` and `photo_public` are separate consent kinds precisely because families who agree
 * to a photo in their child's learning journal routinely refuse one on a website. Consent given in
 * 2018 to a site nobody has updated since is not consent for a new site in 2026, and the sleeping
 * pair would need particular care even with a signature.
 *
 * The originals were 274-415px, which is soft on a phone. These come from the `_2x` variants their
 * own site already served, resized to 720px square and converted to WebP — between a third and a half
 * of the original bytes.
 *
 * ALT TEXT IS PART OF THE DATA, not something a page writes in passing. Their current site gives every
 * image `alt=""`, including the logo, so a screen reader is told the pages are empty of images and
 * also which images do not matter — both wrong. Each caption below describes what somebody would see.
 */
export interface Photo {
  /** Path under `public/`. */
  src: string;
  /** What somebody who cannot see it would need told. Never empty — none of these are decorative. */
  alt: string;
  /** Shown under the image where the layout has room for it. */
  caption: string;
}

export const PHOTOS = {
  entrance: {
    src: '/centre-entrance.webp',
    alt: 'The entrance to a Little Pearls centre: a white and orange building with the Little Pearls logo mounted beside sliding glass doors.',
    caption: 'The front door, and the one you will be buzzed in through.',
  },
  preschoolRoom: {
    src: '/preschool-room.webp',
    alt: 'A large, bright preschool room with child-height wooden tables and chairs, a wooden floor, and children’s artwork covering the wall.',
    caption: 'The preschool room, before the day starts.',
  },
  infantRoom: {
    src: '/infant-room.webp',
    alt: 'An open room set up with low wooden shelves, baskets of natural materials, a wooden trolley of blocks and a soft armchair.',
    caption: 'Open shelves at a child’s height, so choosing is the child’s to make.',
  },
  quietCorner: {
    src: '/quiet-corner.webp',
    alt: 'A quiet corner seen through a doorway trailed with ivy: a small blue sofa, a woven canopy, rugs on the floor and a clock on the wall.',
    caption: 'Somewhere to stop. Not every part of a day is busy.',
  },
  playKitchen: {
    src: '/play-kitchen.webp',
    alt: 'A wooden play kitchen with a sink, oven and washing machine, and a small table set out with plastic food and pots.',
    caption: 'The play kitchen, which is never tidy for long.',
  },
  playground: {
    src: '/playground.webp',
    alt: 'An outdoor play area with artificial grass, a timber archway, young trees and a climbing frame with a ramp and slide.',
    caption: 'Outside, with shade, a slope to climb and room to run.',
  },
  sandpit: {
    src: '/sandpit.webp',
    alt: 'A large decked sandpit shaded by two thatched umbrellas, beside a lawn with a white slide and a timber fence.',
    caption: 'The sandpit, shaded through the middle of the day.',
  },
} as const satisfies Record<string, Photo>;

/**
 * The four held back, kept as a list rather than a sentence so the reason travels with the file.
 *
 * Here on purpose: a note in a markdown file is easy to lose, and the next person to be asked "can we
 * put some photos of the children on the site?" should find the answer next to the photos that are
 * already there. The answer is yes, once the centre holds written consent for public use for each
 * child in each photograph — not consent in general, and not consent for the learning journal.
 */
export const WITHHELD_PHOTOGRAPHS = [
  { flickrId: '28574803438', shows: 'five children at a table, all faces towards the camera' },
  { flickrId: '14524763511', shows: 'a toddler covered in blue paint, face filling the frame' },
  { flickrId: '14318618804', shows: 'a child drawing on the floor, face in profile' },
  { flickrId: '40443416845', shows: 'two toddlers asleep on a rug' },
] as const;
