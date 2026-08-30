# UX audit — the whole app, with fresh eyes

Requested by the founder, 2026-08-30: _"Examine all parts of the samewhere app with a
fresh pair of eyes and run a full audit to optimize the app, focusing specifically on the
user experience based on the design of some of the most popular apps with similar
features. Outline all recommendations for improvement based on your audit."_

## How this was done

Fifteen auditors, then fifteen adversarial verifiers.

Seven read one product area each across every dimension (map; Travelers and profiles;
chat, groups and rooms; the first hello; first run and guest mode; businesses; account,
safety and support). Six read one dimension each across the whole app (time to first
value; empty, loading and error states; accessibility and visual consistency; every
user-facing string; navigation, notifications and re-engagement; motion, gesture and
perceived performance). Two did nothing but research reference apps and come back.

Every auditor read source **and** opened the 94 screenshots from the last simulator run
(commit `293692b`), because this repo's own design brief says to critique pictures rather
than code, and it says so because a screen with two concatenated form fields once passed
review. Reference behaviour was researched rather than recalled: Hinge, Bumble BFF,
Timeleft, Meetup, Geneva; iMessage, WhatsApp, Telegram, Signal, Instagram DMs; Google and
Apple Maps, Citymapper, Airbnb, Zillow, Snap Map, Partiful, Foursquare; Google Business
Profile, Yelp for Business, Square, OpenTable, Hostelworld; Instagram, TikTok, Duolingo;
and the direct competitors already in `RESEARCH_NOTES.md`.

Every critical and high finding then went to a verifier whose instructions were to refute
it. A finding appears below only if somebody opened the file or the picture and saw the
thing. Where a verifier corrected a detail, the corrected version is what is written here.

**321 findings.** This document leads with the eight that are structural, because those
are where the leverage is, and lists the rest in the appendix.

## The verdict first

Samewhere is a better-built app than its stage suggests, and the things wrong with it are
almost all _product_ problems rather than craft problems.

The craft is genuinely unusual. Colour tokens carry their measured contrast ratios in
comments. `failure-message.ts` separates "the request never reached the server" from "the
server said no" and gives each its own sentence. The Travelers empty state distinguishes
three different reasons a queue is empty and offers the action that fixes each one. The
inbox row geometry is the layout iMessage, WhatsApp and Signal converged on, arrived at
deliberately. A failed message keeps your words in a greyed bubble with a retry instead of
deleting them. The sender of an unanswered hello learns nothing, ever, and that is
enforced in SQL rather than in the UI. Almost every odd decision in the source carries a
comment naming the run that photographed the bug it fixes.

What is missing is not polish. It is that **the app does not yet do the thing the brief
says it exists to do.** The hook is _"see what travelers are doing in this city tonight."_
Nothing on the map carries a date; the day filter defaults to "any" two taps inside a
sheet; a pin has a date but no _time_, so the data model cannot answer "tonight" even in
principle; there is no list of what is on anywhere in the app; and the heatmap — which the
brief calls the differentiator — has never rendered in a single one of the 94 screenshots.

The eight themes below are ordered by leverage, not by severity.

---

## 1. The map answers "where are some pins", not "what's on tonight"

The map is the best-built surface in the app. `basemap.ts` is the most carefully reasoned
file in the repo, and the two-family marker language works: a 36pt amber teardrop with a
tail is a person's plan, a 26pt navy chip is a business, and the comment explaining it
("the bar is the ground, the plan is the news") is correct. Place mode is a faithful Uber
pickup marker, down to the ground dot left behind while the pin is airborne.

It is also a viewer for pins rather than an answer to a question.

**There is no list of what is on, anywhere in the app.** Discovery is hunting orange
markers one at a time at a zoom where a venue is smaller than a fingertip. Every reference
map product pairs the map with a scrollable sheet — Airbnb, Zillow, Citymapper, Partiful,
Google Maps. Two independent auditors filed this as critical without seeing each other's
work.

**Nothing on the map carries a date.** `filters.ts` records the founder's decision to move
the three day chips into a Filters sheet, and that decision was right — three chips were
one dimension of a filter system and the wrong one. But the sheet defaults `day` to `any`,
so the shipped default is a three-day union with no temporal signal on any marker, and the
only way to learn a plan is tonight rather than Monday is to tap it. Moving the control was
correct; removing time from the _markers_ was the cost nobody priced.

**A pin has a date but no time.** The actual hour lives as free text inside the note ("By
the door at 7"). "What travelers are doing tonight" is a promise the schema cannot keep.

**The camera never frames its own pins.** `map-screen.tsx:894` opens every city at a fixed
`latitudeDelta: 0.09` box on the centroid and never fits to content, so eight real plans
spread across Bangkok render as six markers huddled in the middle third of an empty
basemap. The app manufactures the dead-city impression out of data that is actually there.

**The heatmap has never rendered.** `heat_k` is 3 distinct posters inside a ~550m cell, and
at seeded density that condition is met in exactly one cell in the entire dataset, in
Lisbon. Every map screenshot from the run is glow-free. The brief promises the heatmap is
valuable to someone who never meets anyone; today it is valuable to nobody because nobody
has seen it.

**Business posts reach nobody.** A live post brightens a marker ring. That is the whole
distribution.

### Recommended

1. **Put a list under the map.** A bottom sheet with three detents: a peek showing
   "11 plans in Bangkok · 4 tonight", a half showing the list, full-screen for browsing.
   Rows carry face, plan, venue, day and join mode. This one change converts the map from
   a thing you hunt to a thing you read, makes business posts discoverable, and gives a
   thin city somewhere to put curated content. Build notes from verification: draw the
   rows from the `clusters` array already in memory (so two plans at one bar are one row,
   and no new query is added); let a row degrade to "a traveler", because the guest and
   business feeds come from the identity-stripped `public_city_pins`; and collapse the
   list to its peek whenever the pin card, the venue stack or the filter sheet opens,
   since all three already own that slot.
2. **Put time on the markers and in the model.** Add an optional hour to a pin (the form
   already asks for a day; the note already contains the hour as prose). Then let the
   marker carry it — a "tonight" pin reads differently from a Monday pin. Amber intensity
   or a small time chip; not a hue swap.
3. **Default the map to today, not to any.** With time on the markers and a list under
   the map, "Today" as the opening state is the product's own sentence.
4. **Fit the camera to the pins** on city change, with a floor so a single pin does not
   zoom to a rooftop.
5. **Let the heatmap exist, and say so when it cannot.** Lower `heat_k` to 2, or
   aggregate the cell up, until the layer renders in a launch city — a privacy threshold
   that never lets the feature appear is protecting nobody. That part is a founder call,
   because `k` is a privacy parameter. What needs no permission is honesty: when there is
   no heat, say why, and read `heat_k` off the launch-city row rather than hardcoding a
   number, because it is per-city and already on the device.

---

## 2. The funnel charges everything up front, then forgets what you were doing

Guest mode is real architecture rather than a marketing claim, and it is already better
than every direct competitor: the tabs are the front door for everybody, `place/[id]`,
`room/[id]` and `profile-me` sit outside the signed-in guard on purpose, and every gate
names the thing you just tried to do in the words you tried to do it in ("Pins come with
your name on them"). The push primer waits for a moment of value instead of ambushing at
signup. Keep all of it.

Then a guest tries to do anything, and pays for the whole profile.

| Funnel                                         |       Screens |  Taps | Typed chars |
| ---------------------------------------------- | ------------: | ----: | ----------: |
| Traveler greets someone, from cold launch      |            22 |   ~35 |        ~119 |
| Traveler drops a pin, from cold launch         |            20 |   ~31 |         ~79 |
| Traveler drops a pin, existing account         |             2 |     5 |         ~20 |
| **Join someone else's plan, existing account** |         **2** | **3** |       **0** |
| Business gets its first customer message       | 16 owner-side |   ~40 |        ~120 |

The bottom row of that table is the best thing in the product. The top row is what a
guest pays to reach it. Five of the thirteen signup steps (occupation, bio, prompt,
priorities, socials) are Travelers-page decoration with nothing to do with dropping a pin,
and at the end of all thirteen the map is pixel-identical to the guest map —
`02-map-tab.png` and `11-signed-in-map.png` are the same frame.

Three of these cost more than they look like they cost. All three were checked against
the source, and two were narrowed by verification:

- **Step 3 buries the Gender field.** Name has `autoFocus`, so the keyboard is up on
  arrival and the Age field is already half-cut by the pinned footer; Gender is below the
  fold. `basicsOk` (`onboarding/index.tsx:129`) checks only name and age, and the column
  defaults to `unspecified`, which `profile_visibility` matches against none of the
  gendered audiences. So the data the women-only filter runs on ships empty for anybody
  who does not scroll. It is one scroll away rather than unreachable, and it can be set
  later in Edit profile — but nothing tells anybody that, and this is the input to the
  feature the founder's own research calls the differentiator for the 54% of solo
  travelers who are women.
- **The one mandatory step offers no way to take a photo.** `photo-grid.tsx:191` calls
  `launchImageLibraryAsync` and nothing else. Somebody in a hostel with nothing usable in
  their camera roll is stuck on the only step with no skip. (Two things I first believed
  here were wrong: iOS needs no permission for the library picker, so there is no
  permission trap, and the screen does have a Back chevron.)
- **Signup discards everything a guest was doing.** The only pre-signup context that
  survives the account wall is a group-invite token, handed back by
  `PendingInviteHandoff`. The pin they tapped, the person they wanted to greet and the
  city they were browsing are all dropped — and because the map's city is unpersisted
  component state defaulting to `launchCities[0]`, a guest browsing Lisbon finishes
  thirteen screens and lands in Bangkok.

### Recommended

1. **Fix step 3 in place.** Drop `autoFocus` from Name and move Gender above Age so it
   sits in the first viewport. `docs/ONBOARDING.md` §3 deliberately puts name, age and
   gender on one step, so this is a layout fix, not a fourteenth step.
2. **Add a camera path** to the mandatory photo step, through `captureLivePhoto()` in
   `src/lib/live-camera.ts` rather than `ImagePicker.launchCameraAsync` directly — there
   is a source-scanning test that enforces exactly that.
3. **Carry the intent across the wall.** `PendingInviteHandoff` is the pattern and it
   already works. Generalise it to a pending _action_ — a pin at these coordinates, a
   hello to this person, this city — and spend it on the far side. A guest who signed up
   to say hi to Dev should land on Dev.
4. **Persist the city.** One `AsyncStorage` key.
5. **Let a signed-up account act before it has a finished profile — founder call.** A pin
   needs a name and a face, not an occupation, a bio, a prompt, six priorities and a
   social handle. Splitting onboarding into _required to act_ and _required to be found_
   would cut the hero funnel roughly in half. **This needs sign-off**, because
   `docs/ONBOARDING.md` records the founder asking for exactly the opposite: prompt for
   each part of the profile during onboarding. Worth noting in its defence that steps 6
   to 11 are all one-tap skips today, so the flow is cheaper than its screen count. If
   the shape stays, the cheap version of the same win is to say what is being skipped in
   the ghost button's own label ("Skip the bio for now") and add a "Finish your profile"
   card on the profile tab for whatever was passed.

---

## 3. The thread is missing the half of iMessage that handles coming back

The inbox is the strongest screen in the app. Flush rows on one surface, 52pt avatar, text
column at x=80, separator inset to the text column, an unread dot in a gutter outside the
text column, weight change as a second colourblind-safe signal, swipe actions with a
long-press twin for VoiceOver, and an empty state guarded by four conditions so it can
never paint over a skeleton or a failed fetch. That is ahead of most shipped messaging
apps.

The thread is about half as finished, and the design brief is explicit that this is the
one surface where novelty is pure cost.

- **You cannot reply to a specific message anywhere in the app.** The long-press menu
  builds three actions: Pin, Unsend, Report. In a hostel room with a dozen people talking,
  a thread with no quoting is unreadable.
- **You cannot copy anything.** No Copy action, no text selection, no link detection. A
  Samewhere message is the one place on the phone where an address somebody sends you
  cannot be gotten out.
- **No unread divider, and a thread never opens where you left off.** You land at the
  newest message with forty unread above you and no marker.
- **Nothing records who joined or left a group.** Membership churns silently in the one
  surface built around churning membership.
- **The long-press menu does not dim.** `25-reaction-menu.png` shows the header, the
  composer, the day separator and a ghost duplicate of the message all legible behind the
  scrim, and the reaction row floating a full bubble-height from the bubble it belongs to.
  The file's own comments record two previous fixes to this same overlay.
- **One house icon for three different privacy contracts.** In `27a-chat-list`, a private
  crew, a pin plan open to anyone who taps the pin, and a hostel room anyone can read are
  drawn identically, and their subtitles mean three different things (a last message, a
  member count, a presence count).

### Recommended

1. **Reply, Copy, and text selection in the long-press menu.** Table stakes in 2026, and
   the menu already exists.
2. **Fix the overlay**: hide the original bubble behind the scrim (UIKit's own context
   menu always does), blur rather than dim, and anchor the reaction row to the bubble's
   own edge.
3. **Unread divider and restore-position on open.**
4. **System lines for join and leave.**
5. **Three icons for three contracts** — a person-group glyph for a crew, a pin glyph for
   a plan, a storefront for a business room — and one consistent subtitle grammar.

### The biggest single product opportunity in the app

The map and the chat never touch. An app built on "I want to go to X on Y" has **no way to
send X on Y into a conversation**. Two people agree in a chat to get dinner and then have
to leave the app to decide where. A "share a pin" attachment in the composer, rendering as
a small map card that the recipient can join in one tap, closes the product's own loop and
uses machinery that already exists on both ends.

---

## 4. Nothing brings anyone back

Push notification handling is honest where it exists: `unread.ts` has one definition of
"waiting" used by both the tab badge and the list, mute is respected end to end in SQL on
both the direct-chat and room arms, and the permission ask is earned rather than ambushed.

But the delivery half is a stub, and the schedule half does not exist.

- **A push opens the app and nothing else.** No tap routing to the chat it is about, no
  foreground presentation, no icon badge. A notification about a message drops you on
  whatever tab you last used.
- **Joining somebody's plan makes no sound at all.** `join_room` never touches
  `push_queue`. You post "sunset drinks at 7", three people join, and your phone stays
  silent. That is the hero loop of the product, and it is the one event that produces no
  notification, no badge and no dot.
- **There are no lifecycle notifications.** Push fires for a hello, an accept, a message
  and moderation outcomes. Nothing fires when your pin is about to expire, when your trip
  starts tomorrow, when travelers with overlapping dates arrive in your city, or when a
  business you are talking to posts what is on tonight. All thirteen `cron.schedule` jobs
  are janitorial — expire, archive, lift, poke a worker.
- **The permission is asked once, ever, and there is no way to say yes later.** There is
  no notification settings screen. An owner or a traveler who taps "Not now" during their
  first session is permanently unreachable.

§2 of the brief names churn between trips as one of the two things that kill this
category. Nothing in the app is aimed at it.

### Recommended

1. **Route the tap.** `data.chat_id` is already in every payload. This is a handler.
2. **Push on join** — "Marco is in for sunset drinks" — and badge it. Cheapest possible
   win on the loop the product is built around.
3. **Three lifecycle notifications**, each tied to a real moment: your pin expires in two
   hours (with a re-post action), your trip starts tomorrow (with the map for that city),
   and a weekly "what's on in Lisbon this weekend" for a city you have a trip in. None of
   these reveals a decline, and none needs location.
4. **A notifications screen** with per-category switches, and a "turn these on" row that
   re-asks when the OS permission was refused.

---

## 5. The business side asks for everything and gives nothing legible back

The business build is careful and internally consistent — the 55-defect pass did real
work, and the signup shell is good: one question per screen, a continuous progress bar
across two navigation stacks, and a Continue that stays pressable while incomplete so
pressing it explains _why_ it will not go through. Step 5 ("Is this right?") and step 11
("Here it is") show the listing as a traveler meets it rather than as a summary of the
form. The address/marker split — typing writes the words, dragging writes the coordinates,
and the screen says so — is exactly right.

What that pass did not reach is the proposition.

- **Nothing in the flow says what an owner gets, or that it is free.** The first screen is
  headlined "What is your email?".
- **The photo step counts only _approved_ photos.** An owner uploads a cover, sees it
  chipped "In review", saves, comes back, and is told "One photo is the only thing we need
  here" — the app has forgotten the photo they just added. The E2E run is the proof: the
  wait for "1 added. Add more" never fired, and steps 8 through 12 of business signup have
  never been photographed.
- **There is no return, and nothing is even recorded.** No views, no taps, no saves, no
  "somebody looked at you". Google Business Profile and Yelp for Business both _open_ on
  views and customer actions. This one was _decided_ rather than overlooked — business
  analytics is listed in `BUSINESS_ACCOUNTS.md` §10 "Not in this plan". It is worth
  reopening, because it sits in that list's _deferred_ bucket rather than its refused one
  (written reviews are marked refused), and because the cost of waiting is asymmetric: the
  screen can ship whenever, but the events have to be recorded from now on or there is no
  history to show when it does.
- **A business's default tab is a map of other people's businesses.** Map is first in the
  tab set for everyone.
- **Abandoning business signup drops a bar owner into traveler onboarding.**
- **The rating says nothing until five people have rated**, so a new business shows
  nothing where its strongest signal would go.

### Recommended

1. **A first screen that sells.** One sentence on what a listing does, one on the price
   ("Free, and it stays free"), before the email field. The founder's own hard rule 1 is a
   selling point nobody is told.
2. **Count photos the owner can see, not photos the server has approved** — pending counts
   toward the gate, and the chip already says "In review".
3. **Make My business open on a number.** Even three counters — map taps, page opens,
   chats started, last seven days — turns a settings screen into a reason to open the app
   on Tuesday. Nothing is recorded today, so start recording now regardless of when the
   screen ships.
4. **Default a business to My business, not Map.**
5. **Give a live listing something to hand out**: a share sheet with a link, and a QR for
   the counter. A hostel's whole distribution is people already standing in the lobby.

---

## 6. Safety is enforced in Postgres and never felt in the app

The invariants are real and the individual controls are unusually well made. The verified
seal explains itself on tap. "Does this feel off? Tell us." sits on the incoming hello
card, between a stranger's words and the Accept row, rather than behind a profile visit.
The report confirmation offers "Block them too" as a button rather than a sentence.
Neither report form preselects a reason, and both say why in a comment.

None of it reaches a traveler at the moment she needs it.

- **There is no settings screen.** The word "Settings" appears in no user-facing string
  and there is no gear. Rules, support, audience, verification, sign out and delete are
  ghost buttons stacked _underneath a full-length render of your own profile_, so
  reaching "Send us a message" is two taps and two long scrolls.
- **The women-only audience is locked, and only one of its two screens offers a way
  through.** Four of five rows render at 0.45 opacity, which composites the row title to
  about 3.3:1 and its detail to 2.4:1 — both under the body floor. On the Visibility
  screen this is handled well: "Get verified" sits directly under the rows, and a comment
  records that placement as a deliberate fix. On **onboarding step 12** it is not: the
  same locked rows appear with only "The selfie check lives on your profile once you are
  in." So the first time a woman meets the setting that the founder's research calls the
  differentiator, it is four grey rows and a deferral. The lock itself is correct — the
  server refuses a narrowed audience without the badge — and keeping the step is a
  recorded founder decision. The problem is the missing door, not the step.
- **Blocking is permanent.** There is no unblock anywhere in the app. A migration comment
  from Phase 2 says the block/unblock UI "ships with the rest of the safety tooling in
  Phase 4". It never did.
- **A suspended user's only button is Sign out**, though the guidelines promise appeals.
- **There is no privacy policy or terms link anywhere in the app.**
- **The four promises that make this app safer than its competitors** — no location ever,
  pins gone in 72 hours, socials hidden until you both agree, every first hello screened —
  appear once, as the fourth of five sections, inside a rulebook reached from a button
  labelled "House rules and help". They appear nowhere in the tour, nowhere on the sign-up
  gate, and nowhere on the Travelers screen where a woman actually decides whether to
  greet a stranger.

### Recommended

1. **A real Settings screen**, reached from the avatar, with the account rows above the
   fold instead of under a profile render.
2. **Unblock.** A "Blocked people" list in Settings with a per-row undo. This is also an
   App Store expectation for a social app.
3. **Put a door next to the lock on step 12**, the way the Visibility screen already
   does. Give each locked row "after the selfie check" as its own caption and route a tap
   to verification instead of swallowing it, and drop the row-level `opacity: 0.45` in
   `audience-picker.tsx:62` in favour of a lock glyph in the trailing slot, so the row
   keeps its contrast while still reading as unavailable.
4. **Say the safety promises where the decision is made.** One line under the Say hi bar
   ("They never see where you are. Your handles stay hidden until you both agree.") and
   one slide in the tour. This is the app's strongest differentiator and it is currently
   filed under house rules.
5. **An appeal path for a suspended account**, and privacy/terms links in Settings.

---

## 7. Two design systems wearing one palette

`theme.ts` does not just list colours, it records the measured contrast of every pair and
says out loud that `#2A4C9B` is fill-only at 2.34:1 on this ground. `PrimaryButton`'s
unavailable state exists because somebody measured that `opacity: 0.4` dims label and
ground together to 2.35:1. That is a real design system.

It is also two systems. A "new" vocabulary (`Space`/`Type`/`Radius`, `ChipRail`,
`StepShell`, `PrimaryButton`) and a "legacy" one (`Spacing`, `theme.tint`, `ChipRow`,
`type="small"`) still carrying about a third of the app, and the seam shows in the
screenshots: three different dashed empty-state shapes on the profile alone, two chip
components with different padding and different selected colours, a square "+" beside a
circular avatar, and headers that are a chevron-plus-progress-bar in signup but a lone
circular button on its own row everywhere else.

- **`type="title"` renders at display size.** The legacy alias map shadows the real role,
  so the documented 24pt title is unreachable in 19 places and the seven-role scale is
  partly a fiction.
- **`docs/DESIGN.md` documents a design system that does not ship.** It describes "Dusk" —
  a light-and-dark indigo-on-warm-bone palette with different type, radius and pin colours
  — while the app ships "Nocturne", dark only. The one document a new contributor would
  read to learn the system teaches the wrong hexes, the wrong scales, and uses the banned
  word "request".
- **Emoji in an SF Symbols app.** The map filter's category chips are full-colour emoji,
  including a red 📍, and they do not match the monochrome glyphs the map draws for the
  same categories. The business signup map draws Apple's default red `Marker`. Rule 7
  bans red as a UI colour.
- **Reduce Motion is queried nowhere** across 91 animation call sites, including two
  infinite loops — one of them the breathing glow on the first screen a new user sees.
- **A photoless cluster degrades to identical glyphs.** Drawing up to three overlapping
  faces plus a count is a recorded decision and a good one — "who is going" is the reason
  to tap, and three separate markers on one building bury two of them. But the no-photo
  fallback repeats the same category glyph per face, so two plans at one bar read as
  glyph, glyph, "2". A comment claims nulls become an anonymous silhouette; the code no
  longer does that.

### Recommended

1. **Fix the `type="title"` alias**, then sweep the 19 call sites. One-line cause, and it
   is currently making the type scale untrue.
2. **Rewrite `docs/DESIGN.md` to describe Nocturne**, or delete it and point at
   `theme.ts` plus the `design-review` skill. A wrong spec is worse than none.
3. **Replace the emoji category chips with the map's own glyphs**, and the bare `Marker`
   in business signup with the app's marker component.
4. **Honour Reduce Motion**, starting with the two infinite loops.
5. **Retire the legacy aliases** behind a lint rule so the seam cannot widen.

---

## 8. The app waits on the network where it should feel instant

The motion vocabulary is real and mostly right: `Motion.quick/standard/slow`, eight named
springs, seven semantic haptics each with a documented meaning, and a sheet entrance
written as a `translateY` with a regression test guarding it against the preset that once
froze the place card. `place-pin-overlay.tsx` is the best interaction in the app.

The failures run in one direction — things that already animate are animated well, and
things that should feel instant wait for a round trip.

- **The app is optimistic exactly once**, in message send, where somebody clearly thought
  hard about it. A heart tapback, accepting a hello, joining a plan and taking down a pin
  all wait for a network round trip plus a cache invalidation before anything changes on
  screen. On hostel wifi that is the difference between a live app and a dead button.
- **There is no concept of being offline.** `NetInfo` is not a dependency and
  `onlineManager` is never wired, so React Query believes the device is always online,
  fails twice and stops. Nothing refetches on reconnect except backgrounding the app.
  Pull-to-refresh exists on exactly one screen.
- **Next on Travelers starts a signed-URL round trip after the card has already appeared.**
  Nothing in the codebase prefetches anything, and this is the most repeated gesture in
  the product.
- **Sheets have one resting height** and a drag that only goes down, with a grabber
  advertising a gesture the body will not accept — on cards that sit over a live map,
  where every competing app offers detents.
- **Some screens turn a failure into a confident lie.** Forty-nine call sites destructure
  `data = []`. `archived-chats.tsx` tells somebody with a full archive "Nothing archived."
  when the fetch failed, and `profile/[userId].tsx` — the screen you land on from a map
  pin — renders a bare empty view both while loading and forever on failure.

### Recommended

1. **Copy the send pattern to tapback, accept, join and pin-delete.** The optimistic
   machinery already exists in `features/chat/hooks.ts`; four more call sites.
2. **Wire `onlineManager` to NetInfo** and add a reconnect refetch. One file.
3. **Prefetch the next traveler's signed photo URL** while the current one is on screen.
4. **Detents on the map sheets** — which is also how theme 1's "what's on" list gets its
   peek state.
5. **Audit the `data = []` destructures** for the ones that can print a false empty, and
   route them through the `LoadError` component that already exists.

---

## Copy: two voices, and only one of them was written

Screen for screen, this is better writing than almost any shipped social app.
`failure-message.ts` separates "the request never reached the server" from "the server
said no". Destructive confirmations name the consequence ("They're gone from the map and
Travelers, and can't message you. They're not told."). The pin form's examples were
written by somebody who has been there, and the comment proves it was checked — the tram
example was removed because Bangkok has no trams.

What has not been swept is everything outside `.tsx` and everything on a failure path.

- **Raw Postgres exception text reaches users.** `query-client.ts` pipes any database
  message into an alert titled "Could not save", and the database says things like "active
  trip limit reached (5)" and "request already sent to this traveler" — lowercase
  developer strings, one of them using the banned word for a chat.
- **Em dashes do reach users.** Thirteen of the sixteen curated pins that make up the
  day-one map carry one, so the first sentence a new user reads on the hero screen is the
  exact tell the brief bans. (The ban holds perfectly in `src/`; the database was never
  swept.)
- **The core action has four names**: "Say hi", "a hello", "Reply to…", "Say you're in".
  The sign-up call to action has three, two of them in the same file.
- **"Rooms near you" and "1 guest here now"** claim presence in the app whose defining
  promise is that it never knows where you are — and the query behind "near you" is not
  location at all, it is whatever the first launch city happens to be.
- **"You're top of their list too."** The sentence is _true_, and two verifiers
  disagreed about this before the migration settled it: `daily_spotlights` is a
  canonically ordered pair, one per person per day, with `score(a,b) = score(b,a)`, no
  appearance input anywhere, and both people genuinely see the same pairing. The objection
  that survives is narrower and is a judgment call rather than a factual one — the
  _grammar_ is reciprocity ceremony, structurally "they liked you back", which is the
  shape the brief bans, even though nobody here chose anybody and a mutual recommendation
  is not a mutual like. Founder call.

### Recommended

Intercept database exceptions behind a small map of known constraint names to written
sentences, and fall back to a generic "That didn't save. Try again." Sweep the curated
pin seed for em dashes. Pick one name for the action and use it everywhere. Replace
"Rooms near you" with "Rooms in Bangkok" and "1 guest here now" with "1 person joined".
On "You're top of their list too.", if the founder decides the grammar has to go, delete
the line rather than rewriting it: the hero photo already carries "Both in Bangkok Aug 30 –
Sep 4" two hundred pixels below, so a replacement would print the same fact twice.

---

## Guardrails: things this audit deliberately does not recommend

The verification pass flagged several otherwise-reasonable fixes as rule breaks. They are
listed here so nobody re-proposes them from the finding list.

- **Do not let a sender withdraw a hello by deleting the row.**
  `unique (sender_id, recipient_id)` is a recorded anti-pester constraint — one shot per
  direction, ever. Hide it from the sender's list; do not free the slot.
- **Do not add a "keep for later" shelf on Travelers.** A control you spend on a _person_
  and a collection of people you liked but did not message is the deck mechanic the design
  brief bans by name. The underlying need — "I want to write something decent later" — is
  better met by persisting the composer draft per user.
- **Do not move onboarding steps 6–11 out of the flow, or cut step 12**, without founder
  sign-off. Both shapes are recorded founder decisions in `docs/ONBOARDING.md` and in a
  code comment, and steps 6–11 are all one-tap skips today.
- **Do not gate a room behind a name prompt.** `room/[id].tsx` records the
  account-versus-name line as settled.
- **Do not apply the audience filter to chat.** `audience.ts` states that the filter does
  nothing to messaging, and gating it would edge hard rule 1.
- **Do not render a sub-threshold heat cell.** Lowering `k` from 3 to 2 is a founder call
  about a privacy parameter; rendering a cell below whatever `k` becomes is never one.

---

## Sequencing

**Ship this week.** Fix the `type="title"` alias. Route the push tap. Push on join.
Sweep the em dashes out of the curated pins. Replace "Rooms near you" and "1 guest here
now". Drop `autoFocus` from the Name field and move Gender above Age. Count pending photos toward the business photo gate. Fix the long-press
overlay so it hides the original and blurs. Persist the map city.

**The next month, in order of leverage.** The what's-on list under the map, with detents.
Time on a pin and on its marker. Reply and Copy in the thread, plus the unread divider.
A Settings screen with unblock. Optimistic accept, join and tapback. My business opening
on three counters — and start recording the events now either way.

**Needs a founder decision first.** Splitting onboarding so a pin can be dropped before
the profile is finished. Lowering `heat_k` so the heatmap can exist. Defaulting the map
to Today. Defaulting a business to My business. Whether "You're top of their list too."
stays — the sentence is true, and the only question is whether its grammar sits too close
to the mechanic the brief bans. Reopening business analytics, which §10 of the business
plan currently defers.

**The one to build when there is room.** Sending a pin into a conversation. It closes the
product's own loop, and both halves already exist.

---

## Appendix — all 321 findings

Severity: **C**ritical / **H**igh / **M**edium / **L**ow. "Verified" is the adversarial
pass; critical and high findings were checked, medium and low were not.

All 138 critical and high findings were checked: **94 confirmed, 34 corrected in detail, 7 shown to be recorded founder decisions, 3 refuted outright.** The three refutations and the seven founder decisions are kept in the table rather than deleted, so the record shows what was checked.

### Accessibility and visual consistency, across the whole app

|     | Finding                                                                                                                                  | Cat           | Effort | Verified         | Evidence                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | "You're top of their list too." is a mutual-match ceremony with the banned word removed                                                  | copy          | S      | confirmed        | `src/app/(tabs)/travelers.tsx:366, rendered under the "Today in Bangkok" chip in screenshot 17-travelers-signed-in.png; mechanism in supabase/migration` |
| C   | Business signup step 4: a full-brightness Continue button that silently does nothing when tapped                                         | error-state   | S      | confirmed        | `src/app/business-signup.tsx:339-366 (no continueDisabled; onContinue runs setTouched(true) then returns when city == null); screenshot 42-business-whe` |
| C   | Chat says "1 guest here now" and "Rooms near you" - live-presence copy in the app that promises it never knows where you are             | trust-safety  | S      | partly-true      | `src/app/(tabs)/chat.tsx:508 and :515; screenshot 27a-chat-list-with-a-row.png; also 03-travelers-guest.png ("In Bangkok right now")`                    |
| H   | A cluster of two pins renders as three circles - the count badge is drawn as another pin                                                 | visual        | M      | founder-decision | `screenshots 28-map-with-places.png and 06-guest-gate.png (bar, camera, restaurant and hike clusters all render as glyph + glyph + "2"); src/features/p` |
| H   | Chat list previews are locked to 40pt, so the second line disappears at large Dynamic Type                                               | accessibility | S      | partly-true      | `src/app/(tabs)/chat.tsx:1294-1299 (rowPreview: { height: 40 }); rendered in screenshots 27a-chat-list-with-a-row.png and 20-chat-individual.png`        |
| H   | Map filter and pin categories use full-colour emoji, including a red pin, in an app that is otherwise strictly SF Symbols                | visual        | S      | confirmed        | `src/features/pins/pin-helpers.ts:4-13; used at src/features/pins/map-filter-sheet.tsx:201 and src/app/drop-pin.tsx:23; screenshots 05b-map-filters-on.` |
| H   | On Travelers, the profile's own trip dates read through the "Say hi" button                                                              | visual        | M      | confirmed        | `screenshot 17-travelers-signed-in.png ("...ico" and "Sep 25 - Oct 28" legible behind and around the Say hi pill); src/app/(tabs)/travelers.tsx:399-407` |
| H   | Pin form: the day chips have no visible label, the expiry slider is cut off below the fold, and "Drop it" is greyed with no reason given | flow          | S      | confirmed        | `screenshot 14-pin-form.png; src/features/pins/pin-form-sheet.tsx:319-348; src/components/form/chip-rail.tsx:29-34 (label goes to accessibilityLabel on` |
| H   | The business photo step is a blank screen: a title, a subtitle, and roughly 1000pt of nothing                                            | empty-state   | M      | partly-true      | `screenshot 48-business-photos.png; src/app/business-signup.tsx:611-635 (children render null when photoCount === 0)`                                    |
| H   | The guest Travelers screen looks nothing like the real one, and the first bio a guest reads ends in "[demo]"                             | conversion    | M      | partly-true      | `screenshot 03-travelers-guest.png against 17-travelers-signed-in.png; bio text from scripts/demo-travelers.json:68`                                     |
| H   | The reaction menu leaves a ghost of the original message and floats the reaction row away from it                                        | visual        | M      | confirmed        | `screenshot 25-reaction-menu.png - "First one in" appears twice, once lifted and once faded behind the action card; the reaction row is left-aligned at` |
| H   | docs/DESIGN.md documents a different design system than the one that ships - wrong palette, wrong scales, wrong pins, banned vocabulary  | consistency   | M      | confirmed        | `docs/DESIGN.md lines 49, 60-87, 98-107, 122, 139, 173, 293, 317-319 compared against src/constants/theme.ts`                                            |
| H   | type="title" silently renders at display size - the documented 24pt title role is unreachable                                            | consistency   | M      | partly-true      | `src/components/themed-text.tsx:12 (title: 'display' in LEGACY) and :30 (LEGACY[type] ?? type); Type.title = 24/30 and Type.display = 32/38 in src/cons` |
| M   | Destructive text ships in red, which the hard rule bans - the rule needs a carve-out or the colour needs to change                       | visual        | S      | —                | `src/constants/theme.ts danger: '#FF6B6B'; rendered as "Unsend" in screenshot 25-reaction-menu.png and "Leave this chat" in screenshot 27b-group-add-an` |
| M   | Elevation runs backwards: gate and notice cards are darker than the sheets they sit inside                                               | visual        | M      | —                | `screenshots 06-guest-gate.png and 19-house-rules.png; src/components/ui/glass-surface.tsx:56 (fallback theme.surface #171A2E); src/components/ui/sign-` |
| M   | Nothing in the app asks whether Reduce Motion is on                                                                                      | accessibility | M      | —                | `grep for reduceMotion / isReduceMotionEnabled across src/ returns zero hits, against 91 animation call sites in 20 files; docs/DESIGN.md line 105 clai` |
| M   | One ALL-CAPS section header survives on the profile, against Title Case everywhere else                                                  | consistency   | S      | —                | `screenshot 18-profile-me.png - "WHO YOU SEE, AND WHO SEES YOU" above "Travel plans", "Top priorities", "About" and "Details"`                           |
| M   | The Chat header's "+" is a square among circles, and its VoiceOver label promises a chat but opens a group                               | accessibility | S      | —                | `src/app/(tabs)/chat.tsx:931-945 (accessibilityLabel="Start a chat", onPress pushes /new-group); screenshot 27a-chat-list-with-a-row.png`                |
| M   | The group invite QR is a 460pt block of pure white in a dark-only app                                                                    | visual        | S      | —                | `screenshot 27b-group-add-and-leave.png`                                                                                                                 |
| M   | The segmented control's selected state is a 0.33pt stroke over a 1.15:1 fill difference                                                  | accessibility | S      | —                | `src/components/ui/segmented.tsx:57-70 and :128 (borderWidth: StyleSheet.hairlineWidth); screenshots 27a-chat-list-with-a-row.png and 20-chat-individua` |
| M   | Three different screen headers, and the most common one spends 150pt on a lone circular button                                           | consistency   | M      | —                | `screenshots 18-profile-me.png, 24-group-message.png, 27b-group-add-and-leave.png and 73-business-account.png (circular back on its own row) versus 42/` |
| M   | Two chip components on two different token vocabularies, used side by side in the same flows                                             | consistency   | M      | —                | `src/components/form/chip-row.tsx:36-46 versus src/components/form/chip-rail.tsx:38-52; both appear in business-signup (screenshot 42) and the pin and ` |
| L   | The intro tour's Skip is about 42pt tall - the only control on three of four pages, 2pt under the floor                                  | accessibility | S      | —                | `src/features/intro/intro-tour.tsx:470-477 (hitSlop={12} on a Type.callout Text) and :626-631; screenshot 00-welcome.png`                                |
| L   | The photo step's tile-plus-side-caption becomes a word ladder at accessibility text sizes                                                | accessibility | S      | —                | `src/components/photo-grid.tsx:305-312 (mainBlock is a row, mainCaption is flex: 1) with the tile sized mainWidth * RATIO; screenshot 54-signup-photo-g` |

### Account, settings, trust, safety, support and leaving

|     | Finding                                                                                                 | Cat                      | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Joining a group silently removes the accept gate, and nothing at the join point says so                 | trust-safety             | M      | confirmed   | `src/app/message/[userId].tsx:13-23 and :57 ("You are in a group together, so this goes straight through. No hello to be accepted."); supabase/migratio` |
| C   | The women-only audience is locked behind a badge the onboarding step gives you no way to get            | flow                     | M      | partly-true | `18b-who-can-see-you.png (four of five rows greyed at 0.45 opacity, explanation placed below all four); src/app/onboarding/index.tsx:523-560 (step 12 r` |
| H   | A suspended or banned user's only button is Sign out, while the guidelines promise appeals              | flow                     | S      | confirmed   | `src/app/_layout.tsx:77-108 (AccountGate renders the status sentence and a single "Sign out" ghost button) and :192-194 (it replaces the entire navigat` |
| H   | Blocking is permanent: there is no unblock anywhere in the app                                          | flow                     | M      | confirmed   | `grep for "unblock" across src/ and supabase/ returns only comments — supabase/migrations/20260816200000_trips_matching.sql:71 ("the block/unblock UI s` |
| H   | Neither report form offers "They are under 18", though the guidelines ban under-18s                     | trust-safety             | M      | confirmed   | `src/app/report.tsx:13-21 (six reasons: Explicit or sexual, Harassment, Spam, Fake profile, Safety concern, Other); src/constants/policies.ts:24 and do` |
| H   | Nothing in the sign-up funnel mentions a single safety promise                                          | conversion               | S      | confirmed   | `00-welcome.png ("Make friends in the city you're visiting."), 00b-tour-travelers.png ("Add your trips and you'll see who overlaps."), 06-guest-gate.pn` |
| H   | Raw Postgres error strings reach users in an alert titled "Could not save", including banned vocabulary | error-state              | S      | partly-true | `src/lib/query-client.ts:12-29 (global mutation onError alerts with title "Could not save") and src/lib/failure-message.ts:33-37 (any non-network error` |
| H   | Reporting a person never says it is anonymous, though reporting a business does                         | copy                     | S      | confirmed   | `src/app/report.tsx:66-69 (subtitle "A real person reads every report.") and :50-53 (confirmation "Thanks. A real person reads every report."); src/app` |
| H   | There is no privacy policy or terms link anywhere in the app                                            | trust-safety             | S      | confirmed   | `grep -i "privacy policy/terms of" across src/ returns zero matches; docs/legal/PRIVACY_POLICY.md exists as a draft and is referenced only from src/con` |
| H   | There is no settings screen, and no word "Settings" anywhere in the app                                 | information-architecture | M      | confirmed   | `grep for user-facing "Settings" in src/ returns nothing except Linking.openSettings in verification.tsx; src/components/ui/avatar-button.tsx:47 labels` |
| M   | "Chat is separate: anyone can still message you" over-scares and under-explains                         | copy                     | S      | —           | `src/features/profile/audience.ts:70 (AUDIENCE_BOTH_WAYS); 18b-who-can-see-you.png shows it as the screen's subtitle; supabase/migrations/2026082223500` |
| M   | "Report this place" ships the banned word, and disagrees with the screen it opens                       | copy                     | S      | —           | `src/app/place/[id].tsx:528 (Alert title 'Report this place'), :534 and :631 (button text "Report this place"); the destination src/app/report-place.ts` |
| M   | A business can only be reported for being the wrong listing, never for how it treated a traveler        | trust-safety             | M      | —           | `src/features/business/vocabulary.ts:97-103 (five reasons: not the real business, doesn't exist, closed for good, wrong spot, spam or something offensi` |
| M   | A report ends in a thank-you and vanishes; there is no what-happens-next and no record                  | trust-safety             | M      | —           | `src/app/report.tsx:50-58 ("Report received" / "Thanks. A real person reads every report." then router.back()); src/features/support/api.ts:28-40 defin` |
| M   | Blocking someone gives no confirmation; the thread just says "This chat is closed."                     | error-state              | S      | —           | `src/app/chat/[id].tsx:70-92 (confirmBlock calls block.mutate and does not navigate or acknowledge), :327 (`closed = chat.chat_status !== 'active'`), :` |
| M   | Declining the one-time push primer permanently silences every account and moderation notice             | flow                     | S      | —           | `src/features/notifications/primer-store.ts:44-46 and :62-77 (alreadyOffered gates on a single AsyncStorage key; "Asking twice is how an app teaches so` |
| M   | No way to change a password or an email from inside the app                                             | flow                     | M      | —           | `grep for updateUser shows src/features/auth/api.ts:55 (signup) and :89 (used only by the recovery-link flow in src/features/auth/reset-password-screen` |
| M   | On the screen where you decide whether to greet a stranger, there is no report or block at all          | discoverability          | S      | —           | `17-travelers-signed-in.png (full-page card: photo, name, age, seal, bio line, home, shared dates, travel plans, Say hi — nothing else); grep for Repor` |
| M   | The in-app guidelines drop the meeting-safety advice the source document has                            | trust-safety             | S      | —           | `src/constants/policies.ts:14-30 ships four sections (Respect and kindness, Moderation, Also not allowed, Your privacy); docs/legal/COMMUNITY_GUIDELINE` |
| M   | Verification tells you what a selfie costs, never what the badge buys                                   | conversion               | S      | —           | `src/app/verification.tsx:88 (subtitle: "One selfie, taken right now. It proves your photos are you. Nobody sees it, and we delete it after the check. ` |
| L   | The business account page hides Delete account below the fold with no anchor                            | information-architecture | S      | —           | `73-business-account.png (visible: title, one line, Manage your business, a four-section rulebook card, Send us a message, Sign out — Delete account is` |
| L   | The contact form is one free-text box, so an urgent safety message queues behind feature requests       | flow                     | S      | —           | `src/app/contact.tsx:73-100 (email field, message field, one footnote); 19a-contact-form.png; the subtitle covers "Questions, appeals, anything that fe` |

### Businesses: signup, running a listing, and the page a traveler sees

|     | Finding                                                                                       | Cat                      | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------- | ------------------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Business markers are invisible on the map they are the whole point of                         | visual                   | M      | refuted     | `screenshot 28-map-with-places.png; screenshot 70-business-my-business.png; src/features/business/business-marker.tsx:13-20,28-31,83`                    |
| C   | The cover photo wall never lifts: signup counts only approved photos                          | flow                     | M      | partly-true | `src/app/business-signup.tsx:606,615; supabase/migrations/20260829180000_a_business_photo_is_ever_seen.sql:11; src/app/business-edit.tsx:461-468; e2e/f` |
| H   | A business's Map tab opens on the wrong city, thousands of miles from its own door            | flow                     | S      | confirmed   | `src/features/pins/map-screen.tsx:687-688 (`activeCityId = cityId ?? launchCities[0]?.city_id`); screenshots 70-business-my-business.png and 71-busines` |
| H   | An owner is given no reason to open the app on Tuesday, and no return is even recorded        | retention                | M      | confirmed   | `src/app/(tabs)/my-business.tsx (Your rating section, rating.average null until 5 raters); grep analytics.capture across src/ - business_registered, bu` |
| H   | Fixing a typo in your name deletes your verification and takes you off the map                | trust-safety             | M      | confirmed   | `supabase/migrations/20260827120000_business_listing.sql:484-507 (business_rename_resets nulls verified_at and drops state to 'unconfirmed' on ANY chan` |
| H   | Nothing in the business flow says what an owner gets, or that it is free                      | conversion               | M      | confirmed   | `screenshot 40-business-email-copy.png; screenshot 08-account-kind-business.png; grep for "free" across src/ returns only sign-up-gate.tsx:56 (traveler` |
| H   | Push is offered exactly once, ever, and no notification setting exists anywhere               | retention                | S      | confirmed   | `src/features/notifications/primer-store.ts:11,44-46,62-68 (KEY, alreadyOffered, "when the offer has been made once already"); src/app/(tabs)/my-busine` |
| H   | Signup's clean steps hand off into the middle of a 1,430-line settings form                   | flow                     | L      | confirmed   | `screenshot 49-business-photo-added.png; src/app/business-signup.tsx:617-620,653-656,687-690,723-726 (all four push /business-edit with a section param` |
| H   | The location picker draws a red pin, the one colour §7 bans                                   | visual                   | S      | confirmed   | `screenshot 46-business-confirm.png (and 44, 45); src/features/pins/location-picker.tsx:77-85 - `<Marker>` with no pinColor, so react-native-maps rende` |
| M   | "Report this place" ships the banned word to travelers on every business page                 | copy                     | S      | —           | `src/app/place/[id].tsx:528 (alert title), 534 and 631 (button label)`                                                                                   |
| M   | A hostel has no way to tell anyone it is on Samewhere                                         | discoverability          | M      | —           | `grep for Share across src/app/place/[id].tsx, src/app/(tabs)/my-business.tsx and src/features/business/ returns nothing; src/features/groups/invite-qr` |
| M   | A post cannot carry a photo, though the column exists and the traveler page renders it        | flow                     | M      | —           | `supabase/migrations/20260827110000_business_content.sql:316 (`photo_path text`); src/app/place/[id].tsx:116-118 (PostCard renders post.photo_path); sr` |
| M   | A post has no default shape and cannot be edited or repeated                                  | flow                     | M      | —           | `src/app/business-post.tsx:184,222-231 (shape starts null, `ready` requires it, note reads "Say how long it stays up."); src/app/(tabs)/my-business.tsx` |
| M   | A traveler cannot say "I'm going" from a business page, and pins never link to a business     | flow                     | L      | —           | `supabase/migrations/20260816210000_map_pins.sql:42-59 (pins carry venue_name as free text; no business_id column); src/app/place/[id].tsx:560-635 (act` |
| M   | An owner has no reply tools for the inbox the app exists to fill                              | flow                     | M      | —           | `src/app/message-place.tsx (traveler composer, free text, lands straight in a chat with no accept); src/app/room/[id].tsx and src/app/(tabs)/chat.tsx:7` |
| M   | Four cities, no explanation, and no path for a business anywhere else                         | empty-state              | S      | —           | `screenshot 42-business-where-empty.png; src/app/business-signup.tsx:355-379 (chips from useLaunchCities, Continue blocked until one is picked)`         |
| M   | One edit screen, two save models: photos and links commit instantly, everything else does not | consistency              | M      | —           | `src/app/business-edit.tsx:1001-1007 (close() warns "Drop your changes? You'll lose what you just typed"), vs BusinessPhotos (line 494) and BusinessLin` |
| M   | The photo, description, hours and links steps are ninety percent empty black                  | visual                   | M      | —           | `screenshot 48-business-photos.png; screenshot 50-business-photo-counted.png; src/app/business-signup.tsx:621-632 (the ghost button renders only when p` |
| L   | A business with no hours silently omits the question a traveler came to answer                | empty-state              | S      | —           | `src/app/place/[id].tsx:433 (`hours.length > 0 // place.hours_note ? <Hours/> : null`); src/app/business-signup.tsx:697-700 ("No hours is better than w` |
| L   | The business account page and the My business tab are two doors to the same room              | information-architecture | S      | —           | `screenshots 73-business-account.png and 74-business-back-on-my-business.png (identical); src/app/profile-me.tsx:113-210 (BusinessAccount: title, "Ever` |
| L   | The first business screen is headlined with a traveler question and a paragraph of admin      | copy                     | S      | —           | `screenshot 40-business-email-copy.png; screenshot 08-account-kind-business.png`                                                                         |
| L   | The owner's first day says "0 people here" in one place and "Nobody in yet" in another        | copy                     | S      | —           | `screenshot 72-business-chat.png; src/app/(tabs)/chat.tsx:316-317 (`${countOf(chat.member_count, 'person', 'people')} here`); src/app/(tabs)/my-busines` |

### Chat tab, message thread, groups, pin plans and business rooms

|     | Finding                                                                                                                         | Cat                      | Effort | Verified  | Evidence                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | The long-press menu does not dim: header, composer, date separator and a ghost of the message all read through it               | visual                   | S      | confirmed | `Screenshot 25-reaction-menu.png (opened); src/features/chat/message-thread.tsx:107-152 (MENU_SCRIM/MENU_GLASS_OVER_SCRIM and their comments), :676-694` |
| H   | "Rooms near you" is not near you, and it says the one thing the app promises never to know                                      | copy                     | S      | confirmed | `src/app/(tabs)/chat.tsx:477-479 (the literal string "Rooms near you"); chat.tsx:~800 (`const cityId = launchCities[0]?.city_id ?? null`); src/features` |
| H   | A hello you sent can never be withdrawn and never expires, so the inbox fills with permanent "Sent" rows                        | flow                     | M      | confirmed | `src/app/(tabs)/chat.tsx:217-270 (SentHelloRow, trailing label is the fixed word "Sent"); chat.tsx:~840 (`waitingOnThem = sentRequests.filter(r => r.st` |
| H   | A private crew, a pin plan open to strangers and a public hostel room draw the same house icon and never say who can read them  | trust-safety             | S      | confirmed | `Screenshots 27a-chat-list-with-a-row.png and 21-chat-groups.png (all three rows identical); src/app/(tabs)/chat.tsx:328-341 (`isRoom ? <roomBadge hous` |
| H   | No reply or quote anywhere, which makes a group room with three people talking unreadable                                       | flow                     | L      | confirmed | `grep for `reply_to`/`replyTo`/`quoted` across src/ and supabase/migrations returns hits only in support tickets and profile prompts, never in chats, m` |
| H   | Nothing in a message can be copied, selected or tapped: no Copy action, no selectable text, no link detection                   | flow                     | S      | confirmed | `src/features/chat/message-thread.tsx:610-620 (the entire actions array is Pin/Unsend/Report); message-thread.tsx:320-325 (message body rendered as a p` |
| H   | Opening a thread with unread messages drops you at the newest one with no divider and no way back to where you left off         | flow                     | M      | confirmed | `src/features/chat/message-thread.tsx:895-1035 (renderItem emits only separators and author lines, no unread marker); src/features/chat/use-mark-read.t` |
| H   | The Send button expresses disabled with opacity 0.4, the exact trap this repo has already documented and paid for               | accessibility            | S      | confirmed | `src/features/chat/composer.tsx:143-146 (`{ backgroundColor: theme.accentDeep, opacity: canSend ? 1 : 0.4 }`); .claude/skills/traps/SKILL.md §"opacity ` |
| M   | "Add someone" puts a person into a group with strangers instantly, with no consent step and no way to refuse                    | trust-safety             | M      | —         | `Screenshot 27c-add-people.png ("Anyone you have chatted with, one to one or in a group. They join straight away."); src/app/add-people/[chatId].tsx; s` |
| M   | "Sent" is rendered in the caption role, an 11pt semibold letterspaced label, so the status shouts louder than the message       | visual                   | S      | —         | `src/constants/theme.ts:152 (`caption: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.4 }`); src/features/chat/message-thread.tsx:` |
| M   | A brand-new group is an empty room with no invite prompt and no record that you created it                                      | empty-state              | S      | —         | `Screenshot 23-group-created.png ("Nobody has said anything yet. / Go first. One line is plenty." alone at the bottom of an otherwise empty screen); sr` |
| M   | A one-to-one thread stops at 100 messages with no way to reach anything older                                                   | flow                     | M      | —         | `src/features/chat/api.ts:7 (`const MESSAGE_PAGE = 100`) and :13-16 (`.order('created_at', {ascending:false}).limit(MESSAGE_PAGE)`); src/features/chat/` |
| M   | A pin plan's date is invisible on its row the moment anybody writes in it                                                       | information-architecture | M      | —         | `src/app/(tabs)/chat.tsx:305-320 (`preview = last_message ?? first_message ?? (member count + ' · you leave ' + date)`); supabase/migrations/2026082912` |
| M   | Every thread wears a two-row header: an empty native nav bar carrying only the back chevron, then the app's own title band      | visual                   | M      | —         | `Screenshots 24-group-message.png and 23-group-created.png (back chevron alone on the top row, "Maestro crew" / "1 person here" on a second row below i` |
| M   | Incoming hellos render as unbounded full-size accept cards at the top of the inbox, with no timestamp                           | information-architecture | M      | —         | `src/app/(tabs)/chat.tsx:121-215 (RequestCard: avatar row, full first_message, report link, Decline/Accept buttons, ~200pt tall); chat.tsx:966-980 (`re` |
| M   | No search in the inbox or in a thread, though the Add someone modal one screen away has one                                     | discoverability          | M      | —         | `Screenshot 27c-add-people.png shows a "Search by name" field; src/app/(tabs)/chat.tsx contains no TextInput at all; src/features/chat/message-thread.t` |
| M   | The Archive swipe action is painted in danger red for an action the app describes as "still readable"                           | visual                   | S      | —         | `src/app/(tabs)/chat.tsx:645-651 (`<SwipeAction label="Archive" tint={theme.danger} />`); src/constants/theme.ts:70 (`danger: '#FF6B6B'`); chat.tsx:111` |
| M   | The Archived screen still uses the floating-card layout the inbox was deliberately rebuilt away from                            | consistency              | S      | —         | `src/app/archived-chats.tsx:29-70 (`ThemedView type="backgroundElement"` rows with padding, Radius.lg and a 12pt gap); compare src/app/(tabs)/chat.tsx:` |
| M   | The group photo somebody uploads when starting a group is never shown in the inbox or the thread                                | flow                     | S      | —         | `src/app/new-group.tsx:118-130 ("Group photo" picker in the creation form) and :63-76 (uploadGroupPhoto, stored as photoPath); src/app/group/[id].tsx:2` |
| M   | The reaction chip hangs below the bubble on the opposite side from "Sent", so the two collide into a meaningless two-column row | visual                   | S      | —         | `Screenshot 26-reacted.png (heart chip bottom-left of the bubble, "Sent" bottom-right, on the same line); src/features/chat/message-thread.tsx:1155-116` |
| L   | A visitor reading a public business room cannot report a message, because canReact gates reporting too                          | trust-safety             | S      | —         | `src/app/room/[id].tsx:340 (`canReact={isMember && !closed}`); src/features/chat/message-thread.tsx:990-996 (`reactable = canReact && ...`is the sole`   |
| L   | The business inbox stamps a time on a room with nothing in it, so "0 people here" is dated 11:01 PM                             | empty-state              | S      | —         | `Screenshot 72-business-chat.png ("Maestro Cafe / 0 people here" with "11:01 PM" on the right); src/app/(tabs)/chat.tsx:295 (`const stamp = rowTimestam` |
| L   | The room moderator's menu replaces Report with Remove, leaving no way to escalate a message they had to delete                  | trust-safety             | S      | —         | `src/app/room/[id].tsx:413 (`reportLabel={isModerator ? 'Remove' : 'Report'}`) and :414-430 (the moderator branch only calls removeMessage); src/featur` |

### Empty, loading, error and offline states across all routes, and the dead-city problem

|     | Finding                                                                                                                                 | Cat                      | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Tapping a pin can open a permanently blank black screen with no spinner, no error and no retry                                          | error-state              | S      | confirmed   | `src/app/profile/[userId].tsx:56-58 — `if (!profile) { return <ThemedView style={styles.root} />; }`. The file imports no LoadError and no Skeleton; co` |
| C   | The heatmap, the product's stated differentiator, renders in one launch city and has never appeared in a screenshot                     | empty-state              | L      | confirmed   | `supabase/migrations/20260823010000_keep_the_map_alive.sql:66-96 (heat_cells, 0.005-degree cells, having count >= v_k); supabase/migrations/20260816210` |
| H   | A business's live post only brightens a marker ring, so "what travelers are doing tonight" is undiscoverable without tapping every chip | discoverability          | L      | confirmed   | `src/features/business/business-marker.tsx:82 (\"The only difference a live post makes\" - the ring) and :181-186; src/lib/database.types.ts:256 (\"Ear` |
| H   | Archived chats tells a user with a full archive that they have nothing archived whenever the fetch fails                                | error-state              | S      | confirmed   | `src/app/archived-chats.tsx:17 `const { data: chats = [] } = useMyChats(true);`and :67-69, which renders \"Nothing archived.\" purely on`chats.length`   |
| H   | The Groups empty state points at content directly below it that is not rendered                                                         | copy                     | S      | confirmed   | `src/app/(tabs)/chat.tsx:1080-1082 — body copy \"Join an open chat below, or start your own.\" Then src/app/(tabs)/chat.tsx:500-503, RoomDiscovery: `co` |
| H   | The app has no concept of being offline: no NetInfo, no reconnect refetch, no connection banner                                         | error-state              | M      | confirmed   | ``grep -rn netinfo package.json src/` returns nothing. src/lib/query-client.ts:31-38 sets staleTime and retry: 2 only; onlineManager is never wired. Re` |
| H   | The map camera is a fixed 0.09-degree box on the city centroid, so a thin city looks abandoned by construction                          | empty-state              | M      | confirmed   | `src/features/pins/map-screen.tsx:891-896 (initialRegion latitudeDelta 0.09) and :819-825 (selectCity animates to the same fixed 0.09). No fitToCoordin` |
| H   | The same Chat screen anchors its empty state two different ways depending on who is looking                                             | consistency              | M      | partly-true | `Screenshot 04-chat-guest.png (empty block vertically centred, ~600pt of dead space above it, sign-up card floating mid-screen) versus 20-chat-individu` |
| M   | Choosing a day filter silently destroys the heat layer, punishing the most engaged users                                                | flow                     | S      | —           | `src/features/pins/filters.ts:109-111 `heatDay` returns a single ISO date for today/tomorrow/later and null for 'any'; heat_cells (keep_the_map_alive.s` |
| M   | No screen announces its own state change to VoiceOver, so a blind user cannot tell loading from empty from failed                       | accessibility            | S      | —           | ``grep -rn 'accessibilityLiveRegion/AccessibilityInfo.announce/accessibilityRole="alert"' --include=*.tsx src/` returns zero hits. Skeleton is correctl` |
| M   | Nothing happens after "Be the first" - the user who drops the only pin in a city is left alone with it                                  | retention                | M      | —           | `src/features/pins/map-screen.tsx:1297-1329, the empty banner: \"No pins in Lisbon yet\" / \"Be the first.\" and an onPress into enterPlaceMode. After ` |
| M   | Pull-to-refresh exists on one screen out of forty-four, so a failed load has no gesture-level recovery                                  | error-state              | M      | —           | ``grep -rn RefreshControl --include=*.tsx src/` returns exactly two lines, both in src/app/(tabs)/chat.tsx (:9 import, :893 use). Travelers, Map, my-bu` |
| M   | The business's own room advertises "0 people here" with nothing the owner can do about it                                               | empty-state              | S      | —           | `Screenshot 72-business-chat.png: \"Your room / Maestro Cafe / 0 people here\", then a separate \"No messages yet\" card below it. src/app/(tabs)/chat.` |
| M   | The first traveler a guest ever sees has "[demo]" glued to the end of their bio                                                         | trust-safety             | M      | —           | `Screenshot 03-travelers-guest.png: \"...Looking for people to explore with. [demo]\" on the very first Travelers card. scripts/demo-travelers.json:3-5` |
| M   | The four city chips carry no liveness, so a thin city gives no reason to look at a busy one                                             | empty-state              | M      | —           | `Screenshots 02-map-tab.png, 05c-map-filtered.png, 70-business-my-business.png: the chips read Bangkok / Denpasar / Lisbon / Mexico City with nothing e` |
| M   | The heat query has no loading or error path, so a failed heatmap and a quiet city are indistinguishable                                 | error-state              | S      | —           | `src/features/pins/map-screen.tsx:703 `const { data: heat = [] } = useMapHeat(activeCityId, filterISO);` - no isError, no isLoading, and heat.length is` |
| M   | The primary "Say hi" action sits in the translucent half of its own gradient, so the profile behind it ghosts through                   | visual                   | S      | —           | `Screenshot 17-travelers-signed-in.png: \"...ico\" and \"Sep 25 - Oct 28\" from the second trip card are visible at roughly half opacity directly behin` |
| L   | My business reads as five rows of "Nothing yet" to an owner who has just signed up                                                      | empty-state              | S      | —           | `src/app/(tabs)/my-business.tsx:594-626 - address \"No address yet\", hours \"Nothing yet\", links \"Nothing yet\", description \"Nothing yet\", photos` |
| L   | The map's one-shot hint occupies the only free banner slot, crowding out the states that matter more                                    | information-architecture | S      | —           | `Screenshots 02-map-tab.png, 28-map-with-places.png and 05c-map-filtered.png all show \"Tap a business to see what's on\" pinned above Drop a pin. src/` |

### Every user-facing string (cross-cutting copy audit)

|     | Finding                                                                                                                                        | Cat          | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | "Rooms near you" lists whatever city is first in the launch list, not a city near anyone                                                       | copy         | S      | confirmed   | `src/app/(tabs)/chat.tsx:508 (heading) and chat.tsx:761 (`const cityId = launchCities[0]?.city_id ?? null;`), passed to RoomDiscovery at chat.tsx:862 a` |
| C   | Raw Postgres exception text reaches users in a "Could not save" alert, including the banned words "unmatch" and "request"                      | error-state  | M      | confirmed   | `src/lib/query-client.ts:22-27; src/lib/failure-message.ts:36 (`return typeof raw === 'string' && raw.trim() ? raw : ...`); supabase/migrations/2026081` |
| C   | Thirteen of the sixteen curated day-one map pins contain an em dash, and so does the moderation push                                           | copy         | S      | partly-true | `supabase/migrations/20260823020000_curated_pins_stay_current.sql:34-57 (16 em dashes); supabase/migrations/20260820001000_copy_pass.sql:190; screensho` |
| H   | "Guest" means two unrelated things, and the collision lands in a hostel room                                                                   | consistency  | S      | confirmed   | `src/app/profile-me.tsx:65 ("{name}, you are in guest mode" / "Browsing as a guest"); src/app/(tabs)/chat.tsx:515 (`${countOf(room.member_count, 'guest` |
| H   | "Here", "here now" and "nearby" make presence claims in an app whose promise is that it does not know where you are                            | trust-safety | S      | confirmed   | `src/app/group/[id].tsx:149 (`{member.departure_date ? \`Here until ${date}\` : 'Here'}`); src/features/pins/map-screen.tsx:1459 and :1470 ("Glowing sp` |
| H   | "Reply to their travel plans" asks a traveler to reply to someone who has said nothing to them                                                 | copy         | S      | confirmed   | `src/features/profile/profile-view.tsx:111-113, 159, 330, 367, 802; src/app/compose-request.tsx:202 ("What are you replying to?"); screenshot 17-travel` |
| H   | The app's core action has four names: "Say hi", "a hello", "Reply to...", and "Say you're in"                                                  | consistency  | S      | partly-true | `src/features/pins/map-screen.tsx:435 ("Say hi"); src/app/compose-request.tsx:255 ("3 hellos left today"); src/features/pins/pin-form-sheet.tsx:362,368` |
| H   | The button says "House rules", the screen it opens says "Community guidelines", and the errors say a third thing                               | consistency  | S      | confirmed   | `src/app/profile-me.tsx:91 ("House rules") and :348 ("House rules and help"); src/app/guidelines.tsx:23 ("Community guidelines"); src/app/(tabs)/my-bus` |
| H   | The guest report action on a business page uses the banned word "place"                                                                        | copy         | S      | partly-true | `src/app/place/[id].tsx:528 (`Alert.alert('Report this place', ...)`) and place/[id].tsx:531-534 (the visible link text "Report this place"), against s` |
| H   | The pin form is headed "Location" and footed "Never shows where you are"                                                                       | copy         | S      | partly-true | `src/features/pins/pin-form-sheet.tsx:170 (section label "Location") and :347 ("Gone in 72h max. Never shows where you are."); src/app/drop-pin.tsx:75 ` |
| H   | The sign-up gate's headline is a privacy warning where the invitation should be                                                                | conversion   | S      | confirmed   | `src/features/pins/map-screen.tsx:1537-1541 (`reason={gate === 'join' ? 'Joining puts you in the chat, with a name' : 'Pins come with your name on them` |
| H   | Three different calls to action for making an account, two of them in the same file                                                            | conversion   | S      | confirmed   | `src/components/ui/sign-up-gate.tsx:20 (default `cta = 'Create an account'`); src/features/pins/map-screen.tsx:1543 ("Make a profile") vs map-screen.ts` |
| M   | "Drop it" is the confirm button on a form where the same verb means abandon                                                                    | copy         | S      | —           | `src/features/pins/pin-form-sheet.tsx:341 (`label="Drop it"`); screenshot 14-pin-form.png; against src/app/business-edit.tsx:1007 ("Drop them" = discar` |
| M   | "Have an invite? Paste the code somebody sent you" opens an alert that tells you to open a link instead                                        | flow         | S      | —           | `src/app/(tabs)/chat.tsx:1099-1100 (card title "Have an invite?", detail "Paste the code somebody sent you.") vs chat.tsx:725 (`Alert.prompt('Invite co` |
| M   | Ban and suspension notifications close the door without saying where the handle is                                                             | error-state  | S      | —           | `supabase/migrations/20260820001000_copy_pass.sql:49-51 ('Account banned' / 'Your account has been closed for repeated guideline breaches.') and :66-68` |
| M   | Developer setup instructions are shippable copy on five tabs                                                                                   | error-state  | S      | —           | `src/components/placeholder-screen.tsx:15-21 and :50-53 (renders `phase`in a`type="code"` badge); src/app/(tabs)/travelers.tsx:508-510, chat.tsx:799-`   |
| M   | Group settings calls one object a chat and a group in the same paragraph, and the leave confirmation drops the fact the screen just taught you | consistency  | S      | —           | `src/app/group/[id].tsx:603 ("Leave this chat") and :607-609 ("You run this one, so somebody else takes over when you go." / "You stop getting messages` |
| M   | Group settings explains its controls by screen position, and the control it describes is not on screen                                         | copy         | S      | —           | `src/app/group/[id].tsx:565-575 area, rendered text "Tap a name to open their profile. The button on the right of a row lets somebody post, or takes th` |
| M   | The accept push says "Say hi" to the person who already said hi, and renames an event the app already named                                    | copy         | S      | —           | `supabase/migrations/20260820001000_copy_pass.sql:304-305 (title 'Chat open', body `coalesce(v_name,'A traveler') // ' replied. Say hi.'`) against src/` |
| M   | Two vocabularies for discarding edits, and eight different words for "cancel"                                                                  | consistency  | S      | —           | `src/app/edit-profile.tsx:114-116 ("Discard your changes?" / "Keep editing" / "Discard") vs src/app/business-edit.tsx:1005-1007 ("Drop your changes?" /` |
| M   | Verification says "once it clears" and gives no timeframe, for a flow the brief says must feel instant                                         | copy         | S      | —           | `src/app/verification.tsx:78 (`Alert.alert('Selfie submitted', 'Your badge shows up once it clears.')`); src/app/verification.tsx:117 ("Selfie in revie` |
| L   | "A profile adds pins, trips and meeting people" breaks its own list                                                                            | copy         | S      | —           | `src/app/profile-me.tsx:67-69 ("Chats only for now. A profile adds pins, trips and meeting people, and your chats come with you.")`                      |
| L   | "Getting your business." is a loading note that reads as an idiom                                                                              | copy         | S      | —           | `src/app/business-storefront.tsx:176-177 (`note={business == null && !settled ? 'Getting your business.' : ...}`)`                                       |
| L   | A curly apostrophe in one sentence of the house rules, straight quotes everywhere else                                                         | visual       | S      | —           | `src/constants/policies.ts:24 ("Sharing someone else's private information." with U+2019) against policies.ts:17 ("you'd", "That's") and every other st` |
| L   | Two labels for retrying, one of them a developer's word                                                                                        | consistency  | S      | —           | `src/components/ui/load-error.tsx:38 (`label="Try again"`) vs src/app/_layout.tsx:60 (`label="Retry"`); src/app/(tabs)/my-business.tsx:381 ("Try again"` |

### First run: intro tour, guest mode, the gates, signup and traveler onboarding

|     | Finding                                                                                                                | Cat                      | Effort | Verified         | Evidence                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Signup throws away everything a guest was doing, except a group invite                                                 | conversion               | M      | confirmed        | `src/features/pins/map-screen.tsx:1640-1649; src/app/(tabs)/travelers.tsx:235-243; src/features/pins/map-screen.tsx:687-688; src/features/auth/store.ts` |
| C   | Step 3 hides the Gender field behind the keyboard, so the women-only filter's data ships as 'unspecified'              | flow                     | S      | partly-true      | `Screenshot 51-signup-who.png; src/app/onboarding/index.tsx:210-236; src/app/onboarding/index.tsx:128; src/features/signup/step-shell.tsx:117-136; supa` |
| C   | The one mandatory step has one input path, no camera, and no handling when photo permission is refused                 | error-state              | M      | partly-true      | `Screenshot 54-signup-photo-gate.png; src/components/photo-grid.tsx:191-199; grep across src finds no requestMediaLibraryPermissionsAsync and no launch` |
| H   | 'Step back to change anything' costs up to ten Back taps, and the component already supports the jump                  | flow                     | S      | confirmed        | `src/app/onboarding/index.tsx:566-620 (owner={false} and its comment); src/features/profile/profile-view.tsx:122-128, 186-192, 204, 299-305, 384-391`    |
| H   | Named guest mode is unreachable from a cold first run, so the open business chats stay dark for visitors               | discoverability          | M      | partly-true      | `grep for '/guest-name' finds pushes only at src/app/join-group/[token].tsx:195 and src/app/profile-me.tsx:78 (which requires already being a guest); s` |
| H   | Six consecutive self-description screens sit between the photo and the app                                             | flow                     | L      | founder-decision | `src/app/onboarding/index.tsx steps 6-11; src/features/signup/steps.ts:24; screenshot 54-signup-photo-gate.png`                                          |
| H   | Step 12 shows a picker whose every option the server refuses for the account looking at it                             | flow                     | S      | founder-decision | `src/app/onboarding/index.tsx:526-560 and its own comment ('Everything but Everyone is inert here'); src/features/profile/audience.ts AUDIENCE_NEEDS_BA` |
| H   | The guest Chat tab is one grey sentence floating in a void, under a Groups toggle that shows nothing                   | empty-state              | M      | partly-true      | `Screenshot 04-chat-guest.png; src/app/(tabs)/chat.tsx:871-879; src/app/(tabs)/chat.tsx:1135-1139`                                                       |
| H   | The map opens on Bangkok for everybody, on every launch, forever                                                       | flow                     | S      | confirmed        | `src/features/pins/map-screen.tsx:687-689; grep of AsyncStorage across src shows no city key; screenshots 02-map-tab.png, 06-guest-gate.png, 10-auth-ga` |
| M   | 'What is your email?' is answered by a white Apple button that makes the question moot                                 | information-architecture | S      | —                | `Screenshots 50-signup-email.png, 07-account-kind.png, 08-account-kind-business.png; src/app/(auth)/join.tsx:150-195`                                    |
| M   | A new traveler becomes discoverable at step 13 and is never offered notifications, so the first hello lands in silence | retention                | S      | —                | `src/features/notifications/primer-store.ts PrimerReason = 'hello-sent' / 'pin-posted'; grep shows .ask( called only at src/features/matching/hooks.ts:` |
| M   | The 13-step progress bar is invisible to VoiceOver and carries no number for anyone else                               | accessibility            | S      | —                | `src/features/signup/step-shell.tsx:100-104; grep for accessibilityValue across src returns only select-field.tsx, hours-slider.tsx, business-edit.tsx,` |
| M   | The account decision is bolted onto the third feature explainer, so four choices arrive under a heading about chat     | information-architecture | S      | —                | `Screenshots 00c-tour-choice.png, 01-cold-start.png; src/features/intro/intro-tour.tsx (choice = index === PAGE_COUNT - 1)`                              |
| M   | The consent line at account creation links the guidelines but no privacy policy                                        | trust-safety             | S      | —                | `src/features/auth/consent-note.tsx (guidelines link only); grep for 'privacy policy' and 'terms of' across src returns nothing`                         |
| M   | The guest gate sheet fills more than half the screen for a three-line card                                             | visual                   | S      | —                | `Screenshots 06-guest-gate.png, 10-auth-gate.png; src/features/pins/map-screen.tsx:1533-1550`                                                            |
| M   | The one traveler a guest is shown has '[demo]' printed in their bio                                                    | trust-safety             | S      | —                | `Screenshot 03-travelers-guest.png; .github/workflows/demo-travelers.yml:7 ('These are not real people: AI-generated portraits, [demo] marked bios')`    |
| M   | The photo tile's label floats at the bottom-right of a tall empty box and states the requirement twice                 | visual                   | S      | —                | `Screenshot 54-signup-photo-gate.png; src/components/photo-grid.tsx:304-313; src/app/onboarding/index.tsx:296`                                           |
| M   | The tour explains the product without ever showing it: three grey glyphs and the largest dead regions in the app       | conversion               | M      | —                | `Screenshots 00b-tour-travelers.png, 00c-tour-choice.png, 00-welcome.png; src/features/intro/intro-tour.tsx PAGES (three SFSymbols) and styles.page/ico` |
| L   | 'I'm travelling' is the app's only British spelling, on the screen that names the two account kinds                    | consistency              | S      | —                | `src/features/auth/account-kind.tsx:47; screenshots 07-account-kind.png and 08-account-kind-business.png; grep confirms every other user-facing instanc` |
| L   | A business is told 'profile' on one screen and 'listing' on the next                                                   | copy                     | S      | —                | `src/app/(auth)/join.tsx step 1 business subtitle; src/app/(auth)/join.tsx step 2 ('That will do. Your listing is next.'); screenshot 08-account-kind-b` |
| L   | The business progress bar reaches 100% one screen before the flow ends, and the last screen has no bar at all          | consistency              | S      | —                | `src/app/business-signup.tsx:59 (TOTAL_STEPS = 12) and :784-786 (step={12} on 'One last thing'); src/app/business-email.tsx:9 imports StepScreen, not S` |
| L   | The welcome screen puts its whole argument in the bottom third and leaves the top half empty                           | visual                   | M      | —                | `Screenshot 00-welcome.png; src/features/intro/intro-tour.tsx welcomeTop = height/2 + MARK/2 + Space.md`                                                 |

### Map surface, business owner tools, and guest-to-account conversion (reference sweep: maps, local-business tools, delayed registration, direct competitors)

|     | Finding                                                                                       | Cat                      | Effort | Verified         | Evidence                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------- | ------------------------ | ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | The map never frames its own pins, so a city with plans in it opens looking empty             | information-architecture | M      | confirmed        | `02-map-tab.png, 28-map-with-places.png; src/features/pins/map-screen.tsx:891-896 (initialRegion latitudeDelta 0.09 at the city centroid); no fitToCoor`      |
| C   | There is no list on the map, so discovery is hunting orange dots at 10km zoom                 | discoverability          | L      | confirmed        | `src/features/pins/map-screen.tsx: the only FlatList/ScrollView over pins is the per-cluster venueList at line 1595; no city-wide list surface exists. `      |
| H   | "Rooms near you" and "1 guest here now" claim presence the app must never claim               | trust-safety             | S      | confirmed        | `src/app/(tabs)/chat.tsx:508 ("Rooms near you") and :515 (`${countOf(room.member_count, 'guest')} here now`). 27a-chat-list-with-a-row.png shows "Once `      |
| H   | "You're top of their list too" is unverifiable and is see-who-liked-you grammar               | trust-safety             | S      | partly-true      | `src/app/(tabs)/travelers.tsx:366; rendered in 17-travelers-signed-in.png under the "Today in Bangkok" chip`                                                  |
| H   | A pin has a date but no time, so the map cannot answer "what is on tonight"                   | discoverability          | M      | confirmed        | `supabase/migrations/20260816210000_map_pins.sql:51 `intent_date date not null`; src/features/pins/filters.ts DayFilter = 'any'/'today'/'tomorrow'/'lat`      |
| H   | My business shows a hostel owner nothing about whether the listing worked                     | retention                | M      | founder-decision | `src/app/(tabs)/my-business.tsx sections: What's on, Your details, Your chat, Your rating, Your account. The only analytics call is analytics.capture('`      |
| H   | Signup discards the thing the guest was doing, at the highest-intent moment in the app        | conversion               | M      | partly-true      | `grep for returnTo/redirectTo/pendingIntent across src/app and src/features/auth returns only 'samewhere://reset-password' (src/features/auth/api.ts:80`      |
| H   | The business signup map draws Apple's default red pin, which rule 7 bans                      | visual                   | S      | confirmed        | `src/features/pins/location-picker.tsx:79 renders a bare <Marker> with no child and no pinColor, so react-native-maps falls back to MapKit's red balloo`      |
| H   | The safety setting most women open the app for is four greyed rows and a clipped sentence     | accessibility            | S      | partly-true      | `18b-who-can-see-you.png: Verified only, Verified men, Verified women, Verified non-binary all disabled; the closing paragraph is cut mid-sentence by t`      |
| M   | "Check the marker is on your door" is asked over a map showing seven kilometres of Lisbon     | flow                     | S      | —                | `45-business-where-final.png: a 220pt map spanning from Parque Florestal de Monsanto to Castelo de São Jorge, with the instruction "Type your address, `      |
| M   | A plan's chat room loses the plan the moment you enter it                                     | information-architecture | M      | —                | `24-group-message.png: header reads "Maestro crew / 1 person here" over an empty thread. Nothing names the venue, the day, the plan text or the expiry `      |
| M   | A two-pin cluster draws two identical glyphs plus a badge reading "2"                         | visual                   | S      | —                | `02-map-tab.png, 05c-map-filtered.png, 28-map-with-places.png: bar, camera, restaurant and hike clusters all render as two identical white-on-amber gly`      |
| M   | Applying a filter silently removes pins and never says how many are left                      | flow                     | S      | —                | `05b-map-filters-on.png then 05c-map-filtered.png: the badge becomes "Filters · 1", markers disappear, the camera does not move, and no count appears a`      |
| M   | Clustering is venue-only at every zoom, so markers collide into an unreadable smear           | visual                   | M      | —                | `src/features/pins/cluster.ts CLUSTER_RADIUS_M = 30, applied identically at all zooms; 28-map-with-places.png shows the camera pair, the own-pin and th`      |
| M   | Every group in the Chat tab wears the same house icon                                         | visual                   | S      | —                | `27a-chat-list-with-a-row.png: "Maestro crew", "Rooftop hello from Maestro" and "Once Again Hostel" all render an identical blue house glyph in an iden`      |
| M   | Pan outside the four launch cities and the map has nothing to say                             | empty-state              | M      | —                | `02-map-tab.png: the city rail is a fixed row of Bangkok, Denpasar, Lisbon, Mexico City with no search field in browse mode (search exists only in plac`      |
| M   | Pin drop mode never says where you are dropping, so a plan lands on a bridge                  | error-state              | M      | —                | `13-place-after-pan.png: a large crosshair marker sitting mid-river between Wat Arun and Wat Kanlaya with a full-width "Pin here" and no label; 16-pin-`      |
| M   | The Travelers action dock is transparent, so the next card's text reads through the buttons   | visual                   | S      | —                | `17-travelers-signed-in.png: "...ico" and "Sep 25 – Oct 28" from the next trip card are legible underneath and around the circular next button and the `      |
| M   | The filter sheet uses colour emoji for the same eight categories the map draws as glyphs      | consistency              | S      | —                | `05a-map-filters.png: 🍸 Bar, 🍜 Food, 🪩 Club, 🖼️ Museum, 🏛️ Sights, ⛱️ Beach, 🥾 Hike, 📍 Other. The map draws the same categories as monochrome symbols o` |
| M   | The heatmap, the stated differentiator, is undiscoverable when it happens not to be on screen | discoverability          | S      | —                | `No heat renders in any of the 94 screenshots. src/features/pins/heat-legend.ts only shows its one-shot chip when hasHeat is true; src/features/pins/ma`      |
| M   | The pin card truncates the address to one line, the exact bug already fixed in the form       | consistency              | S      | —                | `16-pin-posted.png shows "Somdet Phra Pokklao Bridge, Wang Burapha Phi…". src/features/pins/pin-form-sheet.tsx:184 uses numberOfLines={2} with a commen`      |
| M   | Three competing ways to start the same message on one traveler screen                         | flow                     | S      | —                | `17-travelers-signed-in.png: a floating chat-bubble button over the photo, a "Reply" button beside the Travel plans heading, and "Say hi" in the bottom`      |
| L   | Seeded traveler bios carry a literal "[demo]" marker into the guest's first impression        | copy                     | S      | —                | `03-travelers-guest.png: Dev's bio ends "...Looking for people to explore with. [demo]". Grepping src/ and supabase/ for "[demo]" returns nothing, so t`      |
| L   | Sheet content is clipped mid-glyph under the grab handle with no fade or header               | visual                   | S      | —                | `15-pin-form-filled.png: with the keyboard up, the location card's first line renders as "Bridge, Wang Burapha Ph…" cut horizontally through the letter`      |

### Motion, gesture, haptics and perceived performance (cross-cutting)

|     | Finding                                                                                        | Cat             | Effort | Verified    | Evidence                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------- | --------------- | ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Reduce Motion is honoured nowhere in the app, including two infinite loops                     | accessibility   | M      | confirmed   | `grep -rn 'ReduceMotion/useReducedMotion/AccessibilityInfo' src/ returns zero hits; src/components/ui/skeleton.tsx:47; src/features/intro/intro-tour.ts`  |
| H   | Composer Send has no haptic, no press feedback, and fades to 0.4 for disabled                  | consistency     | S      | confirmed   | `src/features/chat/composer.tsx:138 (plain Pressable) and :147 `{ backgroundColor: theme.accentDeep, opacity: canSend ? 1 : 0.4 }`; composer.tsx does n`  |
| H   | Next on Travelers starts a signed-URL round trip after the card has already appeared           | performance     | M      | partly-true | `src/app/(tabs)/travelers.tsx:567 `const current = queue[0]`and :699`entering={FadeIn.duration(200)} key={current.userId}`; src/features/profile/hook`    |
| H   | Tapping a tapback does nothing until two network hops finish                                   | performance     | S      | confirmed   | `src/features/rooms/hooks.ts:165-176 (useToggleReaction has only onSuccess invalidate); src/features/rooms/hooks.ts:157 (useReactions staleTime: 0); sc`  |
| H   | The long-press menu shows the message twice: the lifted copy over the un-hidden original       | visual          | S      | confirmed   | `screenshot 25-reaction-menu.png (the words 'First one in' are legible twice, offset by roughly 18pt); src/features/chat/message-thread.tsx:750 renders`  |
| M   | A thread stops at 100 messages with no way to load older ones                                  | flow            | M      | —           | `src/features/chat/api.ts:7 `const MESSAGE_PAGE = 100`and :16`.limit(MESSAGE_PAGE)`; the FlatList at src/features/chat/message-thread.tsx:895 sets no`    |
| M   | A touch-down haptic fires on rows inside scrollers, so scrolling buzzes                        | consistency     | S      | —           | `src/components/ui/pressable-scale.tsx:12 documents "'none' for rows inside scrollers" and :51 fires in onPressIn; violated at src/app/(tabs)/travelers`  |
| M   | Accepting a hello, joining a plan and taking down a pin all wait for the server                | performance     | M      | —           | `src/features/matching/hooks.ts:171-190 (useRespondToRequest), src/features/pins/hooks.ts:132-146 (useJoinPinChat), src/features/pins/hooks.ts:157-168 `  |
| M   | Content is legible directly behind the Say hi bar on Travelers                                 | visual          | M      | —           | `screenshot 17-travelers-signed-in.png — a second trip row reading 'ico' and 'Sep 25 to Oct 28' shows through beside and behind the Say hi pill; src/ap`  |
| M   | Every sheet has one height, the drag only goes down, and only the grabber accepts it           | flow            | L      | —           | `src/components/ui/sheet.tsx:188 `drag.value = Math.max(0, event.translationY)`; :259 the GestureDetector wraps only the 24pt grabber strip; src/featur`  |
| M   | Every traveler's trip rows re-stagger, so the shared-dates line lands last and untappable      | flow            | S      | —           | `src/features/profile/profile-view.tsx:450 `entering={FadeInDown.delay(i \* 40).duration(260)}`; src/app/(tabs)/travelers.tsx:699 remounts ProfileView w` |
| M   | Keyboard.dismiss runs on every frame of a map pan in place mode                                | performance     | S      | —           | `src/features/pins/map-screen.tsx:912-921 — onRegionChange calls setLifted(true) and Keyboard.dismiss() unconditionally while mode is 'place'`            |
| M   | Opening a pin card does not move the map, so the pin can end up under its own card             | flow            | S      | —           | `src/features/pins/map-screen.tsx:1636 (the pin card Sheet mounts with no camera change; selectCity at :824 and enterPlaceMode at :852 both animate the`  |
| M   | The chat list renders every conversation eagerly inside a ScrollView                           | performance     | M      | —           | `src/app/(tabs)/chat.tsx:888 ScrollView, with .map() over three arrays at :997, :1013 and :1030; each ChatRowLink mounts an avatar Image and its own si`  |
| M   | The warning haptic is defined for destructive confirmations and used only for a language limit | consistency     | S      | —           | `src/lib/haptics.ts:34 documents warning as "Destructive confirmation (delete, leave) — softer than error"; `grep -rn 'haptics.warning' src/` returns e`  |
| M   | Thirty-eight of thirty-nine remote images snap in with no transition                           | visual          | S      | —           | ``grep -rn 'transition=' src/` returns two hits, src/app/place/[id].tsx:75 and src/features/business/place-sheet.tsx:174; the other 37 Image sites incl`  |
| L   | Only the Chat tab can be pulled to refresh                                                     | discoverability | S      | —           | ``grep -rn RefreshControl src/` returns only src/app/(tabs)/chat.tsx:893; src/app/(tabs)/travelers.tsx:340 is a plain ScrollView`                         |
| L   | The map polls every 60 seconds while you are reading a chat                                    | performance     | S      | —           | `src/features/pins/hooks.ts:36 `refetchInterval: 60_000`on useCityPins and :46`refetchInterval: 120_000` on useHeatCells; src/lib/query-client.ts:41-`    |
| L   | The place-mode pin thuds when the map animates itself, not only when you drag it               | consistency     | S      | —           | `src/features/pins/place-pin-overlay.tsx:33-41 (the mounted ref skips only the first effect run); src/features/pins/map-screen.tsx:912 sets lifted on o`  |
| L   | The segmented thumb slides while the content behind it has already swapped                     | visual          | S      | —           | `src/components/ui/segmented.tsx:88-90 — `offset.value = withTiming(..., { duration: Motion.quick })`followed immediately by`onChange(option.value)`;`    |

### Navigation, information architecture, notifications and re-engagement

|     | Finding                                                                                                                    | Cat                      | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Joining somebody's plan produces no push, no badge and no dot: the hero loop is silent                                     | flow                     | S      | confirmed   | `supabase/migrations/20260829190000_a_business_is_not_a_traveler.sql:133-204 (join_pin_chat: inserts room_members, returns jsonb_build_object('chat_id'` |
| C   | Push notifications open the app and nothing else: no tap routing, no foreground display, no icon badge                     | retention                | M      | confirmed   | `src/features/notifications/push.ts (whole file: only register/permission functions); grep across src/ for addNotificationResponseReceivedListener / se` |
| H   | A business owner's default tab is a map of other people's businesses                                                       | information-architecture | S      | confirmed   | `src/components/app-tabs.tsx:36-42 (NativeTabs.Trigger name="index" is declared first and is therefore the selected tab on launch; nothing varies it by` |
| H   | Abandoning business signup drops a bar owner into traveler onboarding                                                      | flow                     | M      | confirmed   | `src/app/(auth)/join.tsx:110 (router.replace('/business-signup')); src/features/auth/routing.ts:17-42 (owesOnboarding returns onboardedAt == null when ` |
| H   | An invite link on a first launch is swallowed, and the link is a custom scheme with no web fallback                        | discoverability          | M      | partly-true | `src/app/_layout.tsx:236 (IntroTour early-return sits above the <Stack> that is the only place join-group/[token] is registered); src/features/auth/use` |
| H   | No lifecycle notifications exist, in a product whose stated killer is churn between trips                                  | retention                | L      | partly-true | `All 13 cron.schedule entries are janitorial (expire-pins, lift-suspensions, expire-room-members, archive-idle-chats, expire-daily-spotlights, expire-p` |
| H   | The first hello and the pin form are swipe-dismissible modals with no discard guard                                        | error-state              | S      | confirmed   | `src/app/_layout.tsx (compose-request and drop-pin declared with presentation:'modal', default gestureEnabled); grep for dirty/Discard/beforeRemove acr` |
| H   | The push permission is asked once, ever, and there is no way to say yes later                                              | retention                | S      | confirmed   | `src/features/notifications/primer-store.ts:63-96 (markOffered writes 'samewhere.push.primer.v1' before the OS dialog; worthAsking returns false foreve` |
| M   | Chats auto-archive after 14 days with no notice, and the door to them only appears once you are already behind it          | flow                     | S      | —           | `supabase/migrations/20260817200000_establishment_rooms.sql:532 (archive-idle-chats, cron '30 3 * * *', archives any chat with no message for 14 days);` |
| M   | Live push copy still contains an em dash, and so do fifteen seeded map pins                                                | copy                     | S      | —           | `supabase/migrations/20260820001000_copy_pass.sql:186-192 (apply_message_verdict: "Your message wasn't delivered — it came across as explicit. Reword i` |
| M   | No timezone anywhere in the schema, so the first scheduled push will fire at the wrong hour in three of four launch cities | performance              | S      | —           | `supabase/migrations/20260816200000_trips_matching.sql:28-38 (cities: id, name, country_code, country_name, admin, lat, lng, population — no timezone);` |
| M   | Passing a traveler is irreversible until you have exhausted the entire queue                                               | flow                     | S      | —           | `src/app/(tabs)/travelers.tsx:545 (queue filters on !passed.has(candidate.userId)), :706-708 (onNext calls passed.add), :683-684 (the 'See them again' ` |
| M   | The Groups list flattens three objects with different lifespans into one identical row                                     | information-architecture | S      | —           | `screenshot 27a-chat-list-with-a-row.png: 'Maestro crew / First one in', 'Rooftop hello from Maestro / 1 person here' and (under 'Rooms near you') 'Onc` |
| M   | The business account screen is an explainer wearing an account screen's slot                                               | information-architecture | S      | —           | `screenshot 73-business-account.png (and 74, which photographed the same screen): business name, 'Manage your business' primary button, a four-section ` |
| M   | There is no way to see or undo a block                                                                                     | trust-safety             | M      | —           | `src/features/chat/api.ts:143 (blockUser), offered from src/app/profile/[userId].tsx:153, src/app/chat/[id].tsx:144 and src/app/report.tsx:50 ('Block t` |
| M   | profile-me is doing a Settings screen's job without being one, and the avatar is its only door                             | discoverability          | M      | —           | `src/components/ui/avatar-button.tsx:55 (router.push('/profile-me'), accessibilityLabel 'Your profile'/'Your business'), used at src/features/pins/map-` |
| L   | The spotlight subtitle sells a mutual-interest signal the product does not have and should not imply                       | copy                     | S      | —           | `src/app/(tabs)/travelers.tsx:366 ("You're top of their list too."), rendered under the 'Today in Bangkok' chip; screenshot 17-travelers-signed-in.png;` |
| L   | Two list subtitles read as present-tense presence on a product that promises it never shows where anyone is                | copy                     | S      | —           | `screenshot 03-travelers-guest.png ('In Bangkok right now' under the Travelers header); screenshot 27a-chat-list-with-a-row.png ('1 guest here now' und` |
| L   | expo-notifications is installed but not configured in app.json                                                             | consistency              | S      | —           | `package.json:28 (expo-notifications ~57.0.11); app.json:29-60 plugins array lists expo-router, expo-splash-screen, expo-secure-store, expo-apple-authe` |

### Platonic discovery and messaging: the Travelers surface, the Chat tab (1:1, groups, hostel rooms), the first-hello loop, and the thread itself — audited against Hinge, Bumble BFF/Geneva, Timeleft, Meetup, iMessage, WhatsApp, Telegram, Signal and Instagram DMs as they behave in 2026.

|     | Finding                                                                                                            | Cat                      | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | A thread has no unread divider and never opens where you left off                                                  | flow                     | M      | confirmed   | `src/features/chat/unread.ts (whole file — badge counting only); grep for "New messages/firstUnread/scrollToIndex/initialScrollIndex" across src/featur` |
| C   | You cannot reply to a specific message anywhere in the app                                                         | flow                     | L      | confirmed   | `src/features/chat/message-thread.tsx:611-625 builds the long-press action list and it contains exactly three entries: 'Pin to the top', 'Unsend', 'Rep` |
| H   | "You're top of their list too." is reciprocity ceremony, and it is printed unconditionally                         | copy                     | S      | confirmed   | `src/app/(tabs)/travelers.tsx:365-367, inside the `spotlight ? ...`branch opened at line 353.`spotlight`is set at line 701 purely as`current.userId`     |
| H   | Group settings never names the group, and cannot mute, rename or report it                                         | information-architecture | S      | partly-true | `Screenshot 27-group-settings.png: the screen opens on a bare "Invite" label above a QR code, and the group's name appears nowhere on it. src/app/group` |
| H   | Nothing in a group thread records who joined or left                                                               | information-architecture | M      | partly-true | `grep -rniE "system message/joined/left the/was added/event_type" across src/features/chat, src/app/chat, src/app/room and src/app/group returns only v` |
| H   | The guest Travelers screen contradicts itself in an empty city, which is the launch-day state                      | empty-state              | M      | confirmed   | `src/app/(tabs)/travelers.tsx:232-241 — when `featured` is null the screen renders "Nobody in town this week." and immediately below it a SignUpGate wh` |
| H   | The map and the chat never touch: you cannot send a pin into a conversation                                        | flow                     | L      | confirmed   | `src/features/chat/composer.tsx:12 — ComposerDraft is exactly { text, photoUri }; PhotoButton at line 8 is the only attachment affordance. Screenshots ` |
| H   | The same conversation is called a group, a room and a chat, sometimes on one screen                                | consistency              | S      | confirmed   | `Tab label "Groups" (TAB_LABELS, src/app/(tabs)/chat.tsx). Creation screen says "Start a group" / "Create group" (screenshot 22-new-group.png). List se` |
| M   | "Have an invite?" is dressed as a conversation and sits in the middle of the list                                  | information-architecture | S      | —           | `Screenshot 27a-chat-list-with-a-row.png: the invite row sits between "Rooftop hello from Maestro" and the "Rooms near you" header, with the same row h` |
| M   | "Rooms near you" and "1 guest here now" are presence language in an app that promises it never knows where you are | trust-safety             | S      | —           | `Screenshot 27a-chat-list-with-a-row.png: section header "Rooms near you" above "Once Again Hostel / 1 guest here now". RoomDiscovery is passed cityId ` |
| M   | A reaction in a group says nothing about who reacted                                                               | flow                     | M      | —           | `Screenshot 26-reacted.png shows a bare ❤️ pill under the bubble. ReactionSummaryRow is threaded through message-thread.tsx:392, 556 and 1006 and rende` |
| M   | A recipient has no way to say in advance what they do not want to receive                                          | trust-safety             | M      | —           | `Moderation is server-side and first-message-only (docs/PRODUCT_BRIEF.md §7 rule 5, §3 moderation pipeline). The recipient's only control is after the ` |
| M   | After you say hi, the screen's only primary button goes dead                                                       | flow                     | S      | —           | `src/app/(tabs)/travelers.tsx:429-433 — label={chatId ? 'Open chat' : requested ? 'Message sent' : 'Say hi'} with disabled={requested && !chatId}.`      |
| M   | Groups default to never expiring, in an app where everything else does                                             | retention                | S      | —           | `Screenshot 22-new-group.png — "Chat is active until / This chat stays open until you set an end date" with "No end date" preselected. src/app/group/[i` |
| M   | Long-pressing a message renders it twice                                                                           | visual                   | S      | —           | `Screenshot 25-reaction-menu.png: "First one in" appears once bright inside the lifted bubble at the menu's anchor, and again dimmed a few points below` |
| M   | Nothing ever asks whether two travelers actually met                                                               | retention                | M      | —           | `No post-meet surface exists anywhere: grep across src/features finds no "met"/"how did it go" flow. docs/PRODUCT_BRIEF.md §6 lists request→accept rate` |
| M   | The Say hi bar's gradient does not cover the content it floats over                                                | visual                   | S      | —           | `Screenshot 17-travelers-signed-in.png: "…ico" and "Sep 25 – Oct 28" from the next trip card are legible directly beside and behind the Say hi button. ` |
| M   | The business inbox states three contradictory things and offers the owner nothing to do                            | empty-state              | S      | —           | `Screenshot 72-business-chat.png: "Your room / Maestro Cafe / 0 people here" with a timestamp of 11:01 PM on the right, and directly beneath it a card ` |
| M   | The tapback row floats a bubble's height away from the bubble and lands on the day separator                       | visual                   | S      | —           | `Screenshot 25-reaction-menu.png: the emoji row sits at roughly y=1478 (of 2622) while the bubble it belongs to sits at y=1607, with the "Today 11:18 P` |
| L   | "Only who I pick" reads as a typo                                                                                  | copy                     | S      | —           | `Screenshot 22-new-group.png, the "Who can post" segmented control: "Everyone" / "Only who I pick". The same options appear via SPEAKING_OPTIONS in src` |
| L   | The members explainer describes a control the reader cannot see                                                    | copy                     | S      | —           | `Screenshot 27-group-settings.png: "Tap a name to open their profile. The button on the right of a row lets somebody post, or takes them out of the gro` |

### Saying hi: the composer, moderation, and the moment two people connect

|     | Finding                                                                                                 | Cat                      | Effort | Verified    | Evidence                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | A hello anchored on a top priority is announced to the recipient as being about their bio               | copy                     | S      | confirmed   | `src/features/chat/anchors.ts:33-54; src/features/profile/profile-view.tsx:206-213, 221-228; src/app/compose-request.tsx:33`                             |
| C   | After accepting, the recipient is told the hello started from the sender's profile, not their own       | copy                     | S      | confirmed   | `src/app/chat/[id].tsx:404-410; src/features/chat/anchors.ts:14-18, 65-84; src/app/(tabs)/chat.tsx:164`                                                  |
| H   | A hello blocked after it was sent vanishes, with no in-app trace and no way to rewrite it               | error-state              | M      | confirmed   | `src/app/compose-request.tsx:154-176; src/app/(tabs)/chat.tsx:790; supabase/migrations/20260820001000_copy_pass.sql:186-192`                             |
| H   | Rewording a blocked message is a strike, and the app's own copy tells people to do it                   | trust-safety             | M      | confirmed   | `src/app/compose-request.tsx:271-280; supabase/migrations/20260822235000_review_fixes.sql:333-343; supabase/migrations/20260817090000_trust_safety.sql:` |
| H   | Saying hi to somebody you already messaged is a dead end that destroys the message                      | flow                     | M      | partly-true | `src/app/profile/[userId].tsx:86-101; src/app/(tabs)/chat.tsx:247; src/features/pins/map-screen.tsx:435-448; supabase/migrations/20260822235000_review_` |
| H   | Server error strings reach users verbatim, using the banned word for a message, titled "Could not save" | copy                     | S      | partly-true | `src/lib/failure-message.ts:32-38; src/lib/query-client.ts:22-28; supabase/migrations/20260822235000_review_fixes.sql:261, 264, 269, 331`                |
| H   | The live draft warning switches OFF exactly when it is needed most                                      | flow                     | S      | confirmed   | `src/app/compose-request.tsx:67; src/features/matching/hooks.ts:87-114`                                                                                  |
| H   | The push-permission ask stops firing the moment LLM moderation is switched on                           | retention                | S      | confirmed   | `src/features/matching/hooks.ts:141-143; supabase/migrations/20260822235000_review_fixes.sql:344-351; supabase/functions/moderation-worker/index.ts:14-` |
| M   | A hello nobody answers never ends, cannot be withdrawn, and has no date on it                           | retention                | M      | —           | `src/app/(tabs)/chat.tsx:230-272, 992-1009; supabase/migrations/20260816200000_trips_matching.sql:376-377, 394, 618-650`                                 |
| M   | Decline is one silent, unconfirmed, permanent tap next to Accept                                        | flow                     | M      | —           | `src/app/(tabs)/chat.tsx:130-143, 194-212; supabase/migrations/20260816200000_trips_matching.sql:394`                                                    |
| M   | Every waiting hello renders as a full card above the inbox, with no cap and no length limit             | information-architecture | M      | —           | `src/app/(tabs)/chat.tsx:969-978, 174; supabase/migrations/20260816200000_trips_matching.sql:655-690`                                                    |
| M   | Hitting the daily cap destroys the message the person just wrote                                        | error-state              | M      | —           | `src/app/compose-request.tsx:99-102, 131-152, 253-257; src/features/matching/hooks.ts:70-78`                                                             |
| M   | Nothing in this entire area has ever been photographed                                                  | visual                   | M      | —           | `e2e/flows/signed-in-tour.yml:225-229 (no compose-request step anywhere under e2e/); the 94 PNGs in shots/results contain no composer, no sent card, no` |
| M   | The accept notification promises a reply that does not exist                                            | copy                     | S      | —           | `supabase/migrations/20260820001000_copy_pass.sql:292-308; supabase/migrations/20260816200000_trips_matching.sql:592-606`                                |
| M   | The block notice cannot teach, because the reason is computed and then thrown away                      | copy                     | M      | —           | `src/app/compose-request.tsx:271-280; supabase/migrations/20260816200000_trips_matching.sql:445-462; supabase/functions/moderation-worker/index.ts:42-4` |
| M   | The card you decide on omits the city and the dates the whole product is built on                       | information-architecture | M      | —           | `src/app/(tabs)/chat.tsx:145-214; supabase/migrations/20260816200000_trips_matching.sql:655-690`                                                         |
| M   | The say-hi composer is the only one of the three composers with no Close button                         | accessibility            | S      | —           | `src/app/compose-request.tsx:178-186; src/components/form/step-screen.tsx:83-91; src/app/message-place.tsx:78; src/app/message/[userId].tsx:62`          |
| L   | The composer defaults to a bio anchor without checking there is a bio                                   | copy                     | S      | —           | `src/app/compose-request.tsx:59; src/app/(tabs)/travelers.tsx:733; src/features/profile/profile-view.tsx:909-910`                                        |
| L   | The sent confirmation is 1100ms long and says nothing the sender needs to know                          | conversion               | S      | —           | `src/app/compose-request.tsx:113-122, 154-176, 286`                                                                                                      |

### The map: browsing, dropping a pin, filters, heat, businesses on the map

|     | Finding                                                                                                         | Cat                      | Effort | Verified    | Evidence                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | Nothing on the map says when any plan is. The date only exists inside a tap.                                    | information-architecture | M      | confirmed   | `Screenshots 02-map-tab, 11-signed-in-map, 28-map-with-places (eleven markers, zero temporal information). src/features/pins/filters.ts:45-49 (DEFAULT_`      |
| C   | The heatmap does not render in the default city, and the app has no way to say so                               | empty-state              | M      | confirmed   | `supabase/migrations/20260816210000_map_pins.sql:24 (heat_k default 3, check >= 3). supabase/migrations/20260823010000_keep_the_map_alive.sql:85-96 (0.`      |
| C   | There is no list of what is on in the city, anywhere in the app                                                 | discoverability          | L      | confirmed   | `src/features/pins/map-screen.tsx (the only aggregate surface is CityCountView, and it only exists past CITY_ZOOM_DELTA 0.6, roughly 65km of latitude).`      |
| H   | "Pin here" hovers over a spot with no name, then names it one screen too late                                   | flow                     | M      | confirmed   | `Screenshot 13-place-after-pan: the fixed amber pin sits on the Chao Phraya river with a "Pin here" button and nothing at all identifying the spot. Scr`      |
| H   | "What's the plan?" writes the venue column, so the pin has no venue and three strings break                     | copy                     | M      | confirmed   | `src/features/pins/pin-form-sheet.tsx:63 `useState(initialPlace?.name ?? '')`feeding a field labelled "What's the plan?" (:~300), submitted as`venueN`        |
| H   | A two-pin cluster draws as three separate discs and shows one category for both plans                           | visual                   | S      | confirmed   | `Screenshots 02-map-tab, 28-map-with-places, 16-pin-posted, 71-business-map: every "2" cluster renders as two overlapping glyph discs plus a count badg`      |
| H   | Every marker is the same orange disc, and Apple's own POI icons are in the same palette                         | visual                   | M      | partly-true | `Screenshot 28-map-with-places: eleven markers, all amber discs with black glyphs, differing only by glyph. Screenshot 13-place-after-pan: Apple's "On `      |
| H   | Pan away from the launch city and you get a blank map with no pins, no message and no way back                  | flow                     | S      | partly-true | `src/features/pins/map-screen.tsx:~700 (`useMapPins(activeCityId)`; every pin is fetched for the selected city only). The empty banner at :~1300 is gat`      |
| H   | The pin form clips "When" and "Disappears after" below the fold, and "Drop it" stays live above them            | flow                     | S      | partly-true | `Screenshot 14-pin-form: "Disappears after" is a section header with roughly 35pt of empty space beneath it and no slider, readout or range visible, an`      |
| M   | A business owner's map does not contain their own business, and nothing explains why                            | empty-state              | S      | —           | `Screenshot 71-business-map: the only business chip visible carries an amber ring and live dot but no blue own-ring halo, and the legend reads "Tap a b`      |
| M   | A pin placed by dragging is always "Other" and disappears under any category filter                             | flow                     | S      | —           | `src/features/pins/pin-form-sheet.tsx:88 `const category = categoryForPoi(initialPlace?.category)`, and src/features/pins/pin-helpers.ts:~130 returns '`      |
| M   | Fixed-height marker and dock chrome will clip at large Dynamic Type                                             | accessibility            | S      | —           | `src/features/pins/pin-marker.tsx: `stackCount {minWidth:22, height:22}`containing a`<Text>`at fontSize 11 with default allowFontScaling;`stackFace`          |
| M   | The Filters sheet covers the map it claims to be updating live                                                  | flow                     | S      | —           | `Screenshots 05a-map-filters and 05b-map-filters-on: the sheet runs from roughly 20% down to the tab bar, and the visible strip of map above it contain`      |
| M   | The Filters sheet labels plan types with emoji, including a red pushpin, and two of them contradict the map     | visual                   | S      | —           | `Screenshots 05a-map-filters and 05b-map-filters-on: chips read 🍸 Bar, 🍜 Food, 🪩 Club, 🖼️ Museum, 🏛️ Sights, 🏖️ Beach, 🥾 Hike, 📍 Other. Source: src/fea` |
| M   | The business map has no action on it at all                                                                     | conversion               | M      | —           | `Screenshot 71-business-map: the dock where travelers get "Drop a pin" is empty. src/features/pins/map-screen.tsx:~1380 gates the dock on `!isBusiness``      |
| M   | The disabled "Drop it" button never says what it is waiting for                                                 | error-state              | S      | —           | `Screenshot 14-pin-form: a grey "Drop it" with the footnote "Gone in 72h max. Never shows where you are." and nothing indicating which field is require`      |
| M   | The map's teaching chips are one-shot forever and they sit on top of the primary action                         | discoverability          | S      | —           | `Screenshots 02-map-tab, 11-signed-in-map, 28-map-with-places, 05c-map-filtered, 71-business-map: "Tap a business to see what's on" sits directly above`      |
| M   | The same pin gets three different titles depending on who is looking at it                                      | consistency              | S      | —           | `src/features/pins/map-screen.tsx:176 hero title `pin.note?.trim() // pin.venue_name`; :202 non-hero headline `pin.venue_name`; :1594 venue-stack row ``      |
| M   | Your own pin is indistinguishable from a stranger's on the map                                                  | visual                   | S      | —           | `Screenshot 16-pin-posted: the just-dropped pin is a slightly larger amber disc, larger only because it is selected. src/features/pins/pin-marker.tsx:7`      |
| L   | A second, older pin-creation screen still ships, with the vocabulary the map has moved on from                  | consistency              | S      | —           | `src/app/drop-pin.tsx: CATEGORY_OPTIONS built as `${c.emoji} ${c.label}` (the 📍 red pushpin included), duration chips instead of the slider, no join-mo`     |
| L   | The city rail says nothing about the cities, and a traveler whose city is not one of the four has nowhere to go | empty-state              | M      | —           | `Screenshots 02-map-tab, 11-signed-in-map, 28-map-with-places, 71-business-map: four chips, Bangkok / Denpasar / Lisbon / Mexico City, with "Mexico Cit`      |

### Time to first value, and every funnel in the app

|     | Finding                                                                                          | Cat                      | Effort | Verified         | Evidence                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------ | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | A business builds its entire listing before being told it is invisible until an email            | conversion               | M      | confirmed        | `src/app/business-signup.tsx:784-792 (step 12 of 12: "Nobody can find you until an email proves somebody reads that inbox"); supabase/migrations/202608` |
| C   | A newly live business lands on "0 people here" with nothing to do and nothing to send            | empty-state              | M      | confirmed        | `72-business-chat.png; grep for Share across src/ returns exactly one use, src/app/group/[id].tsx:293`                                                   |
| C   | Dropping a pin, the hero action, costs the full 13-step signup including a photo                 | flow                     | M      | founder-decision | `06-guest-gate.png; 02-map-tab.png; src/app/onboarding/index.tsx:290-305; src/features/signup/steps.ts:24`                                               |
| C   | Six of the thirteen signup steps emit no analytics, including photo and trip                     | conversion               | S      | confirmed        | `src/app/onboarding/index.tsx:140-152 (capture lives inside saveAndGo) vs steps advancing via go() at :305, :378, :423, :470, :518, :534`                |
| H   | "Disappears after" heads an empty gap: the expiry control never comes into view                  | visual                   | S      | confirmed        | `14-pin-form.png (heading at the bottom of the sheet with blank space under it, then Drop it); 15-pin-form-filled.png (heading, date rail and details f` |
| H   | "You're top of their list too" is an unverified ranking claim in a hardcoded string              | copy                     | S      | refuted          | `src/app/(tabs)/travelers.tsx:366; gated only by :701 (spotlight = this is the spotlit user); 17-travelers-signed-in.png`                                |
| H   | A business post reaches nobody: there is no what's-on list anywhere in the app                   | discoverability          | M      | partly-true      | `src/features/business/hooks.ts:125 - ['business-posts', businessId] is the only posts query key, and business-post.tsx is the only screen referencing ` |
| H   | Nothing in the app can be shared: no listing link, no plan link, no invite a friend              | discoverability          | M      | confirmed        | `Share is imported once in the whole codebase, src/app/group/[id].tsx:7, and used once at :293; nothing in my-business.tsx, place/[id].tsx, room/[id].t` |
| H   | Signup asks for the whole camera roll, three dialogs deep, twice, and offers no camera           | trust-safety             | S      | partly-true      | `step-055-tapOnElement-Allow_Access_to_All_Photos.png, step-056-tapOnElement-Full_Access.png, step-057-tapOnElement-Allow_Full_Access.png and the same ` |
| H   | Skipping the trip step silently closes the Travelers tab, and the skip does not say so           | flow                     | S      | confirmed        | `src/app/onboarding/index.tsx:468 (onSkip with label "I have not booked anything yet"); src/app/(tabs)/travelers.tsx:606-623 ("Add a trip first")`       |
| H   | The heatmap, the product's stated differentiator, renders in none of the 94 screenshots          | discoverability          | M      | partly-true      | `02-map-tab.png, 11-signed-in-map.png, 28-map-with-places.png, 71-business-map.png - zero heat in every map frame; src/features/pins/map-screen.tsx:703` |
| H   | The pin sheet never asks the category, so hand-placed pins file as Other and vanish from filters | discoverability          | S      | founder-decision | `src/features/pins/pin-form-sheet.tsx:86 (category = categoryForPoi(initialPlace?.category)); src/features/pins/pin-helpers.ts:103-106 (no POI returns ` |
| H   | Traveler pins and business markers are the same orange, so the map cannot show people            | visual                   | M      | refuted          | `28-map-with-places.png (the traveler's own just-posted pin, centre-left, is the same fill as the fork, camera, bed and cocktail markers); 02-map-tab.p` |
| M   | "1 guest here now" claims live presence in an app that promises never to know it                 | trust-safety             | S      | —                | `src/app/(tabs)/chat.tsx:515 (`${countOf(room.member_count, 'guest')} here now`); 27a-chat-list-with-a-row.png ("Once Again Hostel · 1 guest here now")` |
| M   | After thirteen signup screens the map is the same frame the guest already saw                    | retention                | S      | —                | `02-map-tab.png (guest) and 11-signed-in-map.png (signed in) are identical - same markers, same "Tap a business to see what's on" banner, same Drop a p` |
| M   | Every group and room row draws the same house glyph, so the list has no shape                    | visual                   | S      | —                | `27a-chat-list-with-a-row.png - "Maestro crew", "Rooftop hello from Maestro" and "Once Again Hostel" all carry the identical blue house; src/app/(tabs)` |
| M   | Step 12 is the only signup step with no Skip, and every option on it is inert                    | flow                     | S      | —                | `src/app/onboarding/index.tsx:524-534 (no onSkip, unlike steps 6-11) and the step's own comment: set_visibility refuses a narrowed audience from an acc` |
| M   | Travelers offers three different controls that all send the same hello                           | information-architecture | S      | —                | `17-travelers-signed-in.png - "Say hi" in the dock, "Reply" beside Travel plans, and an unlabelled floating bubble over the photo; src/features/matchin` |
| M   | src/app/drop-pin.tsx is a second, divergent pin form no iOS screen can reach                     | consistency              | S      | —                | `src/app/drop-pin.tsx:1-120; referenced only by src/features/pins/map-screen.web.tsx:59 and registered at src/app/_layout.tsx:290`                       |
| L   | The guest Chat tab floats one sentence in a screen of empty space                                | empty-state              | S      | —                | `04-chat-guest.png`                                                                                                                                      |

### Travelers queue, the profile, and building your own profile

|     | Finding                                                                                                                 | Cat                      | Effort | Verified         | Evidence                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C   | A stranger's profile page offers Report and Block as its only full-width buttons, and no way to say hi                  | flow                     | M      | confirmed        | `src/app/profile/[userId].tsx:89-159 (onRespondTo is the only messaging path; actions renders Report at :146 and Block at :153, with the Message button` |
| C   | Passing a traveler is irreversible for fourteen days, and the only undo appears after the queue is already empty        | flow                     | S      | confirmed        | `src/features/matching/passed.ts:6 (TTL_MS = 14 days) and :49 (only `add`and`reset`, no per-id removal); src/app/(tabs)/travelers.tsx:708 (`passed.ad`   |
| H   | The "Reply" chip on Top priorities announces itself to VoiceOver as "Say you're in", a name the button does not display | accessibility            | S      | confirmed        | `src/features/profile/profile-view.tsx:116 (`'Top priorities': "Say you're in"`), :159 (passed as `label`), :100-104 (ReplyButton always renders the li` |
| H   | The Age field on the second signup screen is sliced in half by the scroll edge under the keyboard                       | visual                   | S      | confirmed        | `51-signup-who.png - the Name field draws a complete rounded rectangle; the Age field's bottom border is missing and its bottom-left corner does not cu` |
| H   | The Next control is an unlabelled arrow on a circle at ~1.5:1, using `hairline` where the brief says `border`           | visual                   | S      | confirmed        | `17-travelers-signed-in.png (the circle left of "Say hi" is barely distinguishable from the canvas); src/app/(tabs)/travelers.tsx:418-424 and :805 (`ba` |
| H   | The queue never tells you how many people are in it, so an unhurried reading screen behaves like an endless feed        | information-architecture | S      | confirmed        | `src/app/(tabs)/travelers.tsx:341-380 (the page renders the spotlight ribbon or nothing above the hero; there is no header, count, or filter) and :568 ` |
| H   | The reply anchors are 26pt chips in section headers while the content they point at is inert                            | discoverability          | M      | confirmed        | `src/features/profile/profile-view.tsx:66-107 (ReplyButton is the only pressable), :440-451 (the trip card is wrapped in PressableScale only when `owne` |
| H   | The safety filter's four options are rendered at 0.45 opacity (2.7:1 and 1.7:1) with the reason stated underneath them  | accessibility            | S      | partly-true      | `18b-who-can-see-you.png; src/features/profile/audience-picker.tsx:62 (`opacity: locked ? 0.45 : 1`); src/app/visibility.tsx:60-68 (AUDIENCE_NEEDS_BADG` |
| H   | There are only two exits from a traveler: message them now, or lose them for a fortnight                                | flow                     | M      | founder-decision | `src/app/(tabs)/travelers.tsx:405-441 (the action bar has exactly two controls) and :543-553 (the queue removes anyone already messaged, chatted, or pa` |
| M   | "You're top of their list too." imports a ranking frame the product does not have, over a chip nobody can decode        | copy                     | S      | —                | `src/app/(tabs)/travelers.tsx:352-368 (the `sparkles`chip renders`Today in {city}` and the fixed line beneath it); 17-travelers-signed-in.png`           |
| M   | A guest sees exactly one traveler and then a wall, on a tab whose whole job is proving the city is not dead             | conversion               | M      | —                | `src/app/(tabs)/travelers.tsx:69-246 (GuestTravelers renders one `useFeaturedTraveler` result then SignUpGate); 03-travelers-guest.png`                  |
| M   | A trip must have exact start and end dates, which most backpackers do not have when they would post one                 | flow                     | L      | —                | `src/app/add-trip.tsx:18-19 (start defaults to today+7, end to defaultEndFor), :30-42 (submit refuses without `end`), :103-107 ("Pick the day you leave` |
| M   | The paragraph explaining the gendered options is cut off mid-sentence behind the Done button                            | visual                   | S      | —                | `18b-who-can-see-you.png - the last visible line reads "Verified means they passed the selfie check. The three" and stops at the scroll edge; src/app/v` |
| M   | The topmost card on your own profile is the app's last all-caps label, and it touches the identity card below it        | consistency              | S      | —                | `src/features/profile/audience-picker.tsx:144 (`WHO YOU SEE, AND WHO SEES YOU` hardcoded in caps) against src/features/profile/profile-view.tsx:131-135` |
| M   | Three of the action button's four states are unreachable dead code, and the state they were built for has no UI at all  | flow                     | M      | —                | `src/app/(tabs)/travelers.tsx:429 (`chatId ? 'Open chat' : requested ? 'Message sent' : 'Say hi'`) against :543-553, where the queue filter removes eve` |
| M   | Two different controls labelled "Done" are on screen at once whenever a form field has focus                            | accessibility            | S      | —                | `34-priorities-editor.png and 35-priorities-typed.png - a blue "Done" in the keyboard accessory bar directly above the keyboard, and the primary "Done"` |
| M   | Your own profile hides the one affordance that decides whether anyone messages you                                      | information-architecture | M      | —                | `src/features/profile/profile-view.tsx:141-160 (SectionHeader renders Edit *or* Reply, "never both") and :838-1039 (`onRespondTo` is undefined for owne` |
| L   | Both profile screens open with an empty navigation bar and never name whose page you are on                             | information-architecture | S      | —                | `src/app/_layout.tsx:252 and :292 (`headerShown: true, headerTitle: ''` for profile-me and profile/[userId]); 18-profile-me.png shows a lone chevron wi` |
| L   | The guest Travelers tab and the signed-in one are two unrelated screens with the same tab icon                          | consistency              | M      | —                | `src/app/(tabs)/travelers.tsx:106-245 (guest: a "Travelers" title, a 3:2 card, a sign-up gate, a normal scroll) versus :341-450 (member: no title, a 1.` |
| L   | The priorities placeholders are all Lisbon, whoever you are and wherever you are going                                  | copy                     | S      | —                | `src/features/profile/priorities.ts:33-40 ("day trip to Sintra", "pastel de nata crawl" among the six); 34-priorities-editor.png shows "day trip to Sin` |
