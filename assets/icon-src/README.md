# Icon sources

Hand-written SVG rather than exported bitmaps, so the palette values are exactly
the ones in `src/constants/theme.ts` and the artwork rebuilds from a fresh clone.

Render to PNG with the scratchpad script (Playwright + Chromium), or any SVG
renderer at 1024×1024. iOS icons must be **opaque and square** — the system
applies its own rounded-rect mask, so never round the corners here.

| File                 | Concept                                          |
| -------------------- | ------------------------------------------------ |
| `iconA-overlap.svg`  | Outlined circles, deep ochre lens (round 1)      |
| `iconA2-overlap.svg` | Filled circles, bright amber lens (round 2)      |
| `iconB-converge.svg` | Two routes meeting at a point (round 1)          |
| `iconB2-cross.svg`   | Two routes crossing and continuing (round 2)     |
| `iconC-squares.svg`  | Overlapping rounded squares, inverted (round 1)  |
| `iconC2-squares.svg` | Same, bright amber overlap (round 2)             |

Round 2 exists because round 1 used `highlight` (`#9A5709`), which is tuned to
carry white text at 4.5:1. As a graphical mark against indigo it read muddy
brown. Marks only need 3:1, so round 2 uses the dark-scheme amber `#F0A93C`.
