/**
 * The mobile app's launcher, adaptive and notification icons, generated from `MARK`.
 *
 *   npm run icons:mobile
 *
 * WHY GENERATED, AND WHY THE OUTPUT IS COMMITTED ANYWAY
 *
 * `apps/web/src/app/icon.tsx` renders the same three primitives at request time and argues, at
 * length, against committing a raster: the mark is ours, it lives in `@ece/core`, and a PNG copy
 * would be the one nobody notices going stale because nobody diffs a PNG in review.
 *
 * That argument is right and does not survive contact with Android. `app.json` references icons as
 * **file paths resolved at build time** — there is no renderer in an EAS build to call. So the
 * files have to exist, and the only question is whether they are drawn by hand or derived. Derived,
 * with the command in this header, so the geometry has exactly one home and a change to `MARK` is
 * one `npm run icons:mobile` away from reaching the phone.
 *
 * WHAT EACH ONE IS FOR, BECAUSE THEY ARE NOT THE SAME PICTURE
 *
 * `icon.png` — 1024×1024, the store listing and the legacy launcher icon. **Fully opaque and
 * square**: Apple rejects transparency and rejects pre-rounded corners, and both platforms apply
 * their own mask. Drawing our own rounded corners here would show as a rounded icon inside a
 * rounded mask.
 *
 * `adaptive-icon.png` — the Android adaptive **foreground**, 1024×1024 on transparency. Android
 * crops this to whatever shape the launcher likes — circle, squircle, teardrop — and only the
 * central ~66% is guaranteed visible. So the figure is scaled to sit inside that safe circle and
 * the box colour moves to `backgroundColor` in `app.json`, which is what the outer layer is for.
 * Drawing the box into the foreground is the standard way to get a mark with its corners sliced
 * off.
 *
 * `notification-icon.png` — 96×96. Android **ignores every colour** in a notification icon and
 * draws the alpha channel in white, so this is the figure as a silhouette on transparency. Supply
 * a full-colour icon and the system renders a solid white square, which is the grey-square failure
 * `app.json` warns about, one step further along.
 *
 * No splash screen. `expo-splash-screen` is not a plugin here and neither store requires one; a
 * splash is a decision about the first thing a kaiako sees at 7am and belongs with the rest of the
 * mobile design work, not smuggled in with an icon generator.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MARK } from '../packages/core/src/brand';

const OUT = path.join('apps', 'mobile', 'assets');

/** The figure — head and shoulders — as SVG on a `MARK.size` grid, in one colour. */
function figure(fill: string): string {
  const { head, shoulders } = MARK;
  return (
    `<circle cx="${head.cx}" cy="${head.cy}" r="${head.r}" fill="${fill}"/>` +
    `<rect x="${shoulders.x}" y="${shoulders.y}" width="${shoulders.width}" ` +
    `height="${shoulders.height}" rx="${shoulders.radius}" fill="${fill}"/>`
  );
}

function svg(body: string, background: string | null): string {
  const s = MARK.size;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
    (background ? `<rect width="${s}" height="${s}" fill="${background}"/>` : '') +
    body +
    `</svg>`
  );
}

/**
 * `flatten` is the difference between "no transparent pixels" and "no alpha channel".
 *
 * The first version rendered `icon.png` from an SVG whose background rect covers the whole canvas,
 * so every pixel was opaque — and sharp still wrote RGBA, because the input had an alpha channel to
 * carry through. App Store validation rejects an icon that *has* an alpha channel, not one that
 * happens to use it, so "opaque" was not the property being asked for. Verified by reading
 * `hasAlpha` back off the written file rather than trusting the render.
 */
async function write(
  name: string,
  markup: string,
  size: number,
  opaqueOver?: string,
): Promise<void> {
  const file = path.join(OUT, name);
  const pipeline = sharp(Buffer.from(markup)).resize(size, size);
  await (opaqueOver ? pipeline.flatten({ background: opaqueOver }) : pipeline).png().toFile(file);
  const meta = await sharp(file).metadata();
  console.log(
    `  ${name.padEnd(24)} ${meta.width}×${meta.height}  ` +
      `${meta.hasAlpha ? 'alpha' : 'opaque'}`,
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log('\n  generated from MARK in packages/core/src/brand.ts\n');

  // Square and opaque. The box fill covers the whole canvas; the platforms mask it themselves.
  await write('icon.png', svg(figure(MARK.head.fill), MARK.box.fill), 1024, MARK.box.fill);

  /*
   * The foreground, inset so the figure survives an aggressive mask.
   *
   * 0.62 rather than the 0.66 the guidance quotes: 66% is the *guaranteed visible* circle, so
   * drawing right up to it puts the shoulders on the crop line for any launcher that trims a
   * little harder. The figure is not the whole grid either — it spans roughly y=26..97 of 128 —
   * so this is scaled about the centre of the canvas rather than the centre of the mark.
   */
  const inset = 0.62;
  const pad = (MARK.size * (1 - inset)) / 2;
  const foreground =
    `<g transform="translate(${pad} ${pad}) scale(${inset})">${figure(MARK.head.fill)}</g>`;
  await write('adaptive-icon.png', svg(foreground, null), 1024);

  // Alpha-only: Android paints this white whatever colour it is given.
  await write('notification-icon.png', svg(foreground, null), 96);

  console.log('');
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
