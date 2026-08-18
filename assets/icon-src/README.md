# Icon sources

Hand-written SVG rather than exported bitmaps, so the palette values are exactly
the ones in `src/constants/theme.ts` and the artwork rebuilds from a fresh clone.

Render at 1024×1024 with any SVG renderer. iOS icons must be **opaque and
square** — the system applies its own rounded-rect mask, so never round the
corners here.

| File                 | Concept                          | Verdict                              |
| -------------------- | -------------------------------- | ------------------------------------ |
| `iconA2-overlap.svg` | Filled circles, amber lens       | Venn-adjacent; reads as eyes          |
| `iconB2-cross.svg`   | Two routes crossing              | Collapses to an "x" (close) at 60px   |
| `iconD-presence.svg` | Ring, warm centre, arriving dot  | Survivable; slightly camera-aperture  |
| `iconG-pin.svg`      | Map pin, amber centre            | Works at every size; generic          |
| `iconH-same.svg`     | Equals sign — "same"             | Best concept; reads as sliders/menu   |
| `iconJ-routes.svg`   | Two routes crossing, bone + amber | **Strongest.** Asymmetry + two colours break the glyph read |
| `iconL-node.svg`     | Crossing with a dominant node     | Paths still fall into a symmetric X around the dot |
| `iconM-disc.svg`     | Routes cut out of a solid disc    | Strong silhouette; reads as a pinwheel at 60px |
| `iconN-knot.svg`     | One line crossing itself          | Turns to mush at 60px |

## What two rounds established

**Simple geometric marks are almost entirely colonised by UI glyphs.**
Concentric arcs mean WiFi, a crescent means night, an X means close, two bars
mean menu, a ring with a dot means record, overlapping squares mean copy. The
space of "abstract + simple + geometric" has very little unclaimed territory,
which is why every option here collides with something.

Two openings remain unexplored: a **monogram** (letterforms are not system
icons, which is why Stripe, Slack and Notion use them), and paying a human
designer — this is the most visible asset in the product and the one where a
few hundred dollars buys more than another generated round.

Round 1 also used the `highlight` ochre (`#9A5709`), which is tuned to carry
white *text* at 4.5:1 and reads muddy brown as a *mark* against indigo. Marks
only need 3:1, so everything from round 2 on uses the dark-scheme amber
`#F0A93C`.

## The crossing-paths round

The founder liked the crossing-routes idea; the problem with `iconB2` was never
the concept, it was that a **symmetric, monochrome** cross is the close glyph.
Breaking either property fixes it. `iconJ` breaks both — the two paths run at
different angles and in different colours — and it is the only version that
still reads as two routes rather than an "x" at 60px.
