# Little Pearls — website handover pack

Pearl & ocean visual direction for the Little Pearls Educare Centre website,
requested by the centre manager: bring back the pearl analogy from the old
site, add moving water and a boat, and put the children's photos inside the
pearls.

## What is in here

| File | What it is |
|---|---|
| `01-WEBSITE-FIX-BRIEF.md` | The existing fix brief. **Still in force** — tokens, accessibility, the Contact form, photo consent, the Doorway header button. Read first. |
| `02-MASTER-PROMPT.md` | The new visual direction, written to be pasted into Claude Code. Real values: colours, wave geometry, parallax table, the pearl component CSS. |
| `reference/Little Pearls Website - Pearl & Ocean.dc.html` | The working design. Open it in a browser and scroll — the motion is the point, screenshots do not show it. |
| `screens/` | Stills. `01–03-desktop` at 1440 wide, `01–05-home` at ~900 wide. |

## Order of work

1. Fix brief first (coral, tokens, measure, Contact form, consent manifest).
2. Then the master prompt (ocean hero, pearls, waves, boat, "Why pearls").

Doing it the other way round means building the new hero twice.

## Still open

- **Room ratios** (fix 7) — unconfirmed, so this design omits them rather than
  publishing a guess.
- **Photo consent** — every pearl in the design is a consent-manifest slot. No
  photo is specified until the manager confirms which have current written
  whānau consent for public marketing use.
- **"Why pearls" copy** — first draft, needs the manager's sign-off.

## Notes for whoever picks this up

The ocean is a *surface*, not an accent. Green stays the only interface accent
colour, coral stays deleted, and the logo pink is untouched. Everything that
moves is off under `prefers-reduced-motion` and the page has to read as
finished with nothing moving at all — that is the version most parents on
older phones will see.
