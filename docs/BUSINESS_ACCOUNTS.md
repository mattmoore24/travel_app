# Business accounts ("Places") — the plan

Drafted 2026-08-27 from five research lenses (data model, traveler UX, business
UX, trust & safety, migration/competitive), then adversarially reviewed by three
critics (UX simplicity, §7/privacy, engineering feasibility) before this final
form. The review found three blocking defects in the first draft — a
departure-date leak through `group_members()`, anti-scraping refusals asserted
in prose with no migration to live in, and a dropped RPC that would have broken
every deployed client's Join button — all folded in below, marked **[review]**
where the fix changed the design.

Nothing in this document is implemented. It is a plan for founder review, and
§9 lists every decision that is the founder's to make.

---

## 1. What this is, in three sentences

A business account is a normal auth user that owns a row in `businesses`
(today's `establishments`, grown up): a persistent, publicly readable place on
the map with photos, hours, links, posts, and one open chat, visible to anyone
with zero matching. It is not a person: it never appears in Travelers, never
posts trips or pins, never sends a first message, and its public face is the
business record, not a profile. Almost all of the requested chat machinery
already exists — venue rooms, speaking modes, roles, the moderation pipeline,
the guest ladder — so this feature is mostly a new front door onto shipped
plumbing, plus §7 amendments the founder must sign before anything lands.

---

## 2. The §7 reckoning (nothing ships without this)

Every rule below quotes proposed amendment language verbatim for sign-off.
Rules 1, 2, 6, and 7 need no carve-out; they are stated for the record.

**Rule 3 — "Pins hard-expire at ≤72 hours."** A business marker is persistent.
Proposed amendment:

> _"Traveler pins (`public.pins`) hard-expire at ≤72h and are then unreadable —
> unchanged. Business markers are persistent commercial listings stored in
> `public.businesses`; they are statements about a premises, not about a
> person, contain no dates and no personal data, never enter `public.pins`,
> and never count toward heatmap aggregation. Business posts (deals/events)
> carry their own mandatory expiry (≤30 days) and are swept."_

Note: seeded establishments have rendered persistent venue locations since
20260817200000; this writes down a carve-out that is already implicitly live.

**Rule 4 — "Social handles are never visible pre-accept."** Business handles
are public by design. Proposed amendment:

> _"Rule 4 protects people. Personal `social_handles` keep the
> accepted-direct-chat gate unchanged. A business's socials, links, and contact
> info are advertising about a premises, live in a separate public table
> (`business_links`), and are shown to anyone pre-contact. In exchange the gate
> tightens: a chat with a business (`chats.kind = 'business'`) never unlocks
> anyone's personal handles, in either direction."_

Ground truth: `has_accepted_chat` already requires `kind = 'direct'`
(20260819210000:263-281), so the rule-4 protection falls out for free —
**provided** business DM chats are always created `kind='business'`, never
`'direct'`. That invariant is load-bearing and gets a two-direction pgTAP
attack test.

**Rule 5 — "Every first message passes moderation."** Fully intact, no
carve-out — but the _accept ceremony_ (never itself a §7 rule) is waived for
one recipient class. Restatement for sign-off:

> _"Every first message from a person to a business passes the identical
> prefilter → held-state → LLM-verdict pipeline before any chat exists; on a
> clean verdict the chat opens immediately instead of landing in an accept
> inbox. Business accounts send no first messages at all. Business broadcast
> text (name, description, posts, link labels) passes the same regex prefilter
> on write, via a `screen_business_text` trigger in the shape of the existing
> `screen_profile_text`."_ **[review]** (the first draft named a `screen_text`
> function that does not exist; the real chokepoints are
> `screen_first_message` and the profile-text trigger, and the business
> trigger reuses them.)

**Proposed new rule 8** (the anti-spam posture — recommend adopting):

> _"A business account never initiates contact with a traveler, never joins a
> traveler's group or another business's chat, and never reads traveler
> discovery surfaces. Its reach is its marker, its posts, and its own chats."_

**[review]** The first draft's rule-8 wording promised more than its triggers
enforced. The wording above matches the enforcement exactly: BEFORE INSERT
refusals on `trips`, `pins`, `message_requests` (as sender),
`verification_requests`, `profile_photos`, **and `room_members`** (a business
joins no rooms — its own is moderated through ownership, not membership), plus
`create_group` refusing business callers, plus the three discovery reads
refusing them (§3.7).

**Rule 1 note:** nothing here gates any traveler-facing read or message on
payment. Business features are free at v1; if business-side monetization ever
arrives it must be placement, never gating traveler reads/messages, and never
pay-to-rank (decision 15).

**Rule 2 note:** a business's lat/lng is a claimed place of business entered at
registration, not a device reading. No location permission enters app.json.

**Rule 6 note:** businesses are structurally outside heat — `heat_cells`
aggregates only `public.pins`, and businesses can never have rows there
(trigger-enforced). A permanent commercial marker in heat would light a cell
forever and destroy the date signal; the k-count stays a count of travelers.

---

## 3. Data model

### 3.1 Account identity

No mirrored flag — the guests build proved mirrored flags drift; ownership is
the source of truth:

- `businesses.owner_user_id uuid unique references users(id)` — owning a row
  IS being a business account.
- `is_business_account(p_user_id uuid default auth.uid()) returns boolean` —
  SECURITY DEFINER, one lookup via the unique index, execute revoked from anon
  (the `is_guest_account` shape).
- **The keystone invariant, reused from guests:** a business profile's
  `onboarding_completed_at` stays NULL forever
  (`business_profile_stays_minimal` BEFORE UPDATE trigger on profiles, refusing
  the stamp plus age/gender/bio). That single fact keeps businesses out of
  `get_matches`, `featured_traveler`, `daily_spotlight`, `city_pins`, and the
  Travelers tab with zero edits to those functions. Per the Phase 11 lesson,
  pgTAP still attacks each surface individually.
- The registration RPC sets `profiles.display_name := business name`, so chat
  headers and message authorship render correctly with zero query changes.
- One account is one identity: a caller with `onboarding_completed_at` set
  cannot register a business, and a business owner who travels makes a second
  free account (decision 5).

Guard triggers (guest idiom), the full list: `businesses_do_not_broadcast`
(trips, pins), `businesses_do_not_reach_out` (message_requests as sender),
`businesses_do_not_upload` (verification_requests, profile_photos),
`businesses_do_not_join` (room_members) **[review]**, and a business-caller
refusal inside `create_group`.

### 3.2 The `businesses` table

Rename, don't parallel: `alter table establishments rename to businesses;
alter table establishment_staff rename to business_staff;` — live rooms,
chat_ids, members, and messages carry over untouched. A permanent
`establishments`/`businesses` split would leave every future reader guessing
which table means what; the cost — recreating every SECURITY DEFINER function
that names the table — is bounded, greppable, and proven by the full pgTAP run.
It is the single riskiest migration of the set (§8) and lands with the full
recreation list in one file.

New/changed columns on `businesses`:

| column                                                                         | notes                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner_user_id uuid unique → users`                                            | NULL for the four seeded venues (unclaimed)                                                                                                                 |
| `category public.business_category`                                            | enum: hostel, hotel, guesthouse, bar, restaurant, cafe, club, tour, activity, coworking, wellness, shop, other; backfilled from `kind`, then `kind` dropped |
| `description text` (≤600), `place_label text` (≤120), `hours_note text` (≤200) | all through the business text screen                                                                                                                        |
| `moderation_status public.moderation_status default 'pending'`                 | seeded rows backfilled 'approved'; unapproved businesses are **invisible, not badged**                                                                      |
| `claimed_at timestamptz`, `updated_at`                                         |                                                                                                                                                             |

**Access, column-scoped** **[review]**: the existing table grants full-row
SELECT to anon, which after this migration would hand out `owner_user_id`.
Grants become column lists: anon+authenticated read (id, city_id, name,
category, description, place_label, hours_note, lat, lng, public_preview) of
approved+active rows; `owner_user_id`, `moderation_status`, `claimed_at` are
never client-readable — clients never learn which human owns a place, and
`message_business` exists precisely so they never need to.

**Registration evidence is not on this table** **[review]**: the claimed
website and business contact email used for verification live in a separate
`business_claims` table with **no client grants at all** (service-role and the
founder's admin view only). Verification evidence about a pending claim is
nobody's business but the reviewer's.

RLS: select for anon+authenticated where `active and
moderation_status='approved'`; owner selects own row always (own-columns
grant). Client UPDATE column-granted to (name, description, hours_note,
place_label, public_preview) with a validate trigger (text screen + 30/day
velocity); lat/lng, city_id, active, moderation_status, owner_user_id are
server-owned. Name/city/location changes go through
`update_business_location(...)` and re-enter `moderation_status='pending'`
(closes the verify-as-surf-shack-rename-to-Marriott attack). No client
INSERT/DELETE.

`register_business(...) returns uuid` — refuses guests, completed-onboarding
callers, existing owners, bad standing; geofence-validated; lands 'pending';
writes the evidence row to `business_claims`.
`admin_review_business(p_business_id, p_action, p_note)` — service-role only,
`assert_service_caller`, audited to `moderation_events`. v1 verdicts are
founder-manual via an `admin_business_queue` view; the claim evidence is what
the founder judges. A document-upload evidence bucket is deferred to v2 — at
four-city volume the founder is already talking to venues.

### 3.3 Content tables

- **`business_hours`** — (business_id, weekday 0-6, opens time, closes time,
  position; pk on all three). Multiple rows per weekday = split shifts;
  closes < opens = past midnight; absent weekday = closed. Exceptions live in
  the free-text `hours_note`. "Open now" is computed against the launch city's
  timezone (4 cities, lookup table); when in doubt show plain hours, never a
  wrong "Open". Read: anon+authenticated via `is_visible_business(p_business_id)`;
  writes owner-only.
- **`business_links`** — (id, business_id, kind enum: website, reservations,
  tickets, menu, phone, email, whatsapp, instagram, tiktok, facebook, x,
  other; label ≤40, value ≤300, position). This is where business socials
  live; `social_handles` stays people-only. Validator trigger: scheme
  allowlist by kind (https for links, tel:/mailto: for contact, bare handles
  for socials), no IP-literal hosts, label screened, cap 10 per business
  (advisory-locked). Free-text business fields refuse URLs at the prefilter,
  so every outbound URL passes one chokepoint. Public read; owner-only writes.
- **`business_photos`** — mirror of profile_photos, deliberately separate
  (profile_photos is entangled with person surfaces: avatar semantics, 7-cap,
  matching reads). (id, business_id, storage_path, position 0-9 with 0 =
  cover, moderation_status, created_at); cap 10. New private bucket
  `business-photos`, paths `<owner_user_id>/<uuid>.jpg`, own-folder insert
  with object ceiling 30, signed URLs. Same worker pipeline: BEFORE INSERT
  hold at 'pending'; `apply_business_photo_verdict` service-role-only;
  rejection is a strike against owner_user_id. Approved photos of visible
  businesses readable by anon.
- **`business_posts`** — (id, business_id, title 2-80, body ≤600, photo_path,
  happens_at timestamptz nullable, `ends_at not null`, archived_at,
  timestamps). **[review]** The first draft's Event/Deal/Update kind enum is
  dropped: travelers only ever saw the derived caption, so the three-way
  choice was composer friction with no payoff. A post is a post; "When is it?"
  (optional `happens_at`) and "Until when?" (`ends_at`) drive the caption
  ("Tonight 20:00" / "Until Sun"). **Every post expires**:
  `check (ends_at > coalesce(happens_at, created_at))` and
  `check (ends_at <= created_at + interval '30 days')`. Caps: ≤10 live, 5
  writes/day, advisory-locked. Title/body screened on write. Nightly
  `archive_expired_posts()` stamps `archived_at` — soft-archive; §7.3's
  hard-delete is a personal-location promise and does not apply to commercial
  content (recorded reasoning). Live posts readable by anon; owner reads own
  archive.

### 3.4 Business chats

New table, not a `groups` row and not a column on `businesses`:

`business_chats` (chat_id uuid pk → chats, business_id → businesses,
`speaking public.group_speaking default 'everyone'`, created_at,
**unique(business_id)** for v1 — one room per business; dropping that
constraint later is the whole multi-room migration).

Why this shape: a `groups` row would silently invert the guest read-only
invariant ("room with no groups row = venue room", 20260823120000) and
duplicate name/created_by; a column on `businesses` cannot grow to multi-room.
Backfill in the same migration from `businesses.chat_id`, re-point every
reader, then drop `businesses.chat_id`. `guest_message_limits` is recreated so
the venue-room test becomes "exists business_chats row" instead of "no groups
row" — backfill and guard land in one migration, with a guest-post attack test
against the seeded venues specifically.

Speaking modes — the founder's three map onto the existing enum plus one value
(`alter type group_speaking add value 'admins'`; own migration file — new enum
values are unusable in the adding transaction, repo precedent). An explicit
third value means flipping modes never wipes speaker grants.

| founder's words        | mode       | who may post                                                             |
| ---------------------- | ---------- | ------------------------------------------------------------------------ |
| "allow all users"      | `everyone` | any live member                                                          |
| "allow selected users" | `granted`  | speakers + admins + business/staff (today's machinery, `set_group_role`) |
| "read only"            | `admins`   | business owner, staff, appointed admins only                             |

`may_speak_in_room` recreated to read
`coalesce(groups.speaking, business_chats.speaking)` and treat 'admins' as
moderator-only; `can_send_in_chat` unchanged. `is_room_moderator` recreated
with three arms: business_staff, owner_user_id, room_members.role='admin'. All
existing moderator tools (remove message with evidence, remove member, pinned
messages) follow for free.

**Reactions in read-only rooms** **[review]**: the reaction policy currently
gates on `can_send_in_chat`, which would make "read only" mean "no reactions"
— the wrong feel for an announcements room. The reaction policy is recreated
to allow any live member to react regardless of speaking mode; the copy "You
can read and react" then tells the truth.

Admin appointment: `business_set_chat_role(p_chat_id, p_user_id, p_role in
member|speaker|admin)` — callable only by owner/staff, so appointed admins
cannot mint admins. Appointed admins moderate (remove people/messages) but
cannot change speaking mode or edit the business. Guard added to
`room_remove_member`: an admin row is removable only by owner/staff.
`leave_room` unchanged — users always remove themselves.

**[review]** `promote_group_successor` needs no change: its first guard
already returns for chats with no `groups` row, so business rooms are
structurally excluded — the first draft scheduled a pointless recreation. A
pgTAP case proves the exclusion instead.

### 3.5 Membership lifecycle

`join_business_chat(p_chat_id uuid, p_departure_date date default null)
returns jsonb`. Auth + `assert_good_standing` + **a guest refusal in the RPC
itself** **[review]** (decision 9 was client-enforced-only in the first draft
— the exact failure mode 20260823120000 exists to correct); chat must belong
to an active, approved business. Joining IS the auto-add — no trip required,
no business approval, `p_departure_date >= current_date` when given. Upsert,
so rejoin/extend is one tap. Room cap 2,000 members.

**[review]** `room_members.departure_date` is NOT NULL today; this migration
relaxes it to nullable for the "Not sure yet" path, and every reader of the
column is checked for null-safety in the same file (the recreation list
covers them).

| rule                          | value                                                | mechanism                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| join requirement              | none (no trip, no approval)                          | RPC checks standing + business visibility + not-a-guest                                                                                                                                                                        |
| expiry with departure date    | departure + 3 days                                   | `expires_at = least((dep + 3)::timestamptz, now() + 90d)`                                                                                                                                                                      |
| expiry with no departure date | join + 90 days                                       | same formula, null branch                                                                                                                                                                                                      |
| hard cap                      | 90 days from join                                    | the `least()` clamp; rejoin is one tap                                                                                                                                                                                         |
| removal                       | hourly `expire_room_members()` sweep                 | **[review]** recreated: spares admins only where a `groups` row exists — an appointed admin in a business room expires like anyone and can be reappointed on rejoin; immortal traveler-admins in a commercial room were a leak |
| self-removal                  | any time                                             | `leave_room`, unchanged                                                                                                                                                                                                        |
| removal by others             | owner/staff/appointed admins only                    | `room_remove_member` + admin-row guard                                                                                                                                                                                         |
| existing venue-room members   | keep their promised expiry (all ≤30d out)            | grandfathered; new numbers apply from next join (decision 8)                                                                                                                                                                   |
| guests                        | read where `public_preview`; never join, post, or DM | RPC refusal + recreated `guest_message_limits` + `message_requests_no_guests` (decision 9)                                                                                                                                     |
| business DMs                  | never expire; freeze on block/suspension             | standard chat semantics                                                                                                                                                                                                        |

Traveler groups keep their own +7d/long-horizon numbers — the spec's "applies
to all business chats" is read as business chats only.

### 3.6 Inbound DMs

- Enum additions (one migration): `chat_kind + 'business'`,
  `request_source + 'business'`, `group_speaking + 'admins'`,
  `report_reason + 'impersonation'`.
- `message_business(p_business_id uuid, p_first_message text)` — public
  wrapper resolving `owner_user_id` server-side (clients never see owner ids),
  refusing **unclaimed** businesses with the oracle-proof error, calling
  `send_message_request` with source='business'.
- `send_message_request` business branch: validates business visibility
  instead of overlap/pin; **skips** `is_discoverable_owner` /
  `discovery_pair_ok` (meaningless for a premises); **keeps** guest refusal,
  blocks both ways, one-conversation-per-pair (kind-aware check — it cannot
  use `has_accepted_chat`, which now correctly ignores business chats),
  velocity caps, oracle-proof single error, and `screen_first_message` + the
  `pending_moderation` hold.
- Delivery = auto-accept: a clean verdict immediately creates the chat
  (`kind='business'`) + both participants, status 'accepted'. With the LLM
  flag on, it holds exactly like today, and `apply_message_verdict`'s allow
  arm gains a business branch — **critically**, its re-validation must not
  call `is_discoverable_owner(recipient)` for source='business' (always false
  for a business; without the branch every held message silently declines,
  and only in production config).
- **The shadowban collision, designed rather than inherited** **[review]**:
  today a shadowbanned sender's request is silently stored 'declined' while
  the client is told delivered — the illusion works because delivery was
  never immediate. Auto-accept breaks that: a shadowbanned sender would
  notice no chat ever opens. Fix: for a shadowbanned sender the chat IS
  created, with a `shadowed` flag on the chat row; the sender sees a normal
  business chat and can type into the void; `my_chats` and the push enqueue
  exclude shadowed chats for the business side. One column, two predicate
  edits, and a pgTAP case proving the business never sees it.
- Cap: business first messages draw a **separate 10/day budget**, not the
  8/day social-hello budget (asking a hostel about beds is not a hello;
  decision 11); still under the global 30 requests/day trigger.
- `my_chats()` recreated (DROP first, grants restated — the AGENTS.md trap):
  direct arm becomes `kind in ('direct','business')`; business rows carry the
  business name/cover on the traveler side, the traveler's name/avatar on the
  business side, and a new `business_id` out column for routing.
- Who answers: owner account only at v1 (staff moderate the room, not DMs) —
  decision 13.

### 3.7 Map read path, and what a business may read

No new pin table; the `businesses` row is the marker.
`city_businesses(p_city_id)` (anon+authenticated) supersedes `city_rooms` —
returns business_id, name, category, lat/lng, place_label, cover_photo_path,
has_live_post, chat_id, member_count, public_preview.
`business_detail(p_business_id)` returns the full sheet in one round trip,
also anon ("no matching is required to see all of the business' details").

**The compatibility wrappers are load-bearing, not courtesy** **[review]**:
the shipped app calls `join_room` and `city_rooms` today, and JS ships OTA —
dropping either breaks every installed client's Join button until they update.
`join_room` survives as a wrapper delegating to `join_business_chat`;
`city_rooms` survives as a wrapper over `city_businesses`, deriving its old
`kind text` column from `category` (the column it exposed is dropped)
**[review]**. Both are retired in Phase 17 after OTA adoption, never before.

**What a business account may read** **[review]** — the first draft asserted
this in prose with no migration to carry it; it now has a landing spot.
Migration 2 recreates `city_pins`, `traveler_trips`, and `get_matches` with a
one-line `is_business_account()` refusal at the top (42501), and the attack
suite calls each as a business. A business sees traveler pins only through the
**anonymous** feed (`public_city_pins`) — a free-to-mint commercial account
must not be a scraping vector.

**Member privacy has enforcement now** **[review]** — decision 18 promised
"never departure dates" while the live `group_members(p_chat_id)` returns
`departure_date` to every member and moderator. Recreated: for business chats
the column comes back NULL (each member still sees their own leave date via
their own membership row and the room header); traveler groups keep it — "in
town until" is the social fabric there, and no business can be in a traveler
group (the join guard). pgTAP: a business-room moderator calling
`group_members` sees names, roles, join dates, and no dates of travel.

### 3.8 Reporting and suspension

Report context `business:<id>`; impersonation reports sort first in
`admin_report_queue`. `admin_resolve_report` gains 'unverify'
(moderation_status → 'pending', marker dark, room unjoinable) beside
warn/strike/suspend/ban on the owner. **Unclaimed businesses have no owner to
strike** **[review]**: reports against them resolve through a new 'unlist'
action (`active=false`) instead of the owner ladder. Suspension cascades
through existing machinery: `active=false` hides the marker,
`join_business_chat` refuses, room chat status 'closed' silences everyone
including the business, history stays readable as evidence; traveler-facing
copy is oracle-proof ("This chat is paused."). Shadowban is not used for
businesses (a dark storefront only delays impersonation harm). Strikes attach
to `owner_user_id` and ride the existing 3/5/7 ladder; pgTAP proves suspending
an owner silences room and DMs.

---

## 4. The traveler experience

Traveler-facing word is **"place"** — "business" is back-office vocabulary
(decision 16). Business-facing copy also never says "pin" for the marker
**[review]** — the §7 defense rests on a marker not being a pin, and the
first draft's own strings undermined it. It is "your spot on the map."

**Map.** A third marker family beside traveler pins and curated seeds: a 26pt
circular chip (a place IS the spot; a plan is an event at a spot, hence
teardrop vs dot), surface-navy body, muted ring, amber category glyph. A live
post within 24h brightens the ring to accent amber and bolds the glyph —
**not** a gold star **[review]**: gold + star already means "curated seed" in
this map's sign language, and one glyph must not carry two meanings. Drowning
protection, three layers: chips render only past neighborhood zoom
(`latitudeDelta < 0.05`); `displayPriority` default (yields to travelers'
"required" and seeds' "high"); `zIndex: 0` under every pin — a stack of humans
at a bar renders on top of the bar, which is the correct sentence. Places
never join `clusterPins`.

**Place sheet** (tap a chip; same non-modal inline Sheet as PinCard, map stays
pannable): 3:2 hero + scrim with name, category, open state ("Open · till
2:00" in `success` green / "Opens at 17:00" / "Closed today", computed in the
city's timezone); one live-post strip ("Tonight 20:00 · Pub quiz"); address
line + "View in Maps"; actions: **[Join the chat]** primary with "128 in the
chat · anyone can read" footnote, **[Message]** ghost. Hero pushes
`/place/[id]`. Guests see the sheet in full; only Join/Message gate.

**Place page** (`/place/[id]`, new `place-view.tsx` — deliberately not
`ProfileView`, so a business can never drift into person grammar): landscape
hero (0.8 ratio, not a person's 1.15) with name, category, open state — no
"checked place" seal **[review]**: every visible place has passed the check,
so a seal on all of them says nothing; **What's on** (post cards, soonest
first, sentence-case captions "Tonight 20:00" / "Until Sun" **[review]** — the
craft pass retired ALL-CAPS headers and overlines follow the same HIG
decision; empty state "Nothing on right now."); **The chat here** (member
count, read rule, your leave date or inline Join); **Hours** (today bold, "See
the week" disclosure); **Find and book** (labeled link rows — "Book a table",
"Buy tickets", "Website", Call — never raw URLs); **Photos**; **Socials**
(public, no gate); and the bottom bar.

**One action hierarchy everywhere** **[review]** — the first draft made Join
primary on the sheet and Message primary on the page, flipping the app's
answer to "what should I do here?" between two surfaces for the same place.
The rule: **Join the chat is primary until you are in it; then the primary
becomes Open the chat; Message is secondary on both surfaces, always.**

**Two rows, one place, never confused** **[review]**: a traveler who joins the
chat AND messages the team has two conversations with the same name and cover.
The group chat lives in the Groups segment as today; the DM lives in Chats
with the storefront glyph **and** a standing subtitle "The people who run
{place}" — a person row and a place row never blur, and the two place rows
never blur either.

**Joining the chat** (reuse the room footer flow): header "How long are you
around?", optional date field ("Not sure yet" → 90-day membership), footnote
**"You leave the chat 3 days after this. Change it any time."**, button "Join
the chat". If the date clamps: "Chats run 90 days at most. You can rejoin any
time." In-chat header: "128 people here · anyone can read · you leave 12 Nov".
Read-only notice: **"Only the people who run {place} post here. You can read
and react."** **[review]** — the first draft's "Only {place name} posts here"
lied whenever staff or an appointed admin posted.

**Messaging a place** — different verb, different ceremony from "Say hi":
composer sheet "Message {name}" / "Goes to the people who run it. You'll find
the chat in Chats." Chat opens instantly on a clean verdict; a blocked verdict
shows the existing reword notice; no "Sent to…" ceremony. Businesses cannot
message first, ever (rule 8).

**Elsewhere.** Chat tab "Rooms near you" becomes **"Chats to join in {city}"**
**[review]** — "Open chats" put two meanings of "open" in one list, beside
rows showing "Open · till 2:00". Travelers tab: places never appear; the
empty state gains one quiet link, "See what's on in {city}" → Map. Guests:
read everything public, act on nothing, gates say why ("Join this chat to
post" / "Messaging {name} needs a profile").

---

## 5. The business experience

**Signup fork.** Two quiet entrances: the welcome-tour footer gains "Run a
hostel, bar or tour? Put it on the map", and onboarding step 3 gains a
"Setting this up for a business?" footnote. Either arms the business flag
before the first business step, so a killed app resumes correctly. Business
steps (StepShell reused, 7 steps): name + category chips; city + the existing
drop-pin picker ("Drop the pin right on your door." — the picker drops a pin;
the resulting marker is never called one) + address line; links editor ("A
website, a booking link, a WhatsApp. Add what you have."); hours editor
(skippable); photos ("Photos of the place, not of a person. The first one is
your cover."), Finish disabled until the cover slot fills. Finish calls
`register_business`, creates the room, lands on:

> **"You're on the list. We check every new place before it goes live, and
> we'll tell you the moment you're on. Usually within a day."**

**[review]** — the first draft's string carried an em dash (banned in
user-facing copy) and promised working chat/DMs pre-approval while the
recommendation is everything-dark-until-approved. The copy now matches the
recommended mechanics.

**Tabs.** The middle tab trigger swaps to **"My place"** (SF `storefront`) on
`is_business_account`; route file stays `travelers.tsx`, branching the way
`GuestTravelers` already does. **My place**: cover hero + status chip ("Live
on the map" / "Waiting on a quick check" / "Paused"); **What's on** with
docked "Post something" → composer (title, details, "When is it?" +
"Until when?" — no kind chips **[review]**; empty state "Nothing on. Post
tonight's plan and everyone who taps your spot sees it."); **Your details**
rows (Hours, Links, Description, Photos); **Your chat** card; top-right
**"See it as a traveler"** (the profile-honesty rule applied to businesses).
**Map**: own marker with a "You" ring; traveler pins served anonymously; no
drop-pin button. **Chat**: own room pinned with a "Yours" chip, "Chats to
join" hidden, inbound DMs as normal rows, no Requests section (messages
arrive pre-screened).

**Editors.** Hours: rule-based, not a 7×2 grid — one row of day-chips + two
time wheels covers most venues; "Different hours on some days" adds a row;
per-rule Closed toggle; "Past midnight is fine. 20:00 to 2:00 reads as one
night."; free-text note ("Kitchen closes at 22:00."). Links: one list editor
for links, socials, and contact (one mental model, one table); kind picker,
drag reorder; empty state "The reservation link, the Instagram, the WhatsApp.
Whatever travelers ask you for." Photos: PhotoGrid verbatim, "The first photo
is your cover."

**Chat controls** (business variant of `group/[id]`), plain words throughout
**[review]** (the microphone metaphor and "my team" mislabel are gone):
speaking segmented with footnotes — **"Everyone"** / "Anyone in the chat can
post."; **"People I pick"** / "You choose who posts. Everyone can read.";
**"Just us"** / "You, your staff and your admins. Everyone can read." Member
sheet: "Let them post" / "Stop them posting" / "Make them an admin" (confirm:
"Admins can post, take messages down and remove people. You can undo this any
time.") / "Remove {name}".

**Notifications.** Inbound DM: standard new-message push. New members: never
per-join — **one daily digest** ("12 travelers joined your chat today.")
**[review]** (the first draft specified a weekly count and a daily digest in
one sentence). Review verdicts: "You're live on the map in {city}. Travelers
can find you now." Push discipline in rooms: business/staff-authored messages
carry pushes for at most 3 posts per rolling day per room; further posts
deliver silently — the megaphone is a bell, not a siren. Mute-by-default for
far-future joiners stays listed as the escape hatch if churn data demands it.

---

## 6. Trust & safety

- **Impersonation is the top risk.** Every self-serve business is invisible
  until the founder approves it (manual queue; evidence = the
  `business_claims` row + judgment). Unapproved means fully dark: no marker,
  no joinable room, no DMs — a fake venue can never farm members before
  review. Name/city/location edits on an approved business re-enter 'pending';
  description/hours/links/photos/posts publish immediately behind screening
  and the photo pipeline (decision 17). Claiming a seeded venue opens the same
  flow; conflicting claims queue for the founder; the claim-approval step
  wipes or re-confirms legacy `business_staff` rows so no ex-staffer retains
  power over a claimed venue's room.
- **Spam.** Rule 8 (no outbound contact, no joins, no discovery reads) is the
  core stance, DB-enforced by the trigger list in §3.1 and the read refusals
  in §3.7. Sanctioned reach: marker, posts, own chats. Post caps (10 live,
  5/day), link caps (10, scheme-allowlisted, URLs confined to link fields),
  the 3-pushes/day room budget, and the 30/day text-edit velocity are the
  brakes. Room messages by the business are not pre-screened (parity with all
  room text); the reactive path is report → `room_remove_message` (evidence
  kept) → strike ladder, on which business owners sit like anyone.
- **Scraping.** Business accounts read no traveler surfaces (anonymous map
  feed only; `city_pins` / `traveler_trips` / `get_matches` refuse them —
  recreated in migration 2, attacked in pgTAP); member lists exclude
  departure dates (recreated `group_members`); `kind='business'` chats never
  satisfy the handle gate in either direction. Residual, acknowledged: a
  venue can still browse as a person with a second account — velocity caps
  are the practical bound. Heat gaming via sockpuppet pinners is watched
  through `admin_pin_stats` per-city.
- **Reporting.** Sheet on marker/page/room: "This isn't the real business" /
  "Spam or a scam" / "Inappropriate content" / "Something else".
  Impersonation jumps the queue. Guests can report (existing 10/day
  throttle). Reports on unclaimed venues resolve via 'unlist', not the
  owner ladder.
- **Suspension.** As §3.8: everything freezes, nothing deletes, copy never
  says why, reinstatement reopens, clocks tick through the freeze. Ban row:
  "{Business} is no longer on Samewhere."
- **Founder load.** Verification, impersonation reports, and claim conflicts
  all land on one person — fine at 4 cities, but the `admin_ops_health`
  pattern gets a business-queue-depth alarm from day one so it fails loudly.

**Numbers to bless in one pass** (decision 19): 10 photos / 10 links / 10
live posts / 5 post-writes-day / 30 text-edits-day / 10 business-DMs-opened
per traveler per day / 3 push-bearing room posts per day / 2,000 room cap /
10 staff seats / 30-day max post horizon.

---

## 7. Migration from establishments/venue rooms — staged, never half-migrated

The principle: a business chat IS the establishment's existing room, so there
is no data migration — only renames, new columns, and new math for new joins.
Every row, message, member, and promised expiry survives.

**Migration files, in order:**

1. `..._business_enums.sql` — the four `alter type ... add value` statements
   plus the two new enums. Own file: new enum values are unusable in the
   adding transaction.
2. `..._business_accounts.sql` — the renames; new `businesses` columns +
   column-scoped grants; `business_claims`; `business_chats` + backfill +
   drop `businesses.chat_id`; `departure_date` relaxed to nullable;
   `is_business_account`; `register_business` / `admin_review_business`; the
   §3.1 guard triggers; and **the recreation of every function that names
   `establishments` or reads the changed columns**: `is_room_moderator`,
   `is_public_room`, `may_speak_in_room`, `guest_message_limits`,
   `room_info`, `room_messages`, `enqueue_message_push`,
   `expire_room_members` (groups-only admin exemption), `group_members`
   (business-room date redaction), `join_business_chat` + the `join_room`
   compatibility wrapper **[review]**, `city_businesses` + the `city_rooms`
   wrapper with derived `kind`, `my_chats` (DROP first, grants restated),
   `business_set_chat_role`, the `room_remove_member` admin guard, the
   reaction policy, the discovery-read refusals (`city_pins`,
   `traveler_trips`, `get_matches`), and `seed_launch_establishments`
   **[review]** (it names the old table and the dropped `kind` column; the
   first draft's list missed it and the next fresh environment would have
   broken). Completeness check: `grep -r establishments supabase/` returns
   only history; proof: the full pgTAP run.
3. `..._business_content.sql` — photos + bucket + verdict RPC, links +
   validator, hours, posts + caps + sweep, `is_visible_business`,
   `business_detail`, `screen_business_text`.
4. `..._business_inbound.sql` — `send_message_request` business branch,
   `message_business`, `apply_message_verdict` business release branch, the
   `shadowed` chat flag and its `my_chats`/push predicates.

**What carries over:** seeded venues become unclaimed approved businesses
(owner NULL, 'approved'); staff rows keep moderating; live rooms keep chat
ids, messages, members, and grandfathered expiries; speaking defaults to
'everyone' (today's behavior); guests keep read-only via the recreated guard.
`business_staff` is kept, not frozen — it is the multi-staff answer (three
receptionists moderating without sharing a login).

**pgTAP suite (`20_business_accounts` + updates to 10/11/16/18/19), written
as attacks:** business absent from every discovery surface; business cannot
insert trips/pins/message_requests/profile_photos/room_members or create a
group; `city_pins`/`traveler_trips`/`get_matches` refuse a business caller;
personal handles unreadable across a business chat in both directions; an
unscreened or blocked first message never yields a chat; a held business
message releases correctly (the re-validation branch); a shadowed chat is
invisible to the business; guest join refused in the RPC and guest INSERT
refused at the table (seeded venues specifically); 'admins' mode refuses
member and speaker INSERTs while reactions still land; expiry math incl. null
departure and the 90d clamp; the sweep expires business-room admins and
spares group admins; `group_members` returns no departure dates on a business
room; no business rows in heat output; anon reads everything public, writes
nothing; link validator refuses `javascript:` and over-cap; admin-row removal
refused to non-owner moderators; pending business fully dark; rename →
re-pending trigger; suspended owner silences room and DMs; `promote_group_successor`
ignores business rooms.

---

## 8. Build order

Phases sized like this repo's, each ending green, deployable, and pushed. All
client work is JS and ships OTA; no native change anywhere in this plan.

**Phase 13 — Identity and the rename.** Migrations 1 + 2, the full
function-recreation list, the attack suite, `is_business_account` client hook

- routing predicate in the named-function style of `owesOnboarding`, with unit
  tests. Ships with zero visible change — the proof is that nothing broke, and
  the deployed app's `join_room`/`city_rooms` calls still work through the
  wrappers. _Needs from founder: §7 amendments signed (rules 3, 4), rule 5
  restatement confirmed, rule 8 adopted, decisions 3-5 and 8-9._ This phase is
  the risk concentrate: a missed function recreation is a runtime outage in
  chat/push/map, and a missed grant restatement bricks the Chat tab while every
  migration reports success.

**Phase 14 — The public surface.** Migration 3; `city_businesses` markers,
place sheet, place page; "Chats to join in {city}"; join flow with the new
copy and numbers. Seeded venues become the first four places (Message hidden —
unclaimed). Deployable: travelers see and join places; no business can
register yet. _Needs: category list (7), vocabulary (16), member-count
honesty (20), the numbers table (19). Screens-suite verification of marker
density at realistic counts before shipping._

**Phase 15 — Inbound DMs.** Migration 4; Message flow; storefront glyph +
subtitle in Chats; `my_chats` business rows. Deployable against
seeded-turned-claimed venues or dark until Phase 16. _Needs: decisions 11
and 13._

**Phase 16 — The business side.** Signup fork, business onboarding, My place
tab, editors, chat controls, digest push, `admin_business_queue` + review
flow. This is the long pole; the thin-dashboard fallback (founder onboards by
hand, minimal edit screen) is the scope lever if launch pressure demands
(decision 21). _Needs: decision 6 (approval flow + seeded-venue claims), copy
sign-off per design-review, first real business recruited per city._

**Phase 17 — Hardening and cleanup.** Queue-depth alarm, push fan-out watch,
retire the `city_rooms`/`join_room` wrappers after OTA adoption is
near-total, revisit push-budget and mute defaults against real data, docs
updated (ARCHITECTURE "Businesses" section, PROGRESS phase entries, the §7
amendments landed in PRODUCT_BRIEF).

---

## 9. Founder decisions, consolidated

1. **Sign the rule 3 amendment** (§2 wording). Recommendation: sign — it
   writes down what seeded venues already do.
2. **Sign the rule 4 amendment** (§2 wording). Recommendation: sign —
   personal handles get strictly _more_ protected.
3. **Confirm the rule 5 restatement**: full moderation pipeline kept, accept
   inbox waived for businesses only. Recommendation: yes.
4. **Adopt rule 8**: a business never messages first, never joins, never
   reads discovery. Recommendation: adopt — the single biggest anti-spam
   decision; relaxing later is one trigger drop, and it forecloses "invite
   past guests" features without a new decision.
5. **Separate account only** (no personal→business conversion; an owner who
   travels makes a second free account). Recommendation: yes.
6. **Manual approval gate**: registrations land 'pending' and fully dark
   until you approve; seeded-venue claims verified by hand (email/phone
   check) at v1. Recommendation: yes — instant listing is a phishing
   surface. Sub-decision: does "dark" include the room and DMs pre-approval?
   Recommendation: yes, everything dark.
7. **Category list**: hostel, hotel, guesthouse, bar, restaurant, cafe,
   club, tour, activity, coworking, wellness, shop, other.
8. **Grandfather existing venue-room members' expiries**; +3d/90d applies
   from each next join. Recommendation: grandfather — never shorten a
   promised window.
9. **Guests**: read public business rooms, never join/post/DM.
   Recommendation: keep the shipped boundary; "any user can join" reads as
   "any account".
10. **The literal 90-day cap**: a member joining >90 days pre-departure
    lapses mid-wait and rejoins in one tap. Recommendation: accept the spec
    as written; the copy states it.
11. **Business DM budget**: separate 10/day, not the 8/day hello budget.
    Recommendation: separate.
12. **One room per business at v1** (`unique(business_id)` is the one
    constraint to drop for multi-room later). Recommendation: yes.
13. **Owner account answers DMs at v1**; staff moderate the room only.
    Recommendation: yes.
14. **Event posts as expiring map pins**: v2. Recommendation: defer.
15. **Money posture**: everything free at v1; any future monetization is
    business-side placement, never traveler gating and never pay-to-rank.
    Recommendation: write it next to rule 1 now.
16. **Vocabulary**: "place" in all traveler-facing copy; the marker is never
    called a "pin" in business-facing copy either. Recommendation: yes.
17. **Edits re-entering review**: name/city/location re-pend;
    description/hours/links/photos/posts publish behind screening.
    Recommendation: yes.
18. **Member privacy**: businesses see name, photo, role, join date — never
    departure dates or trips. Enforced in the recreated `group_members`, not
    just promised. Recommendation: yes; if hostels lobby for stay windows,
    that is a deliberate trade to make explicitly later.
19. **Bless the numbers table** (§6) in one pass.
20. **Member-count honesty**: show total live memberships, or
    active-in-14-days? Recommendation: total, with post-recency ranking and
    a "quiet lately" label so a graveyard is never the first thing a city
    shows.
21. **Scope lever**: full My place dashboard at v1, or thin edit screen +
    hand-onboarding? Recommendation: full dashboard, thin fallback if launch
    pressure demands.

---

## 10. Deliberately not in this plan (v2 material)

- Multiple rooms per business / per-event chats (drop `unique(business_id)`).
- Staff invite tokens and staff answering DMs; staff self-management UI.
- Document-upload verification bucket and any automated verification
  verdicts.
- Event posts as expiring map pins; posts counting into any map surface.
- Ratings or reviews of businesses — **refused, not deferred**: the moment a
  business can be scored, the DM channel becomes an extortion lever and the
  moderation surface triples. Posts are the business talking, full stop.
  Reopening this needs its own decision.
- Paid placement, sponsored ranking, or any business payment surface.
- Guests joining business chats; "open now" filtering on the map; a
  holiday/exception hours calendar; a dedicated Places directory tab;
  business analytics dashboards; LLM screening of business posts (regex
  prefilter only at v1 — flagged as a fast-follow if abuse shows up);
  business-to-business anything.
