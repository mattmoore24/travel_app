# Design system & experience direction

The product bet is that a traveler opens this app in a hostel lobby, understands
it in five seconds, and finds one real person to meet. Everything below serves
that. Sources for each research claim are at the bottom.

**On tokens, `src/constants/theme.ts` wins.** Every hard number this document
once carried drifted — palette, type, radii, even the pin colours — so the
tables are gone and the one copy that cannot go stale silently is the code,
which carries the contrast ratios and the reasoning inline. This document
keeps what the code cannot: the research, the principles, the guest ladder,
and the narrative of how the system got here.

## What the research says (Aug 2026)

1. **iOS 26 "Liquid Glass" is the current native language** — the biggest visual
   change since iOS 7. Controls float above content in translucent glass; the
   bottom tab bar is a floating glass capsule inset from the page; hierarchy is
   expressed through depth and translucency rather than boxes and borders.
   Critically, glass must still clear **4.5:1 contrast** — pretty is not an
   excuse for unreadable. `expo-glass-effect` (bundled in SDK 57, already in
   our tree) exposes it natively, and `expo-router`'s NativeTabs already give
   us the real glass tab bar we're using.
2. **Guest mode works.** Delayed registration is one of the highest-leverage
   conversion levers: shipping a guest mode raised registrations ~10% in a
   documented case, and "gradual engagement" (let people reach the aha moment
   before asking for anything) is the standard recommendation. Instagram's
   browse-then-gate model is the reference.
3. **Bottom sheets are the default container** for anything that doesn't
   deserve a full screen — standardised by Apple and now the expected pattern
   for previews, filters and detail. A map app is a full-bleed map + floating
   controls + a bottom sheet.
4. **Chat list management belongs on the row, not inside the thread**: swipe on
   iOS for pin/mute/archive, with accessible labels because icons alone carry
   no semantics.
5. **Reactions are a long-press → floating menu**, with the background blurred
   and haptic feedback — the 2026 convention across Google Messages, WhatsApp,
   Messenger.
6. **Hostelworld already validates the business-room idea** — and its
   windows are tighter than ours: rooms open 7 days before check-in and close
   3 days after checkout. Their existence proves demand; their windows are a
   useful comparison for ours (below).

## Principles

1. **The content is the interface.** Full-bleed map, edge-to-edge photos.
   Chrome floats in glass and gets out of the way.
2. **One decision per screen.** A first-timer should never wonder what to tap.
   Where a screen has a primary action, there is exactly one and it is a
   full-width button at the bottom.
3. **Ask for nothing until you must.** Browsing is free. The account appears at
   the moment of action — send, post, join — with the reason stated.
4. **Depth, not decoration.** Elevation and translucency for hierarchy; no
   gratuitous borders, no card-in-card.
5. **Warm, not romantic.** This is not a dating app and it must not look like
   one. No red/pink/purple gradients, no hearts. Nocturne: the brand blue as
   the lantern on an ink-violet night, warm amber as the signal.
   The single exception is the ❤️ tapback on a message (founder, 2026-08-22):
   it marks a message, not a person, and it is the grammar every phone user
   already has. Nothing else earns a heart.
6. **Legible above all.** 4.5:1 minimum on text, 44pt minimum touch targets,
   Dynamic Type respected, and every glass surface has a solid fallback.
7. **The database may not write user-facing copy** (founder, D3, 2026-08-31).
   Every raised failure the UI can reach gets a written sentence in
   `src/lib/failure-message.ts`, keyed on the stable `hint` code the live
   raise clause carries. The one survivable exception is mechanical: a raise
   message that starts with a capital letter and ends with `.`, `!` or `?`
   is treated as a sentence somebody actually wrote and shown verbatim — so
   a migration author who writes a real sentence ("That date has already
   passed.") still gets it shown, and a schema fragment ("active trip limit
   reached (5)") never reaches an alert again. Writing the capital and the
   full stop is what makes a new database message shippable.

## Tokens

Defined in `src/constants/theme.ts`; nothing in the app hardcodes a hex, a
font size, or a magic number. **Read that file rather than any table here** —
the tables this section used to carry drifted on almost every value (palette,
type, radii), and at least one drifted value was dangerous: an old copy
listed the deep brand blue as the accent, a colour theme.ts spends a
paragraph explaining is unusable for anything readable on the app's ground
(2.34:1).

What theme.ts holds, so you know what to look for:

- **"Nocturne", dark only.** A traveler's map at night: the ground is the
  unlit city, warm light is the signal. Both scheme keys hold the same
  palette on purpose; a light scheme can be restored later by filling one
  key back in. The accent is the brand blue's dark-scheme sibling; the deep
  brand blue survives only as a fill under white. Every pair is computed
  against WCAG, not eyeballed, and the ratios are in the comments.
- **Why a blue accent at all**: the palette moved off the original trail
  green because green accents sat next to park polygons on the hero screen.
  The same collision logic keeps the PINS warm — see the pin section below.
- Seven type roles with deliberately loose line heights (an explicit
  lineHeight shears the stacked marks of Thai, Lao, Burmese, Devanagari and
  Vietnamese), a 4pt space grid, a radius scale, three elevation levels, a
  `Motion` duration map and a `Springs` vocabulary, and `HitTarget = 44`.

**Motion**: `quick 150ms` for state, `standard 250ms` for sheets/navigation,
spring for gesture-driven surfaces. Everything respects Reduce Motion.

## Navigation

Three tabs, in the order people use them:

| Tab           | Contains                                                                   |
| ------------- | -------------------------------------------------------------------------- |
| **Map**       | Full-bleed map, floating city/day controls, pin sheet, drop-pin FAB        |
| **Travelers** | Overlapping travelers from 14 days before arrival; first card is public    |
| **Chat**      | First messages waiting on you · pinned · chats · business rooms · archived |

**Profile leaves the tab bar** and lives behind the avatar in the top-right of
Map and Travelers — standard for social apps, and it buys the third tab for
Chat, which now carries far more weight. Settings, verification, guidelines and
account deletion all live inside Profile.

## The guest ladder

Nothing below the line requires an account. Every gate states _why_ it's asking,
and returns you exactly where you were.

| Free, no account                                             | Requires an account         |
| ------------------------------------------------------------ | --------------------------- |
| The whole map: curated pins, the heat layer, city switching  | Dropping a pin              |
| Traveler pins shown **without identity** (a dot, not a face) | Seeing who a pin belongs to |
| The **first** traveler card, in full                         | Every card after the first  |
| A business room, **read-only**                               | Posting, reacting, joining  |
| Community guidelines, privacy policy                         | —                           |

Privacy calls made here:

- **Traveler pins are anonymous to signed-out visitors.** The brief says the map
  is open; it does not say strangers on the internet get names and faces
  attached to venues. Curated pins carry full detail, user pins render as
  accent dots with the venue and day only. The map still feels alive; nobody
  is exposed.
- **The featured traveler has no opt-out** (founder decision, 2026-08-17):
  posting a trip is the consent, nobody can message that person without an
  account, and the slot rotates constantly because it is a live ranking —
  whoever in the city people are connecting with most this week. Selection =
  hellos received in the last 30 days, tie-broken by verified then recency;
  only active, onboarded travelers inside the window are eligible.
- **Business rooms are publicly readable**, which members must be told
  _before_ they post — the composer carries a one-line notice, and each room
  has a `public_preview` flag the business can turn off.

## The traveler window

Matching opens **14 days before arrival** and runs to the end of the shared
window. Two reasons: people can plan before they land (the point), and the tab
stays full of travelers you can actually meet rather than a year of future
bookings. Cards show the counterpart's **whole stay** ("here 19–26 Aug"), not
just the overlap, so you can see how long someone is around. The same window
governs saying hi — you can only message an overlap you can see.

## Chat architecture

One tab, three kinds of conversation, one consistent row.

```
Waiting on you      ← first messages pending your answer (badge)
Pinned              ← anything the user pinned, either kind
Chats               ← direct + rooms, ordered by last activity
Archived  →         ← one row, opens the archive screen
```

**One-to-one chats** are unchanged in behaviour (accept-gated, moderated
first message, block, end the chat). One conversation, one word: a
traveler-made one is a **group**, a business-run one is a **room**, and
**"chat"** is only ever a one-to-one.

**Business rooms** are new:

- A business (hostel/hotel) owns a room. A staff member is the
  **moderator**: they can pin a message, remove a message, and remove a member.
- **Anyone in the city can join**; joining asks one question — _when do you
  leave?_ — because that answer drives everything else.
- **Membership expires**: 7 days after the stated departure date, hard-capped at
  30 days from joining. Both are enforced server-side by a scheduled sweep, not
  by the client. (Hostelworld closes rooms 3 days after checkout — if rooms get
  noisy, 3 is the number to try.)
- Leaving is always one tap, and expiry is never a surprise: the room shows
  "you'll leave this room on 3 Sep" in its header.

**Row actions** (swipe, with long-press equivalent for accessibility):

- **Pin** — sticks to the top, any number, reorderable later.
- **Mute** — no push, no badge; the row shows a muted glyph.
- **Archive** — manual, or **automatic after 14 days without a message**.
  Archived chats stay fully readable forever (Hinge's model); a new message
  un-archives instantly.

**Messages** gain two things in both kinds of chat:

- **Reactions** — long-press a bubble → blurred backdrop + floating glass row of
  six quick emoji + a "more" affordance; haptic on open and on pick. Reactions
  render as a small pill under the bubble with a count.
- **Photos** — camera or library, downscaled client-side, uploaded to a private
  `chat-photos` bucket, and passed through the **same moderation pipeline as
  profile photos** before anyone else can load them. In a public-readable room
  that gate is not optional.

## Profiles

Up to **9 photos**: one profile photo plus 8 gallery slots (the brief asks for
at least 6 beyond the first; 8 gives room without turning the profile into a
scroll marathon). Reorder by drag, first slot is always the avatar.

Both profile screens open on a **full-bleed 4:5 hero** with the name set in
white over a bottom gradient (`PhotoScrim`, backed by `expo-linear-gradient` —
banded `View` stacks were visibly stepped on flat-coloured images). Leading with
the face is the one thing every profile-driven app converged on: it makes the
person, not the form fields, the thing you react to.

Your own gallery renders **empty dashed slots up to 6**, which does the nudging
that a sentence of copy can't. It stays a nudge — onboarding still only requires
the profile photo, because an account you're asked to finish before you've seen
anything is exactly the friction the guest ladder exists to avoid.

## Build order

1. ~~**Tokens + primitives**~~ — palette, type, space, glass surface, buttons,
   cards.
2. ~~**Three-tab IA**~~ — Chat tab absorbs the inbox; profile moves behind the
   avatar.
3. ~~**Screen-by-screen redesign**~~ — Map (full-bleed + sheet), Travelers (big
   photo cards), Chat (sectioned list), Profile.
4. ~~**Guest mode**~~ — anon policies, featured traveler, gates.
5. ~~**Business rooms**~~ — schema, lifecycle sweep, moderation tools, UI.
6. ~~**Reactions + chat photos.**~~

Each stage ships green (typecheck, lint, tests, pgTAP) and gets screenshots in
the PR description.

### Verifying a screen actually changed

Screens are checked by exporting the real bundle (`npx expo export -p web`)
against the mock API in the scratchpad and screenshotting it with Playwright.
Two rounds of that were wasted reading a **stale static server** — the process
holding the port was still serving a build from two exports earlier, so correct
code looked broken and got "fixed" repeatedly. Kill the listener by port
(`ss -lptnH 'sport = :54332'`), not by `pkill -f`, which matches the calling
shell's own command line and takes the shell down with it. Confirm the new
server logged `serving` before trusting a single pixel.

## Sources

- [Apple HIG / iOS 26 design guidance](https://www.learnui.design/blog/ios-design-guidelines-templates.html) ·
  [Liquid Glass principles](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/) ·
  [Liquid Glass usability & accessibility](https://letsdev.de/en/blog/ios-26-in-detail-liquid-glass-ui-between-usability-and-accessibility.php)
- [expo-glass-effect](https://www.npmjs.com/package/expo-glass-effect) ·
  [Expo liquid glass tab bar](https://www.amillionmonkeys.co.uk/blog/expo-liquid-glass-tab-bar-ios)
- [Gradual engagement](https://www.appcues.com/blog/gradual-engagement-mobile-app-first-screen) ·
  [Guest mode conversion results](https://www.businessofapps.com/insights/achieving-a-seamless-user-experience-what-to-consider-before-mandating-registration/) ·
  [Sign-up flow patterns](https://www.eleken.co/blog-posts/sign-up-flow)
- [Bottom sheet UX](https://blog.logrocket.com/ux-design/bottom-sheets-optimized-ux/) ·
  [Mobile UI patterns 2026](https://muz.li/blog/whats-changing-in-mobile-app-design-ui-patterns-that-matter-in-2026/) ·
  [Map UI practice](https://www.eleken.co/blog-posts/map-ui-design)
- [Chat list actions & chat UI patterns](https://bricxlabs.com/blogs/message-screen-ui-deisgn) ·
  [Chat app design practices](https://www.cometchat.com/blog/chat-app-design-best-practices)
- [Reactions & long-press menus](https://9to5google.com/2026/06/27/new-google-messages-features/) ·
  [WhatsApp reactions behaviour](https://techwiser.com/things-to-know-about-whatsapp-message-reactions/)
- [Hostelworld Social Pass](https://www.hostelworld.com/blog/hostelworld-social-pass-the-social-app-no-booking-required/) ·
  [Hostelworld chat windows](https://support.hostelworld.com/knowledge/guest-chat)

## The craft pass (2026-08-19)

Six parallel research agents surveyed iOS 26 HIG/Liquid Glass guidance, Apple
Design Award-tier apps (Flighty, Airbnb 2025, Partiful, Not Boring, Family,
Things, Luma, Lumy), map UX (Apple Maps, Airbnb, Uber pickers, Zenly),
motion/haptics standards, 2025-26 color direction, and the RN/Expo engineering
of all of it (verified against installed SDK 57 types). What shipped:

### Palette verdict: keep the blue + amber pairing

(Historical: the palette this pass reviewed was "Dusk", with a light scheme.
The shipped palette is **Nocturne, dark only** — theme.ts is the record.)

Three researchers independently concluded the blue + amber campfire pairing
is an ownable identity — competitors cluster in coral (Airbnb), black/purple
(Hinge/Partiful), and green (Beli) — and the icon locks it in. Adjustments
made rather than replacement:

- **Warm ink** — light-mode text moved to a warm near-black; warmth
  throughout is the 2026 direction for community products. (Moot under
  Nocturne, kept as the record of why the light scheme read warm.)
- **Amber owns the map's CONTENT now, not its controls.** This pass
  originally gave the docked "Drop a pin" button the amber; the shipped
  button is the accent blue, because amber is spent on twenty markers on
  that same screen and two warm things on one screen means neither reads as
  the signal. Controls are the brand blue; the map's content is warm.
- Dark mode already followed the research (the lifted brand-blue accent,
  ink-violet near-blacks, warm amber at 9:1) — and is now the whole app.

### Motion vocabulary (Springs in `constants/theme.ts`, haptics in `lib/haptics.ts`)

| Moment                        | Spring                                                    | Haptic                                    |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| Press down / release          | `press` d30/s500 → `release` d15/s350 (scale 0.92–0.98)   | `soft` on primary CTAs only               |
| Sheet present                 | `sheet` m1/s130/d19 — the converted SwiftUI system spring | none                                      |
| Center-pin lift               | `snap` 350ms, ratio .92, clamped                          | none                                      |
| Center-pin settle             | `drop` m1/d14/s260 — one crisp bounce                     | `medium` at landing                       |
| Marker drop-in / select       | FadeInDown spring / scale 1.12 `snap`                     | `light` on select                         |
| Success (pin posted, accept)  | `pop` 550ms ratio .75                                     | `success` — budgeted to ≤3 flows app-wide |
| Refusal (search miss, blocks) | ±7pt shake ≤220ms                                         | `error`                                   |

Chip taps tick with `selection`. Chat send, scrolling, tab switches: nothing —
the system owns tabs, and 100×/day actions get no animation.

### The map pins

Emoji markers are gone. Pins are ringed dots with a tail (tip on the exact
coordinate — note `anchor` is Google-only; Apple Maps uses `centerOffset`).
**Both pin colours are warm** (`src/features/pins/pin-marker.tsx`): traveler
pins are the campfire amber `#FF9A5A` with a `#0E1020` glyph, curated seeds
gold `#FFC168` with a star. Never the brand blue — the basemap is dark navy
now, and a blue marker on a dark blue basemap is the same collision that
pushed the brand off green in the first place, just inverted. Warm light on
an unlit city is the whole idea of the palette. Two colors total; the glyph
carries the category; selected pins scale up, raise zIndex, and the camera
nudges them above the detail sheet. `displayPriority` keeps real traveler
pins from ever being collision-hidden.

### The drop-a-pin flow (in place, one screen)

Docked accent-blue pill (bottom-center, not a floating FAB — iOS
convention; amber belongs to the markers, see above) →
placement mode on the same map: chrome swaps out, a fixed center pin lifts
while the map pans and settles with a thud, on-device CLGeocoder search
("Search a place in Bangkok…" — no keys, no user location, submit-only to
respect rate limits) flies the camera, "Pin here" → the detail form as a
keyboard-aware sheet over the same map → posted pin drops in selected.

### HIG compliance fixes

Untinted system-glass tab bar (no painted background); Title Case section
headers (ALL-CAPS retired in iOS 26); glass is decorative-only under touch
targets (`pointerEvents="none"` — the effect view otherwise competes for the
gesture, the root of the dead-first-tap bug); scale animations live on an
inner view because Fabric hit-tests transformed rects; splash overlay is
brand indigo (was leftover template blue).

### The welcome sequence (2026-08-19)

First launch opens on the splash field itself: `IntroTour` reuses the exact
splash indigo (`BrandDeep` in theme.ts) and the 200 pt campfire mark
position, so native splash →
animated overlay → welcome scene plays as one unbroken shot. The mark is a
single shared element floating above the pager: as the first swipe begins it
glides up and shrinks into a docked emblem, with scale and translate driven
directly by the scroll offset so it tracks the finger. The amber glow
breathes behind it on the welcome page only, each page's icon and text move
at different parallax factors for depth, and the dots stretch with the
scroll. The last page carries the join-or-browse choice; the sequence never
theme-switches, same as the splash.

**House rule going forward — transitions read as one scene**: prefer shared
elements over hard cuts and gesture/scroll-driven motion over time-driven
motion whenever two states are visually adjacent.

### The founder review (2026-08-19)

Thirteen asks from the first real-device pass. The structural ones:

**One profile component.** `features/profile/profile-view.tsx` renders both
your own profile and everyone else's — photo first with the name over it,
travel plans immediately under it, then about, details, photos, socials.
Owner mode adds edit affordances and inline trip management; nothing else
differs, which is the only honest way to know what a stranger sees.

**Trips moved to the profile.** They are the most important thing on it, so
they sit directly under the hero and are editable in place. Travelers marks
every window two people share, not just the nearest.

**One at a time in Travelers.** A list of everyone reads as a grid nobody
looks at. One person, full page, say hi or move on — deliberately not framed
as a swipe deck, and the copy never uses the word.

**Chat conventions, not invented ones.** Bubble geometry, grouping, day
separators and long-press reactions follow what WhatsApp/Telegram/iMessage
have settled on, because a messaging screen is the one place novelty is a
cost.

**Tone.** The anti-dating framing was doing more harm than good: it opened
the guidelines with a threat about flirting and pre-accused people in the
message composer. The rule is now "keep it casual and friendly", explicit
content is not allowed, and enforcement detail lives in moderation rather
than in the user's face.

### Researched, deliberately deferred

Worth building when the moment is right, in rough order of value:

1. **Travel Log share card** — Flighty-Passport-style postcard after each trip
   (city, days, meetups joined); free-tier growth artifact.
2. **Ember-cooling expiry** — pin colour cools from the pin amber through a
   deep ochre to gray as the 72h burns down; the countdown ring variant
   needs design time.
3. **Lottie/HEVC-alpha illustration set** — 4–5 warm 3D-ish hero assets
   (campfire, tent, backpack) for empty states, à la Airbnb Lava.
4. **MKLocalSearch Expo module** (~60 lines Swift) for true venue-name search;
   CLGeocoder is address-oriented.
5. **Live Activity** for a joined meetup countdown (plan, not people — no
   location involved).
6. **Time-of-day map chrome tint** (Lumy's window-to-the-world; "Dusk" as a
   felt behavior), **minimize-on-scroll tab bar** on list tabs, and
   **morphing-tray** unification of the map's sheets.
