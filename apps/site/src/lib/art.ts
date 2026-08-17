/**
 * Generated artwork — a separate manifest from `photos.ts`, ON PURPOSE.
 *
 * `PHOTOS` is a consent manifest: every entry is a photograph of the centre, every entry traces to
 * their own site, and the rule "no consent, no render" exists because those images show real rooms
 * and real children. None of that machinery applies here, and mixing these in would blur the one
 * distinction that matters: **these are not photographs of anything.** They are abstract
 * watercolour textures, and they must never be presented as — or be mistakable for — pictures of
 * the centre.
 *
 * PROVENANCE, recorded because rule 5 applies to images too: generated 2026-08-17 with Canva's
 * image generation (via the Canva MCP connection), from a prompt asking for abstract
 * mother-of-pearl watercolour in the site's own ocean palette — no people, no text, no objects.
 * Four candidates came back; two arrived with marketing text baked in ("Embrace the Calm of
 * Childhood", a fake star rating and a placeholder URL) and were discarded on sight. The two
 * clean textures were exported losslessly at 1080×1350 and cropped square here. Canva's terms
 * grant commercial use of generated output to the generating account (Salix's), and the owner
 * directed the generation.
 *
 * The user asked whether Google Veo could do this instead: no Veo, Gemini or Vertex AI credential
 * exists in this repo or in `C:/dev/salix` (checked 2026-08-17 — the "vertex" folder there is the
 * Vertex Tuition client, not Google Vertex AI), so Canva is the generation path that actually
 * exists.
 *
 * WHERE THESE MAY APPEAR, and the boundary: inside `Pearl` components as decoration — the footer
 * cluster, and a decorative aside pearl. The boundary is the manager's own voice rule (authentic,
 * nothing fake): abstract texture inside a pearl reads as *nacre*, which is decoration in the
 * site's own visual language. A generated image that looked like a room, a meal or a child would
 * be a fabricated claim about the centre and does not get made, whatever tool exists.
 *
 * `alt` is empty on every entry and that is correct, not lazy: these are pure decoration, and the
 * pearls that hold them are `aria-hidden` or carry no meaning a reader needs. An alt describing
 * "abstract teal watercolour" would be noise read aloud.
 */
export interface Illustration {
  /** Path under `public/`. */
  src: string;
  /** Always empty — see the note above. Typed so a Pearl can take it in a photo's place. */
  alt: string;
  caption: string;
}

/*
 * REGENERATED 2026-08-17, LATER THE SAME DAY, ON THE MANAGER'S FEEDBACK. The first set was teal
 * watercolour in the ocean palette, and the manager's review was exact: "bunlar biraz gezegenlere
 * benzemiş" — they look a bit like planets — "grey olabilir, pearl gibi renkleri": grey, in pearl
 * colours. He was right; swirled teal inside a circle reads as a gas giant, not a pearl. The
 * second prompt asked for the inside of an oyster shell — silvery grey, ivory, champagne, faint
 * blush — and explicitly forbade the cloud-swirl look. Same review step, same result as the first
 * round: four candidates, two discarded on sight for baked-in marketing text ("Delicious Dining
 * Discounts", on a childcare prompt).
 */
export const ART = {
  /** Soft ivory nacre with warm champagne veining — the top of the first texture. */
  ivory: { src: '/pearl-art-ivory.webp', alt: '', caption: '' },
  /** The same texture's lower half, blush-warmer, so the two read as siblings. */
  blush: { src: '/pearl-art-blush.webp', alt: '', caption: '' },
  /** Silvery grey lustre with pale gold seams — the second texture. */
  silver: { src: '/pearl-art-silver.webp', alt: '', caption: '' },
} as const satisfies Record<string, Illustration>;
