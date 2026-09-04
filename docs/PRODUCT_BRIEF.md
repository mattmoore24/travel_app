# PRODUCT BRIEF — Travel Friend-Finding App (Working Name: TBD)

> This is the founder's complete brief: product vision, competitive research findings, hard
> product rules, tech stack, and phased build plan. Everything below has been decided by the
> founder — do not relitigate strategic decisions, but flag technical concerns as encountered
> (strategic recommendations welcome throughout).
>
> Full competitive research: [`docs/research/travel_app_research.pdf`](research/travel_app_research.pdf)
> · Distilled notes: [`docs/RESEARCH_NOTES.md`](RESEARCH_NOTES.md)

---

## Step 0 — GitHub-First Workflow

All work lives in `https://github.com/mattmoore24/travel_app.git` from the very first file.
Nothing is kept only on the local machine — the project must be fully resumable from any device
by cloning the repo.

1. Clone/connect to the repo before writing any code; verify pushes succeed before continuing.
   If pushing fails due to authentication, pause and report exactly what needs to be set up.
2. First commit = project scaffold + this brief saved as `docs/PRODUCT_BRIEF.md`.
3. Commit early and often: small, atomic commits with conventional commit messages
   (`feat:`, `fix:`, `chore:`, `docs:`). Push at the end of every working session and after
   every completed milestone — never leave work unpushed.
4. Maintain living docs, updated continuously:
   - `docs/PRODUCT_BRIEF.md` — this document
   - `docs/ARCHITECTURE.md` — stack decisions, data model, and why
   - `docs/PROGRESS.md` — what's done, what's next, open questions for the founder
   - `README.md` — how to run/build the project from a fresh clone
5. Never commit secrets. Use `.env` files (gitignored) + an `.env.example` template. Report
   exactly which keys need provisioning (Supabase, Mapbox, Apple, etc.) as they come up.

---

## 1. Product Vision

A **free iPhone app for travelers to make platonic friends** and discover what other travelers
are doing in a city. It is explicitly **NOT a dating app** — enforced by design, not just
stated in marketing.

### Surface A — The Map (the hero feature, lead with this)

- Users drop an **intent pin**: "I want to go to [place] on [day]" — a bar, restaurant, club,
  museum, monument, beach, hike, etc.
- Pins are **future-dated intent, not live location**. A pin persists for a user-set duration,
  **maximum 72 hours**, then auto-expires and is deleted.
- Other users browse the map, tap a pin, view the pinner's profile, and can send a **message
  request**. The pinner must accept before any chat opens.
- All pins also feed an **anonymized heatmap** visible to everyone: which places/areas are
  popular today/tomorrow, with zero personally identifying info at the aggregate layer. The
  heatmap must be valuable even to a user who never matches with anyone.
- **Privacy invariants**: no real-time location sharing, ever. Pin locations are venue/area-level,
  not GPS-precise user positions. The heatmap must not be reverse-engineerable to individual
  users (enforce a minimum-count threshold before a heat cell renders — e.g., don't show heat
  for a cell with only 1 pin unless it's the pinner's own view).

### Surface B — Traveler Matching

- Users post trips: "I'll be in [city/area] from [date] to [date]."
- The app surfaces other travelers with overlapping city + dates in a browsable card stack.
- **Hinge-style mechanics, not Tinder**: a user sends an initial message attached to a specific
  part of the recipient's profile; the recipient sees the message and the sender's profile and
  chooses to accept (opens chat) or decline (sender is not notified beyond no-response).
  No blind mutual-swipe requirement, no "who liked you" paywall — **ever**.

### Profiles

- Fields: name, age, home city/country, languages spoken, profile picture + up to 6 additional
  photos, short bio/interests.
- **Social media handles exist on the profile but are HIDDEN until a mutual accept.** They
  unlock only after both users are in an accepted chat (or via an explicit per-chat "share my
  socials" action — implement the accepted-chat unlock first, tighten later). This is
  deliberate: public handles create an off-platform off-ramp before the accept-gate matters
  and are a scraping/stalking vector.
- Optional **selfie verification** with a verified badge. Design the flow to be near-instant
  (automated liveness/face-match), not a 12–72hr manual review.

### Chat

- 1:1 chat unlocked **only** by an accepted message request (from either surface).
- Standard tooling: block, report, unmatch (deletes chat for both).

---

## 2. Research Findings That Drive the Design

Deep competitive research was done across GAFFL, Travello, Tripr, TripBFF, Fairytrail,
NomadHer, Nomadtable, Backpackr, Tourlina, Bumble BFF, Timeleft, Meetup, Patook, Hostelworld,
Couchsurfing, Snap Map, and Zenly. Key conclusions:

1. **The whitespace is the map.** No existing app combines (a) date/city-overlap matching,
   (b) mutual-accept messaging, and (c) an intent-based activity map with an anonymized
   heatmap. Date-overlap matching alone is commodity (6+ apps do it). The map + heatmap is the
   differentiator and the marketing hook: _"see what travelers are doing in this city tonight."_
2. **The two killers of this category are dead cities and dating-app creep.** Nearly every
   competitor's negative reviews cluster on: no users in my city on my dates; fake profiles;
   "this became a hookup app"; surprise paywalls; buggy chat. Every architectural and product
   decision should be graded against these failure modes.
3. **Paywalls on core social features are fatal** (Couchsurfing lost ~85% of traffic after its
   2020 paywall). Discovery, the map, matching, and messaging are permanently free. Future
   monetization (not in v1) would be experiences/booking affiliate revenue or non-gating
   cosmetics — never gating messages or visibility.
4. **Anti-dating must be enforced in code** (Patook precedent: ML flirt-detection + auto-ban).
   The Hinge-style first message is the perfect chokepoint: screen every initial message
   request for flirtatious/sexual/harassing content before delivery. Blocked messages never
   reach the recipient; repeat offenders get warned then banned. Community guidelines + fast
   human-reviewable reporting on top.
5. **Safety-by-design is a differentiator**, especially for women (~54% of solo travelers and
   the users whose departure collapses these marketplaces): no live location, fuzzy pins,
   expiring pins, accept-gates everywhere, selfie verification, optional women-only visibility
   filter (build the data model to support gender-based visibility filtering from day one,
   even if the UI ships later).
6. **Launch dense, not wide.** GTM is 2–3 geofenced backpacker/nomad hubs (candidate
   archetypes: Lisbon, Mexico City, Bangkok/Bali), hostel partnerships, creator marketing, and
   pre-seeded map pins (curated real events/spots) so the map is never empty on day one. Build
   support for: city-level feature flags/geofencing, an admin tool for seeding curated pins,
   and a liquidity dashboard (active users with overlapping trips per city). Don't hardcode a
   global launch. _Founder decision 2026-09-04: the dense launch is a marketing plan, not a
   fence. A traveler can put a trip or a pin in any city; the seeded hubs are the rail's
   featured cities and where businesses can list._
7. **Retention between trips is a known later problem** (travelers delete apps between trips).
   Do NOT build a home-city mode in v1 — but don't architect anything that would preclude it.

---

## 3. Tech Stack

Chosen for: fully cloud-based workflow (founder works from any device, no local Mac
dependency), solo-founder maintainability, fast iteration, and real-time features.

- **App**: React Native + Expo (managed workflow) + TypeScript. EAS Build and EAS Update so
  iOS builds and OTA updates happen in the cloud — no local Xcode required. Target iOS first;
  keep code cross-platform-clean for a later Android release.
  - Navigation: Expo Router. State/data: React Query (TanStack) + Zustand for local state.
- **Backend**: Supabase — Postgres, Auth (Apple Sign-In + email), Realtime (chat), Storage
  (photos), Edge Functions (moderation pipeline, pin expiry, heatmap aggregation), Row Level
  Security for privacy invariants, PostGIS extension for geo queries.
- **Maps**: `react-native-maps` (Apple Maps) for v1 simplicity, or Mapbox if custom heatmap
  rendering is needed — evaluate during Phase 3 and document the tradeoff. Heatmap =
  server-side aggregation into geohash/H3 cells, client renders cells, never raw pins of
  non-consenting users.
- **Moderation/flirt-detection**: Supabase Edge Function that calls the Anthropic API (Claude)
  to classify initial message requests (flirtatious/sexual/harassment/spam vs. acceptable)
  before delivery, plus a lightweight profanity/regex pre-filter to save API calls. Photo
  moderation on upload (start with a vendor API or Claude vision classification). Log all
  moderation decisions for auditability.
- **Push notifications**: Expo Notifications.
- **Analytics**: PostHog (free tier) — instrument liquidity metrics from day one (see §6).
- **CI**: GitHub Actions — typecheck, lint, test on every PR; EAS build on tagged releases.

---

## 4. Data Model (starting point — refined in `ARCHITECTURE.md`)

- `users` — auth identity, created_at, status (active/banned/shadowbanned)
- `profiles` — name, age, home_city, home_country, languages[], bio, gender (for visibility
  filtering), verified (bool), verification metadata
- `profile_photos` — user_id, url, position (0 = profile pic, 1–6 = gallery), moderation_status
- `social_handles` — user_id, platform, handle. **RLS: readable ONLY by users who share an
  accepted chat with the owner. Enforced at the database layer, not just the UI.**
- `trips` — user_id, city (normalized place ref), area/region, start_date, end_date, status
- `pins` — user_id, venue_name, venue_place_id, lat/lng (venue-level), category
  (bar/restaurant/club/museum/monument/beach/hike/other), intent_date, expires_at
  (≤ now + 72h, enforced by DB constraint), status. Hard-delete or fully anonymize on expiry
  (privacy promise).
- `heat_cells` — materialized aggregation: geohash/H3 cell, date, category, pin_count. Only
  cells with pin_count ≥ threshold are served to clients.
- `message_requests` — sender_id, recipient_id, source (trip_match | pin), first_message_text,
  moderation_verdict, status (pending/accepted/declined/expired/blocked_by_moderation)
- `chats` / `messages` — created only on accept; realtime
- `reports`, `blocks`, `moderation_events` — full audit trail
- `seeded_pins` — admin-curated pins (hostel events, walking tours) flagged as curated, no
  user attached
- `launch_cities` — the seeded hubs: featured on the rail, where businesses list, per-city
  k and clock overrides (a fence until 2026-09-04; not one since)

### RLS invariants to enforce in Postgres (write tests for these)

1. No user can read another user's `social_handles` without an accepted chat.
2. No user can read raw pins outside the map's circle around a city they CHOSE (never a device
   position), or query pins in a way that returns another user's precise history. _(Until
   2026-09-04 this read "outside launch cities"; the founder opened every city.)_
3. Expired pins are unreadable by everyone.
4. Declined/pending message requests never reveal read status or decline to the sender.

---

## 5. Build Plan (phased; finish + push + update PROGRESS.md at each phase boundary)

- **Phase 0 — Repo & scaffold**: Connect to the repo (Step 0), Expo TypeScript scaffold,
  ESLint/Prettier, GitHub Actions CI, Supabase project wiring (`.env.example`), commit docs/.
  _Deliverable: fresh clone → `npx expo start` works._
- **Phase 1 — Auth & profiles**: Apple Sign-In + email auth, onboarding flow (profile fields,
  photo upload with moderation stub), profile view/edit. Social handles stored but hidden per
  RLS. _Deliverable: create account, build full profile, view own profile in the app._
- **Phase 2 — Trips & matching**: Trip creation (city autocomplete via a places API, date
  range), overlap query (city + date intersection), card-stack browse UI of overlapping
  travelers, Hinge-style message request compose (attached to a profile element), inbox of
  incoming requests with accept/decline. _Deliverable: two test accounts with overlapping
  trips can request → accept → land in a chat shell._
- **Phase 3 — The Map (hero feature — invest the most polish here)**: Pin creation flow (venue
  search, category, intent date, expiry ≤72h), map browse of active pins around any city,
  pin → profile → message request flow, server-side heatmap aggregation + client heat layer
  with the k-threshold, pin auto-expiry job, admin seeded-pins path. _Deliverable: the map is
  compelling with 15 pins on it._
- **Phase 4 — Chat & realtime**: Realtime 1:1 chat on accepted requests, push notifications
  (new request, accepted, new message), block/report/unmatch, social-handle reveal in accepted
  chats. _Deliverable: full loop from either surface to a live conversation._
- **Phase 5 — Trust & safety pipeline**: Flirt/harassment classification Edge Function on all
  first messages (pre-filter + Claude classification + verdict logging), strike system
  (warn → suspend → ban), selfie verification flow, photo moderation on upload, report review
  queue (simple admin web view or Supabase dashboard queries fine for v1). _Deliverable: a
  flirtatious first message from a test account is blocked before delivery and logged._
- **Phase 6 — Launch hardening**: Launch-city geofencing/feature flags, liquidity dashboard
  (PostHog + a simple admin query set), empty-state design for low-density cities ("be the
  first pin" + seeded content), App Store assets, TestFlight distribution via EAS, privacy
  policy + community guidelines drafts (flagged for founder review; legal review separate).

Work sequentially. At each phase boundary: run the app, verify the deliverable, commit, push,
update PROGRESS.md with what's done and any open questions. If blocked on anything requiring
founder input (API keys, Apple developer account, design choices), list it in PROGRESS.md
and ask.

---

## 6. Metrics to Instrument from Day One

- Per launch city: active users with a live trip or pin (**the liquidity number**; target
  500–1,000 in-season before opening a new city)
- Map DAU vs. matching DAU (validates map-led thesis)
- Message request → accept rate (marketplace health; a collapsing accept rate = creep problem)
- **Met-in-person rate** — of the travelers asked "did you two end up meeting" once a shared
  trip window has ended, the share who answer yes. Source: `admin_meet_answers`
  (`supabase/migrations/20260902240000_did_you_two_actually_meet.sql`), which is months,
  answers and distinct people — never a chat, never a pair, never a name, and service-role
  only. This is the number that decides whether the product works, and it can move in the
  opposite direction to the accept rate above: hellos and accepts can both climb in a city
  where nobody ever meets anybody. The answer is private to its author, is never shown to the
  other traveler in any form (including by its absence), and is never an input to visibility
  or ranking — the moment it becomes either, it is a rating of a person and this is a
  different product.
- % of first messages blocked by moderation (creep early-warning)
- Pin creation rate and heatmap views per session
- D1/D7 retention **within a trip window** (not calendar retention — travelers churn between
  trips by design)

---

## 7. Hard Rules (never violate without explicit founder sign-off)

1. Core discovery, map, matching, and messaging are **free**. No paywalls, no "see who liked
   you" mechanics.
2. **No real-time user location** is ever collected, stored, or displayed. Pins are
   venue-level future intent only.
3. Pins **hard-expire at ≤72 hours** and are then unreadable.
4. Social handles are **never visible pre-accept** — enforced at the DB layer.
5. **Every first message passes moderation** before delivery.
6. Heatmap cells below the k-threshold are **never rendered** to other users.
7. All work is committed and pushed to GitHub; the project must always be fully recoverable
   from a fresh clone.
8. **A business account never initiates contact with a traveler, never joins a traveler's
   group or another business's chat, and never reads traveler discovery surfaces. Its reach
   is its listing, its posts, its chat and its replies.**

> Rule 8 was proposed in `docs/BUSINESS_ACCOUNTS.md` §2 and **signed off by the founder on
> 2026-08-27** ("businesses can't message individuals without being messaged first"), to be
> written into this section in phase 13. That never happened, so for a week the codebase
> enforced and cited a rule this document did not contain: six BEFORE INSERT triggers,
> `assert_not_business()`, `viewer_is_business()` and their pgTAP attack tests all say "§7
> rule 8" (`docs/ARCHITECTURE.md` §"A business is not a traveler, on both sides"). This is
> that rule, in the wording that was signed. The same sign-off also recorded how rules 3, 4
> and 5 read for a business account; those readings narrow nothing above and live in
> `docs/BUSINESS_ACCOUNTS.md` §2.
