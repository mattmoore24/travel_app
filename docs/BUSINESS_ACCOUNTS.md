# Business accounts — the plan

Drafted 2026-08-27 from five research lenses, adversarially reviewed by three
critics, then **revised 2026-08-28 against the founder's comments**. Changes
from the founder's pass are marked **[founder]**; changes the adversarial
review forced are marked **[review]**.

Nothing here is implemented. §9 lists what is still the founder's to decide;
everything else is settled.

---

## 1. What this is, in three sentences

A business account is a normal auth user that owns a row in `businesses`
(today's `establishments`, grown up): a persistent, publicly readable place on
the map with photos, hours, links, posts, and one open chat anyone can join,
visible to everyone with zero matching. It is not a person: it never appears in
Travelers, never posts trips or pins, never messages anyone first. Most of the
chat machinery already exists — rooms, roles, speaking modes, the expiry sweep,
the moderation pipeline — so the genuinely new work is the business identity,
getting listed and staying listed, ratings, and the map presence.

---

## 2. The §7 reckoning

**Signed by the founder on 2026-08-27, all four as recommended.** They land in
`docs/PRODUCT_BRIEF.md` §7 in phase 13, in the wording below.

**Rule 3 — "Pins hard-expire at ≤72 hours."**

> _"Traveler pins (`public.pins`) hard-expire at ≤72h and are then unreadable —
> unchanged. Business listings are persistent commercial records in
> `public.businesses`: statements about a premises, not about a person. They
> carry no dates and no personal data, never enter `public.pins`, and never
> count toward heatmap aggregation. A business post has an end date its owner
> chooses, or none at all."_

**[founder]** The mandatory 30-day post expiry is gone. A business sets how
long a post runs, or leaves it up indefinitely. The 10-live-post cap is what
bounds the surface now, and dated posts still archive themselves once the date
passes (an event last Tuesday must stop reading as "on"). See §3.3.

**Rule 4 — "Social handles are never visible pre-accept."**

> _"Rule 4 protects people. Personal handles keep the accepted-direct-chat gate
> unchanged. A business's socials, links and contact details are advertising
> about a premises, live in a separate public table, and are shown to anyone.
> In exchange the gate tightens: a chat with a business never unlocks anyone's
> personal handles, in either direction."_

`has_accepted_chat` already requires `kind = 'direct'`, so this falls out for
free — provided business DM chats are always `kind='business'`. That invariant
gets a two-direction pgTAP attack test.

**Rule 5 — "Every first message passes moderation."**

> _"A first message to a business is screened by the same prefilter every
> message passes, and is then delivered immediately. There is no accept step
> and no held state: a business wants to be asked questions. The romance
> classifier does not run on business messages — it screens for the wrong
> thing when somebody is asking about beds. Business accounts send no first
> messages at all. Business broadcast text (name, description, posts, link
> labels) passes the same prefilter on write."_

**[founder]** "Messages to businesses should always go through." The accept
ceremony is gone and so is the LLM hold — a question to a hostel should not sit
in a queue waiting on a classifier trained to spot flirting. The prefilter
stays, because slurs and scam patterns are still slurs and scam patterns. Rule
5 remains true; it just means the right moderation for the speech act.

**Proposed rule 8** (new):

> _"A business account never initiates contact with a traveler, never joins a
> traveler's group or another business's chat, and never reads traveler
> discovery surfaces. Its reach is its listing, its posts, its chat and its
> replies."_

**[founder]** "Businesses can't message individuals without being messaged
first" — exactly rule 8, confirmed. Enforced by BEFORE INSERT refusals on
`trips`, `pins`, `message_requests` (as sender), `verification_requests`,
`profile_photos` and `room_members`, plus `create_group` refusing business
callers, plus the discovery reads refusing them (§3.7).

**Rules 1, 2, 6, 7** need no carve-out. Free at v1 (decision 15); a business's
lat/lng is a claimed premises, not a device reading; businesses are
structurally outside heat because `heat_cells` only aggregates `public.pins`.

---

## 3. Data model

### 3.1 Account identity

No mirrored flag — the guests build proved those drift. Ownership is the truth:

- `businesses.owner_user_id uuid unique references users(id)` — owning a row IS
  being a business account.
- `is_business_account(p_user_id uuid default auth.uid())` — SECURITY DEFINER,
  one indexed lookup, revoked from anon (the `is_guest_account` shape).
- **Keystone invariant, reused from guests:** a business profile's
  `onboarding_completed_at` stays NULL forever
  (`business_profile_stays_minimal` BEFORE UPDATE trigger). That single fact
  keeps businesses out of `get_matches`, `featured_traveler`,
  `daily_spotlight`, `city_pins` and the Travelers tab with no edits to any of
  them. pgTAP still attacks each surface individually.
- `profiles.display_name` is set to the business name, so chat headers and
  message authorship render with zero query changes.
- One account is one identity: a caller with `onboarding_completed_at` set
  cannot register a business (decision 5).

### 3.2 The `businesses` table

`alter table establishments rename to businesses; alter table
establishment_staff rename to business_staff;` — live rooms, chat ids, members
and messages carry over untouched. Cost is recreating every SECURITY DEFINER
function naming the table: bounded, greppable, proven by the pgTAP run.

| column                                              | notes                                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `owner_user_id uuid unique → users`                 | NULL for the four seeded venues                                                                                                  |
| `category public.business_category`                 | hostel, hotel, guesthouse, bar, restaurant, cafe, club, tour, activity, coworking, wellness, shop, other **[founder: approved]** |
| `description`, `place_label`, `hours_note`          | ≤600 / ≤120 / ≤200, all screened                                                                                                 |
| `website_url text`                                  | optional, and no longer a proof of anything (§3.9)                                                                               |
| `state public.business_state`                       | enum: `unconfirmed`, `listed`, `flagged`, `removed` (§3.9)                                                                       |
| `listed_at timestamptz`, `claimed_at`, `updated_at` |                                                                                                                                  |

**Column-scoped grants** **[review]**: the existing table grants full-row SELECT
to anon, which after the rename would hand out `owner_user_id`. Grants become
column lists — anon and authenticated read (id, city_id, name, category,
description, place_label, hours_note, website_url, lat, lng, public_preview)
of `active` + `listed` rows only. `owner_user_id`, `claimed_at` and the report
history are never client-readable. **`state` is not readable either** — a
client that can see a business at all knows it is `listed`, and exposing the
enum would only invite a badge (§3.9 is emphatic that there is no badge).

RLS: select where `active and state = 'listed'`; owner selects own row always.
Client UPDATE column-granted to (name, description, hours_note, place_label,
public_preview) behind a screening + velocity trigger; lat/lng, city_id,
active, state, owner_user_id are server-owned. Name, city or location changes
go through `update_business_location(...)` and **drop the row back to
`unconfirmed` until the email link is clicked again** — that closes
list-a-surf-shack, rename-to-Marriott, which is the one attack a confirmation
link genuinely does stop.

### 3.3 Content tables

- **`business_hours`** — (business_id, weekday 0-6, opens, closes, position).
  Multiple rows per weekday = split shifts; `closes < opens` = past midnight;
  absent weekday = closed. Exceptions live in the free-text `hours_note`. "Open
  now" is computed in the city's timezone; when in doubt, show plain hours and
  never a wrong "Open".
- **`business_links`** — (id, business_id, kind enum: website, reservations,
  tickets, menu, phone, email, whatsapp, instagram, tiktok, facebook, x, other;
  label ≤40, value ≤300, position). Business socials live here;
  `social_handles` stays people-only. Validator trigger: scheme allowlist per
  kind, no IP-literal hosts, label screened, cap 10. Free-text business fields
  refuse URLs, so every outbound link passes one chokepoint.
- **`business_photos`** — mirror of profile_photos, deliberately separate
  (profile_photos is entangled with avatar semantics and matching reads). Cap
  10, position 0 = cover. New private bucket `business-photos`, own-folder
  insert, object ceiling 30, signed URLs, the same worker pipeline: held at
  'pending' on insert, `apply_business_photo_verdict` service-role-only,
  rejection is a strike against the owner.
- **`business_posts`** **[founder: expiry is the business's choice]** — (id,
  business_id, title 2-80, body ≤600, photo_path, `happens_at timestamptz`
  nullable, `ends_at timestamptz` **nullable**, archived_at, timestamps).

  | the business picks | stored                           | what happens                             |
  | ------------------ | -------------------------------- | ---------------------------------------- |
  | "Tonight, 8pm"     | `happens_at` set, `ends_at` null | archives itself once `happens_at` passes |
  | "Until Sunday"     | `ends_at` set                    | archives itself at `ends_at`             |
  | "Keep it up"       | both null                        | stays until the business takes it down   |

  No 30-day ceiling. What bounds the surface is the 10-live-post cap, 5 writes
  a day, and the fact that a post is one card on one page. The composer's
  third option reads **"Keep it up until I take it down"**, so indefinite is a
  choice somebody makes, not a default they fall into. `archive_expired_posts()`
  runs nightly over the two dated cases. Soft-archive, not delete: §7 rule 3's
  hard-delete is a promise about personal whereabouts and does not apply to a
  bar's happy-hour notice.

  **[founder]** The Event / Deal / Update kind picker is gone — travelers only
  ever saw the derived caption, so the three-way choice was friction with no
  payoff. A post is a post; the dates make the caption.

### 3.4 Business chats

`business_chats` (chat_id pk → chats, business_id → businesses, `speaking
public.group_speaking default 'everyone'`, created_at, **unique(business_id)**
at v1). Not a `groups` row — that would invert the guest read-only invariant
("a room with no groups row is a venue room") — and not a column on
`businesses`, which cannot grow to multi-room. Backfill from
`businesses.chat_id`, re-point readers, drop the column.

| founder's words        | mode       | who may post                        |
| ---------------------- | ---------- | ----------------------------------- |
| "allow all users"      | `everyone` | any live member                     |
| "allow selected users" | `granted`  | speakers + admins + owner/staff     |
| "read only"            | `admins`   | owner, staff, appointed admins only |

`may_speak_in_room` reads `coalesce(groups.speaking, business_chats.speaking)`
and treats 'admins' as moderator-only. `is_room_moderator` gains three arms:
business_staff, owner_user_id, `room_members.role = 'admin'`.

**Photos are admins-only, always** **[founder]** — a new
`business_room_photo_guard` BEFORE INSERT trigger on `messages`: if the chat is
a business chat and `image_path is not null` and the sender is not
owner/staff/appointed admin, refuse. This holds _even in `everyone` mode_, so
"anyone can post" never means "anyone can post images". It is the cheapest
possible answer to the one thing that makes an open room ugly, and it keeps a
free-to-join room away from the vision classifier at volume. The composer hides
the photo button rather than failing on send.

**Reactions survive read-only** **[review]** — the reaction policy currently
gates on `can_send_in_chat`, which would make "read only" mean "no reactions".
Recreated so any live member may react regardless of speaking mode, which is
what makes the copy "You can read and react" true.

Admin appointment: `business_set_chat_role(p_chat_id, p_user_id, p_role)` —
owner/staff only, so appointed admins cannot mint admins. They moderate; they
cannot change the speaking mode or edit the business. `room_remove_member`
gains a guard: an admin row is removable only by owner/staff. `leave_room` is
untouched — people always remove themselves.

### 3.5 Membership lifecycle

`join_business_chat(p_chat_id uuid, p_departure_date date default null)`. Auth,
`assert_good_standing`, **a guest refusal in the RPC itself** **[review]**, and
the business must be active and verified. Joining IS the add — no trip, no
approval. Upsert, so rejoining or changing the date is one tap. Room cap 2,000.

`room_members.departure_date` is relaxed to nullable for the "I'm not sure"
path, and every reader of that column is checked for null-safety in the same
migration.

| rule                        | value                                              |
| --------------------------- | -------------------------------------------------- |
| join requirement            | none — no trip, no approval                        |
| with a departure date       | departure + 3 days                                 |
| without one                 | join + 90 days                                     |
| hard cap                    | 90 days from joining                               |
| leave                       | any time, one tap                                  |
| remove others               | owner, staff, appointed admins only                |
| existing venue-room members | keep their promised dates; new math from next join |
| guests                      | read public rooms; never join, post or DM          |

The hourly sweep is recreated to spare admins **only where a `groups` row
exists** **[review]** — an appointed admin in a business room expires like
anyone and is reappointed on rejoin. Immortal traveler-admins in a commercial
room were a leak.

### 3.6 Inbound messages

- `message_business(p_business_id, p_first_message)` — resolves the owner
  server-side (clients never see owner ids), refuses unverified or unclaimed
  businesses with the oracle-proof error.
- **Delivery is immediate** **[founder]**. The prefilter runs; on a pass the
  chat is created (`kind='business'`, status 'accepted') and the message lands.
  No held state, no LLM classifier, no accept inbox. On a prefilter refusal the
  sender gets the existing reword notice.
- Kept from the person-to-person path: guest refusal, blocks both ways,
  one-conversation-per-pair (kind-aware), velocity caps, the single
  oracle-proof error.
- **Shadowban** **[review]**: today a shadowbanned sender's request is silently
  stored 'declined' while the client is told it sent — the illusion works
  because delivery was never instant. Immediate delivery breaks it. Fix: the
  chat IS created, flagged `shadowed`; the sender sees a normal chat and types
  into it; `my_chats` and the push enqueue exclude shadowed chats on the
  business side. One column, two predicates, one pgTAP case.
- Separate 10/day budget for business messages, not the 8/day hello budget
  (decision 11) — asking a hostel about beds is not a hello.
- `my_chats()` recreated (DROP first, grants restated — the AGENTS.md trap):
  the direct arm becomes `kind in ('direct','business')`, business rows carry
  the business name and cover on the traveler side and the traveler's name and
  avatar on the business side, plus a `business_id` out column.

### 3.7 Map read path, and what a business may read

The `businesses` row is the marker; there is no new pin table.
`city_businesses(p_city_id)` supersedes `city_rooms`;
`business_detail(p_business_id)` returns the whole page in one round trip, to
anon as well — "no matching is required to see all of the business' details."

**Compatibility wrappers are load-bearing** **[review]**: the shipped app calls
`join_room` and `city_rooms`, and JS ships over the air, so dropping either
breaks the Join button on every installed phone. Both survive as wrappers
until adoption, retired in a later cleanup.

**A business reads no traveler surface.** Migration 2 recreates `city_pins`,
`traveler_trips` and `get_matches` with an `is_business_account()` refusal at
the top, and the attack suite calls each as a business. A business sees
traveler pins only through the anonymous feed.

### 3.8 Reporting and suspension

Report context `business:<id>`; impersonation sorts first. The structured
report path and its three-reporter escalation are §3.9, because at v1 reporting
IS the verification mechanism rather than a backstop to it.
`admin_resolve_report` gains 'flag' (state → 'flagged', listing dark, room
unjoinable), 'relist' and 'remove' for unclaimed venues that have no owner to
strike **[review]**. Suspension freezes everything and deletes nothing: listing
hidden, joins refused, chat status 'closed' so even the business is silent,
history readable as evidence, copy oracle-proof ("This chat is paused.").
Strikes ride the existing 3/5/7 ladder on the owner.

### 3.9 Getting listed, and staying listed **[founder]**

> _"Let's just send them a link to verify their email upon creating a business
> account. We can then rely on businesses getting reported as fake to settle the
> rare dispute manually ourselves, rather than overthinking it now with complex
> verification methods. Look into how Google allows people to add/claim/verify
> businesses on Google Maps for more ideas."_

**The decision: confirmed email plus reports at v1.** The two-path scheme in
the previous draft (domain-matched email, or a code planted on the website) is
not built. It moves to tier 3 of the ladder at the end of this section, to be
built when volume justifies it and not before.

#### What Google actually does, and what is worth stealing

Google is the only organisation that has solved this at global scale, and the
research is unambiguous about one thing: **they did not solve it at signup.**

- **Google picks the method, the business does not.** Category, region, and how
  much of a public footprint the business already has decide whether you get a
  phone code, an email, a postcard, or a video. Verification strength is tiered
  by risk rather than uniform.
- **Video is now the primary method.** Not "do you own a domain" but "are you
  physically standing in this business and do you have staff-level access": the
  video has to show the street and the building number, signage whose name
  matches the listing exactly, the interior, and then **proof of management** —
  unlocking the door, opening the till, logging into the POS, walking into a
  staff-only area.
- **Email is their weakest and rarest method**, offered only to domain-based
  addresses on businesses that already have a strong footprint. It is a
  tiebreaker, not a gate.
- **Postcards are dying.** Slow, useless for service-area businesses, and
  hopeless internationally.
- **Editing the name, address or category re-triggers verification.** Exactly
  the attack we care about.
- **The listing exists before anyone claims it.** Google builds listings from
  other data; claiming is about who _controls_ one, not whether it exists.
  Anyone can suggest edits to an unclaimed listing.
- **Reporting is a first-class structured path**, not a support email:
  "Suggest an edit" offers "This business doesn't exist", "permanently closed",
  "Spam, fake or offensive", takes a photo as evidence, and feeds an AI
  moderation stack.
- **The badge is the payoff.** A verified profile carries a check and "You
  manage this Business Profile". The badge means something precisely because
  the bar behind it is a video of you opening the till.
- **And it still leaks.** Verification takes 5 to 14 days, Google runs
  periodic algorithmic sweeps of spam-prone categories, and there is an entire
  cottage industry of consultants who do nothing but get wrongly-suspended
  legitimate businesses reinstated. Nobody solves this at signup.

Sources: [Birdeye](https://birdeye.com/blog/how-to-verify-my-business-on-google/),
[JXT Group](https://www.jxtgroup.com/google-business-profile-verification-in-2026-new-warnings-video-requirements-how-to-stay-compliant/),
[Local Falcon](https://www.localfalcon.com/blog/the-ultimate-guide-to-google-business-profile-video-verification),
[Search Engine Journal](https://www.searchenginejournal.com/google-business-profile-video-verification/462489/),
[Red Points](https://www.redpoints.com/blog/how-to-report-a-fake-business-on-google-maps/),
[Sterling Sky](https://www.sterlingsky.ca/top-reasons-google-my-business-suspended-your-listing/),
[BrightLocal](https://www.brightlocal.com/learn/google-business-profile-suspensions/).

#### The recommendation

The founder's instinct is right for launch, and the research supports it: with
four seeded venues and the first handful of real ones hand-recruited per city,
the fake-listing volume is zero and every hour spent on verification machinery
is an hour not spent on the thing travelers actually use. Ship the confirmation
link. Two things go with it that cost close to nothing now and are expensive to
retrofit later, and one is optional.

**1. There is no verified badge. This is the important one.**

A confirmation link proves an inbox exists and somebody read it. It proves
nothing whatsoever about a business: `hostellisboa2024@gmail.com` confirms in
four seconds. Google's check is credible because the bar behind it is a video
of you unlocking the shop. A check mark next to a business that clicked an
email would be **actively worse than no badge**, because it lends an
impersonator our credibility. So v1 ships no badge, no "Verified" chip, no
`state` in the client payload. A place is either on the map or it is not.

That is a feature we do not build, which is why it is cheap. It also keeps the
word "verified" meaning exactly one thing in this app — a traveler who passed
the selfie check — instead of two things with different bars.

**2. Reports are structured, and they escalate without the founder.**

"Rely on reports" only scales as far as somebody reads them. Google's answer is
a fixed reason list plus photo evidence plus machine review, and that shape
ports directly onto machinery this app already has.

`business_reports` (id, business_id, reporter_user_id, reason enum, note ≤300,
photo_path nullable, created_at; unique on (business_id, reporter_user_id) so
one account is one voice). Reasons, lifted from Google's list because it is
well-worn: **not a real place · permanently closed · not this business (someone
else is running it) · wrong location · spam or offensive**.

Escalation, so the founder's inbox is the exception rather than the mechanism:

| trigger                                | what happens                                                         |
| -------------------------------------- | -------------------------------------------------------------------- |
| 1st report                             | logged, listing untouched                                            |
| 3 reports from distinct accounts       | queued for a Claude read of the reports plus the listing             |
| Claude says impersonation is plausible | `state = 'flagged'`, listing dark, chat unjoinable, founder notified |
| Claude says it looks fine              | stays live, flagged in the queue for the founder to glance at        |
| founder resolves                       | `listed` again, or `removed`                                         |

Three reports auto-darkening with no machine read would itself be the attack (a
competitor with three accounts). The Claude read between the threshold and the
consequence is what makes the threshold safe, and it is the same worker shape
as every other machine verdict here, audited to `moderation_events`.

**3. Optional, and recommended: the storefront photo.**

Signup already collects photos of the place. Make the **first one required,
camera-only (not the library), and a photo of the front of the business with
its sign visible** — then have the existing photo worker ask Claude one extra
question: does the sign read the claimed name, does the storefront match the
claimed category, is this a real premises rather than a screenshot or a stock
image.

This is video verification's cheapest 20%. It does not stop somebody who walks
to the hostel and photographs its sign, and it should not pretend to. What it
stops is the entire volume tier of fake listings, which is people who never
leave their laptop. Cost is one signup step and one prompt in a worker that
already runs, and it works identically in Lisbon and Bangkok with no domain, no
postcard and no founder. **Recommended, but genuinely optional** — say no and
v1 is the founder's plan exactly.

#### The ladder, written down so nobody re-derives it

Each tier gets built when the tier below it starts failing, not before.

| tier    | proof                                                  | when                                         |
| ------- | ------------------------------------------------------ | -------------------------------------------- |
| **1**   | confirmed email + structured reports                   | **v1, now**                                  |
| **1.5** | storefront photo checked by Claude                     | v1 if the founder says yes                   |
| **2**   | domain-matched email, or a code planted on the website | when fake listings become a real trickle     |
| **3**   | a short video walk-in, Google's shape                  | contested listings, or spam-prone categories |
| **4**   | a badge, earned at tier 2 or 3                         | only once a tier exists that deserves one    |

#### The state machine, and what "dark" means

`business_state`: `unconfirmed → listed → flagged → removed`, plus `listed`
again out of `flagged`.

- **`unconfirmed`** — signed up, link not clicked. **Fully dark**: no marker, no
  joinable chat, no messages. The business can build its page while it waits and
  the screen says plainly that the link is what stands between it and the map.
  Rename or move drops it back here.
- **`listed`** — the link was clicked. On the map. No badge.
- **`flagged`** — dark again, pending the founder. The owner sees why and can
  reply through the contact form.
- **`removed`** — gone, and the owner cannot re-list the same name in the same
  city without the founder.

The confirmation mail goes through the **existing Resend path**, not GoTrue —
so no auth configuration changes and no effect on traveler signup, which is a
flow that has already been broken once by an auth toggle. Rate limits: 5 sends
per business per day, link expires in 24 hours.

**Signup asks for a business email and says why**, which is the founder's point
about forcing real addresses: _"Use your business email. It's the address
travelers will reach you at, and it's what puts you on the map."_ Nothing
refuses a Gmail address, because most small businesses on earth are on one and
refusing them is refusing the market.

`business_email_confirmations` (business_id, token_hash, expires_at, attempts,
confirmed_at) with **no client grants at all**.

### 3.10 Ratings **[founder]**

> _"I think verified users should be able to rate different businesses, similar
> to how the beli app works."_

I argued against ratings in the first draft on the grounds that a scoreable
business plus a DM channel is an extortion lever. **Beli's mechanic
substantially answers that objection**, so this is in.

**How Beli works** (researched, sources at the end of this section). You never
type a score. You mark a place as been, choose one of three buckets — _loved
it_ / _it was fine_ / _not for me_ — and then the app shows you one place you
already rated and asks which you liked more. Three or four of those and a
binary search has found the new place's exact position in your personal ranked
list; the 0-10 number is read off that position. Scores are personal first and
aggregate second, and there is **no written review anywhere in the flow**.

**Why that matters here:** the extortion lever is the _text_. "Give me a free
room or I post that the staff were rude" only works if there is somewhere to
post it. A comparative ranking has no such surface. What a disgruntled traveler
can do is place one hostel below another in their own list, which moves an
aggregate by a fraction. That is a rating system that cannot be weaponised in
the way a review system can, and it is the reason this is now in the plan.

**The Samewhere version.**

- **Who rates: anybody with an account.** **[founder]** _"Anyone can rate any
  place, Samewhere shouldn't gate keep this. People may have been there before
  and just not entered the trip on Samewhere."_ No verified-only gate and no
  presence requirement. Guests still cannot, for the same reason they cannot
  write anything else: an anonymous session is not an identity, and a rating
  from one is a rating from nobody. Business accounts cannot rate, under rule
  8, so a bar cannot rank a rival down.

  The honest cost of dropping the verified gate: the floor on gaming a place's
  score is now "make five accounts", not "pass five selfie checks". What is
  left holding it up is the five-rater floor, one rating per account per place,
  the 20-a-day cap, and the fact that a rating carries no text to extort with.
  **The switch stays in the wall**: `app_config.ratings_require_verified`
  defaults false, and flipping it is one row rather than a migration, so if
  brigading ever shows up the lever is already there.

- **What you rate:** a place you have been, self-declared and never checked
  against trips **[founder, decision 22 closed]**. Comparisons stay **within a
  category** — bars against bars, hostels against hostels — because "did you
  prefer this hostel or this cocktail bar" is not a question with an answer.
- **The flow:** _Been here_ → three buckets → three or four "which did you
  prefer?" cards → done. Under ten seconds, no typing, and it works from the
  first rating (with fewer than three rated places in a category, the bucket
  alone sets the score).
- **The number:** each bucket owns a band of the 0-10 scale (not for me 0-3.3,
  fine 3.4-6.6, loved 6.7-10) and position within the bucket picks the point
  inside the band. Your own score is always visible to you.
- **The public number** appears on a place only once **five or more** travelers
  have rated it, mirroring the heatmap's k-threshold instinct: below that it
  reads "Not rated yet", because a 9.2 from one person is noise wearing a
  number. Shown as `8.4 · 23 travelers`.
- **Tags, not text.** After rating, an optional fixed-vocabulary tag row —
  _good for meeting people, cheap, quiet, lively, late, good coffee, worth the
  trip_. Fixed list, no free entry, so there is nothing to moderate and nothing
  to extort with. The place page shows the top three.
- **What the business sees:** its score, its count, its tags. **Never who
  rated it.** That is the anti-retaliation control, and it is why the rating
  table has no business-readable path to `user_id`.
- **On a traveler's profile:** their highest-rated places in a city, which is
  genuinely good social proof and pairs with Top Priorities (§ the separate
  doc) as _been_ against _want_.

Schema: `business_ratings` (user_id, business_id, category, bucket enum, `rank
double precision` for cheap midpoint insertion, score numeric generated on
write, tags text[], timestamps; pk (user_id, business_id)). RLS: read own
always; nobody reads another user's row. `business_rating_summary(business_id)`
is a SECURITY DEFINER aggregate returning average, count and top tags, and
returning nulls below the threshold, so the count gate cannot be bypassed by
reading the table. Cap 20 ratings a day. The binary search runs client-side
over the user's own ranked list (tens of rows, their own data); the server
validates the final position on write.

**Decision 22, closed by the founder: no presence requirement.** Rating does
not need an overlapping trip or chat membership, and the reasoning is the
reason it is not there: somebody who stayed in a hostel in 2024, before they
had this app, has a better-informed opinion than somebody who joined its chat
yesterday. The app should not be in the business of refusing that.

Sources: [Today](https://www.today.com/food/trends/what-is-beli-app-rcna217748),
[Spoon University](https://spoonuniversity.com/school/emory/rate-save-and-recommend-restaurants-on-app-beli/),
[Anson Biggs](https://notes.ansonbiggs.com/rating-has-never-been-so-good/),
[Crumble](https://crumble.me/guides/restaurant-ranking-apps).

---

## 4. The traveler experience

The traveler-facing word is **"place"**; "business" is back-office vocabulary.
The marker is never called a "pin" anywhere, in either direction — that word is
load-bearing in rule 3.

**Map.** A third marker family: a 26pt round chip with a category glyph,
surface-navy, quieter than a traveler pin and drawn beneath it, so a stack of
people at a bar renders on top of the bar. A place with something on tonight
brightens its ring — **not** a gold star **[review]**, which already means
"curated seed" on this map. Chips appear only past neighbourhood zoom, never
join clustering, and yield priority to travelers.

**Place sheet** (tap a chip; the same inline sheet as a pin card, map stays
pannable): 3:2 hero, name, category, open state ("Open · till 2:00"), the
rating if it has one, tonight's post if there is one, address with "View in
Maps", then **[Join the chat]** and **[Message]**.

**One hierarchy everywhere** **[review]**: Join the chat leads until you are in
it, then it becomes Open the chat. Message is second on every surface, always.

**Place page** (`/place/[id]`, its own view so a business never drifts into
person grammar): landscape hero, name, category, score; **What's on**; **The
chat here**; **Hours** (today bold, "See the week"); **Find and book** (labeled
rows — "Book a table", "Buy tickets", never a raw URL); **Photos**;
**Socials**; and **Rate this place**, open to anyone with an account.

**Two rows, never confused** **[review]**: a traveler who joins the chat and
messages the team has two conversations with one name. The group chat sits in
Groups; the DM sits in Chats with a storefront glyph and the standing subtitle
"The people who run {place}".

**Joining the chat** **[founder]** — a real date picker, not a text field:

> **When are you leaving?**
> [ date picker ] · **I'm not sure yet**
> _You'll leave the chat 3 days after you go, or after 90 days if you're not
> sure. Leave or rejoin whenever you like._
> **[ Join the chat ]**

In-chat header: "128 people here · anyone can read · you leave 12 Nov".
Read-only notice: "Only the people who run {place} post here. You can read and
react." **[review]** — the earlier "Only {place} posts here" lied whenever
staff posted.

**The member list is open** **[founder]** — anyone in the chat can see everyone
in it: photo, name, and "in town until", tapping through to a profile. This is
an app for meeting people and making plans, and a room where you cannot see who
is in it is a noticeboard. Two consequences stated plainly: the business sees
that list too, and this reverses the earlier decision 18 to redact travel dates
from moderators. Recommended and accepted, but it is a real change and it is
recorded as one.

**Messaging a place** — "Message {name}", "Goes to the people who run it. You'll
find the chat in Chats." It opens instantly. Businesses can never message
first.

**Elsewhere.** The Chat tab's room list becomes "Chats to join in {city}"
**[review]** — "open chats" collided with "Open · till 2:00" on the same rows.
Travelers tab never shows places. Guests read everything public and act on
nothing.

---

## 5. The business experience

**Signup fork.** The welcome tour's footer reads **"Run a business? Put it on
the map."** **[founder]**, and onboarding step 3 carries a "Setting this up for
a business?" footnote. Either arms the business flag before the first business
step, so a killed app resumes correctly.

Steps: name and category · city and the drop-pin picker ("Drop the pin right on
your door.") · **business email** (with the plain reason: _"Use your business
email. It's the address travelers will reach you at, and it's what puts you on
the map."_) and an optional website · links · hours (skippable) · photos
("Photos of the place, not of a person. The first one is your cover.") **and,
if the founder takes §3.9's tier 1.5, the first photo is taken on the spot: "A
photo of the front, with your sign in it."** Finish lands on:

> **"Almost there. Tap the link in the email we just sent and you're on the
> map."**

**Tabs.** The middle tab becomes **"My business"** **[founder]** with a
storefront glyph, branching the way the guest Travelers tab already does. It
holds: cover and status chip ("Live on the map" / "Waiting on your email" /
"Paused"); **What's on** with a docked "Post something" (title, details, when,
and how long — including "Keep it up until I take it down"); **Your details**
(Hours, Links, Description, Photos); **Your chat**; **Your rating** once five
travelers have rated; and "See it as a traveler". No badge anywhere, per
§3.9. Map shows their own marker
with a "You" ring and traveler pins anonymously, with no drop-pin button. Chat
pins their own room and hides the join list.

**Editors.** Hours is rule-based rather than a 7×2 grid: a row of day chips
plus two time wheels covers most venues, "Different hours on some days" adds a
row, and "Past midnight is fine. 20:00 to 2:00 reads as one night." Links is
one list for links, socials and contact — one mental model, one table. Photos
reuses PhotoGrid.

**Chat controls**, in plain words **[review]** (the microphone metaphor is
gone): **"Everyone"** / "Anyone in the chat can post."; **"People I pick"** /
"You choose who posts. Everyone can read."; **"Just us"** / "You, your staff
and your admins. Everyone can read." Under all three: _"Only you and your
admins can send photos."_ Member sheet: "Let them post" / "Stop them posting" /
"Make them an admin" / "Remove {name}".

**Notifications.** Inbound messages push normally. New members arrive as **one
daily digest** **[review]**, never per-join. Verification: "You're live on the
map in {city}. Travelers can find you now." Business posts push at most three
times a rolling day per room and deliver silently beyond that — the megaphone
is a bell, not a siren.

---

## 6. Trust & safety

- **Impersonation** is the top risk, answered by §3.9 in the founder's shape:
  a confirmation link before anything is visible, no badge that could lend an
  impersonator our credibility, renaming or moving dropping the listing back to
  `unconfirmed`, and structured reports that escalate to a machine read at three
  distinct reporters rather than waiting on somebody's inbox. The escalation
  ladder for when that stops being enough is written down in §3.9 so nobody has
  to re-derive it under pressure.
- **Spam** is answered by rule 8, enforced by trigger, plus the caps: 10 photos,
  10 links, 10 live posts, 5 post-writes a day, 30 text edits a day, 10
  business DMs opened per traveler per day, 3 push-bearing room posts a day,
  2,000 room members, 10 staff seats. **[founder: approved as a set.]**
- **Scraping**: businesses read no traveler surface; the anonymous map feed
  only. Residual and acknowledged — a venue can browse as a person with a
  second account, and velocity caps are the practical bound.
- **Ratings** cannot be weaponised the way reviews can: no free text anywhere,
  one rating per account per place, 20 a day, businesses never see who rated
  them, and no public number below five raters. Anyone with an account rates
  **[founder]**; `app_config.ratings_require_verified` is the lever if that
  ever needs tightening.
- **Photos** in open rooms are admins-only, which removes the highest-volume
  moderation surface a free-to-join room would otherwise create.
- **Reporting** is a first-class structured path, Google's shape (§3.9): not a
  real place / permanently closed / not this business / wrong location / spam or
  offensive, with an optional photo. Three distinct reporters trigger a machine
  read; a plausible impersonation verdict darkens the listing immediately.
- **Suspension** freezes and never deletes; copy never says why.

---

## 7. Migration

A business chat IS the establishment's existing room, so there is no data
migration — renames, new columns, and new math for new joins. Every row,
message, member and promised expiry survives.

1. `..._business_enums.sql` — the `alter type ... add value` statements
   (chat_kind 'business', request_source 'business', group_speaking 'admins',
   report_reason 'impersonation') plus the new enums. Own file: a new enum
   value is unusable in the transaction that adds it.
2. `..._business_accounts.sql` — renames; new columns and column-scoped
   grants; `business_email_confirmations`; `business_chats` +
   backfill + drop `businesses.chat_id`; `departure_date` nullable;
   `is_business_account`; `register_business`; the guard triggers; **and the
   recreation of every function naming `establishments` or reading a changed
   column**: `is_room_moderator`, `is_public_room`, `may_speak_in_room`,
   `guest_message_limits`, `room_info`, `room_messages`, `enqueue_message_push`,
   `expire_room_members`, `group_members`, `join_business_chat` + the
   `join_room` wrapper, `city_businesses` + the `city_rooms` wrapper,
   `my_chats` (DROP first, grants restated), `business_set_chat_role`, the
   `room_remove_member` guard, the reaction policy, the three discovery
   refusals, and `seed_launch_establishments` **[review]** — it names the old
   table and the dropped column, and the next fresh environment would break
   without it. Completeness check: `grep -r establishments supabase/` returns
   only history.
3. `..._business_content.sql` — photos and bucket, links and validator, hours,
   posts and the archive sweep, `is_visible_business`, `business_detail`,
   `screen_business_text`, the photo guard trigger.
4. `..._business_listing.sql` — the confirmation link (token table, the mailer
   call on the existing Resend path, `confirm_business_email`), the
   `business_state` transitions including rename/move dropping back to
   `unconfirmed`, `business_reports` with its one-voice-per-account unique, the
   three-reporter escalation trigger, and `admin_resolve_business_report`. Plus
   the storefront-photo question in the photo worker **if the founder takes
   tier 1.5**.
5. `..._business_inbound.sql` — the immediate-delivery branch,
   `message_business`, the `shadowed` flag and its predicates.
6. `..._business_ratings.sql` — ratings, the summary function, caps.

**pgTAP (`20_business_accounts`, `21_business_ratings`, plus updates to
10/11/16/18/19), written as attacks:** business absent from every discovery
surface; business cannot insert trips/pins/requests/photos/room_members or
create a group; the three discovery reads refuse a business caller; personal
handles unreadable across a business chat both ways; a prefilter-blocked
message yields no chat; a shadowed chat is invisible to the business; guest
join refused in the RPC and at the table; 'admins' mode refuses member and
speaker inserts while reactions still land; **a non-admin photo insert refused
in `everyone` mode**; expiry math including the null-departure and 90-day
clamp; the sweep expires business-room admins and spares group admins;
`group_members` returns the full member list for a business room; no business
rows in heat; anon reads everything public and writes nothing; the link
validator refuses `javascript:` and over-cap; an `unconfirmed` business is
fully dark on every surface; rename and move both drop a listed business back
to `unconfirmed`; `state` is absent from every client-readable payload (the
no-badge invariant, asserted rather than trusted); two reports change nothing
and three from distinct accounts enqueue exactly one review; the same account
reporting twice is refused; a suspended owner silences room and DMs; ratings
refuse a guest rater, refuse a business rater, refuse a second rating from one
account, accept a rater with no trip in that city **[founder]**, and return
nulls below five raters.

---

## 8. Build order

Each phase ends green, deployable and pushed. Everything ships over the air.

**Phase 13 — Identity and the rename.** Migrations 1-2, the recreation list,
the attack suite, the client account-kind predicate in the `owesOnboarding`
style. Zero visible change; the proof is that nothing broke and the deployed
app's `join_room` / `city_rooms` calls still work.

**Phase 14 — The public surface.** Migration 3; markers, place sheet, place
page, join flow with the new date picker and copy; the room list rename. The
four seeded venues become the first places.

**Phase 15 — Listing and reports.** Migration 4: the confirmation link, the
state machine, the structured report path and its escalation. Much smaller than
the verification phase it replaces, and it is what unlocks self-serve signup,
so it still lands before the business side.

**Phase 16 — Inbound messages.** Migration 5; message flow, storefront rows.

**Phase 17 — The business side.** Signup fork, My business, editors, chat
controls, digest push. The long pole.

**Phase 18 — Ratings.** Migration 6; the rate flow, the place-page number, the
profile shelf.

**Phase 19 — Hardening.** Wrapper retirement, push budgets against real data,
docs.

---

## 9. Decisions, all closed

The founder's second pass closed the last four. Recorded here with the
reasoning, because a decision without its reasoning gets re-litigated.

- **Decision 6 — the unwebbed escape hatch. _Agreed._** Moot in the shape §3.9
  now takes: there is no domain requirement to be excluded by. Anybody with an
  email address gets listed. The contact form remains the route for a business
  that has been wrongly flagged.
- **Decision 20 — member counts. _Total members, no label._** The "quiet
  lately" qualifier is dropped. Showing a plain number is honest and the
  founder is right that dressing it up is a problem for a scale the app does
  not have.
- **Decision 21 — scope lever. _Agreed:_** full My business dashboard at v1,
  with the thin edit screen as the fallback if launch pressure demands it.
- **Decision 22 — ratings and presence. _No blockers._** Anyone can rate any
  place, with no overlapping trip and no chat membership required. See §3.10.

**§7 rules 3, 4, 5 and proposed rule 8: signed by the founder, 2026-08-27**, as
recommended. They go into `docs/PRODUCT_BRIEF.md` §7 in phase 13, in the wording
quoted in §2 of this document.

**Settled by the first pass:** posts expire when the business says (including
never) · "Run a business? Put it on the map." · "My business" · the category
list · messages to businesses always go through with no accept · the caps · the
member list is open to everyone in the chat · the departure date picker and its
wording · photos are admins-only in business chats · Beli-style ratings.

**The one thing still worth a yes or no** (not a blocker, and v1 is the
founder's plan exactly without it): **§3.9 tier 1.5**, the required
camera-taken storefront photo with the sign in it, checked by the photo worker
that already runs. One extra signup step, no new infrastructure, and it removes
the entire class of fake listing made by somebody who never leaves their
laptop.

---

## 10. Not in this plan

- Multiple rooms per business; staff answering DMs; staff self-management.
- Document-upload verification, and everything above tier 1.5 of the §3.9
  ladder (domain-matched email, a code on the website, a video walk-in, and a
  badge to go with any of them). Written down there, deliberately not built.
- Posts as expiring map markers.
- **Written reviews of businesses — refused, not deferred.** The rating system
  above works precisely because there is no text to post, and adding a review
  field would reintroduce every dynamic the comparative model avoids.
- Paid placement, sponsored ranking, any business payment surface.
- Guests joining business chats; "open now" filtering; a holiday hours
  calendar; a Places directory tab; business analytics; LLM screening of
  business posts (prefilter only at v1); business-to-business anything.
