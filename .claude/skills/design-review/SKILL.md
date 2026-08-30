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
  - **One exception, founder-granted 2026-08-22: the ❤️ tapback on the
    message reaction row.** The rule is about romantic vocabulary — a like
    button, a heart you spend on a PERSON, a ceremony when two of them meet.
    A tapback is none of those: it is iMessage grammar everyone already has
    in their thumbs, and what it marks is a message. It stays confined to the
    reaction row and the expanded grid; a heart anywhere else, and red as a
    UI colour anywhere at all, is still banned.
- Travelers are reviewed one person at a time and that is a _reading_ screen,
  not a _judging_ screen — the framing is "here is a person who will be in
  Lisbon when you are", not "yes or no".
- The map is the hero. Everything else supports it.

Guests can browse. The account is asked for at the moment of action, never at
the door.

## Tokens (`src/constants/theme.ts` — nothing hardcodes a hex)

**Nocturne**, and **dark only**. A traveler's map at night: the ground is the
unlit city, warm light is the signal. `Colors.light` and `Colors.dark` hold
the same palette on purpose, so a light scheme can be restored later by
filling one key back in without touching a component.

| Role          | Value     | On the ground                                  |
| ------------- | --------- | ---------------------------------------------- |
| canvas        | `#0E1020` | the unlit map                                  |
| surface       | `#171A2E` | cards, rows                                    |
| surfaceSunken | `#20243D` | sheets, modals                                 |
| text          | `#F1F0F7` | 16.7:1                                         |
| textSecondary | `#A6A9C4` | 8.2:1                                          |
| textTertiary  | `#6E7196` | 4.0:1 — labels and large text ONLY, never body |
| accent        | `#8AA6F0` | 7.9:1                                          |
| onAccent      | `#0E1020` | 7.9:1 on accent                                |
| accentDeep    | `#2A4C9B` | fill only, under white (8.1:1)                 |
| highlight     | `#FF9A5A` | 9.0:1 — pins, own-pin, unread                  |
| ember         | `#FF6B54` | 6.7:1 — heat scale top end                     |
| success       | `#7FD9A8` | 11.1:1                                         |
| warning       | `#FFC168` | 11.8:1                                         |
| danger        | `#FF6B6B` | 6.8:1                                          |
| hairline      | `#2E3350` | decorative dividers only                       |
| border        | `#5E6499` | 3.4:1 — input outlines, edges a user must see  |

**The accent is the brand blue, and it is NOT `#2A4C9B`.** That value scores
**2.34:1** on this ground: it fails the 4.5:1 body floor and also the 3:1
floor for large text and UI edges. Its dark-scheme sibling `#8AA6F0` is the
same brand blue at 7.9:1. `#2A4C9B` survives only as a fill under white.

**Pins stay warm.** Blue markers on a dark blue basemap are the same
collision that pushed the brand off green originally, inverted. Heat reads as
one light source intensifying, amber to ember, never as a hue swap.

Other scales, all Nocturne's: seven type roles (`display` 32 → `caption` 11),
a **4pt** space grid, radii `sm 8 / md 12 / lg 16 / xl 20`, `bubble 18`
(iMessage's corner), `pill`. Three elevation levels,
`Motion.quick/standard/slow` = 150/250/400ms, a `Springs` vocabulary.
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
- **"place" for a business.** A hostel, bar, cafe or tour operator is a
  **business** in every string anybody reads, traveler or owner. This reverses
  the earlier rule ("travelers never see the word business, they see a
  place"), which the founder overturned on 2026-08-28: consistency beats the
  softer word. "Place" is still right where it means a spot on the map, as in
  the drop-a-pin search field.
- **"here now", "nearby", "near you", and a bare "Here"** — presence claims,
  every one, in an app whose strongest safety claim is that it never collects
  your location (§7 rule 2). A member count is chat membership: say
  "in this chat". A bare "Here" next to a name is exactly where WhatsApp puts
  "online". The map's heat is "where the plans are", never "plans nearby" —
  it is scoped to a city chip that may be a continent away. Locative uses
  about a business ("in the chat here", meaning at the venue) are not
  presence claims and can stay.

One conversation, one word, and the word is decided: a traveler-made one is a
**group**, a business-run one is a **room**, and **"chat"** is only ever a
one-to-one. The same object must never be a group, a room and a chat on one
screen — this is the 2026-08-28 place-versus-business ruling applied to
conversations.

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
