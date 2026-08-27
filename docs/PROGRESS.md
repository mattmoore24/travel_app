# Progress

Living status doc: what's done, what's next, what needs founder input.
Updated at every phase boundary (and mid-phase when something changes).

## Current: **Places is built and audited** (2026-08-27)

### The final audit, and what it found

Four independent passes over the whole surface before the founder tests it —
copy and voice, layout and contrast, client correctness against the migrations,
and a walk through five user journeys. They converged, which is the useful part:
the same handful of problems came back from passes that could not see each
other's notes.

Every finding that mattered was **silent**. The app did nothing, or it said it
had done something it had not. That is the class of bug a green test suite
cannot see and a screenshot cannot either.

**Dead on arrival, all now fixed:**

- **A business account could not open a single chat.** `chat/[id]` sat behind
  `signedIn && onboarded`, and a business's `onboarding_completed_at` is NULL
  forever by design. A traveler's message reached the owner's Chat tab, the
  owner tapped it, and nothing happened. Ever. The whole inbound feature was
  dead on the receiving end.
- **Message was offered on the four unclaimed launch venues**, where
  `message_business` refuses — after five hundred characters and a Send.
  `business_detail` now returns `claimed`.
- **An `uncertain` storefront verdict was a permanent dead end.** The writer set
  status `uncertain`; its own guard refuses anything not `pending`. Nobody could
  finish it, and the business sat on "someone is looking at these by hand" with
  the retry button taken away. `admin_resolve_business_verification` is the way
  back in.
- **A second message to the same place was thrown away.** The RPC short-circuited
  on the existing chat and never inserted. Success haptic, straight into a thread
  holding only what you said last week.
- **A post could never be taken down**, so three standing notices permanently
  bricked an unverified place's own composer — which then told it to take one
  down.
- **`register_business` never set `display_name`**, so every message a place sent
  was authored by nobody.
- **`report_business` let a business report a rival.** One report emails support
  and queues a Claude impersonation scan, one verdict from darkening a
  competitor. **`is_business_account`** was the one helper with no revoke, so any
  user id could be posted to it. **`website_url`** skipped the validator every
  link row passes.
- **Deleting a place's account left the listing up.** `owner_user_id` is ON
  DELETE SET NULL, so the name, photos, posts, hours, links and chat all outlived
  the account. 5.1.1(v) applies to a business account too.

**Wrong on screen:** the place sheet could run off the bottom with nothing to
scroll; every text field in the app had a 1.24:1 edge while `theme.border`
existed unused and documented for exactly that; chips were 34-40pt against a 44
floor; a place's chat was drawn as a person's, down to signing the cover photo
against the profile bucket and linking to the owner's stub profile; nothing on
the map said what the new markers were.

**Wrong in words:** the storefront screen promised a fifteen-minute rule nothing
enforced (it does now); a post said it appeared in the chat, which nothing does;
"Paused" told an owner they had switched their own listing off when moderation
had taken it down; two em dashes; "a map pin" for a commercial listing, which is
the one word §7 rule 3 needs to keep.

The audits also found the **one door** to listing a place was a ghost button
below the fold on step 3 of traveler signup. There is one on the welcome tour
now, and it carries through signup — finishing traveler onboarding refuses
`register_business` permanently, so dropping somebody there was a trap.

## What was built (2026-08-27)

The founder gave the all clear, and phases 13 to 18 are implemented. What is on
the branch:

- **Phase 13, identity and the rename.** `establishments` is `businesses`, all
  eight dependent functions recreated in the same migration (a function body is
  stored as TEXT and `ALTER TABLE ... RENAME` does not rewrite it, so a bare
  rename fails at runtime with a green deploy). `city_rooms` and `join_room`
  keep their names because shipped iOS builds call them over the wire. §7 rule 8
  is six BEFORE INSERT triggers. Routing gets the guest bug's sequel before it
  happens: a business's `onboarding_completed_at` is null forever by design.
- **Phase 14, the public surface.** Photos, links, hours and posts, all hanging
  off one `is_visible_business` predicate, so a dark listing takes its content
  with it. Posts expire when the business says, including never; the live-post
  cap bounds the surface instead, and an unverified business gets three rather
  than ten. Links are the one chokepoint a URL can enter through, so the scheme
  allowlist lives in that trigger.
- **Phase 15, listing and the badge.** A six-digit code lights the listing up
  and grants no badge. Two live camera shots of the storefront earn the badge.
  Renaming or moving clears it. The first report emails `SUPPORT_INBOX` and
  queues a Claude read of the whole listing.
- **Phase 16, inbound messages.** Straight through on a clean prefilter verdict,
  no accept step, no romance classifier. `kind = 'business'` is what keeps the
  handle gate shut in both directions.
- **Phase 18, ratings.** Buckets, head-to-head comparisons, a score derived from
  where it lands, no text anywhere, public number only past five raters.
- **Phase 17, the business side**, and the traveler screens for all of the
  above.

**643 pgTAP assertions.** The client gate runs on every commit.

### One honest correction, and the fix that followed it

**The selfie screen was not camera-only — now it is.**
`docs/BUSINESS_ACCOUNTS.md` §3.9 claimed the storefront check would enforce
"the same rule the selfie screen already enforces". It did not:
`src/app/verification.tsx` fell back to `launchImageLibraryAsync` on web or
when camera permission was denied, which meant the badge could be earned with
a picture of a face rather than a face. The founder's answer was to close it,
so both screens now capture through `src/lib/live-camera.ts` — camera only, a
refused permission gets an explanation and an Open Settings button, and
`src/lib/__tests__/live-camera.test.ts` scans the source of both screens and
the helper so no future kindness can reopen it.

**`business_chats` is not built.** Decision 12 is one chat per business at v1,
which `businesses.chat_id` already models exactly. The separate table only earns
its place alongside multi-room, which §10 defers. Nothing else in the plan
depended on it.

### What the founder has to do

**Nothing before testing.** `MODERATION_PROMPTS_BUSINESS` is set and synced, so
the storefront and impersonation queues are live. `RESEND_API_KEY` and
`SUPPORT_INBOX` were already set, and the business mail rides the same path the
contact form does.

Two things to know while testing:

1. **A verification photo can never come from the library**, for a person or for
   a place. Both screens go through `src/lib/live-camera.ts` and a
   source-scanning test keeps them there. Refusing the camera gets an
   explanation and an Open Settings button, not a second route.
2. **An `uncertain` storefront verdict now waits for you**, and the founder's
   email says exactly what to run:
   `select public.admin_resolve_business_verification('<request id>', true);`
   (or `false, 'reason'`). Before this it waited forever.

## Planned: **Top priorities on the profile** (2026-08-27)

Founder request, deliberately separate from the business work: up to six very
short things a traveler wants to do out there, listed on the profile. Plan in
**docs/TOP_PRIORITIES.md**.

Why it is worth its own doc rather than another prompt: everything else on a
profile describes a person, trips describe a place and a window, and this is
the only section that describes a **plan**. A plan is the one thing a stranger
can say yes to without having to be charming first, which is why each entry is
a tappable RSVP that opens the composer anchored to it ("Say you're in").

Shape: a `profile_priorities` table modelled on `profile_prompts` (slot 0-5, so
six is enforced by the primary key rather than by client code), 40 characters
per entry, screened by the same classifier the prompts and the bio go through,
visible exactly where the profile is. The editor is one screen where the return
key commits a row and opens the next, so six entries cost six lines of typing
and no taps in between. **One list per profile**, settled by the founder;
adding a nullable `trip_id` later is one migration with no backfill if that
ever changes.

## Planned: **Phase 13-17 — business accounts ("Places")** (2026-08-27)

The founder asked for business accounts: a persistent place on the map with
photos, hours, links, posts, and one open chat anyone can join; inbound DMs
with no matching; three speaking modes; departure+3d / 90d membership; the
whole thing replacing the hostel-room dynamic. The full plan is
**docs/BUSINESS_ACCOUNTS.md** - researched across five lenses, then
adversarially reviewed by three critics whose findings (a departure-date leak
through group_members, anti-scraping refusals with no migration to live in, a
dropped RPC that would break deployed clients' Join button) are folded in.

Headline findings: the chat spec is closer to built than it reads
(room_members already carries roles, departure dates and the expiry sweep;
groups.speaking is two of the three modes); the genuinely new surface is the
business identity, verification against impersonation, and two §7 amendments.

**Revised 2026-08-27** after the founder read the plan. Twelve changes, all
folded in:

- Posts expire when the business says so, including never. No mandatory 30
  days.
- "Run a business? Put it on the map." and the tab is **My business**.
- **Getting listed is a confirmation link, and nothing more** (§3.9). The
  two-path scheme drafted first (domain-matched email, or a code planted on the
  website) is written down as tier 2 of a ladder and deliberately not built.
  The founder's call, and the Google Maps research backs it: Google picks the
  method by risk rather than offering one; video verification is now their
  primary method because it proves physical presence rather than domain
  ownership; email is their weakest and rarest; re-verification triggers on a
  name or address edit; reporting is a structured first-class path feeding
  machine review; and even so, verification takes 5-14 days and there is a
  consultancy industry built on wrongly-suspended listings. Nobody solves this
  at signup.

  Three things came out of that. **There is no verified badge** — a link click
  proves an inbox exists, and a check mark next to it would lend an impersonator
  the app's credibility, so v1 ships the absence of the feature and "verified"
  keeps meaning exactly one thing in this app. **Reports are structured and
  escalate without the founder** — Google's reason list, one voice per account,
  three distinct reporters trigger a Claude read of the reports plus the
  listing, and a plausible impersonation verdict darkens it immediately. And one
  recommended optional addition: **a camera-taken storefront photo with the sign
  in it**, checked by the photo worker that already runs. That is video
  verification's cheapest 20%, and it removes every fake listing made by
  somebody who never leaves their laptop.

- Messages to a business always go through, with no accept step. A business
  cannot open a conversation with a person who has not written first.
- The member list in a business chat is open to everyone in it. It is an app
  for meeting people, and this reverses the earlier decision 18.
- The departure question is a date picker with "I'm not sure", and says plainly
  that you leave the chat three days after that date, or after ninety, and can
  go or come back whenever.
- Only admins can send photos in a business chat, even in the everyone mode.
  Enforced by a trigger, not by hiding the button.
- **Anyone with an account can rate a business, Beli-style** (§3.10). This
  reverses an earlier refusal of mine, and the reason it reverses is specific:
  the extortion lever in reviews is the free text, and Beli's mechanic has
  none. You pick loved / fine / not for me, then answer three or four "which did
  you prefer" comparisons, and the score falls out of where the place lands in
  your own ranked list. No written reviews anywhere. Public number only past
  five raters, mirroring the heatmap's k-threshold, and a business never learns
  who rated it. The founder dropped both gates the draft had: verified-only and
  been-in-the-city. Somebody who stayed there in 2024 has a better-informed
  opinion than somebody who joined the chat yesterday.
  `app_config.ratings_require_verified` is the lever if brigading ever appears,
  one row rather than a migration.
- Category names and the capitalisation kept as proposed.

**Signed off 2026-08-27**: §7 rules 3, 4, 5 and proposed rule 8, all as
recommended, plus the last four decisions (6 agreed; 20 total members with the
"quiet lately" label dropped; 21 agreed; 22 no blockers to rating). Nothing is
blocked. One optional yes or no is outstanding and holds nothing up: the
storefront photo at §3.9 tier 1.5.

Build order is seven phases, 13 through 19, everything over the air. Phase 13
is the rename and the identity and ships with zero visible change; the proof is
that nothing broke.

## Current status: **Phase 12 — the founder's second review batch** (2026-08-23)

### Phase 12 — what the founder asked for after testing on the phone

- **Heart back on the reaction row.** The "no hearts" rule is about the romantic
  vocabulary this app avoids; a tapback is none of those. Both rule docs now carry
  that exception explicitly, scoped to the reaction row and expanded grid.
- **Trip dates are one range calendar.** Tap the day you arrive, tap the day you
  leave, everything between fills in. `src/features/trips/trip-calendar.tsx`, used by
  add-trip and the trip editor. This also retired the picker that rendered near-black
  on near-black; the three remaining native pickers are told `themeVariant` explicitly.
- **The "Sent" row stopped impersonating a chat.** It borrowed the chat row's card,
  avatar and preview whole, so tapping one and landing on a profile read as a bug.
  Outlined instead of filled, smaller, quotes your own words back, has a chevron.
- **Travelers' exhausted state** reads "that's everyone with travel plans matching
  yours" and sits clear of the profile avatar.
- **Demo travelers: 6 → 12, 2 cities → 4.** Each carries a gender, an occupation and
  three prompt answers, and holds four trips instead of one. Rotation by index puts
  three of them in every launch city today (so every city has avatar pins) and
  staggering the later windows gives at least three matches in any city for any trip
  in the next four months. The old single 27-day window was why the tab said nobody
  matched.
- **An invite link opened for nobody.** `group_invite_preview` was granted to signed-in
  users only, so a signed-out tap got 42501 and the client turned a permission error
  into "could not load this invite, try again". The screen already had a branch that
  shows the group and offers an account; it was unreachable behind that one grant.
- **Guests can chat.** Anonymous sign-in, a name, and a long list of refusals. See
  ARCHITECTURE "Guests can chat" for the table of what is blocked where and why, the
  three abuse ceilings, and the daily janitor. Anonymous sign-ins were enabled in the
  dashboard on 2026-08-23 (rate limit 150/hour) and live-backend run 11 proves it:
  40 assertions, 0 failed, including the sign-in itself, the onboarding-stamp refusal,
  the signed-out invite preview, join-and-post, and conversion keeping the room and the
  messages on the same auth row.
- **Three client bugs that no test could have seen.** Every migration assertion and all
  196 unit tests passed while the feature was unusable end to end, because all three
  were in routing rather than in logic. The root gated the tabs on `!signedIn ||
onboarded`, and a guest is signed in and can never be onboarded — the database
  refuses that stamp on purpose — so typing a name unmounted the tabs and dropped
  somebody into an onboarding flow whose last step the server would refuse forever.
  `guest-name` sat inside `signedIn && onboarded`, the one pair of states it is never
  used in, so "Join with a name" pushed a route that was not registered. And the boot
  hold, which unmounts the navigator, went up in the same tick `guest-name` called
  `router.replace(next)`, so a new guest landed on the map instead of the invite. Both
  root decisions are named, tested functions now (`src/features/auth/routing.ts`).
- **A guest could not post in the group they had joined.** The room footer branched on
  `isGuest`, which answers true for a named guest as well as a signed-out visitor, so
  the client refused the one thing the feature exists for. `isGuest && !isMember` now:
  a venue room stays a read-only public front door, a chat somebody was handed a link
  to is theirs to answer.
- **A guest could reach their group exactly once.** Joining took them into the room;
  after that the Chat tab showed the guest view — a line about venue rooms and a
  discovery list — with no chat list in it at all, so the group they had just been
  invited to was unreachable from anywhere in the app. The Groups tab lists their own
  rooms now.
- **And that line is in the database now**, not only in the footer. The anon key ships
  inside the app, so an anonymous sign-in could insert straight into a venue's room. A
  venue room and a traveler group are the same shape and differ by one row — the group
  has a `groups` row — so that is the check.
- **Group threads name their senders**, and somebody with no photo gets their initial
  instead of an empty circle.
- **Nothing user-facing says "hostel"** any more; hostels stay in the App Store keywords
  because they are the expected primary users.
- **The map was too dark to read**, and the cause was two treatments doing the same
  job. `mutedStandard` drops label contrast as well as saturation, and the ink wash
  over it took another third, which put a street name at roughly 2:1 against the
  ground. Now `standard` in a dark interface style (Apple's own night map: legible,
  already navy) with the wash cut from 0.34 to 0.14, doing only the job an overlay is
  good at. The pin picker also draws the wash now: the shared constant covers props,
  the wash is an overlay, and only the map tab had ever drawn one.
- **Who can see you.** Verified-only / verified-men / verified-women / verified-non-binary
  audiences for the map and Travelers, gated on holding the badge, enforced in the
  database. See
  ARCHITECTURE "Who can see you" for the three boundaries it respects and why the
  heatmap is deliberately outside them.

### Phase 12 — the filter, after the founder tested it

Three complaints, one real code defect between them, and a lot of copy that made a
working feature read as a broken one.

- **The map lagged the setting by up to a minute.** `useSetVisibility` invalidated
  `['city-pins']`, which is the WEB pin list; the native map reads
  `['map-pins', cityId, isGuest]`. On a phone the invalidation matched nothing, so the
  map sat on the old audience until its 60-second poll. `useCreatePin` had already paid
  for this exact trap and invalidates both families with a comment saying why. The key
  list now lives in `src/features/profile/discovery-cache.ts` with its own test, because
  the call site is where it went wrong.
- **"Verified only" emptied the Travelers queue, and the screen said "that's everyone".**
  The SQL is correct: nothing in the app can set `profiles.verified` (only
  `apply_verification_verdict`, behind the service role), so an audience is only as
  populated as the by-hand flip makes it. The defect was the empty state asserting a
  supply problem it had not checked. It names the audience now, says the setting cuts
  both ways, and leads with a button back to the picker. The map's empty banner does the
  same.
- **The picker framed the setting one way five times and corrected itself once**, in
  13pt secondary text, last on the screen, inside a `verified` branch that hid it from
  the person deciding whether the badge is worth a selfie. Title, subtitle and all five
  option details now name both directions, and the both-ways note is unconditional.
- **The audience did not reach the signed-out map.** 20260823030000 reasoned about the
  guest case for `featured_traveler` and not for `public_city_pins`, the other function
  granted to `anon`, so a traveler who narrowed to verified was hidden from the queue and
  the signed-in map and still pinned on every logged-out visitor's. That is the one
  direction the setting exists to control. Fixed in 20260823140000.
- **The documented verification SQL was non-deterministic.** `limit 4` with no
  `order by`, over twelve travelers in four cities on four staggered windows, yields
  about one verified traveler per city and a real chance of zero in the city you are
  testing from. It flips all twelve now, and ARCHITECTURE carries the per-city gender
  spread so the gendered audiences are tested where they can pass.

### Phase 12 — founder questions

- **Verifying demo travelers.** Testing the new audiences end to end needs a verified
  demo traveler, and the seed script is anon-key-only on purpose. The SQL to flip a
  few by hand is in ARCHITECTURE under "Who can see you".
- **Gendered audiences and nonbinary travelers — ANSWERED.** The first cut had only
  `verified_men` and `verified_women`, which left nonbinary travelers as the only group
  that could be asked for and never ask. Founder called it: `verified_nonbinary` shipped
  the same day. Non-binary was already a gender option in onboarding and profile
  editing, so nothing was needed there. Anyone on "Rather not say" is still in none of
  the three gendered audiences, and the picker says so.

## Current status: **Phase 11 — the unaudited-areas sweep** (2026-08-21)

### Phase 11 — what nobody had looked at yet

Phase 10 answered the founder's ten-item list. This phase went after the parts
of the app that list never touched: onboarding, profile editing and photos,
trips and matching, accessibility, failure states, security beyond the pgTAP
suite, the data layer, the section 7 rules end-to-end through the client, App
Store shippability, and every user-facing string. Ten areas, audited in
parallel and then adversarially verified.

**Caveat on the verification.** The verifiers ran after most of the fixes had
already landed, so a "refuted" verdict there usually means "the code no longer
does this" rather than "the finding was wrong". Nineteen findings survived as
confirmed. One of them corrected me: I had dismissed a keyboard finding on the
strength of a screenshot of the sign-in screen, and the verifier pointed out
that `(auth)` sets `headerShown: false` while `onboarding` set it `true` — the
same shell, two stacks, only one of them broken.

The things that would have hurt most:

- **Every over-the-air update so far shipped an app pointed at nothing.** The
  TestFlight workflow's update step passed `EXPO_TOKEN` and no Supabase
  variables. Metro inlines `EXPO_PUBLIC_*` at bundle time and that bundling
  happens on the runner, so the published bundle fell back to
  `placeholder.supabase.co`. Builds were unaffected — they read the EAS
  environment named in `eas.json` — which is why this survived. The step now
  requires the secrets, passes them, and proves the bundle before publishing.
- **Posting in a group did nothing.** `useSendMessage` merged into the
  direct-chat cache key; rooms and groups read a different key holding a
  different shape. `useSendPhoto` had always invalidated both.
- **Rooms and groups had no realtime at all.** Two people in the same chat,
  both with it open, never saw each other.
- **Sending a photo in a one-to-one chat always failed.** `push_queue.body` is
  NOT NULL and a photo message has a null body, so the after-insert trigger
  took the message down with it.
- **The composer sat under the keyboard**, from a hardcoded
  `keyboardVerticalOffset` of 90 that is not the height of anything.
- **Removal from a group did not stick** — the same invite link still worked.
- **A group's photo was unreadable by everybody**, including the admin who
  chose it.
- **The three cron workers authorized nobody**, and the anon key ships in the
  app. The first guard was written, deployed, and **reverted the same hour**:
  it took the moderation worker down with it, so first messages were held and
  never released, with every check green. The second one is in and proven; the
  lasting change is that the deploy now POSTs each worker and requires a 401,
  so this class of failure cannot be silent again.
- **The binary asked for location, motion and Face ID**, in Expo's default
  wording, on an app whose whole promise is that it never asks.
- **Failure was reported as emptiness everywhere.** Offline, you were told you
  had no chats, no trips, no travelers, and that a friend's invite was dead.

Also: the privacy policy was describing an app that no longer exists, deleting
an account left every chat photo behind, a reinstall opened with a queue of
old celebrations, and the last em dashes in user-facing copy are gone.

### Still open after this phase

- ~~The cron workers are unauthenticated again~~ — the guard is back and
  verified on both sides. It reads the JWT's `role` claim rather than
  comparing key strings, and is written inline in each function rather than
  imported from `_shared`, which removes both candidate causes of the outage
  instead of picking one. Deploy run 25's smoke step got exactly 401 from all
  three workers using the anon key (alive, and refusing the credential that
  ships in the app), and live-backend run 8 on the same commit passed all
  fourteen assertions including the clean-message release, which is the cron
  path still getting through.

- **The reaction menu never opened, and the menu was never the problem.**
  Two fixes aimed at it (`0a2e28a` moving groups onto the shared thread,
  `c26bdd4` opening before the measurement lands) missed, because the long
  press never reached the bubble at all. The thread's `FlatList` was the only
  scroller in the app without `keyboardShouldPersistTaps`; the default is
  `'never'`, and React Native implements that by claiming the responder in the
  CAPTURE phase whenever a field has focus, so `Pressability` never runs
  `onResponderGrant` and never schedules its long-press timer. On release the
  list blurs the composer. E2E run 34's failure screenshot is that mechanism
  photographed: keyboard gone, thread slid down one keyboard height, no scrim,
  no menu, nothing crashed — and with a real keyboard up, only a list that had
  become the responder can produce that blur.

  It broke identically for a person: send a message, press and hold your own
  bubble, and nothing happens but the keyboard closing. The second press
  works. Same defect swallowed the first tap on a reaction chip, and it was
  live in one-to-one chats too, since both render `MessageThread`.

  Fixed with `keyboardShouldPersistTaps="handled"` (`64ec1b1`). The six
  component tests could never have caught it — `fireEvent` calls the handler
  directly and never enters the responder system — and the file's own comment
  used to claim Maestro could not drive a Pressable, which is false and is
  what excused a real failure once. Both are corrected, and the flow now
  asserts a `message-menu` testID as well as the Dismiss label so the next
  failure says which half broke. Recorded in the `traps` skill.

- **Shipped.** The JavaScript went out as iOS update
  `01a0250e-a712-7f38-ab5b-86d99eeb1702` (group
  `86c5c34b-2b4c-4a65-88b4-9c66ceec4bfc`) from commit `289ef67`, on branch
  `production`, runtime `0.1.0`. The database side went out on Supabase deploy
  run 26, which also proved all three workers alive and refusing the anon key.
  E2E run 38 is the picture of what that update contains.

- **The reaction menu now behaves like Messages.** The scrim was doing
  nothing visible (`rgba(6,7,16,0.62)` over `#0E1020` resolves to `#090A16`),
  so the menu floated over a live thread with the date separator legible
  between the pill and the actions. Darker now, and local to this menu rather
  than a change to `theme.scrim`, which every sheet shares.

  The keyboard also steps aside on the founder's call (`01622f8`). The
  ordering is the trick: the thread stands on a keyboard-sized floor and an
  inverted list is anchored to its own bottom, so every bubble slides DOWN by
  the keyboard's height as that floor collapses. Measuring at the press would
  pin the menu roughly a third of a screen above the message. Dismiss, wait
  for `keyboardDidHide`, two more frames for the floor's Reanimated style to
  commit, then measure. A 400ms failsafe means a press always produces a menu.
  Recorded in `traps`.

- **The contact form now delivers without a key.**
  `20260821150000_support_delivery.sql` adds a second channel: name yourself
  in `app_config.support_notify_recipients` and every incoming message raises
  a push on your phone, addressed so it can be read off the lock screen. One
  statement, and it takes your **email** rather than your user id:

  ```sql
  update public.app_config
     set value = jsonb_build_array('you@example.com')
   where key = 'support_notify_recipients';
  ```

  Email is still the better channel for App Review and still needs
  `RESEND_API_KEY` + `SUPPORT_INBOX` (founder-side). Neither channel can lose
  a message: the row lands first and delivery is only the notification.

- **The Info.plist change needs a build**, not an update. It is native config.
- **Being featured to signed-out visitors has no opt-out.** The policy now
  says so plainly; whether it should exist is a founder decision.
- ~~Rooms and groups send no push notifications~~ — fixed in
  `20260821140000_room_push.sql`. The room is the title and the sender opens
  the body, muting is honoured, and expired or archived members are skipped.

## Phase 10 — the launch-readiness pass (2026-08-21)

### Phase 10 — the founder's ten-item review, and what the screenshots found

Every item from the founder's device testing on 2026-08-20 is addressed.

- [x] **The E2E harness was screenshotting the wrong code.** expo-updates
      applies a downloaded update on the NEXT launch, and Maestro's
      `clearState` deleted the download first, so every reused-binary run
      pictured the binary's embedded JS while reporting green. The workflow
      now publishes with `--json`, primes the update and polls `expo-v2.db`
      for StatusReady, resets state by hand between flows, and FAILS rather
      than falling back. Recorded in the `traps` and `screens` skills. Every
      "verified by screenshots" claim made before this is suspect.
- [x] **Chat, rebuilt around the interaction.** Long press lifts the bubble
      out of a dimmed thread with the emoji row directly above it and the
      actions directly below (it was a slab in the middle of the screen);
      one reaction per person per message, enforced by the primary key;
      unsend, archiving the original first so a report stays reviewable;
      photos wait in a preview until you press send; timestamps moved out of
      the bubbles into separators; sent bubbles use the brand blue as a fill
      under white.
- [x] **Individual / Groups** segmented header; the big "Chat" title is gone.
- [x] **Traveler groups** — anyone can start one, speaking permissions that
      are real permissions, admin removal, invite links with a stay-until
      date capped by the admin's maximum, membership that expires on its own.
- [x] **Pin search suggests as you type**, and the drop-a-pin form fills its
      own location block from the search result, links into Maps, drops the
      activity-type row, and gives the lifetime a 1–72 hour slider. The
      details box no longer traps the keyboard.
- [x] **The map went warm** — amber pins and an amber-to-ember heat scale, so
      it reads on the dark basemap; controls went back to the brand blue.
- [x] **Traveler profile** — photo, then everything the profile says, then
      the rest of the photos, one per row; a reply bubble on every photo and
      every written block opens the composer quoting that specific thing.
- [x] **Languages** — the full ISO 639-1 set, searchable, English pinned.
- [x] **Contact form** replaces the founder's published email address.
- [x] **The map freeze** after viewing a pin's profile (a Sheet's scrim
      surviving a `router.push` out from under it).
- [x] **The traveler counter** is gone.

**Found by the first honest screenshots** (and fixed): sign-in could not be
completed because tapping the password field with the keyboard up does not
move focus on iOS; the sign-in back button said "join"; React Navigation's
DarkTheme left a seam at every header; the segmented control was inside out;
the selected city was nearly invisible; the guest travelers card pushed its
own sign-up card off the screen and rendered an empty photo frame.

**Shipped 2026-08-21.** All three migrations
(`20260820230000_chat_reactions_and_unsend`, `20260821000000_support_messages`,
`20260821010000_traveler_groups`) applied on Supabase deploy run 20, and the
JavaScript went out as iOS update `01a021dc-3e10-7739-a751-7245751b745c`
(group `167d5dae-f8a0-42d0-b2c7-cbc8e6ccab5d`) from commit `5e58d48`.

**Waiting on the founder:**

1. **The contact form needs two repo secrets** to actually email:
   `RESEND_API_KEY` and `SUPPORT_INBOX` (plus `SUPPORT_FROM` once a domain
   is verified). Until they exist, messages still land in the
   `support_messages` table and are readable from the dashboard — the deploy
   skips that step, which is the expected state. The push channel above needs
   nothing but the one SQL statement, so the form can be live before either
   secret exists.
2. **Add a `TEST_EMAIL_BASE` repo secret** (any inbox you can read; the
   suites plus-address it). Hosted Supabase rejects RFC-2606 test domains, so
   the test accounts fall back to a literal address in `tests/live` and
   `e2e/account.mjs` — both workflows now pass the secret when it exists, and
   the literal comes out of the repo the moment it does.
3. **A real support address** is still needed for App Store Connect and the
   privacy policy. Removing the personal one from the repo stops it
   spreading; it does not unpublish it from the history of a public repo.
4. **Visual reviews now cost a build credit.** The simulator on GitHub's
   runners cannot reach `u.expo.dev` (TLS, environment not config), so the
   E2E suite must embed the code under test rather than fetch it. `build`
   defaults to true for that reason; see the `traps` skill.

## Current status: **Phase 9 — the craft pass** (2026-08-19)

### Phase 9 — Research-backed beauty + the founder's fix list

Six parallel research agents surveyed the HIG, award-tier apps, map UX,
motion, color, and the RN engineering of all of it — full synthesis and the
deliberately-deferred ideas list in [`DESIGN.md`](DESIGN.md) ("The craft
pass"). Shipped on top of it:

- [x] **Drop-a-pin rebuilt in place** (founder ask): docked amber action →
      placement mode on the same map — fixed center pin with lift/settle
      springs + haptics, on-device address search (CLGeocoder, no keys, no
      user location), form as a sheet over the map, posted pin drops in
      selected
- [x] **Map pins redesigned** (founder ask): emoji stickers → ringed indigo
      category-glyph markers, amber star for curated seeds; correct Apple
      Maps anchoring (`centerOffset` — `anchor` is Google-only), collision
      priority, camera nudge above the detail sheet
- [x] **Avatar first-tap bug** (founder ask): root causes addressed — glass
      is now decorative-only under touch targets, and press-scale transforms
      moved off the Pressable's hit rect (Fabric hit-tests transformed rects)
- [x] **Press physics + haptic vocabulary everywhere** — PressableScale +
      semantic haptics; spring tokens match the iOS system feel
- [x] **HIG iOS 26 fixes** — untinted glass tab bar, Title Case sections,
      warm ink text, staggered card entrances, brand-indigo splash overlay
      (was template blue), campfire mark on the welcome hero
- [x] **E2E now drives the signed-in app** — throwaway account created and
      onboarded per run, Maestro signs in, drops a real pin through the new
      flow, opens the profile via the avatar, account destroyed after

**Audit outcome (2026-08-19):** live-backend canary 17/17 twice; simulator E2E
walked sign-in → place mode → pan → form → **a real pin posted and refetched
onto the map** → signed-in Travelers → profile via the avatar's FIRST tap.
Screenshots confirmed the indigo tab tint and the amber dock. Two cosmetic
fixes from the screenshots (back chevron said "(tabs)"; PHOTOS → Photos) are
committed but their on-device validation run could not start: the GitHub
Actions minutes ran out. **Decision: the repo goes PUBLIC while building**
(unlimited free standard-runner minutes) and flips private before real users
arrive — runbook step 4 is the gate. Prep is done: the moderation classifier
prompts moved to the `MODERATION_PROMPTS` secret and were redacted from all
git history before publication. The founder adds that GitHub secret, flips
visibility, then the next Supabase deploy re-arms the worker (it fails closed
until then). The one stray test account (an early workflow bug skipped its
teardown) was deleted by the founder on 2026-08-19 — no test data remains
visible to real users.

**The founder's idea batch (2026-08-19)** — all shipped and E2E-validated:

- [x] **First-run tour, now cinematic** — the splash dissolves into an indigo
      welcome scene (the campfire mark never leaves the screen), "Connect.
      Plan. Explore. / Welcome to the Samewhere community." staggers in, and
      "Show me around" starts the tour: the mark glides up into a docked
      emblem while pages parallax underneath, dots and all driven by the live
      scroll offset. Ends in join-or-browse; 'Skip' stays in the corner (the
      E2E flows key off it)
- [x] **Guest profile screen** — the header avatar always lands somewhere real
      now: signed out it invites join/sign-in (root cause: the route lived
      inside the auth guard, so guest taps silently no-oped)
- [x] **Demo travelers** — Actions → **Demo travelers** seeds/purges six
      AI-portrait personas (Lisbon ×3, Bangkok ×3) with pins and overlapping
      trips so Travelers/matching/requests are testable on a phone; `[demo]`
      bios, `DEMO_PASSWORD`-gated sign-in; purge is a runbook step 4 gate
- [x] **Pins wear their poster's face** — signed-in users see the poster's
      photo in the marker (guests get plain glyphs, enforced server-side);
      the pin sheet links to profile and message request
- [x] **One clear signup** — email/password page says it's step one of two,
      then a single profile builder (photos, basics, bio) ends in "Create
      account"; everything editable later
- [x] **Copy pass + the yes moment** — casual, direct copy throughout, em
      dashes gone from app copy; when a message request is accepted, a
      full-screen celebration springs the accepter's photo in with haptics
      and opens the chat ("Connected with {name}")

### Phase 10 — The founder's review batch (2026-08-19)

A full pass on a real device produced thirteen asks, all researched with a
subsystem-by-subsystem map before anything was rewritten. Shipped:

- [x] **Signup is six screens, not two.** Email, then password twice, then
      name/age/gender (a dropdown, no explainer), home and languages, the
      optional bio/occupation/socials, and photos last. One shared shell with
      a springing progress bar and slide-through transitions. **The tour's
      "Make my profile" now opens account creation** — `/email` opened in
      sign-in mode for everyone, so every new user was asked for a password
      they had never set
- [x] **One profile.** Own and other-traveler profiles were two different
      pages; they are now the same component, photo first with the name over
      it, so what you see of yourself is what a stranger sees. Owner gets
      edit affordances on the same page
- [x] **Trips are the headline.** Add, edit and delete them on the profile,
      every planned trip visible to others, and every shared window shown in
      Travelers instead of only the nearest one. Matching looks a season
      ahead rather than a fortnight
- [x] **Travelers is one person at a time** — full profile, say hi or move
      on; skipped people return after a fortnight
- [x] **Optional occupation/school line**, and **socials with real platform
      logos**, an automatic @ where it belongs, and one-tap add
- [x] **The handles bug**: the public profile drew a hardcoded "hidden" card
      and never fetched. It asks now, RLS decides, and accepting invalidates
      the query so the unlock is immediate
- [x] **Chat looks like chat** — grouped bubbles with tails, day separators,
      in-bubble timestamps, long-press reactions. Hostel rooms take your real
      checkout date instead of three preset buttons
- [x] **Drop-a-pin works.** The search field's input was mounted inside a
      native visual-effect view, so it never received a tap; the sheet's
      keyboard lift was unclamped, so the form rode off the top of the
      screen. Pins now carry details and the street they sit on, and "Ask
      about this plan" opens a chat with the question already written
- [x] **Tone.** No more "not a dating app", "keep it platonic", "no
      flirting", or the 3/5/7 ban tally; a first message is a message, not a
      "request"; the celebration says "Connected with {name}" with a "Go to
      chat" button. Push notification copy rewritten to match

**Privacy note for the founder:** making trips visible on profiles is a
deliberate widening — upcoming trips of a discoverable traveler are readable
by any signed-in traveler now, where before you could only see trips that
overlapped your own. Past trips stay private, blocked and hidden accounts
stay invisible, and no live location is involved. A first pass exposed the
whole trips table to a bulk read; that was caught in review and replaced
with a gated call before any client used it.

## Phase 8 complete — Samewhere is on TestFlight, audited end-to-end (2026-08-19)

### Phase 8 — Identity, TestFlight, and Claude's eyes

- [x] **Name: Samewhere** (six rounds, ~950 candidates — [`NAMING.md`](NAMING.md)); slug,
      scheme, and bundle ID (`com.mattmoore.samewhere`) all wired. Apple accepted the app
      record under the name, which doubles as the availability check
- [x] **Dusk palette** — indigo `#2A4C9B` + burnt amber, every pair WCAG-checked
      ([`DESIGN.md`](DESIGN.md)); **campfire mark** (O4) rendered to icon / splash /
      adaptive-icon / in-app brand from `assets/icon-src/`
- [x] **TestFlight pipeline** — Actions → **TestFlight** builds, signs, and submits with
      zero interactive steps; certificates are minted per-build straight from the App
      Store Connect API ([`APP_STORE.md`](APP_STORE.md) has the war stories). **The app
      is live on TestFlight**
- [x] **Claude's eyes: simulator E2E** — Actions → **E2E simulator** builds the app,
      drives it with Maestro on an iOS simulator, and pushes screenshots to the
      `e2e-results` branch, so the agent can see and audit real native pixels
- [x] **Live-backend canary** — anon-key-only integration tests against the production
      Supabase (Actions → **Live backend tests**, weekly + on demand): 17/17 green,
      including a real Claude moderation release (~21 s) and a flirty message that never
      arrived
- [x] **Two real bugs caught by the harnesses**: signups were silently dead-ended by the
      email-confirmation toggle (now off for v1 — see runbook), and the selected tab
      rendered iOS system blue instead of the accent (fixed: `NativeTabs` needed
      `tintColor`)

---

## Phase 7 complete — design overhaul + guest mode + rooms (2026-08-17)

### Phase 7 — Beautiful, frictionless, and room-shaped

Research-backed redesign (sources in [`DESIGN.md`](DESIGN.md)): iOS 26 Liquid
Glass is the native language now, and `expo-glass-effect` ships in our SDK, so
"modern" means native rather than imitated.

- [x] **Design system** — trail-green palette (deliberately unlike every dating
      app), warm canvas, seven-role type scale, 4pt spacing, elevation/motion
      sets, `GlassSurface` primitive with an opaque fallback
- [x] **Three tabs** — Map · Travelers · Chat, with Profile behind the header
      avatar; 9 photo slots per profile
- [x] **Guest mode** — the tabs are the front door for everyone. No account
      needed for the map (curated pins in full, user pins with no identity
      attached), the heat layer, one featured traveler, or reading an
      establishment room. The account is asked for at the moment of action
- [x] **14-day traveler window** — matching opens two weeks before arrival, and
      cards show the whole stay, not just the overlap
- [x] **Establishment rooms** — hostels/hotels run a room; joining asks only
      when you leave; membership ends 7 days after that, capped at 30; staff
      can remove messages and members; pin/mute/archive plus 14-day
      auto-archive (Hinge-style: archived stays readable)
- [x] **Reactions and photo messages** — long-press for quick emoji; chat
      photos go through the same moderation pipeline as profile photos, which
      is not optional in a publicly-readable room
- [x] 36 new database assertions (suite: **268**)
- [x] **Screen-by-screen visual redesign** — map pin detail is a real bottom
      sheet under floating glass controls; traveler cards lead with a 4:5
      photo; the chat list splits into requests / pinned / chats / rooms /
      archived; both profile screens open on a full-bleed hero photo with the
      name set over a gradient scrim, and your own gallery shows empty slots up
      to the six-photo target rather than describing the gap
- [x] **Web preview is honest again** — the web-only tab bar was anchored to
      the top and floating over every screen title (web reports a zero top
      safe-area inset). It now sits at the bottom like the real iOS tab bar,
      and screens reserve room for it

---

## Phase 6 complete (2026-08-17)

### 🎉 The backend is LIVE

The Supabase project exists and is provisioned: all migrations applied (schema + 9,062
cities), `push-worker`, `moderation-worker`, and `delete-account` deployed. Provisioning
runs from GitHub Actions (**Supabase deploy** workflow) because development happens from a
phone — credentials live in GitHub's encrypted secret store, never in the repo or a chat.

**Before real users touch it, do [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) step 1**: the
moderation pipeline ships _dark_ (photos auto-approve; messages get the regex filter only)
until `ANTHROPIC_API_KEY` is set, both workers are scheduled, and the two `app_config`
flags are flipped.

### Phase 6 — Launch hardening: done

**Database (pgTAP suite now 232 asserts, all green):**

- [x] **Velocity caps** on every hot write path — messages 30/min; requests 30/day; reports
      10/day; trips 20/day; pins 30/day; photos 25/day; blocks 50/day; profile updates
      30/day; plus storage-object ceilings (30 photos / 10 selfies). The Phase 2–5 caps
      bounded _state_; delete-and-recreate churn defeated them, so these bound _rate_
- [x] **Oracle-proof errors**: every relationship failure in `send_message_request` now
      returns one indistinguishable message — distinct errors let a sender detect a block
- [x] **Profile text screening**: `display_name`/`bio` (broadcast to every overlapping
      traveler) now pass the same pre-filter as first messages
- [x] **Admin metrics views** (service-role only): `admin_liquidity` (the liquidity
      number), `admin_request_funnel`, `admin_moderation_stats`, `admin_pin_stats`, and
      `admin_ops_health` — the one-query liveness check for both workers and pg_cron
- [x] Account-deletion cascade proven: profile, photos, trips, pins, requests, tokens, and
      reports all die; the moderation audit spine survives with the subject nulled

**App:**

- [x] **In-app account deletion** (App Review 5.1.1(v)) — Profile → Delete account →
      `delete-account` Edge Function (storage both buckets, chats for both sides, auth user)
- [x] **Guidelines + consent + support contact** (App Review 1.2) — `/guidelines` readable
      before sign-up, consent line on the welcome screen, support mailto
- [x] "Be the first pin" empty state on the map, per city and per date filter
- [x] `eas.json` build profiles, encryption declaration, microphone permission suppressed
- [x] `trip_created` now carries `starts_within_days` so §6's _within-trip-window_
      retention is actually computable

**Docs (the launch-operations set):**

- [x] [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) — go-live in order, with rollback levers
- [x] [`APP_STORE.md`](APP_STORE.md) — privacy labels, review notes, TestFlight, EAS env vars
- [x] [`DASHBOARD.md`](DASHBOARD.md) — every §6 metric mapped to a PostHog insight or SQL view
- [x] [`legal/`](legal) — community guidelines + privacy policy drafts (founder review, then legal)
- [x] `supabase/seed/launch_pins.sql` — 20 curated pins across the four launch cities

**Verification:**

- [x] Adversarial launch audit (4 lenses → 23 agents, App Store / abuse / privacy / ops):
      22 findings, 15 confirmed, all fixed. Standouts: the block-detection oracle; unbounded
      storage uploads; profile text bypassing moderation entirely; Edge Functions having no
      static checks; cloud builds shipping with no backend keys
- [x] typecheck, lint, format, 25 Jest, 232 pgTAP, Deno typecheck of all three functions

---

Previous phases below.

## Phase 5 complete (2026-08-17)

### Phase 5 — Trust & safety: done

**Database (pgTAP suite now 209 asserts, all green):**

- [x] **Hard rule 5 completed**: with `require_llm_moderation` on, a first message that
      clears the regex pre-filter is HELD (`pending_moderation` — invisible to the
      recipient, masked as "sent" to the sender, no push) until the Claude classifier's
      verdict; the only exit from the held state is a service-role-only RPC. Fail-closed:
      API outages never deliver an unscreened message (and never strike innocent senders —
      failsafe blocks are non-strike and retryable)
- [x] Server-only `app_config` flags (`require_llm_moderation`, `require_photo_moderation`,
      both default off) keep keyless dev/CI on exact Phase 2–4 behavior
- [x] **Strike ladder** on the `moderation_events` audit spine: 3 strikes → warning push,
      5 → 7-day suspension, 7 → permanent ban; suspensions auto-lift (pg_cron, guarded);
      all transitions audit-logged and pushed
- [x] **Standing gates in Postgres**: suspended/banned accounts refused at
      `send_message_request`, `respond_to_message_request`, chat-message RLS, and
      verification; blocks filed while a message is held sever it, and release re-validates
      the pair (belt and braces — both tested)
- [x] Photo moderation swap-in: flag on → uploads hold at `pending` (owner-only visible)
      for Claude vision review; reject = strike + push; flag off = Phase 1 stub behavior
- [x] Selfie verification: write-only `verification-selfies` bucket (no client reads,
      ever), `submit_verification` RPC (own-folder + object checks, one pending, 3/day),
      Claude-vision likeness verdict → `profiles.verified` badge + server-only evidence.
      Honestly labeled a likeness check, not identity/liveness verification
- [x] **Admin report review queue**: `admin_report_queue` view (status, strike count,
      report totals per reported user) + `admin_resolve_report`
      (dismiss/warn/strike/suspend/ban/shadowban) — service-role only, runtime-guarded
- [x] 75 new pgTAP assertions covering every gate, privilege, and ladder step above

**Edge Function (`supabase/functions/moderation-worker`):**

- [x] Drains all three queues (~1/min schedule): held messages, pending photos, pending
      verifications; `claude-opus-5` with structured outputs (typed allow/block verdicts);
      model refusals treated as blocks; retry bookkeeping with failsafe caps;
      `ANTHROPIC_API_KEY` lives only as a Supabase secret

**App:**

- [x] Account gate screen (suspended-with-date / banned) at the root navigator —
      `users.status` + `suspended_until` are self-readable; DB enforcement is independent
- [x] Get-verified flow: profile-tab entry → selfie capture (front camera, library
      fallback) → write-only upload → status card (in review / rejected reason / verified)
- [x] Photo grid shows "In review" / "Removed" badges from the live moderation status
- [x] Code-review pass: 12 findings, all fixed. Standouts: the strike ladder's
      suspend→lift path could launder a shadowban into a fully active account; a
      shadowbanned sender's released message would have ghost-notified its recipient (now
      full-illusion suppression: "delivered" to the sender, silently declined in the DB);
      the Phase 5 migration would have failed on any already-provisioned database (enum
      value now lands via its own ALTER TYPE migration); admin actions that can't apply
      logged phantom audit events (now raise); verification selfies are deleted from
      storage the moment a verdict lands
- [x] Verified: typecheck, lint, format, 25 Jest tests, 209 pgTAP tests

### Phase 5 deliverable check

"A flirtatious first message from a test account is blocked before delivery and logged":
proven twice over in `08_trust_safety.test.sql` — the pre-filter path blocks instantly
(Phase 2, still tested) and the classifier path holds → blocks → strikes → notifies without
the recipient ever seeing a row. Live end-to-end additionally needs the Supabase project +
`ANTHROPIC_API_KEY` secret + the two flags flipped (see
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)).

---

Previous phases below.

### Phase 4 — Chat & realtime: done

**Database (pgTAP suite now 134 asserts, all green):**

- [x] `messages`: member-only RLS, active-chat-only sends, streamed via RLS-filtered
      Supabase Realtime (publication add guarded for keyless environments)
- [x] **Block vs unmatch semantics**: block freezes the chat (history preserved as report
      evidence; unmatch refused on closed chats so an abuser can't delete the record);
      unmatch hard-deletes chat + messages for both (brief §1), request row survives
- [x] `reports` (reason enum + details + context) — insert-only, auto-logged to
      `moderation_events` for the Phase 5 review queue
- [x] Push pipeline: server-only `push_queue` filled by triggers (new request → recipient,
      accept → sender, message → other member), `push_tokens` with shared-device
      reassignment RPC, `push-worker` Edge Function (chunked Expo API delivery, dead-token
      pruning, retry-on-failure) ready to deploy + schedule

**App:**

- [x] Live chat screen: realtime message stream + always-refetch-on-mount (no lost
      messages), composer, first-message context bubble, unlocked-socials strip, closed-
      chat state
- [x] Safety tooling everywhere: chat menu (view profile / report / block / unmatch with
      confirmations), report + block on public profiles, report modal with platonic-app
      reason set ("Flirting / sexual" is front and center)
- [x] Push registration wired post-sign-in (silently skips Expo Go/simulator/pre-EAS;
      never prompts signed-out users)
- [x] Inbox: last-message previews, activity ordering, closed badges
- [x] Verified: typecheck, lint, 25 Jest tests, 134 pgTAP tests, iOS+web export (27 routes)
- [x] Code-review pass: 5 findings, all fixed (incl. unmatch-on-closed evidence deletion
      and a lost-messages cache bug)

### Phase 4 deliverable check

Full loop from either surface to a live conversation: overlap-or-pin → request →
moderation → accept → push → realtime chat → socials unlocked — every hop implemented, the
DB legs proven by tests. Live end-to-end still waits on the Supabase project keys.

---

Previous phases below.

### Phase 3 — The Map (hero feature): done

**Database (pgTAP suite now 98 asserts, all green):**

- [x] `launch_cities` geofence/flag table seeded with Lisbon, Mexico City, Bangkok,
      Denpasar (per-city radius + heat-k; founder toggles `active`)
- [x] `pins`: venue-level future intent. **Hard rule 3 structural**: 72h CHECK + no UPDATE
      grant (immutable) + RLS hiding expired pins from everyone _including the owner_ +
      hard-delete sweep (pg_cron on hosted, guarded locally)
- [x] Geofence trigger (haversine, no PostGIS needed), active-city check, 10-pin cap
- [x] **Hard rule 6 structural**: `heat_cells()` is the only heat path — k distinct pinners
      per ~550m cell or nothing renders; identifier-free output; seeded pins feed the
      cold-start heat
- [x] Seeded pins (admin-inserted, no user attached, `seed_note` for curated events)
- [x] `send_message_request` extended with the `pin` source (recipient must have a live pin)

**App:**

- [x] Native map (react-native-maps/Apple Maps — decision resolved, see ARCHITECTURE):
      city switcher chips, emoji category markers, heat-cell underlay, pin detail card
      (profile + Say hi, or curated note for seeded pins, Remove for own), drop-pin FAB
- [x] Drop-pin modal: venue text, category, intent day, **user-set duration ≤72h**
      (brief §1), tap/drag map placement — no venue-search API needed for v1 (flagged)
- [x] Pin → compose-request flow with `source='pin'`
- [x] §6 metrics: `map_viewed`, `heatmap_rendered`, `pin_created`, `pin_tapped`
- [x] Verified: typecheck, lint, 25 Jest tests, 112 pgTAP tests, iOS+web export (26 routes)
- [x] Adversarial review (rounds for Phases 2 and 3) — all confirmed findings fixed and
      regression-tested. Standouts: a trip-cap bypass via cancel/reactivate that would have
      enabled travel-plan scraping (critical); a heatmap differencing attack that could
      localize a user who blocked you (critical — `heat_cells` is now SECURITY INVOKER, so
      heat can only ever summarize pins the caller's own RLS already shows them, making the
      attack impossible by construction); blocks now sever pending requests and active chats
      instantly; accept-time re-validation; full public-profile view before accept/decline;
      clock-skew-safe pin expiry; coherent intent-date/duration pairing; today/tomorrow heat
      filter on the map

### Phase 3 deliverable check

"The map is compelling with 15 pins on it": the rendering path (markers + heat + cards) is
built and the seeded-pin mechanism exists to guarantee those 15 pins in each launch city on
day one. Actual visual verification on a device needs the Supabase keys + a seeded project
— the seed SQL is one INSERT per curated pin (documented in ARCHITECTURE).

---

Previous phase (2) summary below.

Phases 0 and 1 finished earlier the same day (CI green, incl. the DB RLS job). Phase 1's
adversarial review findings were all fixed and regression-tested before Phase 2 started.

### Phase 2 — Trips & matching: done

**Database (pgTAP suite now 77 asserts, all green):**

- [x] `cities` reference table: 9,062 GeoNames cities (pop ≥50k) bundled as a generated
      seed migration + `search_cities` autocomplete RPC — **no places-API key needed for
      v1** (deviation from brief §5 "places API", rationale in ARCHITECTURE; approve or
      veto)
- [x] `trips` with overlap-gated visibility: travel plans readable only through a real
      city+date overlap; blocks + shadowban + onboarding gates respected; ≤5 active trips
      (anti-scrape); no past trips
- [x] `message_requests` via RPCs only: **moderation pre-filter before delivery** (hard
      rule 5 seam — regex blocklist now, Claude classifier in Phase 5), blocked messages
      never reach recipients and are audit-logged, retry-after-rewrite allowed, one
      delivered request per pair ever
- [x] **Invariant 4 enforced**: senders read outgoing requests only through
      `sent_requests()`, which collapses pending/declined/expired into 'sent' — a decline
      is indistinguishable from silence (tested)
- [x] Accept path creates the chat that unlocks social handles — the full loop
      (overlap → request → moderation → accept → chat → handle reveal) is covered by tests
- [x] `blocks` table live ahead of Phase 4 UI

**App:**

- [x] Travelers tab: trip chips (add/cancel), match cards (photo, verified badge, shared
      window, bio) with per-recipient request state (Say hi / Requested / Open chat)
- [x] Add-trip modal: city autocomplete + native date pickers, client-side mirrors of the
      DB date rules
- [x] Compose-request modal: Hinge-style profile-element anchor + message, moderation-block
      feedback with rewrite guidance
- [x] Inbox: incoming requests with accept/decline → chat; chat list
- [x] Chat shell (`/chat/[id]`): first-message bubble, **socials-unlocked card** proving
      the accept-gate end-to-end, Phase 4 note for live messaging
- [x] PostHog liquidity events (`trip_created`, `request_sent{delivered,blocked}`,
      `request_responded`) — no-op until a key exists
- [x] Verified: typecheck, lint, 19 Jest tests, 77 pgTAP tests, iOS+web export of all 24
      routes

### Phase 2 deliverable check

Two accounts with overlapping trips: request → accept → chat shell — the exact flow is
proven end-to-end at the DB layer by `05_message_requests.test.sql` and implemented in the
UI. Live execution still waits on Supabase keys (below).

### Phase 1 — Auth & profiles: done

**Database (fully tested):**

- [x] Migrations for `users`, `profiles`, `profile_photos`, `social_handles`,
      `moderation_events`, and read-only `chats`/`chat_participants` stubs
      (`supabase/migrations/`)
- [x] **Hard rule 4 enforced in Postgres**: social handles readable only by the owner or a
      user sharing an active accepted chat; unmatch re-hides them
- [x] Server-owned columns (`verified`, `moderation_status`, `users.status`) stripped from
      client grants — self-verification is impossible at the DB layer
- [x] Photo moderation stub trigger (auto-approve + audit log) at the exact chokepoint the
      Phase 5 pipeline will occupy; 7-photo cap; shadowban visibility semantics
- [x] Private `profile-photos` storage bucket with owner-folder write policies
- [x] **43 pgTAP assertions** proving all of the above, runnable anywhere via
      `scripts/db-test.sh` (local Postgres + Supabase shim, no Docker) — wired into CI as a
      second job

**App:**

- [x] Email/password auth + Sign in with Apple flow (Apple needs an EAS dev build + provider
      config; gated off gracefully in Expo Go)
- [x] Encrypted session persistence (keychain AES key + AsyncStorage ciphertext),
      unit-tested
- [x] Route guards: signed-out → welcome/email; signed-in-incomplete → 6-step onboarding
      (resumable; each step saves server-side); complete → tabs
- [x] Onboarding: name/age/gender → home → languages → photos (picker → client resize →
      private bucket upload) → bio → socials
- [x] Profile tab: real profile view (avatar, gallery, languages, bio, verified badge slot,
      locked-socials card) + modal edit screen covering every field
- [x] Verified: typecheck, lint, 15 Jest tests, 43 pgTAP tests, and full iOS+web bundle
      export of all 16 routes
- [x] Adversarial multi-agent review (RLS security, brief compliance, React/Expo, Supabase
      client lenses) — 8 confirmed findings all fixed, incl. a critical relationship-graph
      leak via viewer-parameterized RPC-exposed policy helpers (now caller-scoped +
      regression-tested), client-readable verification evidence (now column-gated), an
      offline dead-end in the route guards (now an error screen with retry/sign-out), and
      silent mutation failures (now surfaced globally)

### Phase 1 deliverable check

Create account → build full profile → view own profile: **implemented and compiling**, but
end-to-end execution needs a real Supabase project (keys below). The DB layer is fully
tested locally; the moment `.env` is filled and migrations are pushed, the flow is live.

## Next: ship it

All six phases are built. What remains is founder-gated, not engineering-gated:

1. **Runbook step 1** — Anthropic key + schedule the workers + flip the two flags, so
   moderation is live before anyone real uses it.
2. **Apple Developer Program** → EAS build → TestFlight (guide written and waiting).
3. **Decide the name**, set the support email, get the legal drafts reviewed.
4. **Open Lisbon only**, seed pins every couple of days, watch `admin_liquidity` toward
   500–1,000 before opening city #2.

## Needs founder input

1. **PostHog key** — §6 metrics ("instrument from day one") are fully wired but no-op
   until `EXPO_PUBLIC_POSTHOG_API_KEY` exists. Create a free PostHog project and drop the
   key in `.env` whenever you want the liquidity dashboard to start filling.
2. **Card-stack deviation** — the brief says "browsable card stack"; v1 ships a scrollable
   card _list_ (each card links to the full profile). A swipe-paged stack is a contained UI
   change on the same data if you want it — say the word. (Hinge itself is a scroll feed;
   the accept-gate mechanics are what matter and are fully implemented.)
3. **Places-API deviation (cheap to veto now)** — v1 city autocomplete uses a bundled
   GeoNames table (9k cities) instead of a paid places API. Zero keys/cost, works offline;
   tradeoff: prefix-only search of city names (no neighborhoods/venues). Phase 3 venue
   search will need its own answer regardless. Say the word if you want Google/Mapbox
   autocomplete instead.
4. **Supabase project (the one real blocker)** — full step-by-step walkthrough now lives
   in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) (~15 min: create project → copy two keys →
   `.env` → `supabase db push` → auth settings → verify).
5. **Anthropic API key + live moderation** — ✅ **DONE 2026-08-18.** Key synced to Edge
   Function secrets; both workers scheduled by pg_cron from
   `20260817230000_schedule_workers.sql`; Vault credentials set via
   `public.set_worker_credentials()`; both `app_config` flags flipped to `true`.
   Verified: `worker_status()` shows 200s on consecutive ticks and
   `admin_ops_health` reads all zeros.

   **Exercised 2026-08-19.** The live-backend canary (Actions → **Live backend tests**,
   `tests/live/live-backend.mjs`, also scheduled weekly) ran the runbook's own check
   against the production project: a clean first message was released by a real Claude
   verdict in ~21 s, a flirty first message was still undelivered after a 4-minute
   watch, and 17/17 checks passed — handle gating pre/post-accept, guest RLS, and
   delete-account teardown included.

   **Email confirmation is OFF for v1.** The canary's first run caught that with
   Supabase's "Confirm email" toggle on, `signUp` returns no session and the app has no
   confirmation deep-link flow — every real signup silently dead-ended. The toggle is
   now off (founder, 2026-08-19). Before public launch: either keep it off knowingly or
   build the deep-linked confirmation flow, then re-enable.

6. **Apple Developer Program** ($99/yr) — needed before Apple Sign-In can be tested
   end-to-end (entitlement + Services ID, then enable the Apple provider in Supabase Auth).
   Email auth works without it. Also unlocks EAS dev builds, push (Phase 4), TestFlight
   (Phase 6).
7. **Bundle identifier** — now `com.mattmoore.samewhere`. Deliberately kept under the
   `com.mattmoore` namespace rather than `com.samewhere.*`, because the convention is to
   use a reverse-domain you actually control and `samewhere.com` belongs to someone else.
   This is the last comfortable moment to change it — it is fixed after the first App
   Store submission.
8. **Working name** — **Samewhere**, chosen after six rounds and ~950 candidates
   ([`NAMING.md`](NAMING.md)). One check is still owed and only the founder can run
   it: an **App Store search** for the name. The sandbox can reach neither the
   iTunes Search API nor RDAP/WHOIS, so no collision check was possible from here.
   Everything is wired up, but treat the name as provisional until that search
   comes back clean — it is cheap to swap now and expensive after submission.
9. **Branch** — everything is on `claude/travel-app-initial-setup-ephphz`; merge to `main`
   via PR whenever you're ready.

## Open technical flags

Note per brief §6 ("instrument from day one"): PostHog wiring is scheduled for Phase 2 with
the first liquidity events (trips/matching) — Phase 1 has no meaningful liquidity events to
record. Flagging the small deferral for your sign-off.

See "Technical flags" in [`ARCHITECTURE.md`](ARCHITECTURE.md). New this phase: selfie
verification shipped as an honestly-labeled Claude-vision likeness check — a certified
liveness vendor stays a deliberate deferral until fraud data justifies the cost; LLM
moderation adds ~1min max delivery latency (worker schedule) while the flag is on.

## Phase ledger

| Phase                 | Status  | Deliverable                                               |
| --------------------- | ------- | --------------------------------------------------------- |
| 0 — Repo & scaffold   | ✅ done | Fresh clone → `npx expo start` works                      |
| 1 — Auth & profiles   | ✅ done | Account + full profile viewable in app (E2E pending keys) |
| 2 — Trips & matching  | ✅ done | Overlap request → accept → chat shell (E2E pending keys)  |
| 3 — The Map (hero)    | ✅ done | Compelling map with 15 pins (seeding path ready)          |
| 4 — Chat & realtime   | ✅ done | Full loop to live conversation (E2E pending keys)         |
| 5 — Trust & safety    | ✅ done | Flirty first message blocked + logged (proven in pgTAP)   |
| 6 — Launch hardening  | ✅ done | Rate limits, deletion, dashboards, runbook, store prep    |
| 7 — Design overhaul   | ✅ done | Guest-first 3-tab app, rooms, photo-forward screens       |
| 8 — Name & TestFlight | ✅ done | Samewhere on TestFlight; E2E + live canary both green     |
| 9 — UX/UI audit build | ✅ done | All 43 audit findings implemented (see below)             |

## Phase 9 — the UX/UI audit build

Ten researchers looked at the app against Hinge, Raya, Tinder and Bumble and came
back with 43 findings: a top ten, 21 quick wins and 12 bigger bets. All 43 are in.

**The ten that mattered most.** An unread nervous system (`last_read_at`,
`my_chats.unread_count`, row dots, tab badge, mark-read on open and on receipt);
the Travelers hero repaired (the photo was being SHRUNK by the name under it);
the say-hi loop closed (confirmation, queue advances, a "You said hi" section);
Apple Sign-In and the consent line rescued from an orphaned welcome screen;
push-permission priming instead of an ambush at signup; a featured traveler with
a profile worth teasing; password recovery that recovers; a heat layer that merges,
glows and explains itself; a non-modal pin card over a live map; and your own
profile reachable from every tab.

**The bigger bets.** Travel prompts with reply chips (`profile_prompts`); the
daily mutual spotlight (`daily_spotlight`, symmetric score, no appearance
input); an optimistic composer with a real delivery ladder; avatar-stack
markers for same-venue pins; verification surfaced where trust is spent; a
daily first-message cap (safety limit, **never** a tier — §7 rule 1); exhausted
states that create supply; two-sided moderation softening; invite QR codes;
pinned messages; run-final avatars; and skeletons on the two cold lists.

Database: six migrations, 417 pgTAP assertions (up from 351). Client: 141 unit
tests (up from 75).

### And then the pictures found the one that mattered

The simulator run after all of that posted a pin and stopped responding.

Three screenshots — the confirmation card, the next tab, and the failure
shot — came back BYTE-IDENTICAL. Between them the driver tapped Close,
Travelers, Map and the profile avatar; Maestro found every one of those
elements in the tree and reported all four taps as successful. Nothing moved.
The last frame, a minute later, is the same frame with a different clock. The
run only failed four steps afterwards, on a name that was never going to
appear.

Posting a pin unmounts the pin form, which is a Sheet and therefore a native
Modal. In the same tick `useCreatePin.onSuccess` asks the push primer to
appear, which mounts a second Modal while the first is still dismissing. iOS
drops that presentation — the trap `traps` already carried, and the map
already works around for its own card with a 450ms delay. What `traps` did
NOT say, and now does, is what a dropped presentation costs on Fabric: the
`ModalHostView` is laid out full screen, mounts its children into the modal's
own view controller rather than into itself, overrides no `hitTest`, and so
returns itself for every point on the screen. An invisible, full-screen touch
sink, permanent, because RN marks itself presented before presenting and only
retries on a re-parent.

Proven by bisect: the run before the primer existed completed this flow; the
run after it dies on the first four taps.

**What is NOT proven is that it would have hit the founder's phone.** An
adversarial pass refuted that half, correctly. The device path serialises a
real `getNotificationSettingsWithCompletionHandler:` round trip that the
simulator short-circuits, and that hop is in the one variable a sub-frame
race turns on — the phone might lose it too, or might simply show the sheet.
Every artifact here is a simulator. The fix is pure JS with no
`Device.isDevice` in it, so it behaves the same either way.

The primer is the only thing in the app that presents a sheet on a schedule
of its own rather than because somebody tapped something, which is why it is
the only thing that has to ask whether the screen is free. It waits on three
facts now: the tabs focused, no sheet registered, and a settle delay, because
unmounted in React and gone from the screen are not the same fact. Six
component tests; two of them fail against the code they replace.

The suite would have slept through it again, too. A tap that is allowed to do
nothing is how a frozen app passes as a working one, so the flow now proves
the first tap out of the pin card landed — by the card's own headline going
away, not by "Drop a pin" (also the Travelers empty state's button) or
"Travelers" (the tab's own label), both of which are true either way.

**One audit item does less than it says on the tin, and this is where that is
written down.** The featured traveler now has to have an approved first photo
before the server will surface them. The intent was a face on the guest
teaser; the face cannot arrive. The photos bucket is private and its only
SELECT policy is `to authenticated`, so a signed-out device is refused the
image whatever the card asks, and `featured_traveler` has no signed-in caller
to pay the requirement off elsewhere. Widening the bucket to `anon` would hand
every primary photo in the app to anybody holding the public key, which is not
a trade to make for a teaser — so the requirement stays (it still selects
somebody who bothered to add a photo, which is a decent proxy for a profile
worth showing) and the card leads with a monogram instead of an empty frame.
Revisit only if the founder decides a stranger's face may be seen without an
account.

**Deferred, and the only thing that is.** BB11's "Copy" in the message
long-press menu needs `expo-clipboard`, which is a native module and therefore
an EAS build. The other half of that item — the blurred menu backdrop — turned
out not to need a build at all, because `expo-glass-effect` already ships in
the binary. Batch Copy with the next native change.

**Also fixed on the way past:** CI had been failing every run since the
component tests landed, on three undeclared dependencies
(`@testing-library/react-native`, `react-test-renderer`,
`@react-native/jest-preset`) that this sandbox happened to have installed. And
the lint step was `npx expo lint -- --max-warnings 0`, which exits 2 with
"Value for 'max-warnings' of type 'Int' required" — a step that could only ever
fail, hidden behind a typecheck that was already failing.

### Then the build was reviewed against itself

Six review dimensions over the whole diff, every finding handed to a verifier
told to refute it and to default to "not real". Twenty survived. The four that
matter, all reproduced on a real Postgres before they were believed:

- **The spotlight reached past a block.** `daily_spotlight()` is SECURITY
  DEFINER and calls `get_matches()`, which is SECURITY INVOKER and does none of
  its own filtering — the account status, the onboarding check, the block check
  and the trip status all live in the `trips_select_overlap` POLICY, and a
  definer does not run policies. It handed a blocked person's name, age, bio,
  occupation, languages and photo to the person they blocked. Every filter is
  restated inside the function now, in both the scan and the read-back.
- **The pairing could be raced.** Two unique indexes cannot express "one
  spotlight per person per day": a user may be `user_a` in one row and `user_b`
  in another, so the `unique_violation` the function catches is never raised.
  A per-day advisory lock, and a re-read under it.
- **The daily cap counted and then inserted**, while every other counted cap in
  the schema takes `pg_advisory_xact_lock` first.
- **A dead pin held its slot.** `pin_message` counted the table; `room_pins`
  reads the join. Unsending a pinned message left a slot nothing could free.

And on the client, the one worth naming: a failed send lives only in the query
cache, and the thread refetches on every realtime insert — so the greyed "Not
sent" bubble, and the sentence inside it, were deleted by the next message
anybody else posted. Failed rows survive a refetch now.

The rest: two divergent implementations of "what this hello was a reply to",
neither knowing about the prompts added in the same build; an anti-flirting
lecture the project's own design brief bans by name; a verified badge dead to
touch on every profile with a photo; a reaction grid positioned as though it
were the row it replaces, growing 152pt down over the Report button; a
confirmation timer that popped the screen underneath; the push primer
presented from beneath a modal iOS had not dismissed, which iOS silently
drops; a real traveler's display name shipped to analytics from a signed-out
screen; "1 hellos left today"; and a red **0** on the Chat tab, permanently,
for every account with nothing waiting — expo-router's `Badge` reads
`children` before it consults `hidden`.

Database after the fixes: **428** pgTAP assertions. Client: **162** unit
tests.

### Then the build was reviewed as pictures

Run 44 was the first fully green simulator run: 27 screenshots, all distinct,
and `16-pin-posted` finally different from `17-travelers-signed-in`, which is
the proof that the post-pin freeze is gone. Every screen was then opened as an
image rather than read as an exit code, and four things that no test could see
turned up. All four are the same failure — a control or a sentence that a
human eye cannot read, on a screen the checks call passing.

- **The reaction menu did not dim anything.** The scrim was painted only when
  liquid glass was unavailable, so on any OS that has it the menu floated over
  a thread at full brightness — the composer legible right beside it. Glass
  alone over a dark ground dims nothing. And every action label took
  `theme.danger`, so "Pin to the top" was the same destructive red as
  "Unsend". This is the founder's #1 complaint area and it had regressed
  behind a passing test.
- **"Both there Aug 23 - 28" was half dissolved.** The fade under the Say hi
  bar was given `ACTION_BAR_CLEARANCE`, 30pt taller than the bar it protects,
  so it began a line and a half above the buttons and ate whatever was there.
  On a one-trip traveler that is exactly the overlap window: the one fact that
  explains why this person is on your screen. Scrolling recovered it and
  nothing said to scroll. The band is now the bar's own height plus a ramp,
  and the window is also said in the hero beside the name, where no screen
  size and no text size can push it under anything.
- **The X that leaves place mode was invisible.** `variant="clear"` glass over
  a traveler's avatar pin: both strokes cut off halfway down, on the only
  control that leaves the mode. Regular glass with a hairline ring.

The general lesson, and it is now in the `screens` skill: a green E2E run
means the flow completed, not that a person could have completed it. Three of
these four shipped under a full green gate.

Client after the fixes: **172** unit tests.

## Phase 10 — the founder's audit: an empty map, Raya, and fewer words

Three asks: audit everything against the research, make the map look like
Raya's, and cut the words back everywhere. A twelve-agent fan-out read the
map end to end, re-verified all 43 findings against the code, swept every
user-facing string and walked every empty/loading/error state; 203 findings,
each survivor put to an adversarial refuter told to default to "not real".
Forty-two were rejected because they had already been fixed hours earlier in
the same session.

### The map was empty, and nothing was broken

`seed_launch_pins()` puts twenty curated pins across the four launch cities,
and its own header says "Re-run every couple of days during launch". Nobody
did. Seeded pins expire in 48h because rule 3 caps every pin at 72h, so two
days after that migration deployed the map went back to "be the first to drop
a pin" and stayed there. A comment asking a human to remember something every
48 hours is not a mechanism; it is on pg_cron now, beside the four workers
that already run that way.

Then the same function was letting its plans rot: the guard skips any venue
that still has a LIVE seeded pin, so on day two every venue is skipped and
yesterday's `intent_date` survives. The pins stayed on the map and the Today
and Tomorrow chips — the brief's own hook — went empty, because they match
that column exactly. And the client compared it against the phone's LOCAL
calendar day while the seed writes Postgres's UTC `current_date`, which for a
travel app means the normal case is comparing one clock against another.

**Heat had never rendered once, in any run, and the reason was in the SQL.**
The k-threshold was applied per (cell, CATEGORY): three people had to be
planning the same KIND of thing inside the same 550m square. Three people
planning three different things IS a busy corner. Grouping by cell alone is
also the safer version — the bucket gets larger and the row carries one fewer
attribute about the people in it, which moves away from rule 6, not toward
it.

### The Raya look was three props and an overlay

`mapType="mutedStandard"` is MapKit's own "somebody else's data on top" style.
`showsPointsOfInterests={false}` — the plural; the singular is not a prop —
kills the venue pills. Both were nearly wasted: on iOS 16+ the POI prop writes
a `pointOfInterestFilter` onto `preferredConfiguration`, and `mapType` is
written to the same state twenty-five lines LATER in the same props pass and
installs a fresh default configuration, discarding the filter. Both change
together on mount, neither changes again, and the native remap is guarded on
old != new, so nothing re-applies it. It flips on `onMapReady` now, one commit
later. The drop-a-pin picker had no treatment at all, which matters more than
the main map rather than less: it sits at venue zoom, exactly where Apple
draws bright pills for restaurants and bars.

What no prop can remove is labels, roads and water. An overlay can, and it is
the right lever: MapKit draws every overlay BENEATH every annotation, so a
polygon wash dims the cartography and leaves the faces, the heat and the
curated stars exactly as bright as they were.

### Two rules the app had quietly broken

The **match ceremony** had crept in — it is on three of the four do-not-copy
lists. A full-screen takeover over every tab: the brand field, a 168pt photo
springing in behind an amber ring, a glow breathing on an infinite repeat with
no reduce-motion check, and a verification upsell riding along. The words were
always right ("Connected with {name}", "Go to chat"); the presentation was the
banned thing. It is a card at the bottom of the current screen now.

And the **heart** led the reaction row, against "no hearts" in DESIGN.md
principle 5 and in the design brief in as many words. On a dimmed thread it
was the brightest, most saturated element on screen. A wave replaces it; it
stays in the expanded grid. Flagged to the founder as reversible in one line,
since a heart tapback is also ordinary iMessage grammar.

### The faceless featured traveler was not unfixable

Top 6 is "never ship a faceless featured traveler", and the previous session
recorded it as impossible: the photos bucket is private, its only SELECT
policy is `to authenticated`, and widening it to anon would hand every primary
photo in the app to anybody holding the public key. The way through is an
Edge Function that takes a CITY — not a path, not a user id — picks the person
by calling the same function the card calls, and signs that one photo for five
minutes. Nothing to walk, no policy widened. The card leads with a 3:2 hero
now, verified against the live backend.

### Five screens that could not say what was happening

A signed-out visitor could read a hostel room forever with no way to join one
(`useMyChats` is disabled without a user id, so the guest branch sat behind a
query that never leaves `isPending`). Archiving a conversation made it
unreadable, and an archived room offered to let you join a room you are
already in. The guest Travelers tab was permanently blank whenever the city
list failed. And the Chat tab painted "No chats yet" under its own loading
skeletons and under "You said hi — Sent".

Plus roughly a hundred strings shortened, and two dev-phase badges that were
being shown to real users in a code font.

Database: **429** pgTAP assertions. Client: **178** unit tests. Run 51 green
end to end, 32 screenshots, all distinct.

### Still open, honestly

`bb2` (anchored opener as the DEFAULT path), `bb4` (owner-mode completeness
dashboard), `bb7`/`bb9`/`bb10`, per-pin audience, a tap target on the heat
layer, timestamps-on-demand and a typing indicator all remain partial — they
were confirmed by the refuters and are not done. `bb11`'s Copy action still
needs `expo-clipboard`, which is a native build.
