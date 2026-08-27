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
**automatic verification**, ratings, and the map presence.

---

## 2. The §7 reckoning

Proposed amendments, quoted as they would land in the product brief.

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

| column                                                | notes                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `owner_user_id uuid unique → users`                   | NULL for the four seeded venues                                                                                                  |
| `category public.business_category`                   | hostel, hotel, guesthouse, bar, restaurant, cafe, club, tour, activity, coworking, wellness, shop, other **[founder: approved]** |
| `description`, `place_label`, `hours_note`            | ≤600 / ≤120 / ≤200, all screened                                                                                                 |
| `website_url text`                                    | the verification anchor (§3.9)                                                                                                   |
| `verification_state public.business_verification`     | enum: `unverified`, `pending`, `verified`, `failed`                                                                              |
| `verified_at timestamptz`, `claimed_at`, `updated_at` |                                                                                                                                  |

**Column-scoped grants** **[review]**: the existing table grants full-row SELECT
to anon, which after the rename would hand out `owner_user_id`. Grants become
column lists — anon and authenticated read (id, city_id, name, category,
description, place_label, hours_note, website_url, lat, lng, public_preview,
verification_state) of `active` + `verified` rows only. `owner_user_id`,
`claimed_at` and the verification evidence are never client-readable.

RLS: select where `active and verification_state = 'verified'`; owner selects
own row always. Client UPDATE column-granted to (name, description, hours_note,
place_label, public_preview) behind a screening + velocity trigger; lat/lng,
city_id, active, verification_state, owner_user_id are server-owned. Name, city
or location changes go through `update_business_location(...)` and **re-enter
verification** — that closes verify-as-surf-shack, rename-to-Marriott.

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

Report context `business:<id>`; impersonation sorts first.
`admin_resolve_report` gains 'unverify' (verification_state → 'failed', listing
dark, room unjoinable) and 'unlist' for unclaimed venues that have no owner to
strike **[review]**. Suspension freezes everything and deletes nothing: listing
hidden, joins refused, chat status 'closed' so even the business is silent,
history readable as evidence, copy oracle-proof ("This chat is paused.").
Strikes ride the existing 3/5/7 ladder on the owner.

### 3.9 Verification, automatic **[founder]**

> _"Is there a way that a business could become verified in a similar way to
> the way we verify profiles? Ideally something Claude can verify without any
> interaction needed by me."_

Yes. A selfie proves a face is live and matches a photo; the business analogue
is proving control of the business's own public presence. Two automatic paths,
either sufficient, both cheap and global:

**Path A — business email at the business's own domain (the fast path).**
The business gives its website. If the signup email's domain matches that
website's domain, we mail a six-digit code and confirming it verifies them.
Controlling `hello@hostelname.com` is strong evidence you are Hostel Name, and
it works identically in Lisbon and Bangkok. **This is why business signup asks
for a business email** — the email step says so plainly, because an address at
your own domain is the whole shortcut.

**Path B — a code on the website (for the many businesses on Gmail).**
Most small businesses worldwide have no domain email. So: we show a short code;
they put it anywhere public — a line in the footer, an About page, a meta tag,
their Instagram or Facebook bio. An Edge Function fetches the URL and looks for
it. Found → verified. This proves control of the business's public face
without requiring a domain.

**Both paths then pass a Claude plausibility check**, in the shape of the
existing moderation-worker: given the claimed name, address, category and the
fetched page text, does this look like the same business, and are there red
flags — a parked domain, a different business's name, a chain's name on a
personal blog, an address on the wrong continent. Verdict pass / fail /
uncertain, audited to `moderation_events` like every other machine verdict.

    verified  =  (domain-matched email confirmed  OR  code found on the site)
                 AND Claude says the site plausibly belongs to this business

New tables, both with **no client grants** — verification evidence is nobody's
business but the reviewer's:

- `business_claims` (business_id, claimed_website, claimed_email, method,
  token, token_expires_at, attempts, state, evidence jsonb, timestamps)
- `business_email_codes` (business_id, code_hash, expires_at, attempts) — the
  code is mailed through the existing Resend path, not GoTrue, so no auth
  configuration changes and no effect on traveler signup.

Rate limits: 5 code sends per business per day, 10 verification attempts per
day, tokens expire in 30 minutes; all standard for this schema.

**Until verified, a business is dark** — no marker, no joinable chat, no
messages. It can build its profile while waiting, and the screen says exactly
which check is outstanding and how to pass it. Impersonation is the headline
risk and an unverified listing is exactly the phishing surface.

**The honest gap:** a business with no website and no domain email — a food
stall whose entire presence is an Instagram account that blocks fetching —
cannot pass either path. For those, the existing contact form is the escape
hatch: it lands in the founder's inbox as a rare exception, not as the default
path. Roughly: automatic for everyone with a web presence, manual only for the
genuinely unwebbed. **Decision 6.**

### 3.10 Ratings **[founder]**

> _"I think verified users should be able to rate different businesses, similar
> to how the beli app works."_

I argued against ratings in the first draft on the grounds that a scoreable
business plus a DM channel is an extortion lever. **Beli's mechanic
substantially answers that objection**, and the founder's verified-only gate
answers the rest, so this is in.

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

- **Who rates:** verified travelers only (founder's requirement, and the main
  anti-brigading control). Guests and businesses never rate. Businesses cannot
  be verified travelers, so a venue cannot rank a rival down.
- **What you rate:** a place you have been. Comparisons stay **within a
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

**Open question, decision 22:** should rating a place require having been in
its city — a trip that overlapped, or membership of its chat? It closes remote
brigading at the cost of blocking a legitimate "I was here last year" rating.
Recommendation: require it, because a rating from someone who was never in the
city is the exact shape of a bought rating.

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
**Socials**; and **Rate this place** for verified travelers.

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
your door.") · **website and business email** (the verification step, with the
plain reason: _"Use the email at your business's own domain if you have one.
It's the quickest way to get verified."_) · links · hours (skippable) · photos
("Photos of the place, not of a person. The first one is your cover."). Finish
lands on:

> **"You're nearly on. Confirm the code we just emailed you and you'll be live
> on the map."**

**Tabs.** The middle tab becomes **"My business"** **[founder]** with a
storefront glyph, branching the way the guest Travelers tab already does. It
holds: cover and status chip ("Live on the map" / "Waiting on verification" /
"Paused"); **What's on** with a docked "Post something" (title, details, when,
and how long — including "Keep it up until I take it down"); **Your details**
(Hours, Links, Description, Photos); **Your chat**; **Your rating** once five
travelers have rated; and "See it as a traveler". Map shows their own marker
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

- **Impersonation** is the top risk, answered by §3.9: nothing is visible until
  a machine has proved control of the business's public presence, and renaming
  or moving re-enters verification.
- **Spam** is answered by rule 8, enforced by trigger, plus the caps: 10 photos,
  10 links, 10 live posts, 5 post-writes a day, 30 text edits a day, 10
  business DMs opened per traveler per day, 3 push-bearing room posts a day,
  2,000 room members, 10 staff seats. **[founder: approved as a set.]**
- **Scraping**: businesses read no traveler surface; the anonymous map feed
  only. Residual and acknowledged — a venue can browse as a person with a
  second account, and velocity caps are the practical bound.
- **Ratings** cannot be weaponised the way reviews can: no free text anywhere,
  verified raters only, one rating per traveler per place, businesses never
  see who rated them, and no public number below five raters.
- **Photos** in open rooms are admins-only, which removes the highest-volume
  moderation surface a free-to-join room would otherwise create.
- **Reporting**: "This isn't the real business" / "Spam or a scam" /
  "Inappropriate content" / "Something else", impersonation first in the queue.
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
   grants; `business_claims`, `business_email_codes`; `business_chats` +
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
4. `..._business_verification.sql` — claims, codes, the verify RPCs, the
   Edge Function contract.
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
validator refuses `javascript:` and over-cap; a pending business is fully dark;
rename re-enters verification; a suspended owner silences room and DMs;
ratings refuse an unverified rater, refuse a second rating, refuse a business
rater, and return nulls below five raters.

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

**Phase 15 — Verification.** Migration 4 and the verifier Edge Function. This
is what unlocks self-serve signup, so it lands before the business side.

**Phase 16 — Inbound messages.** Migration 5; message flow, storefront rows.

**Phase 17 — The business side.** Signup fork, My business, editors, chat
controls, digest push. The long pole.

**Phase 18 — Ratings.** Migration 6; the rate flow, the place-page number, the
profile shelf.

**Phase 19 — Hardening.** Wrapper retirement, push budgets against real data,
docs.

---

## 9. Decisions still open

Everything else is settled per the founder's pass.

6. **The unwebbed escape hatch.** Businesses with no website and no domain
   email cannot verify automatically. Recommendation: route them to the
   existing contact form as a rare manual exception, so nobody is permanently
   stuck. Confirm, or accept that v1 simply cannot list them.
7. **Member counts**: show total members, or only those active in 14 days?
   Recommendation: total, with a "quiet lately" label so a dead room is never
   a city's first impression.
8. **Scope lever**: full My business dashboard at v1, or a thin edit screen
   with hand-onboarding? Recommendation: full, thin as the fallback.
9. **Ratings and presence**: must a rater have been in the city (an
   overlapping trip, or chat membership)? Recommendation: yes — a rating from
   somebody never in the city is the shape of a bought rating.

**Settled by the founder's pass:** posts expire when the business says
(including never) · "Run a business? Put it on the map." · "My business" ·
automatic verification via business email and website, no founder in the loop ·
the category list · messages to businesses always go through with no accept ·
the caps · the member list is open to everyone in the chat · the departure
date picker and its wording · photos are admins-only in business chats ·
Beli-style ratings for verified travelers.

---

## 10. Not in this plan

- Multiple rooms per business; staff answering DMs; staff self-management.
- Document-upload verification.
- Posts as expiring map markers.
- **Written reviews of businesses — refused, not deferred.** The rating system
  above works precisely because there is no text to post, and adding a review
  field would reintroduce every dynamic the comparative model avoids.
- Paid placement, sponsored ranking, any business payment surface.
- Guests joining business chats; "open now" filtering; a holiday hours
  calendar; a Places directory tab; business analytics; LLM screening of
  business posts (prefilter only at v1); business-to-business anything.
