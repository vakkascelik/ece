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
 * - **Four showed identifiable children**, and were withheld until consent was established. On
 *   2026-08-07 the centre's manager confirmed the consents are held, so three are now in use: the
 *   group at the table, the child painting, and the child writing. The fourth — two toddlers asleep
 *   on a rug — is still out, and that is now an editorial judgement rather than a consent one. See
 *   `WITHHELD_PHOTOGRAPHS` below.
 *
 * The distinction is not squeamishness, it is the same one the platform models in its schema:
 * `photo_internal` and `photo_public` are separate consent kinds precisely because families who agree
 * to a photo in their child's learning journal routinely refuse one on a website.
 *
 * Two things about that confirmation are worth keeping visible rather than treating as settled, and
 * neither was a reason to stall: whether it covers **public/website** use specifically rather than
 * photographs in general, and whether it covers **these** photographs, which are from around 2018 —
 * the tamariki in them are school-aged now and most will have left. The centre is the agency
 * responsible for that call and has made it; this note records the basis. `CONTENT-GAPS.md` gap 10
 * carries the same detail.
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
  /**
   * Where the subject is, 0–1 from the top-left, for the circular pearl crop. Defaults to
   * `0.5 / 0.35` — centre, a little above the middle, which is where a face usually is.
   *
   * Only set where the default is wrong. These are square files rendered into a circle, so the
   * *corners* are what a pearl loses rather than the sides; the focal point matters less here than
   * it would on a landscape crop, and is recorded per image only where somebody has looked.
   */
  focalX?: number;
  focalY?: number;
  /**
   * Which side the pearl's specular highlight sits on.
   *
   * `left` is the default and it is where a real pearl's highlight belongs. It is also, at
   * `34% 26%`, exactly where a face lands in a portrait — and the highlight is 92% white at its
   * centre, so it does not soften a face, it erases it. `right` mirrors it to `66% 26%`.
   *
   * A per-image field rather than a rule, because it depends entirely on the photograph. See
   * `painting` below, which is the reason this exists.
   */
  sheen?: 'left' | 'right';
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
  atTheTable: {
    src: '/at-the-table.webp',
    alt: 'Five children sitting around a low table together, working on a picture card activity with a teacher’s materials spread out in front of them.',
    caption: 'Working on something together, which is most of a morning.',
  },
  /**
   * THE HERO PEARL, and the two extra fields are the whole reason the fields exist.
   *
   * Chosen by opening all ten and looking, against a 420px circle: it is the only photograph the
   * centre owns with a single subject, face-on, at the centre of the frame. Everything else is
   * either a room or a group, and a group in a circle is a picture of somebody's shoulder.
   *
   * The face sits at roughly 44% / 29%. On a square file rendered into a circle nothing but the
   * corners is lost — that point is 22% from the centre against a 50% radius — so the crop is safe
   * and `focalX`/`focalY` only nudge it.
   *
   * `sheen: 'right'` IS NOT COSMETIC. The default highlight is `circle at 34% 26%` at 92% white,
   * which lands on this child's forehead and left eye and burns them out completely. Mirrored to
   * `66% 26%` it falls on the hair at the edge of the frame, which is where light would actually
   * catch. Caught by looking at it rendered, not by reading the co-ordinates.
   */
  painting: {
    src: '/painting.webp',
    alt: 'A toddler in a painting smock, hands and face covered in blue paint, holding a brush over a pot of it and looking up.',
    caption: 'Paint goes where paint goes.',
    focalX: 0.44,
    focalY: 0.3,
    sheen: 'right',
  },
  writing: {
    src: '/writing.webp',
    alt: 'A child lying on a wooden floor, drawing a grid of letters on a large sheet of paper with a marker, with another child’s hands at the edge of the picture.',
    caption: 'Writing, at the age where the floor is the best desk in the room.',
  },
  sandpit: {
    src: '/sandpit.webp',
    alt: 'A large decked sandpit shaded by two thatched umbrellas, beside a lawn with a white slide and a timber fence.',
    caption: 'The sandpit, shaded through the middle of the day.',
  },
} as const satisfies Record<string, Photo>;

/**
 * What is still held back, and why — kept as a list rather than a sentence so the reason travels
 * with the file.
 *
 * Here on purpose: a note in a markdown file is easy to lose, and the next person asked "can we put
 * some photos of the children on the site?" should find the answer beside the photographs that are
 * already there.
 *
 * It is down to one, and the reason has changed. Consent is no longer the question — the centre
 * confirmed on 2026-08-07 that it holds the consents. This one is an editorial call, and it is a
 * recommendation rather than a veto: **it is the centre's photograph and the centre's decision.**
 *
 * The case for leaving it out: a photograph of two sleeping toddlers on a public website invites a
 * different kind of attention than a photograph of a sandpit, and it is the one image here that
 * shows children at their least able to have had a view about it. The centre gains little from it
 * that the other nine do not already give — the rooms, the play, the faces, the work. If they want
 * it up, it goes up in a line of code.
 */
export const WITHHELD_PHOTOGRAPHS = [
  {
    flickrId: '40443416845',
    shows: 'two toddlers asleep on a rug',
    reason: 'editorial, not consent — see the note above. The centre may say the word at any time.',
  },
] as const;
