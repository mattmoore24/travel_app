# Icon sources

Hand-written SVG rather than exported bitmaps, so the palette values are exactly
the ones in `src/constants/theme.ts` and the artwork rebuilds from a fresh clone.

Render at 1024×1024 with any SVG renderer. iOS icons must be **opaque and
square** — the system applies its own rounded-rect mask, so never round the
corners here.

| File                  | Concept                            | Verdict                                                      |
| --------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `iconD-presence.svg`  | Ring, warm centre, arriving dot    | Survivable; slightly camera-aperture                          |
| `iconG-pin.svg`       | Map pin, amber centre              | Works at every size; generic                                  |
| `iconJ-routes.svg`    | Two routes crossing, bone + amber  | Best of the geometric set — asymmetry + colour break the "x"  |
| `iconO-campfire.svg`  | Flame over crossed logs            | Warmest read; the crossed logs keep the routes idea           |
| `iconP-balloon.svg`   | Hot air balloon                    | Fun and unmistakable; basket detail is lost at 60px           |
| `iconQ-peaks.svg`     | Peaks and a low sun                | **Reads as the broken-image glyph.** Unusable                 |
| `iconR-tent.svg`      | Tent with a lit doorway            | Strong silhouette; reads as a letter A at small size          |

## What each round established

**Round 1 — two-element compositions.** Two circles read as a Venn, two squares
as a folder, two paths as an arch. Nothing survived 60px.

**Round 2 — single focal shapes.** Simple geometric marks turn out to be almost
entirely colonised by UI glyphs: concentric arcs are WiFi, a crescent is night,
an X is close, two bars are a menu, a ring with a dot is record.

**Round 3 — crossing paths.** The concept was never the problem; a *symmetric,
monochrome* cross simply is the close glyph. `iconJ` breaks both properties and
is the only version that still reads as two routes at 60px.

**Round 4 — warm themes** (fun, adventure, community, holiday). Pictorial marks
dodge the glyph problem that sank the geometric rounds, but bring their own:
peaks-and-sun is the broken-image placeholder, and the tent resolves to a
letter A. The campfire is the strongest — it is the one image in the whole
exploration that says *strangers gathering* rather than *travel*.

Colour note: round 1 used the `highlight` ochre (`#9A5709`), which is tuned to
carry white *text* at 4.5:1 and reads muddy brown as a *mark* on indigo. Marks
need only 3:1, so everything since uses the dark-scheme amber `#F0A93C`.
