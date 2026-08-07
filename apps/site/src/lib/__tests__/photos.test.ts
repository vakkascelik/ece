import { describe, expect, it } from 'vitest';
import { PHOTOS, WITHHELD_PHOTOGRAPHS } from '../photos';

/**
 * WHY THIS EXISTS, AND WHY `npm run audit:site` IS NOT ENOUGH
 *
 * axe was added for the site in the same commit as these photographs, and it does **not** catch the
 * failure these images actually risk. Confirmed by trying it: emptying one photograph's `alt` and
 * re-running the audit reported no violations, on every route and both widths.
 *
 * That is axe behaving correctly. `alt=""` is a valid, meaningful declaration that an image is
 * decorative and should be skipped by a screen reader, and no automated tool can tell that a
 * photograph of a playground is not decorative. The rule `image-alt` fires on a *missing* attribute,
 * not on one that is deliberately empty.
 *
 * So the thing to check is the data contract rather than the rendered page: every photograph on this
 * site conveys information, therefore every one has a description. The single empty `alt` on the site
 * is the logo in the masthead, which is not in this list — the words beside it already say the name,
 * and describing it too would read it twice.
 */
describe('every photograph is described', () => {
  const entries = Object.entries(PHOTOS);

  it('has a non-empty alt for every photograph', () => {
    for (const [key, photo] of entries) {
      expect(photo.alt.trim(), `${key} has no alt text`).not.toBe('');
    }
  });

  it('describes rather than labels', () => {
    for (const [key, photo] of entries) {
      // "Photo of the playground" tells a screen-reader user nothing they could not guess from the
      // heading. A description is a sentence about what is in the frame.
      expect(photo.alt.length, `${key}'s alt is too short to be a description`).toBeGreaterThan(40);
      expect(photo.alt, `${key}'s alt starts with a redundant prefix`).not.toMatch(
        /^(image|photo|picture|photograph) of/i,
      );
    }
  });

  it('gives every photograph a caption and a file under public/', () => {
    for (const [key, photo] of entries) {
      expect(photo.caption.trim(), `${key} has no caption`).not.toBe('');
      expect(photo.src, `${key} is not a root-relative path`).toMatch(/^\/[a-z0-9-]+\.webp$/);
    }
  });

  it('uses each file once, so a copy-paste cannot show the same room twice', () => {
    const srcs = entries.map(([, p]) => p.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  /**
   * What is still held back, asserted as a list rather than trusted to a comment.
   *
   * This started as four, on consent grounds. The centre confirmed on 2026-08-07 that it holds the
   * consents, so three went up and one remains — and the reason for that one is now **editorial,
   * not legal**, which the assertion below states so nobody later reads the list as a consent
   * blocker and treats it as untouchable. It is the centre's photograph and the centre's call.
   *
   * The list stays because the pressure to add a photograph of a smiling child to a childcare
   * website is constant and entirely well-meant, and a failing test is a better place to meet that
   * question than a paragraph in a markdown file.
   */
  it('keeps the sleeping pair out, and says the reason is editorial rather than consent', () => {
    expect(WITHHELD_PHOTOGRAPHS).toHaveLength(1);
    for (const withheld of WITHHELD_PHOTOGRAPHS) {
      expect(withheld.shows.trim()).not.toBe('');
      // The distinction that must not get lost: this is a recommendation, not a prohibition.
      expect(withheld.reason).toMatch(/editorial/i);
      // And it still may not appear in the published set while it is on this list.
      expect(Object.values(PHOTOS).some((p) => p.src.includes(withheld.flickrId))).toBe(false);
    }
  });

  it('now publishes the three the centre consented to', () => {
    for (const key of ['atTheTable', 'painting', 'writing'] as const) {
      expect(PHOTOS[key], `${key} is missing`).toBeTruthy();
    }
  });
});
