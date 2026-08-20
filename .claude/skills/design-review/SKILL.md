---
name: design-review
description: Samewhere's design brief — load alongside design:design-critique, design:accessibility-review, design:ux-copy, or design:design-system whenever a screen is being designed, redesigned, critiqued, or audited. Supplies the real palette, type scale, motion vocabulary, tone rules, and per-screen intent so the generic procedure produces Samewhere criticism instead of generic criticism. Also use before writing any user-facing string.
---

# Designing and critiquing Samewhere

Run the `design:*` skill you came for. This file is the brief it is missing.
Where the two disagree, this file wins — it describes a shipped iOS app with
a fixed token system, not a greenfield brand exercise.

## What the product is

A **free** app for travelers to find other travelers in the same city on the
same dates, and to meet up in person. Platonic. **It is explicitly not a
dating app**, and it must not look, read, or behave like one.

That single fact decides more design questions than anything else:

- No swipe deck, no cards to flick, no "likes", no match ceremony, no hearts,
  no red/pink/magenta anywhere.
- Travelers are reviewed one person at a time and that is a _reading_ screen,
  not a _judging_ screen — the framing is "here is a person who will be in
  Lisbon when you are", not "yes or no".
- The map is the hero. Everything else supports it.

Guests can browse. The account is asked for at the moment of action, never at
the door.

## Tokens (`src/constants/theme.ts` — nothing hardcodes a hex)

**Dusk**: deep indigo and burnt amber on a warm bone canvas.

| Role          | Light     | Dark      |
| ------------- | --------- | --------- |
| canvas        | `#FBFAF7` | `#0D0F14` |
| surface       | `#FFFFFF` | `#171A21` |
| text          | `#211E1A` | `#F4F4F2` |
| textSecondary | `#585F6B` | `#A3AAB8` |
| accent        | `#2A4C9B` | `#8AA6F0` |
| highlight     | `#9A5709` | `#F0A93C` |
| danger        | `#B5342A` | `#F08076` |

Indigo is not a taste preference: green accents sat too close to Apple Maps'
park polygons, and the map is the hero screen. A cool primary separates from
the beige-and-green basemap; the warm canvas and amber stop it reading cold.
Amber is the deep ochre, not a bright one — a bright amber cannot carry white
text and loses against the basemap.

Every pair clears **WCAG 4.5:1** in both schemes (3:1 for purely graphical
marks), verified numerically. A critique that proposes a colour must state
its ratio against the surface behind it.

Other scales: seven type roles (`display` 34 → `caption` 11), a **4pt** space
grid, radii `xs 5 … xl 28` plus `bubble 20` and `pill`, exactly **three**
elevation levels, `Motion.quick/standard/slow` = 150/250/400ms, and a
`Springs` vocabulary so every interaction shares one physical feel.
`HitTarget = 44`.

## Accessibility, as it actually bites here

- **Dynamic Type is live everywhere** — nothing disables `allowFontScaling`.
  Any fixed-height container, any absolutely-positioned pair, any full-screen
  composition must be checked at large sizes. The intro tour caps at 1.2×
  because it is a fixed composition; that cap is the exception, not licence
  to add more.
- **44pt hit targets**, and remember a view at `opacity: 0` is skipped by
  UIKit hit-testing entirely — a staggered entrance makes a button untappable
  until it lands.
- **VoiceOver labels must be unique in context.** The sheet scrim says
  "Dismiss" precisely because sheets carry their own "Close" and two
  identical labels are ambiguous.
- Both schemes, every time. A colour defined for one scheme only is the
  classic unreadable-screen bug.

## Per-screen intent

- **Map** — the hero. Faces on pins once signed in, plain glyphs for guests.
  Pins are venue-level _future intent_; never anything that reads as "where
  this person is now".
- **Travelers** — one person, full page, say hi or move on. Shared date
  windows are marked. Never framed as a deck.
- **Chat** — follow WhatsApp/Telegram/iMessage conventions exactly: bubble
  geometry, grouping, day separators, long-press reactions. A messaging
  screen is the one place novelty is a pure cost.
- **Profile** — one component renders your own profile and everyone else's.
  Photo first with the name over it, travel plans directly beneath, then
  about, details, photos, socials. Owner mode only adds edit affordances.
  This is the only honest way to know what a stranger sees.

## Words

Tone: **casual and friendly**. Write like a person who has travelled, not a
platform.

Banned, each for a reason already paid for:

- **"swipe", "deck", "match"** — imports the dating frame the product exists
  to avoid, including in negative form. Do not write "no swiping".
- **"request"** for a message or a connection — it is a _chat_. When someone
  accepts, say **"Connected with [name]"** with a **"Go to chat"** button.
  Never "they said yes".
- **Anti-flirting lectures.** The guidelines used to open with a threat and
  the composer pre-accused the writer. The rule is "keep it casual and
  friendly"; explicit content is not allowed; enforcement detail belongs in
  moderation, not in the user's face.
- **Em dashes and the other AI tells**, in anything the app itself shows.
  (Internal docs, this one included, are not user-facing copy.) Read every
  string aloud before shipping it.

A control says exactly what happens, and the confirmation echoes it. Errors
say what went wrong and what to do — "Nothing by that name in Lisbon. Try the
street, or drag the map to the spot."

## Critique pictures, not code

A design critique of this app runs against the **screenshots from the last
E2E run**, not against a description of the screens. See the `screens` skill
for fetching them and publishing the gallery. Reading source and imagining
the result is how a screen with two concatenated form fields passed review.

## Skip these

`design:research-synthesis` and `design:user-research` have nothing to work
from — the app has no users yet. `design:design-handoff` has no audience:
there is no separate implementer. Use `design-critique`,
`accessibility-review`, `ux-copy`, and `design-system`.
