# Design system & experience direction

The product bet is that a traveler opens this app in a hostel lobby, understands
it in five seconds, and finds one real person to meet. Everything below serves
that. Sources for each research claim are at the bottom.

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
6. **Hostelworld already validates the establishment-chat idea** — and its
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
   one. No red/pink/purple gradients, no hearts. Indigo + amber on warm bone.
   The single exception is the ❤️ tapback on a message (founder, 2026-08-22):
   it marks a message, not a person, and it is the grammar every phone user
   already has. Nothing else earns a heart.
6. **Legible above all.** 4.5:1 minimum on text, 44pt minimum touch targets,
   Dynamic Type respected, and every glass surface has a solid fallback.

## Tokens

Defined in `src/constants/theme.ts`; nothing hardcodes a hex or a magic number.

**Colour — "Dusk": deep indigo + burnt amber on warm bone.** The light when you land
somewhere, which is also when travellers actually make plans.

Indigo replaced the original trail green deliberately. Green was chosen partly
for map legibility, and that turned out to be backwards: Apple Maps' basemap is
beige _and green_, so green accents sit close to park polygons on the app's hero
screen. A cool primary separates from the basemap; the warm bone canvas and the
amber keep it from reading cold. It remains nothing like the red/pink/purple
every dating app runs, which was always the more important constraint.

| Role            | Light                 | Dark                 | Use                               |
| --------------- | --------------------- | -------------------- | --------------------------------- |
| `canvas`        | `#FBFAF7` warm bone   | `#0D0F14` near-black | page background                   |
| `surface`       | `#FFFFFF`             | `#171A21`            | cards, sheets                     |
| `surfaceSunken` | `#F0EFEA`             | `#212630`            | inputs, chips                     |
| `text`          | `#14171A`             | `#F4F4F2`            | primary text                      |
| `textSecondary` | `#585F6B`             | `#A3AAB8`            | supporting text (6.2:1 on canvas) |
| `accent`        | `#2A4C9B` deep indigo | `#8AA6F0`            | primary actions, selection, pins  |
| `onAccent`      | `#FFFFFF`             | `#0A1330`            | text on accent                    |
| `accentSoft`    | `#E7EBF8`             | `#1D2742`            | accent-tinted fills               |
| `highlight`     | `#9A5709` burnt amber | `#F0A93C`            | featured, own-pin, unread         |
| `onHighlight`   | `#FFFFFF`             | `#2A1A00`            | text on amber                     |
| `highlightSoft` | `#FBEEDA`             | `#33260F`            | amber-tinted fills                |
| `warning`       | `#9A5709`             | `#F0A93C`            | expiry, moderation notices        |
| `danger`        | `#B5342A`             | `#F08076`            | destructive, blocked              |
| `hairline`      | `#00000012`           | `#FFFFFF14`          | 0.5pt separators only             |

Amber is the deep ochre rather than a bright one on purpose: a brighter amber
can't carry white text at 4.5:1 and loses to a beige basemap. Every pair in this
table was **checked numerically** against WCAG 2.1 (4.5:1 for text, 3:1 for
graphical marks), not judged by eye — which is how the previous palette shipped
a `warning` colour that silently failed at 4.12:1.

**Type.** iOS system font, seven roles, generous line height. Sizes are the
default; all scale with Dynamic Type.

| Role       | Size / line | Weight | Use                     |
| ---------- | ----------- | ------ | ----------------------- |
| `display`  | 34 / 40     | 700    | one per screen, max     |
| `title`    | 26 / 32     | 700    | screen titles           |
| `headline` | 19 / 24     | 600    | card titles, names      |
| `body`     | 16 / 23     | 400    | messages, bios          |
| `callout`  | 15 / 20     | 500    | buttons, chips          |
| `footnote` | 13 / 18     | 400    | metadata, timestamps    |
| `caption`  | 11 / 14     | 600    | overline labels, badges |

**Space** on a 4pt grid: `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48`.
**Radius**: `sm 10 · md 14 · lg 20 · xl 28 · pill 999`. Nothing sharp; nothing
fully circular except avatars and the FAB.
**Elevation**: three levels only — `raised` (cards on canvas), `floating`
(glass controls over the map), `sheet` (bottom sheets).
**Motion**: `quick 150ms` for state, `standard 250ms` for sheets/navigation,
spring for gesture-driven surfaces. Everything respects Reduce Motion.

## Navigation

Three tabs, in the order people use them:

| Tab           | Contains                                                                |
| ------------- | ----------------------------------------------------------------------- |
| **Map**       | Full-bleed map, floating city/day controls, pin sheet, drop-pin FAB     |
| **Travelers** | Overlapping travelers from 14 days before arrival; first card is public |
| **Chat**      | Requests · pinned · direct chats · establishment rooms · archived       |

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
| An establishment room, **read-only**                         | Posting, reacting, joining  |
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
  requests received in the last 30 days, tie-broken by verified then recency;
  only active, onboarded travelers inside the window are eligible.
- **Establishment rooms are publicly readable**, which members must be told
  _before_ they post — the composer carries a one-line notice, and each room
  has a `public_preview` flag an establishment can turn off.

## The traveler window

Matching opens **14 days before arrival** and runs to the end of the shared
window. Two reasons: people can plan before they land (the point), and the tab
stays full of travelers you can actually meet rather than a year of future
bookings. Cards show the counterpart's **whole stay** ("here 19–26 Aug"), not
just the overlap, so you can see how long someone is around. The same window
governs sending a request — you can only message an overlap you can see.

## Chat architecture

One tab, three kinds of conversation, one consistent row.

```
Requests            ← accept-gated first messages (badge)
Pinned              ← anything the user pinned, either kind
Chats               ← direct + rooms, ordered by last activity
Archived  →         ← one row, opens the archive screen
```

**Direct chats** are unchanged in behaviour (accept-gated, moderated first
message, block/unmatch).

**Establishment rooms** are new:

- An establishment (hostel/hotel) owns a room. A staff member is the
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
5. ~~**Establishment rooms**~~ — schema, lifecycle sweep, moderation tools, UI.
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

### Palette verdict: keep Dusk

Three researchers independently concluded the indigo + amber campfire pairing
is an ownable identity — competitors cluster in coral (Airbnb), black/purple
(Hinge/Partiful), and green (Beli) — and the icon locks it in. Adjustments
made rather than replacement:

- **Warm ink** — light-mode text is now `#211E1A` (was a cool near-black);
  warmth throughout is the 2026 direction for community products.
- **Amber owns action and reward** — the docked "Drop a pin" button is amber
  (`highlight`/`onHighlight`, both schemes WCAG-checked already): lighting a
  fire is THE core act, and amber is spent nowhere else on that screen.
  Indigo recedes to structure, links, selected states, and the pins.
- Dark mode already followed the research (lifted indigo `#8AA6F0`,
  indigo-tinged near-blacks, amber `#F0A93C` at 9:1) — no change needed.

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
coordinate — note `anchor` is Google-only; Apple Maps uses `centerOffset`):
indigo body + white category glyph for traveler pins, amber + star for curated
seeds. Two colors total; the glyph carries the category; selected pins scale
up, raise zIndex, and the camera nudges them above the detail sheet.
`displayPriority` keeps real traveler pins from ever being collision-hidden.

### The drop-a-pin flow (in place, one screen)

Docked amber pill (bottom-center, not a floating FAB — iOS convention) →
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
indigo (`#2A4C9B`) and the 200 pt campfire mark position, so native splash →
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
2. **Ember-cooling expiry** — pin color cools `#F0A93C` → `#9A5709` → gray as
   the 72h burns down; the countdown ring variant needs design time.
3. **Lottie/HEVC-alpha illustration set** — 4–5 warm 3D-ish hero assets
   (campfire, tent, backpack) for empty states, à la Airbnb Lava.
4. **MKLocalSearch Expo module** (~60 lines Swift) for true venue-name search;
   CLGeocoder is address-oriented.
5. **Live Activity** for a joined meetup countdown (plan, not people — no
   location involved).
6. **Time-of-day map chrome tint** (Lumy's window-to-the-world; "Dusk" as a
   felt behavior), **minimize-on-scroll tab bar** on list tabs, and
   **morphing-tray** unification of the map's sheets.
