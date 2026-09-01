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
| `verified_at timestamptz`                           | set once by the storefront-photo check; cleared by rename, move or flag (§3.9)                                                   |
| `listed_at timestamptz`, `claimed_at`, `updated_at` |                                                                                                                                  |

**Column-scoped grants** **[review]**: the existing table grants full-row SELECT
to anon, which after the rename would hand out `owner_user_id`. Grants become
column lists — anon and authenticated read (id, city_id, name, category,
description, place_label, hours_note, website_url, lat, lng, public_preview)
of `active` + `listed` rows only, **plus a derived boolean `verified`** so the
badge can render. `owner_user_id`, `claimed_at`, the raw `verified_at` and the
report history are never client-readable. **`state` is not readable either** —
a client that can see a business at all knows it is `listed`, and exposing the
enum would leak the moderation queue.

RLS: select where `active and state = 'listed'`; owner selects own row always.
Client UPDATE column-granted to (name, description, hours_note, place_label,
public_preview) behind a screening + velocity trigger; lat/lng, city_id,
active, state, verified_at, owner_user_id are server-owned. Name, city or
location changes go through `update_business_location(...)`, which drops the
row back to `unconfirmed` **and clears `verified_at`** — that closes
verify-a-surf-shack, rename-to-Marriott, and it is the same edit set Google
re-triggers on.

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
  runs hourly, at minute 7 over the two dated cases. Soft-archive, not delete: §7 rule 3's
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
report path and its first-report escalation are §3.9, because a business report
carries a machine scan and an email that a person report does not.
`admin_resolve_report` gains 'flag' (state → 'flagged', listing dark, room
unjoinable), 'relist' and 'remove' for unclaimed venues that have no owner to
strike **[review]**. Suspension freezes everything and deletes nothing: listing
hidden, joins refused, chat status 'closed' so even the business is silent,
history readable as evidence, copy oracle-proof ("This chat is paused.").
Strikes ride the existing 3/5/7 ladder on the owner.

### 3.9 Getting listed, and getting verified **[founder, final]**

> _"Businesses required to verify their email address to use their email
> address. This alone would not trigger a verification. For a business to be
> verified, we can use the one time storefront/sign photo (must be a real
> photo, like the selfie) method which uses Claude to judge if it is real,
> similar to the selfie verifications. You could even require the photo be
> taken a certain way if that would help to deter fake businesses further... I
> also like Claude to scan each business profile and give an alert when
> impersonation is plausible - but do this after the first report, and also
> make sure that the report is alerted via email as well."_

Two separate things, and keeping them separate is the whole design.

| step                   | what it proves                       | what it unlocks                           |
| ---------------------- | ------------------------------------ | ----------------------------------------- |
| **Confirm your email** | somebody reads that inbox            | the listing goes live. **No badge.**      |
| **Storefront photo**   | somebody stood in front of the place | **the verified badge**, and the full caps |

This is Google's claimed-versus-verified split, and it is the right one: a
business gets onto the map in minutes, and the badge is earned by a bar high
enough that the badge means something. Compare the previous draft, where a
click on an email link would have produced a check mark: that badge would have
lent an impersonator the app's credibility. This one does not, because behind
it is a photograph of the premises judged the same way a selfie is.

#### Step 1 — confirm the email

A link, mailed through the **existing Resend path** used by `support-mailer`,
not GoTrue — so no auth configuration changes and no effect on traveler signup,
a flow that has already been broken once by an auth toggle.

- `business_email_confirmations` (business_id, token_hash, expires_at, attempts,
  confirmed_at). **No client grants at all.** Link expires in 24 hours, 5 sends
  per business per day.
- Until confirmed the business is **`unconfirmed`, and fully dark**: no marker,
  no joinable chat, no messages. It can build its page while it waits, and the
  screen says plainly that the link is the only thing between it and the map.
- Signup asks for a business email and says why: _"Use your business email.
  It's the address travelers will reach you at, and it's what puts you on the
  map."_ Nothing refuses a Gmail address; most small businesses on earth are on
  one, and refusing them is refusing the market.
- **Changing the email re-confirms.** Changing the name, city or location drops
  the row back to `unconfirmed` **and clears the verification**, which is what
  closes list-a-surf-shack, rename-to-Marriott. Google re-triggers on exactly
  the same edits.

#### Step 2 — the storefront photo, and how it must be taken

Modelled on `verification_requests` down to the table shape, the private
bucket, the worker branch and the service-role-only verdict writer. It is one
time, and it is the only thing that sets `verified_at`.

**Two shots, live camera only, one session.** The design choice the founder
left open, and the reasoning for it:

1. **The wide shot.** _"Stand back across the street and get the whole front in,
   with your sign."_
2. **The close shot.** _"Now get closer, so we can read the sign."_

Why two and not one. A single close-up of a sign is the easiest thing on earth
to find on the internet; a wide shot pins the sign to a building, a street and
a streetscape, and the pair has to agree with each other **and** with the marker
the business dropped on the map. Two shots taken minutes apart from different
distances is a thing you get by standing there and a thing you do not get by
searching. It costs the honest business twenty extra seconds.

Mechanically, and all of it mirrors the selfie flow:

- **Camera only. The photo library is never offered.** The single most
  important line in this section, because a library picker turns the whole
  check into a search-and-download.

  **History, 2026-08-27:** an earlier draft of this line said "the same rule the
  selfie screen already enforces", which was wrong at the time —
  `src/app/verification.tsx` fell back to `launchImageLibraryAsync` whenever the
  platform was web or camera permission was denied. The founder called it, and
  it is now true: both screens capture through `src/lib/live-camera.ts`, the one
  sanctioned path, which never imports the library picker. A refused camera gets
  an explanation and an Open Settings button on both screens, never a second
  route. `src/lib/__tests__/live-camera.test.ts` scans the source of all three
  files so the fallback cannot come back as a kindness.

- Both shots captured in one screen session, server-stamped, and **refused if
  more than 15 minutes apart**.
- Uploaded to the private `business-photos` bucket under a
  `verification/<business_id>/` prefix that is never served publicly. These are
  evidence, not gallery photos, and they never appear on the listing.
- One pending submission at a time; 3 attempts a day; a rejection is a strike
  against the owner on the existing ladder.

**What Claude is asked** (branch in the existing `moderation-worker`, prompt
text in the GitHub secret like every other classifier prompt, never in the
repo). Given both photos plus the claimed name, category, city and address:

1. Is each image a **photograph of a real place**, rather than a screenshot, a
   photo of a screen, a stock image, a render or an AI generation?
2. Do the two show the **same premises**?
3. Does signage in the close shot **read the claimed business name**? Allow for
   translation, transliteration and a trading name that differs from the legal
   one, because this has to work in Bangkok as well as Lisbon.
4. Does the storefront **look like the claimed category**?
5. Does the wide shot's streetscape **plausibly match the claimed city**?

Verdict `pass` / `fail` / `uncertain`, written back by a service-role-only
`apply_business_verification_verdict`, audited to `moderation_events` like every
other machine judgment. `uncertain` goes to the founder rather than to either
extreme, because a hand-painted sign in a script the model reads poorly is a
real business having a bad day.

**A business with no sign at all** (a tour operator who works from a phone, a
market stall) will fail step 2 honestly. It is still **listed** on the map, it
simply has no badge, and the contact form is the route to arguing the case. The
badge is the exception, not the ticket.

#### What the badge does, and does not, unlock

Deliberately almost nothing, so the badge stays a signal rather than a paywall:

- **Listed, unconfirmed:** dark everywhere.
- **Listed, email confirmed, unverified:** on the map, joinable chat, inbound
  messages, and a **reduced ceiling — 3 live posts and no push-bearing posts.**
  A quiet incentive to finish, with no core function withheld.
- **Verified:** the badge, and the full caps from §6.

The badge renders as a small check beside the name on the place sheet and page,
in `accent`, with the accessible label "Verified business". Nowhere else. There
is no "unverified" chip: labelling the absence would put a scarlet letter on
every honest business that has not got round to it yet.

#### Step 3 — impersonation scanning, on the first report **[founder]**

The threshold moves from three reporters to **one**. The founder's reasoning is
sound: the machine read is cheap, and it is the thing that keeps disputes rare
enough to handle by hand.

`business_reports` (id, business_id, reporter_user_id, reason enum, note ≤300,
photo_path nullable, created_at; unique on (business_id, reporter_user_id), so
one account is one voice). Reasons, lifted from Google's list because it is
well-worn: **not a real business · permanently closed · not this business (someone
else is running it) · wrong location · spam or offensive**.

| on the first report from a given account                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- |
| the report is stored, and **an email goes to `SUPPORT_INBOX` immediately**                                                |
| the business profile is enqueued for a Claude impersonation scan                                                          |
| the scan reads name, description, category, links, posts, photos and the report against a plausibility prompt             |
| **plausible impersonation → `state = 'flagged'`**: listing dark, chat unjoinable, verification cleared, second email sent |
| **not plausible → stays live**, verdict recorded on the report for the founder to glance at                               |

Two reports on the same business do not re-scan within 24 hours; the email
still sends, because the founder wants to see them.

**The email** reuses `support-mailer`'s Resend path exactly, and is addressed to
`SUPPORT_INBOX` — pinned to `hello@samewhere.io` in the deploy workflow since
2026-08-31 (it began as a personal-address secret before the domain existed).
Subject and body carry the business name, the city, the reason, the note, a link
to the report row and, once the scan lands, the verdict. Nothing in it is
guessed: if the scan has not finished, the email says the scan is pending and a
second email follows.

`admin_resolve_business_report(report_id, action)` with actions **flag**,
**relist**, **remove**, **unverify** and **dismiss**, service-role only. This is
the manual path the founder asked to be left with, and the machinery above
exists to keep the queue short enough that it is a real path rather than a
theoretical one.

#### The state machine

`business_state`: `unconfirmed → listed → flagged → removed`, plus `listed`
again out of `flagged`. `verified_at` is orthogonal to all four: it is set once
by the photo check, and cleared by a rename, a move, or a `flag`.

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

The word everywhere, in both directions, is **"business"** — travelers read it
too. Founder, 2026-08-28: _"I don't think we should refer to businesses as
'places', we should always call them businesses to keep it consistent and also
less confusing."_ "Place" survives only where it means a spot on the map, never
a listing.
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
**Socials**; and **Rate this business**, open to anyone with an account.

**Hours are always a section, even when there are none.** Signup is right not
to make an owner guess their hours and step 9 is skippable, but the traveler
side used to hide the whole section in that case, so "should I go there
tonight" was neither answered nor acknowledged — and an absent section is
indistinguishable from one that failed to load. The section now renders
**"Hours not set"**, and the tapped-marker card says the same on its meta line
(the card has no Hours section to put it in), so the two surfaces cannot
disagree about whether a business has told anyone when it is open. The meta row
on the page is deliberately left silent: an open line there is a fact about
today, and stating the gap in two places on one screen makes it louder than the
business. Where the listing is **claimed**, the existing **[Message]** button
moves up beneath that line rather than sitting three sections down — asking is
the traveler's one remaining move, and it is the same control moved, never a
second copy.

**Share this business** — one ghost button on the listing page, on the
traveler's reading of it and on the owner's own "See it as a traveler" view.
`src/features/business/share-listing.ts` owns the link and the words;
`src/features/share/share-link.tsx` owns the QR square and the share sheet, the
same pair the group invite uses. **The link is the custom scheme
(`samewhere://place/<id>`) and not an https one** — founder ruling: no
universal links in this batch, `UNIVERSAL_LINKS_LIVE` stays false, because an
`apple-app-site-association` entry for a path we do not serve is a broken link
rather than a half-working one, and flipping it costs an EAS build. So the QR
at a hostel counter is the case this is good at today and Instagram is the case
it is half good at. The https spelling is already written behind the same flag,
so turning it on later is a flag flip plus one build — plus, for this path
specifically, a `/place/*` component in the association file and a hosted page
answering it.

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
("Photos of the business, not of a person. The first one is your cover."). Finish
lands on:

> **"Almost there. Tap the link in the email we just sent and you're on the
> map."**

**Tabs.** The middle tab becomes **"My business"** **[founder]** with a
storefront glyph, branching the way the guest Travelers tab already does. It
holds: cover and status chip ("Live on the map" / "Waiting on your email" /
"Paused"), with a **"Get verified"** row beneath it until the storefront photo
passes (§3.9); **What's on** with a docked "Post something" (title, details, when,
and how long — including "Keep it up until I take it down"); **Your details**
(Hours, Links, Description, Photos); **Your chat**; **Your rating** once five
travelers have rated; and "See it as a traveler". The verified check renders
beside the name once earned, and nowhere else. Map shows their own marker
with a "You" ring and traveler pins anonymously, with no drop-pin button. Chat
pins their own room and hides the join list.

**Share your page.** A section on My business with two rows: the share sheet,
and a QR square the owner can hold up or print for the counter. Both are the
same link and the same one string (`listingShareMessage`), and the QR needs no
native module, so the whole thing ships over the air. §2.6's go-to-market is
hostel partnerships and creator marketing and both of those are links, so this
is the cheapest liquidity lever in the product; until it existed, `Share`
appeared exactly once in all of `src/` and it was the group invite.

**The account page behind the header avatar is settings, not a second front
door.** It used to open with a large "Manage your business" button under a
subtitle explaining it, which made it and the My business tab two doors onto
one room — an owner who arrived from the tab was handed a button back to the
tab. Both are gone, the page is titled **Account** (a business account has no
profile), and the way back is the back gesture, which returns to whichever tab
the avatar was tapped from.

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

- **Impersonation** is the top risk, answered by §3.9: a confirmation link
  before anything is visible; a badge earned only by two live camera shots of
  the premises, judged the way a selfie is, so the badge never lends an
  impersonator our credibility; renaming or moving dropping the listing back to
  `unconfirmed` and clearing the badge; **a Claude scan of the whole business
  profile on the very first report [founder]**; and an email to `SUPPORT_INBOX`
  on every report, so nothing waits on somebody opening a dashboard.
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
  real business / permanently closed / not this business / wrong location / spam or
  offensive, with an optional photo. **The first report** triggers both an email
  and a machine read; a plausible impersonation verdict darkens the listing
  immediately and clears its badge.
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
   `unconfirmed` and clearing `verified_at`; `business_verifications`,
   `submit_business_verification` and the service-role-only
   `apply_business_verification_verdict`; `business_reports` with its
   one-voice-per-account unique; the **first-report** trigger that enqueues both
   the email and the impersonation scan; and `admin_resolve_business_report`.
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
to `unconfirmed` **and null `verified_at`**; `state` and raw `verified_at` are
absent from every client-readable payload while the derived `verified` boolean
is present; a client cannot write `verified_at` by any path; the FIRST report
enqueues exactly one email and one scan; the same account reporting twice is
refused; an unverified business is held to the reduced post caps; a suspended owner silences room and DMs; ratings
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

**Phase 15 — Listing, verification and reports.** Migration 4: the confirmation
link, the state machine, the storefront-photo check and its worker branch, the
structured report path, the first-report email and impersonation scan. What
unlocks self-serve signup, so it lands before the business side.

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

**Built, 2026-08-27, with two deliberate departures from this document:**

- **`business_chats` is not built.** Decision 12 is one chat per business at v1,
  which `businesses.chat_id` already models exactly, so the separate table and
  its backfill would have been schema churn with no behaviour behind it. It
  earns its place alongside multi-room, which §10 defers. Nothing else in the
  plan depended on it, and every function that would have read it reads
  `chat_id` instead.
- **The confirmation is a six-digit code, not a tappable link.** Functionally
  identical - both prove somebody reads that inbox - and a code needs no
  deep-link handling, no associated-domain entitlement and no native build, so
  it ships over the air today. It also survives mail clients that rewrite links.

**Settled by the first pass:** posts expire when the business says (including
never) · "Run a business? Put it on the map." · "My business" · the category
list · messages to businesses always go through with no accept · the caps · the
member list is open to everyone in the chat · the departure date picker and its
wording · photos are admins-only in business chats · Beli-style ratings.

**Closed 2026-08-27, and the last open question with it.** The storefront photo
is in, and it is what the verified badge means. Confirming the email is required
to use the account but grants no badge; the badge comes from a one-time real
photo judged like the selfie; the impersonation scan runs on the **first** report
rather than the third; every report emails `SUPPORT_INBOX`. §3.9 carries the
full design, including the two-shot capture rule and why the photo library is
never offered. **Implementation is cleared to proceed.**

---

## 10. Not in this plan

- Multiple rooms per business; staff answering DMs; staff self-management.
- Document-upload verification, domain-matched email, a code planted on the
  website, and a video walk-in. All strictly stronger than the storefront photo
  and all deliberately not built: the photo is the bar, and the manual queue
  behind the report path is what handles what it misses.
- Posts as expiring map markers.
- **Written reviews of businesses — refused, not deferred.** The rating system
  above works precisely because there is no text to post, and adding a review
  field would reintroduce every dynamic the comparative model avoids.
- Paid placement, sponsored ranking, any business payment surface.
- Guests joining business chats; "open now" filtering; a holiday hours
  calendar; a Places directory tab; **a business analytics product** — counters,
  charts, time series, a views/taps/saves dashboard nobody asked for; LLM
  screening of business posts (prefilter only at v1); business-to-business
  anything.

**What "business analytics is deferred" does not mean.** Two events now fire:
`business_page_viewed` (`business_id`, `source: 'page' | 'sheet'`, and never on
the owner's own reading of their own listing) and `business_link_tapped`
(`business_id` and the link **kind**, never the link's value — a phone number is
the business's own contact detail and does not leave the app in an analytics
payload). They cost no table, no column and no screen; they are the history that
makes a Tuesday number possible later, and §6 asks for liquidity metrics from
day one. Founder ruling: the one honest sentence on My business built from
numbers already on that screen ("How it's going") ships with them. The moment
either needs a table, it has stopped being this and has become the thing above.
