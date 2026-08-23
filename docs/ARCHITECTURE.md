# Architecture

Living document: stack decisions, data model, and the reasoning behind them. The product
constraints that drive everything here are in
[`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md) — especially §7 (hard rules).

## Stack (confirmed 2026-08-16, Phase 0)

The founder's proposed stack was adopted as-is; concrete versions locked at scaffold time:

| Layer          | Choice                                                                                        | Version (Phase 0)                        |
| -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| App framework  | React Native + Expo managed workflow + TypeScript                                             | Expo SDK 57, RN 0.86, React 19.2, TS 6.0 |
| Navigation     | Expo Router (file-based, native tabs)                                                         | expo-router ~57                          |
| Server state   | TanStack React Query                                                                          | v5                                       |
| Local state    | Zustand (not yet used; added when first needed)                                               | v5                                       |
| Backend        | Supabase (Postgres, Auth, Realtime, Storage, Edge Functions, RLS, PostGIS)                    | supabase-js v2                           |
| Maps           | `react-native-maps` (Apple Maps) vs Mapbox — **decision deferred to Phase 3**, criteria below | —                                        |
| Moderation     | Supabase Edge Function → Anthropic API + regex pre-filter (Phase 5)                           | —                                        |
| Visual polish  | `expo-glass-effect` (iOS 26 Liquid Glass), `expo-linear-gradient` (photo scrims) — Phase 7    | both ~57                                 |
| Push           | Expo Notifications (Phase 4)                                                                  | —                                        |
| Analytics      | PostHog (Phase 2+)                                                                            | —                                        |
| Builds/updates | EAS Build + EAS Update (cloud; no local Mac)                                                  | —                                        |
| CI             | GitHub Actions: typecheck, lint, format, test                                                 | —                                        |

**Why**: fully cloud-based workflow (founder works from any device), solo-founder
maintainability, fast iteration, realtime chat included, and Postgres RLS lets the privacy
invariants live at the database layer instead of in app code (brief §4). No technical
objections were found to the proposed stack; per-phase flags are recorded below as they arise.

## Client architecture

- **Routing**: `src/app/` is the route tree (Expo Router). Four tabs, matching the product's
  information architecture from day one:
  - `index.tsx` — **Map** (Surface A, hero; Phase 3)
  - `travelers.tsx` — **Travelers** (Surface B matching; Phase 2)
  - `inbox.tsx` — **Inbox** (message requests + chats; Phases 2 & 4)
  - `profile.tsx` — **Profile** (auth + profile; Phase 1)
- **Tabs**: native tab bar via `expo-router/unstable-native-tabs` with SF Symbol icons
  (`src/components/app-tabs.tsx`); a synced web variant exists for dev convenience
  (`app-tabs.web.tsx`). iOS-first: Android drawables are intentionally deferred.
- **Data**: React Query for all server state (client in `src/lib/query-client.ts`,
  30s default staleTime); Supabase Realtime will bypass React Query for live chat streams
  (Phase 4). Zustand reserved for genuinely local state (compose drafts, map viewport).
- **Supabase client**: `src/lib/supabase.ts`. Reads `EXPO_PUBLIC_SUPABASE_URL` /
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`; degrades gracefully (warns, `isSupabaseConfigured=false`)
  so a fresh clone runs before any backend exists.
- **Theming**: template-derived themed primitives (`themed-text`, `themed-view`, theme tokens
  in `src/constants/theme.ts`), automatic light/dark.

## Backend — implemented (Phase 1) and planned

**Phase 1 shipped the identity/profile slice of the schema as real migrations**
(`supabase/migrations/`), with RLS proven by a pgTAP suite (43 asserts) that runs against a
throwaway local Postgres via `scripts/db-test.sh` (locally and in CI — no Docker needed).
`supabase/shim/local_supabase_shim.sql` recreates what hosted Supabase provides (roles,
`auth.uid()`, storage schema, default grants) so the tests exercise the same privilege model
as production; it is never applied to a real project.

Implemented tables: `users`, `profiles`, `profile_photos`, `social_handles`,
`moderation_events` (server-only audit), plus minimal `chats`/`chat_participants` so the
accepted-chat gate on social handles is real from day one (Phase 2 adds their write paths).
Key mechanics:

- **Social handles (hard rule 4)**: RLS `SELECT` allowed only for the owner or a user sharing
  an _active_ chat (`has_accepted_chat()` SECURITY DEFINER helper). Unmatching (chat closed)
  re-hides handles. Tested from both directions.
- **Caller-scoped definer helpers**: policy helpers never take a viewer parameter — they bind
  `auth.uid()` internally. PostgREST exposes executable public functions as RPC, so a viewer
  parameter would let any client probe arbitrary user pairs and dump the private
  who-is-chatting-with-whom graph (caught by the Phase 1 adversarial review; regression-tested,
  including that the old two-arg signature no longer exists and anon cannot execute helpers).
- **`verification` evidence is unreadable by clients**: column-level SELECT grants expose only
  the boolean `verified` badge; the Phase 5 evidence jsonb (document/liveness metadata) has no
  client grant at all, so clients always select explicit columns (`PROFILE_COLUMNS`).
- **Server-owned columns**: `profiles.verified`/`verification`, `profile_photos.moderation_status`,
  and all of `users` are stripped from client column grants — a client literally cannot
  self-verify or approve photos, regardless of RLS.
- **Moderation stub (Phase 5 seam)**: photo inserts pass through a BEFORE INSERT trigger that
  auto-approves and writes a `moderation_events` audit row. Phase 5 swaps the stub for the
  real pending→classify pipeline without moving the chokepoint.
- **Shadowban semantics**: `is_visible_owner()` hides profiles/photos of non-active users from
  everyone except themselves.
- **Photos**: ≤7 per user (trigger-enforced), position 0 = avatar, stored in a private
  `profile-photos` bucket under `<user_id>/<uuid>.jpg`; write policies key off the folder
  prefix. Reads mirror the photo-row gate (own objects, or approved photos of visible owners —
  shadowbanned/rejected content is not fetchable) and are served via signed URLs.
- **Signup trigger**: `auth.users` insert → app `users` row + empty `profiles` row.

**Phase 2 added** (same migration + test discipline, suite now 77 asserts):

- **`cities`** — bundled reference table (9,062 cities, population ≥50k) derived from
  GeoNames via the `all-the-cities` npm package (CC BY 4.0; regenerate with
  `scripts/generate-cities-seed.mjs`). This replaces the brief's "places API" for v1: no
  key, no rate limits, offline-friendly autocomplete via the `search_cities` RPC, and
  lat/lng per city ready for Phase 3 map centering. A paid places API can slot in later
  purely client-side if finer-grained autocomplete is ever needed (documented deviation —
  flag to founder in PROGRESS).
- **`trips`** — city ref + date range. RLS: _other users' travel plans are only readable
  through a genuine city+date overlap with one of your own active trips_ (caller-scoped
  `overlaps_own_trip()` helper), owner must be discoverable (active + onboarded), and
  blocks sever visibility both ways. Guardrails: no fully-past trips, ≤5 active trips per
  user (anti-scraping — one account can't hold trips everywhere at once), date checks only
  on date edits so cancelling an old trip never fails.
- **`blocks`** — created ahead of the Phase 4 UI so matching and requests respect blocks
  from day one.
- **`message_requests`** — the Hinge-style accept-gate, all writes through RPCs:
  - `send_message_request()` validates the relationship (real overlap, not blocked,
    recipient discoverable), then screens the message through the moderation pre-filter
    (regex blocklist table, server-only) **before** it can exist as deliverable — hard
    rule 5's chokepoint. Blocked attempts are audit-logged, invisible to the recipient,
    and replaceable (sender may rewrite and retry); delivered requests are one-per-pair
    forever.
  - `respond_to_message_request()` — accept creates the chat + both participants (which is
    exactly what unlocks social handles via the Phase 1 gate); decline records silently.
  - `sent_requests()` — the ONLY sender read path; collapses pending/declined/expired into
    `'sent'` so a decline is indistinguishable from silence (§4 invariant 4). Senders have
    zero direct SELECT on the table.
  - `incoming_requests()` / `my_chats()` — list RPCs for the inbox (invoker + caller-scoped
    definer respectively).
- **Metrics**: PostHog wrapper (`src/lib/analytics.ts`, no-op without key) capturing §6
  liquidity events: `trip_created`, `request_sent{delivered,blocked}`, `request_responded`.

Planned next (from brief §4), unchanged:

- `users` (auth identity, status: active/banned/shadowbanned) — Supabase `auth.users` +
  app-level `users` row
- `profiles` (name, age, home_city, home_country, languages[], bio, gender for visibility
  filtering, verified, verification metadata)
- `profile_photos` (position 0 = avatar, 1–6 gallery, moderation_status)
- `social_handles` — **RLS: readable only with an accepted chat with the owner** (hard rule 4)
- `trips` (normalized city ref, date range, status)
- `pins` (venue-level lat/lng, category, intent_date, `expires_at ≤ now() + 72h` as a DB CHECK
  constraint; hard-delete/anonymize on expiry — hard rules 2–3)
- `heat_cells` (H3/geohash cell, date, category, pin_count; only cells with
  `pin_count ≥ k` are ever served — hard rule 6; k configurable, initial default 3)
- `message_requests` (source: trip_match | pin, first_message_text, moderation_verdict,
  status incl. blocked_by_moderation — hard rule 5)
- `chats` / `messages` (created only on accept; Realtime)
- `reports`, `blocks`, `moderation_events` (full audit trail)
- `seeded_pins` (admin-curated, no user attached), `launch_cities` (geofence/feature flags)

**RLS invariants to be enforced in Postgres with tests** (brief §4): social-handle gating;
no pin reads outside launch cities; expired pins unreadable by everyone; pending/declined
requests reveal nothing to the sender.

Edge Functions planned: first-message moderation (regex pre-filter → Claude classification →
verdict log), pin expiry sweep, heatmap aggregation (PostGIS → H3 cells). Scheduled jobs via
Supabase cron (`pg_cron`) or scheduled Edge Functions — chosen in Phase 3.

## Phase 3 map decision — RESOLVED: react-native-maps (Apple Maps)

Decided 2026-08-16 with Phase 3. Rationale: (a) react-native-maps 1.27.2 is SDK-bundled and
works in Expo Go on iOS with Apple Maps — no token, no dev-build requirement for the demo
loop; (b) our heatmap is **k-anonymous cells by design** (translucent ~275m circles whose
opacity scales with count) — a smooth gradient heat layer would actually undercut the
privacy story, so Mapbox's marquee feature isn't needed; (c) zero cost at any scale.
Revisit only if launch-city polish demands custom map styling (Mapbox free tier ~50k
loads/month, needs token + config plugin + dev build).

### The map (Phase 3 implementation)

- **`launch_cities`** — geofence/feature-flag table seeded with the brief's candidate hubs
  (Lisbon, Mexico City, Bangkok, Denpasar), per-city `radius_km` (default 40) and `heat_k`
  (default 3). Founder toggles `active`; nothing is hardcoded global (brief §2.6).
- **`pins`** — venue-level future intent. Hard rule 3 is structural: `expires_at <=
created_at + 72h` CHECK, **no UPDATE grant at all** (a pin can never be edited past its
  cap), RLS that hides expired pins from _everyone including the owner_, and an
  `expire_pins()` hard-delete sweep (pg_cron every 15min on hosted; guarded no-op locally).
  A validation trigger enforces the city geofence (haversine — no PostGIS dependency yet),
  active-city status, sane intent dates, and a 10-active-pin cap.
- **Rule 2 posture**: nothing in the schema or client ever touches device location —
  `showsUserLocation={false}`, no location permission in app.json, pin placement is manual
  (tap/drag on the map).
- **Heatmap (rule 6)**: `heat_cells(city, date?)` is the _only_ heat read path — SECURITY
  DEFINER so it can aggregate pins the caller can't individually see, returning only
  quantized ~550m cell centers + counts, `HAVING count(DISTINCT pinner) >= heat_k`. Distinct
  pinners, not pins — one user can't heat a cell alone. Seeded pins count toward heat (the
  cold-start strategy). Client renders cells as translucent circles under the pin markers.
- **Seeded pins** — `user_id IS NULL` + `seeded` flag + optional `seed_note`; visible to all,
  no profile/request path, insertable only server-side (admin SQL for now, Phase 6 tooling).
- **Pin→request**: `send_message_request` gained the `pin` source — requires the recipient
  to have a live pin; same moderation chokepoint and invariants as trip requests.
- **Client**: native map screen (city chips, emoji category markers, heat underlay, pin
  detail card with Say hi / Remove, drop-a-pin FAB), drop-pin modal (venue text + tap/drag
  placement + category + intent day + **user-set duration** ≤72h per brief §1), web fallback
  list. §6 metrics: `map_viewed`, `heatmap_rendered`, `pin_created`, `pin_tapped`.
- **Venue search**: free-text venue name + manual map placement for v1 — same zero-key
  posture as the cities decision; a places API or curated venue seeds can layer in later
  without schema changes (flagged to founder).

## Chat & realtime (Phase 4)

- **`messages`** — member-only RLS both ways; senders must be the caller and the chat must
  be ACTIVE (`can_send_in_chat()`, caller-scoped). No client UPDATE/DELETE. Streamed via
  Supabase Realtime postgres-changes, which are RLS-filtered server-side; the publication
  add is guarded so migrations run on environments without it (local rig, CI).
- **Block vs unmatch — deliberate asymmetry**: a BLOCK closes the chat (Phase 2 sever
  trigger) — history stays readable to both members as _evidence for reports_, nothing new
  can be sent, and `unmatch_chat` refuses to touch closed chats so a reported abuser cannot
  destroy the record. UNMATCH (active chats only) hard-deletes the chat and messages for
  both, per the brief; the request row survives as the one-request-per-pair anti-pester rule.
- **`reports`** — reason enum + free-text details + context ref; insert-only for clients
  (own reports readable, review `status` is admin-only via column grant); every report
  auto-logs to `moderation_events` — the Phase 5 review queue reads from there.
- **Push pipeline** — DB triggers enqueue into a server-only `push_queue` (new request →
  recipient; accept → sender; message → other member). `supabase/functions/push-worker`
  (deploy + schedule ~1/min) drains it to the Expo push API in ≤100-notification chunks,
  prunes `DeviceNotRegistered` tokens, and leaves rows unstamped on transport failure so
  they retry. Device tokens live in `push_tokens`, registered via a caller-scoped RPC that
  reassigns a token on shared-device account switches. Client registration is best-effort
  and silently skips Expo Go / simulator / pre-EAS setups.
- **Chat list** — `my_chats()` now carries last-message preview and orders by last activity.

## Trust & safety (Phase 5)

Hard rule 5 is now complete: the regex pre-filter (Phase 2) plus a Claude classification
stage, both in front of delivery.

- **Feature flags** (`app_config`, server-only): `require_llm_moderation` and
  `require_photo_moderation`, both default **false** so keyless dev/CI runs exactly the
  Phase 2–4 behavior. Flip them (SQL editor) only after `ANTHROPIC_API_KEY` is set and
  `moderation-worker` is deployed + scheduled — held items don't move otherwise.
- **First-message pipeline** (flag on): pre-filter block → immediate `blocked_by_moderation`
  (unchanged); pre-filter pass → **`pending_moderation`** — invisible to the recipient
  (RLS), masked as plain "sent" for the sender, no push. `supabase/functions/
moderation-worker` (scheduled ~1/min) classifies with `claude-opus-5` (structured
  output: allow/block + category + confidence) and applies the verdict through
  `apply_message_verdict`, the **only** transition out of the held state —
  service-role-only (EXECUTE revoked from clients + runtime `auth.role()` guard). Allow
  releases the request (push fires then); block lands as `blocked_by_moderation` with a
  strike and sender feedback. Fail-closed semantics: API failures leave the message held;
  after 10 attempts it's blocked with engine `failsafe` (sender told to retry, **no**
  strike); a model refusal is treated as a block. Release re-validates the pair — a block
  filed while held, a sender no longer plain-active, a recipient turned invisible, or a
  chat already formed via the reverse direction all end in a silent decline — and
  `sever_on_block` also declines held requests.
- **Strike ladder** (trigger on `moderation_events`; strike actions: `blocked`,
  `llm_blocked`, `photo_rejected`, `admin_strike`): 3 strikes → warning (event + push),
  5 → 7-day suspension, 7 → permanent ban. Deterministic, advisory-locked per user,
  audit-logged. Suspensions lift via `lift_expired_suspensions()` (pg_cron, guarded).
- **Standing gates at the DB layer**: suspended/banned callers are refused by
  `send_message_request`, `respond_to_message_request`, `submit_verification`, and
  `can_send_in_chat` (chat RLS). Shadowbanned users get the full illusion instead: their
  message requests report "delivered" but land directly as `declined` (audit action
  `shadowban_suppressed`) — no push, no inbox row, nothing the recipient can ever see —
  and they keep chatting in chats that already exist. The strike ladder never _suspends_ a
  shadowbanned account (that would both reveal the shadowban and launder it into `active`
  when the suspension lifts); they still hit the ban rung. The client adds an account-gate
  screen (`users.status`/`suspended_until` are self-readable), but that's UX; enforcement
  is in Postgres.
- **Photo moderation** (flag on): uploads hold at `pending` (owner-only visible — the
  Phase 1 RLS already gates others on `approved`); the worker classifies via Claude vision
  on a short-lived signed URL and applies `apply_photo_verdict` (reject = strike + push).
  Photos that repeatedly fail classification are failsafe-removed without a strike (owner
  told to re-upload) rather than left stuck "in review". Flag off = the Phase 1
  auto-approve stub.
- **Selfie verification**: selfie goes to a **write-only** private bucket
  (`verification-selfies` — clients have no SELECT policy at all); `submit_verification`
  (caller-scoped RPC: own-folder path check, object-exists check, requires an approved
  profile photo to compare against, one pending at a time, 3/day cap) opens a request; the
  worker compares selfie vs up to two approved profile photos with Claude vision and
  applies `apply_verification_verdict` — approve sets `profiles.verified` + evidence into
  the server-only `verification` jsonb; reject carries a user-facing reason. The selfie
  object is **deleted from storage as soon as a verdict lands** (data minimization — the
  audit trail is the verdict, not the image). **Honesty note (also in the UI): this is a
  likeness plausibility check, not certified liveness/identity verification** — the vendor
  upgrade path stays flagged.
- **Admin review queue**: `admin_report_queue` view (open reports + reported user's status,
  strike count, total reports) and `admin_resolve_report(report_id, action, note)` with
  actions dismiss/warn/strike/suspend/ban/shadowban — both service-role-only (SQL editor
  or a future dashboard). `strike` feeds the ladder; direct suspend/ban bypass it. An
  action that can't apply to the account's current status (e.g. suspending a banned user)
  raises instead of resolving the report and logging a phantom audit event.

## Guests can chat (Phase 12)

Anonymous sign-in makes a guest a **real auth user** with a normal session. That one
choice is why the rest is small: a guest is `authenticated`, so RLS, chat membership
and message authorship need no new paths, and the conversion is free — adding an email
clears `is_anonymous` on the **same row**, so every chat, membership and message follows
them. A second identity table would have needed a parallel permission system and a
hand-written data move.

`public.users.is_guest` mirrors `auth.users.is_anonymous`, maintained by two triggers
(`handle_new_user` at creation, `sync_guest_flag` at conversion). It has no client write
grant in any direction, so the only way in is the auth event itself.

**What a guest can do**: read a venue room, join a group they hold a link for, post text
in a chat they belong to, set and change their own name (`set_guest_name`).

**What a guest cannot do**, each guarded at the _table_ rather than in the RPC above it,
because the tables that matter all have a SECURITY DEFINER path that sails past a
missing client grant:

| Refused                         | Where                        | Why                                                                                                             |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Stamp `onboarding_completed_at` | `profiles_guest_minimal`     | The single fact keeping guests off every discovery surface — and the column is in the client's own UPDATE grant |
| A bio, an age, a gender         | same trigger                 | Nothing to leak, and age/gender are what the visibility audiences filter on                                     |
| Trips, pins                     | `guests_do_not_broadcast`    | The two things that put you in front of strangers                                                               |
| Say hi to a stranger            | `message_requests_no_guests` | The one chat action that is not "answer the room you were invited to"                                           |
| Profile photos, verification    | `guests_do_not_upload`       | Storage and a vision call apiece, for a profile that does not exist                                             |
| Photos in chat                  | `guest_message_limits`       | Keeps a free identity away from the classifier entirely                                                         |

**Abuse ceilings**, three because they fail differently: 10 concurrent chats
(`guest_membership_cap`), 200 messages a day (under the existing 30-a-minute throttle,
which catches the slow flood it lets through), and no photos at all.

**The janitor**, split in two: `stale_guest_ids()` names anonymous accounts idle 30 days
with no live membership; the `guest-janitor` Edge Function deletes them through the
admin API, on a daily pg_cron invoke at 04:30 UTC. The split is not decoration — SQL
cannot be trusted to delete an `auth.users` row (the migration role's rights over that
schema are not ours to assume), and `delete-account` already goes through the admin API
for the same reason. A nightly job that silently cannot do its job is worse than none.
Deleting a guest cascades to their messages, which is the point — a throwaway identity
is not a place to keep somebody's words forever. A member who wants persistence has the
account that makes that true.

`is_guest_account()` reads `auth.users.is_anonymous` directly from a SECURITY DEFINER
function rather than mirroring it into a column. There is no stored copy, so no sync
trigger, no drift, and conversion is instant: clearing the flag converts them in the
same statement. The first cut had a `public.users.is_guest` column kept in step by two
triggers on `auth.users`, and opened by ALTERing that table for local-shim parity —
which the hosted project refuses outright, and which passed the local suite only because
the throwaway cluster has one owner for everything.

Venue rooms stay **read-only** for guests: a room is a public front door, and a
free-to-mint identity posting through one is a different risk from answering a link
somebody handed you. Reading stays open to everyone, which is what the room is for.

**Founder action required**: anonymous sign-ins must be enabled in the Supabase
dashboard (Authentication → Sign In / Providers → Anonymous sign-ins), and its rate
limit set there. Until that is on, "Join with a name" fails and the account path still
works.

## Who can see you (Phase 12)

A traveler can narrow the audience for their profile and their pins:
`everyone` (default), `verified`, `verified_men`, `verified_women`, `verified_nonbinary`. Stored as
`profiles.visible_to public.profile_audience`, a column with **no client grant in
either direction** — reading it would leak one traveler's setting to another, and
writing it would route around the rule below. Both go through `my_visibility()` and
`set_visibility()`, and the "narrowing your audience costs a verified badge" rule
lives in the latter, not in the app.

Three deliberate boundaries, all proved in `17_profile_visibility.test.sql`:

- **It cuts both ways.** `discovery_pair_ok(viewer, subject)` is symmetric: the
  subject's audience must admit the viewer _and_ the viewer's own audience must admit
  the subject. Choosing an audience chooses who you see as well as who sees you, which
  is what makes it a preference rather than a cloak. Self is always admitted, so your
  own pin never vanishes from your own map.
- **It stops at the two discovery surfaces.** Wired into `get_matches()` (Travelers),
  `city_pins()` (map) and `featured_traveler()` (guest-visible slot, so a narrowed
  audience is never eligible). Deliberately NOT wired into `send_message_request`,
  `traveler_trips`, rooms, groups or any profile read: anyone can still message anyone,
  and a profile reached from a chat still opens.
- **It stops before the heatmap.** Heat cells are an aggregate behind a k-threshold.
  Re-filtering them per viewer would push counts _down_ for some viewers, which is the
  direction that breaks hard rule 6. A hidden traveler still adds anonymous weight to a
  cell and still never appears as a pin.

`profiles_reset_visibility` drops the setting back to `everyone` if the badge is ever
taken away, so the rule is not enforced only at write time.

Honest consequence, stated in the picker as well as here: the three gendered options
match `profiles.gender`, so a traveler who has not set a gender ("Rather not say") is in
none of them. `verified_nonbinary` was added a revision after the rest (founder,
2026-08-23) because without it nonbinary travelers were the only group that could be
asked for and never ask. The three are siblings, not a hierarchy: asking for one gendered
audience does not put you in another.

**Testing it against demo travelers** needs at least one of them verified, and the seed
script is anon-key-only by design (it can do nothing a real user could not, and
`profiles.verified` has no client grant). Flip a couple by hand in the Supabase SQL
editor:

```sql
update public.profiles set verified = true
where user_id in (select user_id from public.profiles where bio like '%[demo]%' limit 4);
```

## Launch hardening (Phase 6)

- **Velocity caps** complement the Phase 2–5 _standing_ caps (5 active trips,
  10 live pins, 7 photos, one request per pair). Standing caps bound state;
  these bound rate, because delete-and-recreate churn defeated the former:
  messages 30/min, requests 30/day, reports 10/day, trips 20/day, pins 30/day,
  photos 25/day, blocks 50/day, profile updates 30/day. Photo/block/profile
  counters read from `moderation_events` precisely because the rows they'd
  otherwise count can be deleted. Storage buckets gained object ceilings (30
  photos, 10 selfies per user) — uploads were previously unbounded whenever no
  DB row accompanied them.
- **Oracle-proof errors**: `send_message_request` now raises the _same_
  'recipient unavailable' for every relationship failure (blocked pair,
  non-discoverable recipient, no overlap, no live pin). Distinct messages let
  a sender with a known overlap detect that someone blocked them — the same
  class of leak as the Phase 3 heatmap differencing attack.
- **Profile text screening**: `display_name`/`bio` are broadcast to every
  overlapping traveler but previously bypassed moderation entirely. They now
  pass the regex pre-filter on write (LLM-grade review of profile text is a
  flagged follow-up).
- **Admin metrics views** (service-role only, brief §6): `admin_liquidity`
  (the number), `admin_request_funnel`, `admin_moderation_stats`,
  `admin_pin_stats`, and `admin_ops_health` (queue depths — the liveness check
  for both workers and pg_cron). App-behavior metrics stay in PostHog; the
  mapping is docs/DASHBOARD.md.
- **Account deletion** (App Review 5.1.1(v)) is `supabase/functions/
delete-account`: verifies the caller's JWT, clears both storage buckets,
  hard-deletes their chats for both members (unmatch semantics), then deletes
  the auth user — the FK graph cascades the rest, while `moderation_events`
  survive with `subject_user_id` nulled so the audit spine isn't erasable by
  deleting an account. Proven in `09_launch_hardening.test.sql`.
- **In-app policy surface** (App Review 1.2): bundled community guidelines at
  `/guidelines` (readable before sign-up), a consent line on the welcome
  screen, and a support contact. Text lives in `src/constants/policies.ts`;
  the long-form drafts in `docs/legal/` are the source of truth for both.
- **Edge Functions are typechecked in CI** (`deno check`) — they're excluded
  from `tsc`/jest as Deno code, which had left the moderation and deletion
  paths with no static verification at all.

## Groups and permissions (Phase 10)

A traveler group is `chats.kind = 'room'` with a row in `public.groups`
rather than in `public.establishments`. That was the whole point of reusing
the rooms schema: membership with a stay window, the expiry sweep,
pin/mute/archive, reactions, moderated photos and realtime already worked,
and none of them had to learn about a new kind of chat.

What is new sits in three places:

- **`room_members.role`** (`member` / `speaker` / `admin`). Establishment
  rooms leave it at `member` and keep their moderators in
  `establishment_staff`; `is_room_moderator` now returns true for either.
  The admin check deliberately ignores `expires_at`, and
  `expire_room_members` skips admins, so a group cannot end up with nobody
  able to run it.
- **`may_speak_in_room`**, folded into `can_send_in_chat`. A restricted
  group refuses a plain member's INSERT at the policy layer. The client
  explains why; the client is not what stops them.
- **`group_invites`**, a bearer-token table with RLS on and **no policies at
  all**. Any select policy would make every group's invite enumerable, so
  the only ways in are two SECURITY DEFINER functions that take a token and
  never hand one out. One live token per group, revocable, thirty-day life.

Joining clamps the stay-until date to the group's maximum server-side.
`my_chats` had to be dropped and recreated to gain `my_role`: Postgres
refuses to add an OUT column to an existing `RETURNS TABLE`, and the grants
have to be restated after the drop.

## Support (Phase 10)

The in-app contact form writes into `support_messages` and the row is the
record: delivery is only the notification, so an unconfigured or failing
mailer cannot lose a safety report. The table has an insert policy for `anon`
as well as `authenticated` — somebody who cannot sign in is the person most
likely to need support — with per-address and global hourly limits enforced by
a trigger, and no select policy for anyone.

Two delivery channels, either or both:

- **Email.** A cron'd `support-mailer` Edge Function sends undelivered rows
  through Resend. Needs `RESEND_API_KEY` and `SUPPORT_INBOX` as repo secrets;
  without them the worker returns `{skipped: 'not configured'}` and changes
  nothing.
- **Push, and it needs no key at all.** `app_config.support_notify_recipients`
  is a JSON array of **emails or user ids**; an `after insert` trigger queues
  a push to each of them with the sender's address as the title. Empty by
  default. Emails are accepted because the person setting this knows their own
  address and not their uuid — `support_duty_user_ids()` resolves them and
  never raises, so a typo in the setting can never refuse somebody's message.

Because the insert policy is write-only, PostgREST cannot return the new row,
so the client submits through `submit_support_message()` and gets an id back.
`support_message_status(id)` then answers "what became of mine" — created,
delivered, attempts — for the author only, and returns neither body nor
address, so it is not a way to read the inbox.

## The audit build (Phase 11)

Six migrations, in the order they apply. Each is listed with the one thing a
future reader is most likely to need.

| Migration                               | What it adds                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `..._unread`                            | `chat_prefs.last_read_at`, `mark_chat_read()`, `my_chats.unread_count`                 |
| `..._first_message_anchor`              | `my_chats.first_message_element` — what the hello answered                             |
| `..._featured_and_caps`                 | featured traveler needs a face; the daily first-message cap; `preview_first_message()` |
| `..._profile_prompts`                   | up to three answered prompts per profile, screened like the bio                        |
| `..._daily_spotlight`                   | the mutual pairing, its symmetric score, and the nightly sweep                         |
| `..._room_info` / `..._pinned_messages` | the name a non-member sees; three expiring pins per room                               |
| `..._review_fixes`                      | four guards the above had walked around — see below                                    |

Three decisions worth keeping:

**`my_chats()` was dropped and recreated twice.** Postgres will not add an OUT
column to an existing `RETURNS TABLE` signature, and each drop takes the grants
with it. Both migrations restate them. This is the trap `AGENTS.md` names, and
it has now bitten twice; expect a third.

**The spotlight is mutual by first-write, not by matching.** A proper stable
matching over the whole city is the textbook answer and is far more machinery
than this needs. Instead the score is _symmetric by construction_ — every term
is a fact about the pair or a sum over both profiles — so the same pairing is
the right answer whichever of the two asks first, and the first to ask writes
the row.

The race is closed by a **per-day advisory lock**, not by the unique indexes.
That was the original claim and it was wrong: `(day, user_a)` and
`(day, user_b)` bound a user to one row per SIDE, and because the insert
canonicalises with `least`/`greatest`, which side you land on depends on UUID
ordering — so anybody with one partner above them and one below can occupy
both, and the `unique_violation` handler never fires. A pairing is a decision
about two people, so a per-user lock is not enough either; the lock is on the
day, taken before the candidate scan, with a re-read under it.

**A SECURITY DEFINER function that calls `get_matches()` must restate the
policy.** `get_matches()` is SECURITY INVOKER and does none of its own
filtering: `is_discoverable_owner`, `not is_blocked_pair`, the trip status and
the account status all live in the `trips_select_overlap` POLICY, and policies
do not run for a definer. `daily_spotlight()` is the only definer caller in the
schema and it originally restated none of them, which handed a blocked person's
profile to the person who blocked them. If a future function calls
`get_matches()` as the owner, it owes the same four clauses — in the read-back
as well as the scan.

**The first-message cap returns rather than raises, and it is checked before
anything about the recipient.** Returning keeps it out of the error path,
because being finished for the day is not an error. Checking it first makes the
answer identical whoever you aimed at, so a capped sender cannot use the refusal
as an oracle for who exists, who blocked them, or who is discoverable. It is a
safety limit and hard rule 1 means it is never sold back.

It is also **serialised per sender** with
`pg_advisory_xact_lock(hashtext('first_messages:' || sender))`, the same shape
every other counted cap in this schema uses (trips, pins, photos, strikes,
verification, group creation). Without it the count and the insert are two
statements with a network round trip's worth of daylight between them, and
twenty parallel hellos to twenty different travelers all read zero — the unique
`(sender_id, recipient_id)` constraint does not help, because they aim at
different people.

**Every branch of `send_message_request` returns the same keys.** The client
has one result type for it, so a branch that omits a key types it as present
and hands back `undefined`. The capped branch returned four of seven, including
dropping `used` — on precisely the branch where the composer wants to say
"8 of 8".

**A refusal must not be an oracle.** `pin_message` and `unpin_message` each had
two distinguishable outcomes that let anybody holding a message id learn
whether it exists, and whether it is pinned, in a room they cannot read. Both
now answer a member honestly (they can already see the message) and answer
everybody else the same way whatever the truth is — the rule
`send_message_request` already followed.

## Privacy & secrets model

- `EXPO_PUBLIC_*` env vars ship inside the client bundle. Only the Supabase URL + anon key
  belong there. **RLS is the security boundary, not key secrecy.**
- Server secrets (ANTHROPIC_API_KEY, service role) exist only as Supabase Edge Function
  secrets; they never appear in this repo or the app bundle.
- `.env` is gitignored; `.env.example` is the committed template.

## The app's public-facing surface

Two functions are the whole of what an unauthenticated or non-overlapping
person can see, and the privacy policy is written against them. Change either
and the policy has to change with it.

- **`featured_traveler(city_id)`** is granted to `anon`. It returns one
  traveler's name, age, verified badge, languages, bio, city, dates and first
  approved photo to signed-out visitors. Eligibility is having an active trip
  in that city within the next fortnight; the ranking is who has been messaged
  most in the last thirty days. There is deliberately no opt-out
  (20260817190000, "posting a trip is the consent") — an open founder
  decision, now stated in the policy.
- **`traveler_trips(user_id)`** gates on a signed-in caller, a discoverable
  owner and no block either way — not on overlap. Upcoming trips are part of a
  profile; finished ones are private.

## Technical flags (raised to founder, non-blocking)

1. **`expo-router/unstable-native-tabs`** — the native tabs API is new in the SDK 5x line and
   namespaced "unstable"; minor churn is possible on SDK upgrades. The web tab bar
   (`expo-router/ui`) is stable. Isolated in one component (`app-tabs.tsx`) so any migration
   is a single-file change.
2. **Supabase session persistence** — Phase 0 ships `persistSession: false`. Phase 1 will add
   an `expo-secure-store`-backed storage adapter so auth sessions survive app restarts and
   tokens live in the iOS keychain, not AsyncStorage.
3. **Push notifications** (Phase 4) require a paid Apple Developer account and an EAS project;
   remote push does not work in Expo Go — we'll move to an EAS development build at that point
   (also required for Apple Sign-In entitlements in Phase 1).
4. **React Compiler + typed routes** are enabled by the SDK 57 template (`experiments` in
   `app.json`). Kept on; if the compiler misbehaves with any dependency it can be switched off
   in one line.
5. **Selfie verification** (Phase 5 — shipped as plausibility check): the implemented flow is
   Claude-vision face-match plausibility, honestly labeled in the UI ("likeness check, not an
   identity document check"). True liveness (challenge-response, anti-replay) needs a vendor
   SDK (e.g. iProov, FaceTec, AWS Rekognition Liveness) — evaluate when verification fraud
   becomes a real problem, with cost.
6. **LLM moderation cost/latency** (Phase 5): with `require_llm_moderation` on, every first
   message costs one `claude-opus-5` call (~1–3s, fractions of a cent) and delivery is
   delayed by up to the worker's schedule interval (~1min). Fine at v1 volume; if it ever
   matters, the classifier model is one constant in `moderation-worker`.

## Client auth & profile architecture (Phase 1)

- **Route guards**: root `Stack.Protected` guards in `src/app/_layout.tsx` switch between
  `(auth)` (signed out), `onboarding/` (signed in, profile incomplete), and `(tabs)` +
  `edit-profile` (onboarded). Routing holds until the persisted session restores and the
  first profile fetch settles, so cold starts don't flash the wrong stack.
- **Session storage**: `SecureSessionStore` (Supabase's documented pattern) — AES-256-CTR key
  in the iOS keychain via `expo-secure-store`, ciphertext in AsyncStorage (sessions exceed
  SecureStore's ~2KB cap). Unit-tested, including the keychain-wiped recovery path.
- **Auth methods**: email/password now; Sign in with Apple via
  `expo-apple-authentication` → `signInWithIdToken` (needs an EAS dev build — the entitlement
  doesn't exist in Expo Go — and the Apple provider enabled in Supabase auth settings).
- **Onboarding**: six steps (about → home → languages → photos → bio → socials), each
  persisting directly to `profiles` so a killed app resumes where it left off. Finishing sets
  `onboarding_completed_at`, which flips the root guard to the tabs.
- **Age, not birthdate**: we store an integer age (18+ CHECK in DB + client validation),
  never a date of birth — data minimization; revisit only if App Review demands DOB.
- **Data layer**: React Query for profiles/photos/handles; signed photo URLs cached just
  under their 1h TTL; Zustand holds only the session (`features/auth/store`).

## Decision log

- **2026-08-16** — Adopted founder's stack unmodified (Expo SDK 57 + Supabase). Scaffolded
  from the official `create-expo-app` default template, trimmed to a four-tab skeleton.
- **2026-08-16** — Tab icons: SF Symbols (iOS-first) instead of bundled PNGs; Android
  drawables deferred until an Android release is planned.
- **2026-08-16** — Heatmap k-threshold initial default set to **3** (cells with <3 pins from
  distinct users never render to others); value lives server-side so it can be tuned without
  an app release.
- **2026-08-16** — Repo work happens on the session branch
  `claude/travel-app-initial-setup-ephphz` (merge to `main` via PR), per the remote session's
  branch policy.
- **2026-08-16 (Phase 1)** — RLS verified with pgTAP on a local Postgres 16 + Supabase shim
  instead of Docker/`supabase start` (unavailable in the cloud dev environment); the shim
  replicates hosted default grants so REVOKEs are tested honestly.
- **2026-08-16 (Phase 1)** — Store integer `age`, never a birthdate (data minimization).
- **2026-08-16 (Phase 1)** — Chats/chat_participants created in Phase 1 as read-only stubs so
  the social-handle gate is DB-real immediately; Phase 2 adds their server-side write paths.
- **2026-08-16 (Phase 2)** — Bundled GeoNames city table instead of a paid places API for
  v1 (no keys, offline autocomplete, map-ready lat/lng); revisit only if autocomplete
  quality becomes a complaint.
- **2026-08-16 (Phase 2)** — Message-request state machine lives in SECURITY DEFINER RPCs,
  not client table writes: moderation-before-delivery and sender-blind declines are
  structural, not conventions.
- **2026-08-16 (Phase 2)** — Trip visibility = overlap-gated RLS + 5-active-trip cap as the
  anti-scraping budget; API-layer rate limiting still flagged for launch hardening.
- **2026-08-16 (Phase 3)** — react-native-maps over Mapbox (SDK-bundled, Expo Go-compatible,
  and k-anonymous cell rendering doesn't want a gradient heat layer). Haversine trigger
  instead of PostGIS for the geofence — PostGIS enters when real geo queries do.
- **2026-08-16 (Phase 3)** — Pins are immutable (delete + recreate, no UPDATE grant): the
  72h CHECK cannot be outlived by edits, and pin history can't be rewritten.
- **2026-08-16 (Phase 3)** — Free-text venue + manual map placement for v1 pin creation
  (no venue-search API); curated seeds/places API can layer in without schema changes.
- **2026-08-16 (Phase 4)** — Block freezes chats (evidence preserved), unmatch deletes them
  (brief), and unmatch is refused on closed chats so blocks can't be laundered into
  evidence deletion.
- **2026-08-16 (Phase 4)** — Push delivery is queue-and-drain (DB triggers + scheduled Edge
  Function) rather than webhook-per-event: testable in pgTAP, no dashboard wiring in the
  critical path, and at-least-once semantics with retry on transport failure.
- **2026-08-17 (Phase 5)** — LLM moderation is a held state + service-role verdict RPC, not
  an inline API call from the send RPC: sends stay fast and keyless dev works, while "no
  path to delivery without a verdict" stays structural. Same queue-and-drain worker pattern
  as push.
- **2026-08-17 (Phase 5)** — Moderation failures fail **closed** (message stays held, then
  failsafe-blocks with no strike) — hard rule 5 outranks delivery latency; an outage must
  never deliver an unscreened message, and must never put innocent users on the strike
  ladder.
- **2026-08-17 (Phase 5)** — Strikes are derived from `moderation_events` (the audit spine)
  rather than a separate counter table: every strike is inherently evidence-backed, and the
  ladder is re-computable.
- **2026-08-17 (Phase 5)** — Selfie verification ships as an honest Claude-vision likeness
  check (labeled as such in the UI), not fake "identity verification"; certified liveness
  is a vendor decision deferred until fraud data justifies the cost.
- **2026-08-17 (Phase 6)** — Provisioning runs from GitHub Actions
  (`supabase-deploy.yml`) rather than a local CLI: the founder develops from a phone, and
  this keeps credentials in GitHub's encrypted store instead of a chat transcript. Trigger
  is a commit to `supabase/.deploy-request` (works on any branch — `workflow_dispatch`
  only lists workflows that already exist on the default branch).
- **2026-08-17 (Phase 6)** — Rate limits live in DB triggers, not an API gateway: the
  client is not the only caller (anyone can drive PostgREST with a valid JWT), so the same
  place that enforces privacy enforces velocity. Limits are counted from `moderation_events`
  wherever the counted rows are user-deletable.
- **2026-08-17 (Phase 6)** — All relationship failures in `send_message_request` return one
  indistinguishable error; usability of precise errors loses to the block-invisibility
  invariant.
- **2026-08-17 (Phase 6)** — Account deletion is an Edge Function rather than an RPC: it
  must reach the storage API and `auth.admin.deleteUser`, neither of which is available to
  SQL — and doing it in one server-side place keeps "delete" honest (storage included).
