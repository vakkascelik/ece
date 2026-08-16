# Master prompt — Little Pearls website: pearl & ocean visual direction

Paste this whole file into Claude Code, in the repo that serves
`little-pearls-production.up.railway.app`. Read `01-WEBSITE-FIX-BRIEF.md`
first — it is still in force. **Nothing in this prompt overrides it.** This
prompt adds the visual direction the centre manager asked for: the pearl
analogy from the old website, expressed as pearls and ocean.

Reference implementation: `reference/Little Pearls Website - Pearl & Ocean.dc.html`
(open it in a browser — every value below is taken from it).
Screenshots: `screens/`.

---

## What the manager asked for

1. Bring back the pearl analogy from the old site. The tagline
   **"Every child is precious like a pearl"** becomes a real part of the page,
   not header microcopy.
2. Ocean feel: **waves that move in the background as you scroll**, and a small
   **boat** on the waterline.
3. **Children's photos inside the pearls** — the pearl is the photo frame.

Everything else on the site stays as the fix brief specifies.

---

## Scope

Home page only in this pass. The header, footer wave band and the pearl/photo
component are shared, so they will appear on every page — build them as shared
components, but do not restyle other pages' bodies yet.

---

## 1. Tokens — one addition

Keep the existing token table exactly as in the fix brief. Add **one** new group
for the ocean surfaces. Do not hard-code these anywhere; add them to the same
theme file as the rest.

| Purpose | Variable | Hex |
|---|---|---|
| Ocean deep (band top/bottom) | `--ocean-deep` | `#0d3b3e` |
| Ocean mid | `--ocean-mid` | `#12474a` |
| Ocean shallow (hero bottom) | `--ocean-shallow` | `#16545a` |
| Text on ocean | `--on-ocean` | `#ffffff` |
| Secondary text on ocean | `--on-ocean-muted` | `#bfd7d1` |
| Tertiary / eyebrow on ocean | `--on-ocean-soft` | `#a9cfc7` |

Contrast: `#ffffff` on `#12474a` = 8.9:1; `#bfd7d1` on `#0d3b3e` = 7.6:1;
`#a9cfc7` on `#0d3b3e` = 6.3:1. All pass AA. Do not lighten the band or darken
the text without re-checking.

Green (`--green` `#2f6f4f`) remains the only *interface* accent — buttons,
links, focus rings. Ocean teal is a **surface**, never a button or a link
colour. On ocean bands the primary button inverts: white background,
`--ocean-deep` text.

Still no coral. The logo pink remains the single untouched exception.

---

## 2. The hero — ocean band

Structure, left to right at ≥1024px: copy column (`minmax(0,1fr)`) and pearl
column (`420px`), `gap: 64px`, container `max-width: 1160px`,
`padding: 88px 24px 168px` (the bottom padding is deliberate — it keeps the
waterline clear of the buttons).

```css
background: linear-gradient(180deg, #0d3b3e 0%, #12474a 52%, #16545a 100%);
```

Plus one soft light source, top right:
`radial-gradient(120% 90% at 78% 8%, rgba(215,236,232,0.22) 0%, rgba(13,59,62,0) 60%)`.

Copy order: eyebrow (small pearl dot + `ŌWAIRAKA · PUKETĀPAPA`, 12px, uppercase,
`letter-spacing: 0.14em`), `<h1>` "Nau mai — welcome to Little Pearls"
(serif, weight 300, 66px, `line-height: 1.04`), then the tagline as an italic
serif line at 23px, then the existing intro paragraph, then the two buttons.

The `<h1>`, tagline, intro and **both buttons** must be visible above the fold
at 1440×900. Check this before you consider the hero done.

Below 1024px the pearl column drops under the copy; below 640px the `<h1>` goes
to 40px and the pearl to `min(340px, 78vw)`.

---

## 3. The pearl-with-photo component

One component, used at five sizes (hero 420px, story cards 64/80/98px, footer
cluster 56/74/124px). It is a circular photo crop with three layers over it.

```html
<figure class="pearl" style="--size: 420px">
  <img src="…" alt="…" width="840" height="840">   <!-- object-fit: cover -->
  <span class="pearl__sheen" aria-hidden="true"></span>
  <span class="pearl__nacre" aria-hidden="true"></span>
  <span class="pearl__rim"   aria-hidden="true"></span>
</figure>
```

```css
.pearl { position: relative; width: var(--size); height: var(--size);
         border-radius: 50%; overflow: hidden; margin: 0;
         box-shadow: 0 40px 80px rgba(0,0,0,0.30); }   /* scale shadow with size */
.pearl > img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* specular highlight, top-left */
.pearl__sheen { position: absolute; inset: 0; background:
  radial-gradient(circle at 34% 26%,
    rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.42) 16%,
    rgba(255,255,255,0.10) 34%, rgba(255,255,255,0) 52%); }

/* iridescence — soft-light so it tints the photo instead of covering it */
.pearl__nacre { position: absolute; inset: 0; mix-blend-mode: soft-light;
  background: conic-gradient(from 200deg at 60% 60%,
    rgba(255,214,224,0.55), rgba(214,238,232,0.45), rgba(226,222,246,0.48),
    rgba(255,235,214,0.40), rgba(255,214,224,0.55)); }

/* curvature: dark at the bottom, light at the top, 1px pearly edge */
.pearl__rim { position: absolute; inset: 0; border-radius: 50%; box-shadow:
  inset 0 -34px 64px rgba(13,59,62,0.42),
  inset 0  20px 44px rgba(255,255,255,0.65),
  inset 0 0 0 1px rgba(255,255,255,0.35); }
```

Scale the three inset shadow blurs with `--size` (roughly 8% / 5% of the
diameter) so small pearls do not look muddy.

**Faces must survive the crop.** A circular crop plus a bright top-left highlight
will destroy a badly chosen photo. Require a focal point per image
(`focalX`/`focalY`, 0–1, default 0.5/0.35) in the consent manifest and drive
`object-position` from it. If the sheen sits over a face, mirror it
(`circle at 66% 26%`) via a per-image `sheen: "left" | "right"` field.

Pearls with no consented photo render as an **empty pearl** — the same three
layers over `linear-gradient(150deg, #eceeeb 0%, #d6ddda 100%)`. This is the
one place a missing image may leave something behind, because the pearl is the
decoration, not the photo. Elsewhere fix 11 still applies: no consent, no
render, no gap.

---

## 4. Waves

Three layers at the bottom of the hero, two at the top of the footer band.
Each layer is: a wrapper (positioned, `left: -10%`, `width: 220%`,
`will-change: transform`) → an inner div carrying the CSS drift animation →
an SVG whose path contains **two identical periods** across the viewBox, so a
`translateX(-50%)` loop is seamless.

```html
<div class="wave" data-parallax="wave2" style="bottom: 28px">
  <div class="wave__drift" style="animation: lpwave 22s linear infinite">
    <svg viewBox="0 0 2880 90" preserveAspectRatio="none" aria-hidden="true"
         style="display:block;width:100%;height:72px">
      <path d="M0,44 C220,84 400,8 720,44 C1040,80 1240,8 1440,44
               C1660,84 1840,8 2160,44 C2480,80 2680,8 2880,44
               L2880,90 L0,90 Z" fill="rgba(250,249,247,0.34)"/>
    </svg>
  </div>
</div>
```

```css
@keyframes lpwave     { from { transform: translate3d(0,0,0) }
                        to   { transform: translate3d(-50%,0,0) } }
@keyframes lpwaveback { from { transform: translate3d(-50%,0,0) }
                        to   { transform: translate3d(0,0,0) } }
```

Hero layers, back to front:

| Layer | `bottom` | Height | Fill | Drift |
|---|---|---|---|---|
| wave1 | 56px | 70px | `rgba(250,249,247,0.16)` | `lpwaveback 34s` |
| wave2 | 28px | 72px | `rgba(250,249,247,0.34)` | `lpwave 22s` |
| wave3 | 0 | 64px | `#faf9f7` (solid — this is the page floor) | `lpwaveback 16s` |

Footer band, mirrored (paths fill *upward*, `L2880,0 L0,0 Z`): wave4 62px tall,
`#faf9f7`, `lpwave 28s`; wave5 44px tall, `rgba(250,249,247,0.20)`,
`lpwaveback 19s`.

Two directions and three speeds are what makes it read as water. Do not give
them all the same direction, and do not speed them up — anything under ~15s
per cycle looks like a loading animation.

---

## 5. Scroll parallax

The animation above runs on its own. Scroll position adds a horizontal offset,
so the sea reacts to the reader.

- Mark each moving element `data-parallax="<name>"`.
- One listener: `document.addEventListener('scroll', handler, { capture: true, passive: true })`
  — capture phase, because on some pages the scroller is an ancestor element,
  not the window. Also listen to `resize`.
- Throttle with `requestAnimationFrame`, and **always** clear the pending flag
  in a `finally` — otherwise one dropped frame silently kills the effect.
- Progress per element, from its own rect:
  `p = 1 - (rect.top + rect.height / 2) / innerHeight`, clamped to `[-1, 2]`.
  0 = element centre entering at the bottom, 1 = leaving at the top.
- Write only `transform`. Never read/write layout properties in the handler.

| Element | Transform at progress `p` |
|---|---|
| `heroPearl` | `translate3d(0, -46p px, 0) scale(1 + 0.02p)` |
| `glow` | `translate3d(60p px, -30p px, 0)` |
| `boat` | `translate3d(180p px, -10p px, 0)` |
| `wave1` | `translate3d(-70p px, 18p px, 0)` |
| `wave2` | `translate3d(110p px, 10p px, 0)` |
| `wave3` | `translate3d(-150p px, 0, 0)` |
| `wave4` | `translate3d(120p px, 0, 0)` |
| `wave5` | `translate3d(-90p px, 0, 0)` |
| `cluster` (footer pearls) | `translate3d(0, -34p px, 0)` |

Bail out of the whole thing when
`matchMedia('(prefers-reduced-motion: reduce)').matches` — no listener, no
transforms, and the CSS drift is already disabled by the media query. The page
must be complete and legible with zero motion.

---

## 6. The boat

A small white-sailed silhouette on the hero waterline: `position: absolute;
bottom: 78px; left: 44%; width: 74px`. Hull `#0b3032`, mainsail
`rgba(255,255,255,0.88)`, jib `rgba(255,255,255,0.62)`.

It has two motions: a continuous bob (`lpbob 6.5s ease-in-out infinite`,
±7px and ±2.5°, `transform-origin: 50% 90%`) on an inner element, and the
scroll parallax on the wrapper — they must be on **separate elements** or they
overwrite each other.

Check its whole travel (`left: 44%` → `+180px`) at 1440, 1024, 768 and 390px
wide. It must never touch the CTA buttons or the pearl, and must never be the
thing that creates horizontal overflow. Below 640px, hide it — there is not
enough waterline.

`aria-hidden="true"`. It carries no meaning.

---

## 7. "Why pearls" section

New section, directly under the hero. This is where the analogy is actually
made; without it the pearls are just decoration.

Eyebrow "WHY PEARLS" → `<h2>` "A pearl is made slowly, one layer at a time" →
one intro paragraph → three cards, `grid-template-columns: repeat(3, minmax(0,1fr))`,
`gap: 24px`, each `background: #fff; border: 1px solid #e3e1dd;
border-radius: 14px; padding: 28px 26px 30px`.

Each card leads with a photo pearl, and the pearls **grow across the three
cards** (64px → 80px → 98px) — the layers accumulating, in the layout itself.

1. **Something singular arrives** — infant room photo.
2. **Layer upon layer** — toddler room photo.
3. **Something to treasure** — preschool room photo.

Copy is in the reference file. Run it past the manager before publishing; it is
a first draft, not approved text.

Below 1024px: two columns. Below 640px: one column, pearls 72px.

---

## 8. Section markers and dividers

Fix 6 said remove the dashed glyph divider. It stays removed. The replacement
mark is a **9px pearl dot** before each section eyebrow — not a divider, a
label bullet:

```css
background: radial-gradient(circle at 32% 28%, #fff 0%, #f6ece9 45%, #c9d2d2 100%);
box-shadow: 0 1px 2px rgba(27,26,24,0.18);
```

Between sections: `1px solid var(--hairline)` at container width, 48px gap
above and below (32px mobile). No glyphs, no emoji.

The rooms list reuses the same dot at 18 / 24 / 30px for Infant / Toddler /
Preschool — the pearl scale again, this time as age.

---

## 9. What not to do

- No coral, anywhere, still.
- Ocean teal never becomes a button, a link, or body text on `--bg`.
- No more than two ocean bands per page (hero and footer). The middle of the
  page stays `--bg` and white cards.
- No new dependencies: no parallax library, no scroll library, no
  `IntersectionObserver` polyfill, no SVG icon set. Everything above is CSS,
  one small handler, and inline SVG.
- No bubbles, no fish, no sand, no seashell dividers, no gradient text. One
  boat is the whole illustration budget.
- Do not animate anything the reader is trying to read. Text never moves.

---

## Definition of done (in addition to the fix brief's)

1. Hero heading, tagline, intro and both buttons visible at 1440×900 without
   scrolling.
2. Waves drift continuously and respond to scroll; the loop has no visible seam
   and no white gap at either edge at 1440, 1024, 768 and 390px.
3. The boat never overlaps a button, the pearl, or text, across its whole
   travel; hidden below 640px.
4. Every pearl renders correctly with a photo, and as an empty pearl without
   one; no face is cropped out or bleached by the sheen.
5. `prefers-reduced-motion: reduce` removes all motion — no scroll listener
   attached — and the page still reads as finished.
6. No horizontal scrollbar at any width.
7. Every new colour resolves to a token; contrast checked on ocean bands.
8. Lighthouse performance unchanged within 2 points; the scroll handler stays
   off the main-thread budget (transform-only writes, rAF-throttled).

## To confirm with the manager before publishing

- The "Why pearls" copy (three cards + section intro).
- Which consented photos go in the hero pearl and the three story pearls.
- The room ratios, still outstanding from fix 7 — omitted from this design
  rather than guessed.
