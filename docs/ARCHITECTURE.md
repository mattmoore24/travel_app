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
  the boolean `verified` badge; the evidence jsonb (`{method, request_id, verdict, at,
photo_ids}` — the model's verdict and, since 20260904100000, which photos the selfie was
  compared against) has no client grant at all, so clients always select explicit columns
  (`PROFILE_COLUMNS`).
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
- `seeded_pins` (admin-curated, no user attached), `launch_cities` (where a business can
  list, the seed of the map's rail, and a per-city override for `heat_k` and the clock; **not
  a fence** since 2026-09-04 - a pin or a trip can be in any of the ~49,000 `cities`)

**RLS invariants to be enforced in Postgres with tests** (brief §4): social-handle gating;
pins readable only within the map's circle around a city the reader CHOSE, never a device
position; expired pins unreadable by everyone; pending/declined requests reveal nothing to
the sender.

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

- **`launch_cities`** — seeded with the brief's candidate hubs (Lisbon, Mexico City,
  Bangkok, Denpasar), per-city `heat_k` (default 3) and a hand-set `timezone`. Since
  2026-09-04 it is the seed of the rail and the business side's list, not a geofence:
  `radius_km` is unused by pins, and `active = false` takes a city off the rail's guaranteed
  slot without hiding a single pin. `cities` carries every city down to 5,000 people with
  its own `timezone` (`city_clock_zone()` reads the launch override first).
- **`pins`** — venue-level future intent. Hard rule 3 is structural: `expires_at <=
created_at + 72h` CHECK, **no UPDATE grant at all** (a pin can never be edited past its
  cap), RLS that hides expired pins from _everyone including the owner_, and an
  `expire_pins()` hard-delete sweep (pg_cron every 15min on hosted; guarded no-op locally).
  A validation trigger RESOLVES the pin's city (the browsed one within 20 km, else
  `nearest_city()`, distance over the fourth root of population - haversine, no PostGIS),
  checks sane intent dates and an optional hour or window against the expiry in the city's
  zone, and a 10-active-pin cap. The map feeds read by distance from the browsed city
  (`map_radius_km()`, 50 km), so the city label is for the funnel and the rail.
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
  list. §6 metrics: `map_viewed`, `heatmap_viewed`, `pin_created`, `pin_tapped`.
  (`heatmap_viewed` replaced `heatmap_rendered` 2026-08-31: a view now requires
  drawn pixels on an uncovered map rather than heat data arriving, so the
  series legitimately drops at the rename.)
- **The tab bar is inside the safe-area inset on iOS** (2026-09-03): expo-router
  wraps each native tab screen's content in its own `SafeAreaProvider`, which
  publishes that view's insets after UIKit has grown them by the bar. So
  `useTabDockBottom` (`src/hooks/use-tab-bar-inset.ts`) treats `BottomTabInset` as a
  FALLBACK for the tree outside the tab host and for the pre-layout frame, never as
  an addend on the measurement. Adding it was 50pt of dead space under every docked
  bar in the app. `tabDockBottomOf` is the pure half, unit-tested by execution.
- **The map's bottom card** (2026-09-03): the plan list's sheet runs to the SCREEN bottom
  and the Drop-a-pin dock is painted over it on a plate cut from the same `theme.surface`,
  so the peek strip, the button and the tab-bar clearance are one card rather than three
  floating slabs. The arithmetic is `src/features/pins/bottom-stack.ts` — `dockFootingOf`
  (the plate), `messageSlotOf` (the one message strip) and `planListHeights` (the three
  detents), all composed from MEASURED heights, never the constants, because both the button
  and the peek grow with Dynamic Type. `useTabDockBottom()` is still the app's only
  tab-bar clearance formula; nothing here adds a second one.
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
- **Strike ladder** (trigger on `moderation_events`; strike actions: `llm_blocked`,
  `photo_rejected`, `admin_strike`, and the historical `blocked`): 3 strikes → warning
  (event + push), 5 → 7-day suspension, 7 → permanent ban, counted over a **rolling
  90 days**. Deterministic, advisory-locked per user, audit-logged. Suspensions lift via
  `lift_expired_suspensions()` (pg_cron, guarded).
  **A prefilter block is not a strike.** The regex prefilter writes
  `prefilter_blocked` (20260902010000), which is deliberately absent from
  `is_strike_action`: it is a guess nobody read, and the composer's own copy tells the
  writer to reword and send again, so three tries at the same unlucky phrase must not be
  a warning. Same reasoning as `blocked_failsafe` on the LLM side. The action is still
  audited, because `admin_moderation_stats` needs it for the creep early-warning.
  `blocked` stays on the strike list only so pre-rename history keeps its meaning;
  nothing writes it any more.
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
  (caller-scoped RPC: own-folder path check, object-exists check, requires a profile photo
  to compare against — approved or still pending, since 20260904100000 — one pending at a
  time, 3/day cap) opens a request; the worker compares selfie vs up to two approved profile
  photos with Claude vision (waiting a tick while the only photo is still pending) and
  applies `apply_verification_verdict` — approve sets `profiles.verified` + evidence into
  the server-only `verification` jsonb, including `photo_ids`, the photos that were in the
  prompt; reject carries a user-facing reason. The selfie
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

### A badge follows the face (20260904100000)

Until this migration a verified traveler could swap in a different person's photo and keep
the badge: nothing ever set `profiles.verified` back to false, no trigger on `profile_photos`
watched an UPDATE or a DELETE, and the verdict recorded nothing about which photos it had
compared. Three things close that.

- **The evidence names the photos.** `apply_verification_verdict` writes `photo_ids` into
  the `verification` jsonb: the array the worker says it sent (what was actually in the
  prompt, not what the database would re-derive a model call later), falling back to
  `compared_photo_ids()` — the worker's own first-two-approved-by-position query — for a
  verdict from an older worker. Everybody verified earlier is backfilled with the derivation
  as of the migration, stamped `photo_ids_backfilled_at`: the best approximation available,
  and better than exempting pre-migration badges forever, which would be the defect with a
  date on it.
- **`profile_photos_badge_follows_the_face`** (AFTER DELETE OR UPDATE OF `position`,
  `moderation_status`) takes the badge away when the face it was issued for stops leading
  the profile. A photo is _compared_ when its id is in `photo_ids`; the _lead_ is the
  approved photo with the lowest position. Revoke when an uncompared approved photo arrives
  at slot 0; when an uncompared photo becomes approved with nothing approved below it (the
  delete-the-lead-then-upload path, which fires on the approval, not the upload); when a
  compared photo stops being approved or is deleted and the lead after that is nobody or
  somebody uncompared. **Never because a compared photo leaves slot 0.** The rule is about
  what _this row_ did, not about the derived state, because a reorder is several PostgREST
  round trips and on a full gallery `photoWritePlan` (`src/features/profile/photo-order.ts`)
  has no free slot to step into, so it moves the photo in the lowest occupied slot first:
  swapping compared A@0 with compared C@2 past an uncompared B@1 writes `A→2` (slot 0 empty,
  B leads) and then `C→0`. A "is the lead compared?" check after the first write would take
  the badge off somebody moving between two checked faces; the row rule sees only C arrive.
  `75_a_badge_follows_the_face` replays both plans write for write and records, per guard,
  which assertion fails when it is removed.
- **A revoke is** `verified = false` with `revoked_at`/`revoked_by`/`revoked_photo_id`
  appended to the evidence (never replaced), the approved `verification_requests` row turned
  `rejected` with a reason the capture screen already renders as a card (no fourth enum
  value: it behaves exactly like a rejection and a new value would have been a client change
  on every installed build), one `verification_revoked` event with source `system` — not on
  `is_strike_action`'s list, changing your own photo is not misconduct — and one push. Naming
  `verified` is what fires `profiles_reset_visibility`, so the narrowed audience falls with
  the badge. The same per-user advisory lock `submit_verification` takes is taken by the
  verdict and, before its read, by the trigger, so a verdict and a photo write in the same
  instant cannot leave a badge judged against a snapshot; a double revoke is prevented without
  it by the profile row lock and the re-checked `and verified`.
- **Verifying during signup works.** `submit_verification` accepts a pending photo, and the
  worker leaves such a request untouched (no reject, no attempt spent, counted as `waiting`)
  until the photo clears, which is usually the next tick since photos drain earlier in the
  same one. Only a request with no photo at all is still refused up front.
- **Client:** `useDeletePhoto` and `useReorderPhotos` also invalidate `['profile']` and
  `['verification']`, since either write can take the badge off server-side; the main tile's
  delete confirm says so while there is a badge to lose. The arrange sheet does not: a reorder
  that costs the badge is the person choosing a new face.

## Guests can chat (Phase 12)

Anonymous sign-in makes a guest a **real auth user** with a normal session. That one
choice is why the rest is small: a guest is `authenticated`, so RLS, chat membership
and message authorship need no new paths, and the conversion is free — adding an email
clears `is_anonymous` on the **same row**, so every chat, membership and message follows
them. A second identity table would have needed a parallel permission system and a
hand-written data move.

There is **no mirrored flag**. `is_guest_account()` reads `auth.users.is_anonymous`
directly from a SECURITY DEFINER function, costing one primary-key lookup per guarded
write. The first cut kept a `public.users.is_guest` column in step with two triggers on
`auth.users`, and every one of those was something that could be refused or drift — the
migration role does not own that schema on the hosted project, which is how the first
deploy of this migration failed. Reading the source of truth needs no triggers, makes
conversion instant because there is no copy to update, and cannot go stale.

**What a guest can do**: read a venue room, join a group they hold a link for, post text
in a chat they belong to, set and change their own name (`set_guest_name`).

A venue room and a traveler group are the same shape — chats of kind `room` with
`room_members` — and differ by a single row: the group has a `groups` row naming it.
That row is what tells "a chat somebody handed you a link to" from "a public front
door", and it is the check both the room footer and `guest_message_limits` make.

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
| Posting in a venue room         | `guest_message_limits`       | A venue's open room is a public front door; a group they hold a link for is not                                 |

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

Venue rooms stay **read-only** for guests: a room is a public front door, and a
free-to-mint identity posting through one is a different risk from answering a link
somebody handed you. Reading stays open to everyone, which is what the room is for.
Enforced in `guest_message_limits` as well as in the room footer — the anon key ships
inside the app, so a rule that lives only in the client is not a rule.

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
taken away, so the rule is not enforced only at write time — and since 20260904100000 it
is, by `profile_photos_badge_follows_the_face`, when the face the badge was issued for
stops leading the profile.

Honest consequence, stated in the picker as well as here: the three gendered options
match `profiles.gender`, so a profile still at the column default is in none of them.
Since 2026-09-04 that is only a guest or an account that never finished signing up:
"Rather not say" was removed from both pickers because it let a traveler use the gendered
filters without being subject to them, and step 3 and edit-profile now refuse the default. `verified_nonbinary` was added a revision after the rest (founder,
2026-08-23) because without it nonbinary travelers were the only group that could be
asked for and never ask. The three are siblings, not a hierarchy: asking for one gendered
audience does not put you in another.

**Testing it against demo travelers** needs them verified, and the seed script is
anon-key-only by design (it can do nothing a real user could not, and `profiles.verified`
has no client grant, so only `apply_verification_verdict` behind the service role ever
sets it). Flip them by hand in the Supabase SQL editor:

```sql
-- How many hold the badge right now.
select count(*) filter (where verified) as verified, count(*) as demo_total
from public.profiles where bio like '%[demo]%';

-- All twelve. Undo with `false`.
update public.profiles set verified = true where bio like '%[demo]%';
```

**All twelve, not a sample.** An earlier version of this said `limit 4`, with no
`order by` and no city or gender filter, which picks an arbitrary four of twelve spread
over four cities and four staggered trip windows. Expected yield is one verified traveler
per city, with a real chance of zero in the city you happen to be testing from, and the
gendered audiences fare worse. That produced a correctly-empty queue that read as a
broken filter (founder, 2026-08-23).

Even with all twelve verified the gendered audiences are thin today, because window-0
membership is fixed by index in `scripts/demo-travelers.json`:

| city today  | men | women | non-binary |
| ----------- | --- | ----- | ---------- |
| Lisbon      | 0   | 2     | 1          |
| Bangkok     | 2   | 0     | 1          |
| Mexico City | 1   | 2     | 0          |
| Denpasar    | 1   | 1     | 1          |

**Denpasar is the only city where all three gendered audiences have somebody today**, so
test those from a Denpasar trip. This is a property of the demo roster, not of the
feature.

## Places: business accounts (Phases 13-18)

Full design in [`BUSINESS_ACCOUNTS.md`](BUSINESS_ACCOUNTS.md). The shape, for
somebody reading the schema cold:

**A business account is an ordinary auth user whose `profiles.onboarding_completed_at`
stays NULL forever.** That one fact is the keystone. The stamp is what makes
somebody a discoverable traveler, so an account that never gets it can never be
matched, spotlit, queued or pinned, and every discovery function built on
completed profiles excludes them without knowing they exist. Everything else is
belt and braces on top of it.

`establishments` became `businesses` in `20260827100000`. Eight functions named
the old table and all eight were recreated in the same migration, because a
function body is stored as TEXT and `ALTER TABLE ... RENAME` does not rewrite
it: a bare rename produces a green deploy and a broken app. `city_rooms` and
`join_room` keep their names, because shipped iOS builds call them over the wire
and a binary does not update over the air.

| table                          | what it holds                                                   |
| ------------------------------ | --------------------------------------------------------------- |
| `businesses`                   | the listing. `state` and `verified_at` are ORTHOGONAL           |
| `business_staff`               | who moderates the room, no expiry                               |
| `business_photos`              | private bucket `business-photos`, cover is position 0           |
| `business_links`               | the one chokepoint a URL can enter through                      |
| `business_hours`               | rows, not a grid: two rows is a split shift                     |
| `business_posts`               | expiry chosen by the business, including never                  |
| `business_email_confirmations` | the six-digit code. No client grants at all                     |
| `business_verifications`       | the two storefront shots. Evidence, never rendered              |
| `business_reports`             | one voice per account, enforced by a partial unique index       |
| `business_scans`               | the impersonation queue, one scan a day per business            |
| `business_ratings`             | Beli-style. No text anywhere                                    |
| `outbound_mail`                | queued email; `to_address` NULL means the SUPPORT_INBOX address |

**`state` is permission to appear; `verified_at` is a badge.** Confirming the
email moves a listing from `unconfirmed` to `listed` and grants no check mark,
because a link click proves an inbox exists and nothing more. Two live camera
shots of the premises, judged the way a selfie is, are what set `verified_at`.
Renaming or moving clears the badge and drops the listing back to `unconfirmed`,
which is the one attack a confirmation step genuinely stops.

**One predicate decides all visibility**: `is_visible_business(id)` is
`active and state = 'listed'`, and every content table's SELECT policy reads it,
so a listing that goes dark takes its photos, links, hours and posts with it.
The people-side equivalent is `is_visible_owner`, and the discipline is the
same: one place to change, one place to test.

**Column-scoped grants, not full-row.** `owner_user_id`, `state` and the raw
`verified_at` have no client grant at all; `verified` is a generated boolean so
the badge renders without the timestamp ever reaching a client. That has a
consequence worth knowing before you debug it: Postgres requires SELECT on every
column a statement NAMES, including in a WHERE, so even the owner cannot filter
by `owner_user_id`. RLS does the scoping instead, and `my_business()` is the one
RPC that answers "am I a business, and which one".

**§7 rule 8 is six BEFORE INSERT triggers** on trips, pins, message_requests,
verification_requests, profile_photos and room_members, plus `register_business`
refusing an account that has already finished a traveler profile. In the
database rather than the client, because the client is a thing somebody can
replace, and because this is what stops a venue scraping who is in town.

**A business chat is `kind = 'business'`, and that is not a label.**
`has_accepted_chat` requires `kind = 'direct'`, so that one enum value is what
makes "a chat with a business never unlocks anybody's personal handles, in
either direction" true rather than merely promised.

**Two worker branches**, inside the existing moderation-worker: the storefront
check and the impersonation scan. Their prompt keys are OPTIONAL in
`loadPrompts`, which is load-bearing rather than lazy: the loader returns null
unless every REQUIRED key is present, and a null stops all four original queues,
so making these required would let a stale secret take message moderation down.
The impersonation scan is also the one branch in that worker that fails OPEN,
because a scan that could not run is not evidence, and darkening a real business
because the classifier was down would be the app doing the damage it exists to
prevent.

### What the final audit changed (2026-08-27)

Four passes over the surface before the founder's first test. The structural
ones are recorded here because they are decisions, not tidying.

**`business_detail` carries `claimed`.** A boolean, never the owner's id or
name: the only question a traveler's screen has to answer is whether there is
somebody on the other end of a message, and anything richer would put a person
on an endpoint that anon can call. The four launch venues have no owner, and
`message_business` refused them _after_ the message was typed.

**An `uncertain` storefront verdict is terminal for the machine and open for a
person.** `apply_business_verification_verdict` writes it and then refuses to
touch the row again, which is right — it is the machine's last word — but it
left nobody able to finish. `admin_resolve_business_verification` is
service-role only and accepts `pending` or `uncertain`. Rejection now emails the
business the way approval does: somebody who sent their photos and put the phone
away has no reason to open the app again.

**One question, one answer, in both places.** `is_room_moderator` gained an
owner arm — `register_business` writes no `business_staff` row and
`room_members_refuse_business` stops the owner ever joining, so the one person
who runs the place could read their own room and not post in it.
`report_business` gained the `is_business_account` refusal that `rate_business`
and `message_business` already had; the client guard alone was never a guard,
because the anon key ships in the app.

**`is_business_account` is revoked from clients.** It was the one helper in the
set without a revoke, so Supabase's default grant stood and PostgREST served it:
any user id lifted off a profile page could be posted to it, and the answer is
exactly what the column-scoped grant hiding `owner_user_id` exists to withhold.
Every caller inside the database is SECURITY DEFINER and unaffected.

**`website_url` goes through the link validator.** `business_links` funnels
every row through `validate_business_link` — https only, no IP literals — and
`website_url` was separately client-writable and screened only for offensive
text. The identical string refused as a link row was accepted here and rendered
as a tappable button on the public page. One chokepoint or none.

**Deleting a business account deletes the place.** `businesses.owner_user_id` is
ON DELETE SET NULL, so the listing outlived the account that made it — name,
photos, posts, hours, links, ratings, chat. The Edge Function now deletes the
row (which cascades everything keyed on `business_id`), then its chat by hand
because that FK points the other way, and sweeps both business storage buckets.
A claimed launch venue goes with it, which is the right answer — the content on
it was theirs — and `seed_launch_businesses()` is idempotent, so restoring the
bare venue is one call.

**A verification photo is always taken, never chosen.** Both verification
screens capture through `src/lib/live-camera.ts`, which never imports
`launchImageLibraryAsync`, and a source-scanning test holds both of them plus
the helper. The selfie screen had a library fallback for a refused camera. It
read as a kindness and it was a hole: a selfie chosen from a camera roll proves
only that somebody owns a picture of a face, which is what a catfish has.

## A group chat's lifetime (2026-08-27)

`groups.max_stay_until` used to be one thing and is now two, and the founder's
rename is what forced the second: it had always been the cap on how far ahead a
JOINER could set their own departure date, and the label "Chat is active until"
promises it is the chat's own life. It is both now, and the promise is
enforced rather than printed.

**`group_closes_at(date)`** is the single definition: noon UTC on the day
after, and `'infinity'` for NULL. The noon is the decision. "Active through the
10th" has to hold until 23:59 on the 10th wherever the reader is, and the last
place on earth to finish its 10th is UTC-12 at 11:59 UTC on the 11th — so noon
UTC on the 11th is the earliest instant that is never early for anybody. It is
late by up to a day in the far east of the map, which is the right direction to
be wrong in: a chat that lingers beats one that cuts somebody off on a day the
app said was still theirs. IMMUTABLE, so a policy can call it.

Every date shown to a person is derived from that INSTANT in their own
timezone (`src/features/groups/closing.ts`), never from the date string plus
one. East of UTC+12 those disagree, and printing the string would name a day
the members can disprove from their own scrollback.

**NULL means no end date**, and it is NULL rather than a far-future sentinel
for a reason worth keeping: a CHECK constraint is satisfied unless it evaluates
to FALSE, so NULL passes the existing ceiling untouched while
`'infinity'::date` is rejected by it.

**What closing means**: `can_send_in_chat` refuses, which takes reactions with
it (their policy borrows it), and joining refuses. Reading does not change.
A closed group is exempt from `expire_room_members` and `archive_idle_chats`,
and that is load-bearing rather than tidy — the screen says "everything in it
is still here to read", and without those two exemptions a member's seat would
lapse a week later, `my_chats` would stop returning the group, and the invite
link would refuse them. The conversation would be gone, permanently, from the
app that had just promised it was readable.

**`groups_max_stay_sane` is deleted**, not edited. It was anchored to
`created_at`, so on a group older than 400 days there was no future date its
admin could legally set — including the one that reopens a closed chat. The
ceiling now lives in `create_group` and `update_group`, where a sentence can
live with it.

**`update_group` was dropped and recreated**, not replaced. Adding
`p_clear_max_stay` as a defaulted parameter creates an OVERLOAD, and a
six-argument call then matches both signatures and fails with "function is not
unique" — from every client at once. Named to match `p_clear_photo` one line
above it, since both exist for the same reason: NULL in that signature has
always meant "leave this alone", so turning a value OFF needs its own flag.

**`room_members.expires_at` is NOT NULL**, so the admin of an endless group
holds `'infinity'`, which PostgREST serialises as the literal string
`"infinity"` — truthy, and `new Date()` of it is `Invalid Date`. `finiteDate()`
is the guard; two screens rendered "you leave Invalid Date" without it.

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
delete-account`, and the step ORDER is load-bearing: verify the caller's JWT,
  clear both storage buckets, hard-delete their chats for both members
  (unmatch semantics), delete a business listing if they run one, **tell Apple
  to forget the account**, and only then delete the auth user — the FK graph
  cascades the rest, while `moderation_events` survive with
  `subject_user_id` nulled so the audit spine isn't erasable by deleting an
  account. Proven in `09_launch_hardening.test.sql`.
- **Sign in with Apple revocation** (App Review 5.1.1(v) again — an app that
  offers both Sign in with Apple and in-app deletion and never calls
  `appleid.apple.com/auth/revoke` is rejected). Apple hands out an
  authorization code exactly once per sign-in, good for five minutes and one
  exchange, so the refresh token has to be bought at sign-in and kept:
  - `public.apple_refresh_tokens` (`user_id` primary key, referencing
    `public.users` and cascading on delete) is **service-role only**: RLS on
    with deliberately no policies,
    and every grant revoked on top, because the row is a credential against
    somebody else's identity provider. Attacked in
    `35_apple_tokens_are_server_only.test.sql` and again from the live anon
    key in `tests/live/live-backend.mjs`.
  - `supabase/functions/store-apple-token` is the buyer: the app posts the
    authorization code, the function resolves the caller from their own JWT
    (never a user id in the body), signs the client-secret JWT with the .p8,
    exchanges the code, and upserts the refresh token with the service role.
    It fails soft with `stored:false` — a sign-in must not fail because a
    founder task is outstanding.
  - **The revoke must precede the auth delete.** `apple_refresh_tokens`
    cascades off `public.users`, so once the auth user goes there is nothing
    left to spend and the grant stays live under iOS Settings forever. It fails soft
    and logs which branch it took: a right to delete an account cannot depend
    on another company's endpoint being up.
  - The user-visible half: Apple returns a name and an email only on the
    FIRST authorization, so an account deleted without a revoke comes back on
    the next sign-up with neither, and no address to recover with.
  - **This is not the same thing as the sign-in working**, and the two get
    conflated constantly. The revoke needs a `.p8`; the Supabase Auth provider
    being ON with the bundle id in `external_apple_client_id` needs no key at
    all, and is what decides whether anybody can sign in with Apple in the
    first place. `supabase-deploy.yml` does both, from separate steps, and
    `.github/scripts/enable-apple-provider.mjs` carries the reasoning for why
    the client id is the bundle id (the app uses `signInWithIdToken`, and
    GoTrue matches the identity token's `aud` against that list) and why
    `external_apple_secret` is never sent.
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

## A pin that carries a group (2026-08-29)

A joinable pin is a pin that has a `groups` row pointing at it. That is the
whole of it — from the group's side it is an ordinary traveler group, with the
same messages, reactions, admin tools, invite link and moderation.

**The link points from the group AT the pin**: `groups.pin_id uuid references
public.pins (id) on delete set null`, with a partial unique index. It has to
be this direction. Pins are hard deleted — by `expire_pins` on its 15-minute
cron, by the poster taking one down, and at 72 hours because §7 rule 3 says so
— and a `chat_id` column on `pins` would take the conversation with it. On
`groups`, the pin burns out and the chat is still there, with `pin_id` null:
an ordinary group with no end date, reachable from the Chat tab and by invite
and no longer joinable from the map, because there is no longer a pin to tap.
That is the founder's explicit call.

**`post_joinable_pin` is one transaction, not two calls.** The client could
insert the pin (it holds the per-column grant) and then ask for a group, but a
failure between the two leaves a pin whose author ticked "anyone can join" and
which nobody can join — the one outcome with nothing honest to say about it.
Being SECURITY DEFINER bypasses the pins RLS policies, so `user_id` and
`seeded` are set explicitly rather than trusted; every BEFORE INSERT trigger
still fires, because a trigger does not care who is running the insert, which
is why none of `validate_pin`, `throttle_pins`, `guests_do_not_broadcast` or
the business refusal is restated there.

**Visibility stays keyed to the pin's OWNER.** `pins_select_visible` and
`city_pins` decide by `p.user_id`, and `join_pin_chat` asks the same question:
the pin is live, and `discovery_pair_ok(you, the owner)` holds with no block in
either direction. A joiner outside your audience therefore never removes a pin
from your map, and cannot. Founder's rule; there is a pgTAP assertion whose
only job is to fail if a later change re-keys it to the joiners.

**Its own daily budget.** `create_group` caps a person at five groups per 24
hours because a group row is durable and carries an invite link. An open pin
makes one too, so it is counted — in its own bucket (`pin_id is not null`, five
per 24 hours) with its own sentence, because `create_group`'s message is a
baffling thing to be told by a map. The pin ceilings (10 live, 30 created per
24h) apply on top.

`city_pins` and `public_city_pins` were DROPped and recreated with `chat_id`
and `crew`; both grants restated, and `public_city_pins` keeps `anon`. They
read the group through two small SECURITY DEFINER helpers (`pin_chat`,
`pin_chat_size`) rather than joining `groups`, because `city_pins` is
deliberately SECURITY INVOKER and `groups` is readable only by its members —
an invoker join would show a joinable pin as unjoinable to exactly the people
who have not joined yet.

## People you already know (2026-08-29)

One predicate, three doors. You **know** somebody if you share an active direct
chat (`has_accepted_chat`) or an active traveler group (`shares_group_with`).
Both are caller-scoped like every other relationship helper here: they bind
`auth.uid()` inside rather than taking a viewer, so no client can walk the
who-knows-whom graph.

Two exclusions are load-bearing:

- **Venue rooms are not groups.** Every predicate joins `groups`, not just
  `room_members`. A venue's room is open to anybody signed in, so "we are in
  the same room" there means only "we both tapped the same bar", and free
  direct messages out of one would be a stranger-messaging channel with the
  say-hi gate removed.
- **Guests are neither end of it.** An anonymous account can talk in a group it
  was let into and that is all: it cannot be searched, added to a second group,
  or open or receive a one-to-one chat. Same reasoning as
  `message_requests_no_guests`.

The doors are `people_you_know(query)`, `add_to_group(chat, user)` — any
member, not only the admin, because the invite link was always copyable by
everyone — and `open_direct_chat(user, first_message)`.

Two consequences worth stating plainly, because both are deliberate and both
make an older sentence in this document false:

- **`people_you_know` is not audience-filtered.** The audience setting governs
  discovery — the map and Travelers — and has never governed chat ("anyone can
  say hi, and anyone in a group with you can write to you directly", in the
  picker's own words since the group-consent copy pass). Somebody you are
  already in a chat with is not a discovery result, so narrowing your audience
  does not remove you from the address book of people you have already talked
  to.
- **Adding somebody to a group is a new privilege level, not just a new
  mechanism.** `group_invite_token` refuses a non-moderator, so before this an
  ordinary member had no way at all to bring anyone in. `add_to_group` gives
  them one, deliberately and on the founder's instruction, bounded by having
  to already know the person.

**The guest map stays faceless, open plans included.** `pin_crew` is the one
surface here that could have leaked identity to an anonymous account — it
answers for anybody holding `authenticated`, which a guest does — so it
returns nothing for a guest (`20260829140000`). A guest can still JOIN an open
plan and see the room from inside, the same as a group they hold a link for:
that is a membership row somebody can see and an admin can remove, capped at
ten, which is the difference between accountable and a free roster read.

### The two §7 rules this touches

**Rule 4, handles never visible pre-accept.** There is no accept on this path,
and a direct chat with two `chat_participants` rows is precisely what unlocks
handles. So the gate moved rather than widening. `chats.opened_from_room` marks
a chat opened this way, and the `social_handles` policy now calls
`handles_unlocked_for`, which for those chats additionally requires **both**
people to have sent a message. That is stricter than the single tap it replaces
— accepting a request is one person tapping once — and every chat that exists
today has `opened_from_room = false` and is unaffected. `has_accepted_chat` is
deliberately left alone: its other callers ask "do these two already have a
conversation", and for a room-opened chat the honest answer is yes.

**Rule 5, every first message passes moderation.** With no accept step to hold
a bad first message behind, `open_direct_chat` runs `screen_first_message`
synchronously and a blocked verdict creates nothing at all — no chat, no
participants, nothing to release later. That is exactly `message_business`'s
shape, for exactly the same reason.

## A business is not a traveler, on both sides (2026-08-30)

Two migrations, two days apart, carry the whole of §7 rule 8 for a business
account. Before them the rule lived in the screens, and the anon key is in the
app bundle, so a hidden button was never a rule.

**`assert_not_business(p_what text)`** (20260829190000) is the single refusal
point for DOING a traveler thing. It is called from `join_room`,
`join_pin_chat`, `create_group`, `post_joinable_pin`, `set_visibility` and
`open_direct_chat`, and a `pins_owner_is_a_traveler` BEFORE INSERT trigger
covers the table itself. The message names the act, so a refusal that does
reach somebody reads as a sentence rather than as a stack trace. The departure
date the founder objected to is `join_room`'s second argument, so guarding the
join is what removes the question.

**`viewer_is_business()`** (20260830000000) is the single refusal point for
READING a traveler. It sits in the WHERE clause of `city_pins`,
`traveler_trips`, `pin_crew` and `featured_traveler`, each of which returned a
traveler's identity to any authenticated caller. All four now return zero rows
to a business, which is why the client points a business at
`public_city_pins`: the faceless feed is what a business is meant to read, and
the server no longer has an identity-carrying one to offer it.

Deliberately left open: `heat_cells`, which carries no identities and never
draws a cell under the k-threshold. How busy a street is on a Friday is a fair
question for the business whose street it is. And `get_matches`,
`daily_spotlight` and `people_you_know`, which all start from the caller's own
trips, chats or groups — a business has none of those, so a predicate there
would be a comment pretending to be a guard.

The same migration answers two questions the room screen could only guess at.
`business_for_chat` matched `kind = 'business'`, the DM a traveler opens from a
listing, so a business's own PUBLIC room (`kind = 'room'`) resolved to nothing
and the screen could not tell the owner they were in their own chat. And
`my_chats` set `my_role` off a `groups` row, which a business room does not
have, while `is_room_moderator` had answered true for the owner since
20260827160000 — so the one person who runs a room was handed "Report" where
"Remove" belongs. Both are answered server-side now rather than derived.

## Support (Phase 10)

The in-app contact form writes into `support_messages` and the row is the
record: delivery is only the notification, so an unconfigured or failing
mailer cannot lose a safety report. The table has an insert policy for `anon`
as well as `authenticated` — somebody who cannot sign in is the person most
likely to need support — with per-address and global hourly limits enforced by
a trigger, and no select policy for anyone.

Two delivery channels, either or both:

- **Email.** A cron'd `support-mailer` Edge Function sends undelivered rows
  through Resend. Needs the `RESEND_API_KEY` secret; `SUPPORT_INBOX` is pinned
  to `hello@samewhere.io` in the deploy workflow (2026-08-31 — it is a public
  address, not a secret). Without the key the worker returns
  `{skipped: 'not configured'}` and changes nothing.
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
- **Sign in with Apple adds four**, same rule and the same place: `APPLE_TEAM_ID`,
  `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (the **bundle id** — the Services ID is
  for the web) and `APPLE_PRIVATE_KEY` (the .p8 contents). Read by
  `supabase/functions/_shared/apple.ts` and by nothing else; `appleConfig()`
  returns null when any is missing, which is what makes both Apple functions
  degrade instead of throwing. **They are synced by the deploy, not by hand**
  (2026-09-03): `supabase-deploy.yml`'s "Sync Sign in with Apple secrets" step
  maps `APPLE_SIGNIN_KEY_ID` → `APPLE_KEY_ID` and `APPLE_SIGNIN_KEY_P8` →
  `APPLE_PRIVATE_KEY` from repository secrets, takes `APPLE_TEAM_ID` from the
  one `testflight.yml` already uses, and carries `APPLE_CLIENT_ID` as a literal.
  The `APPLE_SIGNIN_` prefix keeps it away from `ASC_KEY_ID`, which is the App
  Store Connect API key and a different key entirely. Recipe, and the hand
  equivalent, in docs/APP_STORE.md.
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

## The URL space the app claims (2026-08-30)

`ios.associatedDomains: ["applinks:link.samewhere.io"]` means iOS hands the
app every path the association file declares, for the life of every install.
expo-router registers `prefixes: []`, has no `getStateFromPath`, no
`+native-intent`, and route groups compile to optional segments — so an https
URL is reduced to a bare path and matched against `src/app` with NO host
check. The association file is the only gate, and an unmatched path lands on
`+not-found`.

So the two lists must agree, and there is a test that says so
(`src/app/__tests__/invite-links.test.ts`):

| Declared | Route                                                        | Page               |
| -------- | ------------------------------------------------------------ | ------------------ |
| `/i/*`   | `src/app/i/[token].tsx` (the join-group screen, re-exported) | `web/i/index.html` |

The route re-exports the join screen rather than redirecting to it: a
`router.replace` from a focus effect is exactly the navigation the root hold
loses when it unmounts the stack (src/features/auth/routing.ts), and a route
that IS the destination cannot be lost that way. `src/app/i/index.tsx`
answers the bare `/i`, which `/i/*` also matches and a dynamic segment does
not.

`/b/*`, `/c/*` and `/u/*` were declared ahead of their features and dropped
before the first build claimed the domain. Adding one later is an AASA edit
plus a JS route — an over-the-air update, never a new build — so nothing was
lost. `/u/*` also stays out until the §7 rule 4 question is answered: a
public profile page may never render social handles.

`/reset*` is deliberately absent. `PASSWORD_RESET_REDIRECT` is
`samewhere://reset-password`, so Supabase's `/auth/v1/verify` 302 hands the
tokens straight to the app; `link.samewhere.io/reset` is not on that path at
all. Declaring it would only fire for a forwarded URL or a link-rewriting
mail gateway, and there it would replace a working Safari bounce with a
burned single-use token. `parseRecoveryLink` is widened to recognise the
hosted `/reset` spelling anyway, as the net under exactly that window — a
stale association file on Apple's CDN, a forwarded mail — so a token that
does arrive that way is spent on a working reset instead of on +not-found.

`applinks:` is iOS only. Android needs its own two pieces before an invite
can open the app there: `web/.well-known/assetlinks.json` naming the release
signing certificate's SHA-256 fingerprint, and `android.intentFilters` in
`app.json` (`{"action": "VIEW", "autoVerify": true, "data": [{"scheme":
"https", "host": "link.samewhere.io", "pathPrefix": "/i/"}], "category":
["BROWSABLE", "DEFAULT"]}`). Until both exist, an Android invite opens
Chrome and the only way in is the "Open in Samewhere" anchor on
web/i/index.html — the paste fallback does not help there either, because
`Alert.prompt` is iOS-only and the Android branch shows an alert with no
input.

## Language and locale (2026-08-31, decision D5)

**The app's strings are English, everywhere, for v1. The traveler's own dates and times
are to follow their phone.**

Two different questions were being answered by accident, and the answer to the second one
was "whatever each formatter's author felt like":

- **Strings** stay English. Four launch markets are not four translations: a v1 with no
  users does not have the evidence to spend a translation budget, and a half-translated
  app reads worse than an English one. The App Store LISTING is localised for pt-PT,
  es-MX, th and id (docs/APP_STORE.md), because listing metadata is per-territory, needs
  no build, and "travel friends" and "amigos de viagem" are different search markets.
- **Dates, times and the week's first day are to follow the phone.** Eleven formatters are
  pinned to `Intl.DateTimeFormat('en', …)` while six follow the device, so a Portuguese
  phone shows "agosto 2026" as a calendar header and "Aug 30 to Sep 2" in the summary
  directly beneath it. Chat times are locked to 12-hour AM/PM worldwide while business
  hours in the same app are 24-hour. That is the rule this decision sets, not a description
  of the app today.

`src/lib/locale.ts` is where the phone is asked, and the only place it should be:
`DEVICE_LOCALE`, `DEVICE_LOCALE_TAG`, `DEVICE_LANGUAGE`, `USES_24_HOUR_CLOCK`,
`FIRST_WEEKDAY` and `DEVICE_TIME_ZONE`, read once at module load from `expo-localization`
and frozen for the process. Anything that formats a date or a time is to take its locale
from there rather than naming one.

**"Should be" is now enforced**, by `src/lib/__tests__/one-clock.test.ts` ("the phone is
asked from exactly one place"): any file under `src/` other than `lib/locale.ts` that
imports `expo-localization` fails the test. It was added the day after
`src/lib/device-locale.ts` became a second caller, carrying a near-verbatim copy of
lib/locale's own widening rationale, with neither this section nor that file's own "this
file is the one call site" comment updated. Nothing stops a file from READING the phone's
language — the rule is only that it asks lib/locale for it rather than the device.

`DEVICE_LOCALE_TAG` is that same answer with no fallback, and the split is deliberate. A
formatter must have some locale, so `DEVICE_LOCALE` guesses `'en-US'` when the phone says
nothing and nobody is harmed. The tag written to `profiles.locale` — which decides what
language a moderation verdict about somebody's face or somebody's livelihood comes back in
— must not guess: null there means English silently, and a guessed language is a rejection
written in a language the reader may not have. `src/lib/device-locale.ts` is that write,
and after 2026-09-03 it holds only the write, its once-per-launch guard and the column's
16-character ceiling.

**What is actually migrated is tracked in the test, not here.** `clocks()` and `dates()`
have production call sites now — chat separators and business hours both take their clock
from `lib/locale`, which is what closed the two-clock bug. The files that still name a
locale of their own live in `ADOPTION_OUTSTANDING` in `src/lib/__tests__/one-clock.test.ts`,
a debt a file may leave and nothing may join. That list is the live one; a list written out
here would go stale, and the one that used to be here did. `cityClockNow`
(`features/pins/pin-helpers.ts`) names `'en-US'` on purpose and must keep it: it reads the
formatted parts back by name to build a Date, so it is machine parsing rather than display,
and the guard exempts `.formatToParts` for exactly that reason.

**Expiry condition.** Revisit the English-only strings decision when a non-English launch
city is added, or when a launch market's retention lags the others by enough to suspect the
language. Until then this is a decision, not an omission, and it does not need re-deriving.

**RTL is not handled.** Every directional style in the app is physical (`marginLeft`,
`textAlign: 'left'`) rather than logical (`marginStart`, `'start'`). That is harmless while
no RTL locale is declared and becomes a forty-file retrofit the day one is. Adding Arabic or
Hebrew to the listing is not a metadata change; it is that retrofit first.

## Wave 2 backend: four migrations (2026-09-01)

One enum, one table, one admin view, one column and five functions landed in one change.
They are recorded here because nothing else in the tree says what they are for.

### `trips.approximate` — a window that is a guess (20260902230000)

A traveler who does not yet know their dates could not post a trip at all: the calendar
wants two specific days and Post trip stays off until both land. `approximate boolean not
null default false` marks a window as a guess. **The dates stay real dates** — the widest
range the traveler stands behind, still under the table's 365-day check — and the flag is
the fact that they are not a claim. `rangeForRoughDates` (client, `features/trips/dates`)
is the single rule that turns "a month, roughly this long" into those two dates, so the
picker, the profile and any future overlap query cannot each invent their own.

Who consults it, decided one reader at a time:

- `traveler_trips()` carries it as an OUT column (the function was dropped and recreated —
  `create or replace` cannot add an OUT column to a `RETURNS TABLE`), so a profile card can
  read "Around Sep 1 – 30" instead of printing a guess as a fact.
- `push_trip_starts_tomorrow()` **excludes** rough trips, and excludes them from its
  overlap population count. "Lisbon tomorrow" on the first day of a window somebody
  described as "probably most of September" is the app inventing a travel date. The count
  goes out under the heat-k rule (§7 rule 6) and a disclosed population must not be padded
  with windows nobody committed to; excluding can only make the number smaller, which is
  the safe direction for a k-threshold.
- `get_matches()`, `overlaps_own_trip()`, the `trips_select_overlap` policy and
  `featured_traveler()` are **untouched, and that is an open founder question rather than
  an oversight** — whether a rough trip matches at full weight, is de-ranked, or is
  excluded decides how wide a rough window's read access to other people's trips is
  (`docs/UX_PACKAGES.md`, prof-rough-trip-dates "Waits on"). Until it is answered, the
  column ships defaulted false and every existing row behaves exactly as before.

Two consequences worth keeping in mind. `trips` carries column-level UPDATE grants, so the
migration grants `update (approximate)` — without it a rough trip could be posted and never
corrected. And the overlap sentence (`features/matching/overlap`) still states exact days,
because get_matches has no flag to hedge from and the window it prints is an intersection
of two trips of which either may be rough; the file records why it cannot be hedged on one
surface alone.

### `chat_meet_answers` + `meet_answer` + `admin_meet_answers` — the met-in-person rate (20260902240000)

§6's most important number ("did you two end up meeting") had no source. This is it, and it
is the most §7-sensitive thing added since social handles, because it is one keystroke away
from being a rating of a person.

The shape follows from that. One row per (chat, participant), answered once and never
updated or deleted — no update policy, no delete policy, no grant for either verb. Selects
are scoped to the author's own row; `meet_prompt_due()` reads nothing of the other
participant's answer, **including whether one exists**, because a prompt that stopped being
due once the other person answered would publish their answer perfectly in a boolean. That
is the reciprocal-interest rule (§1) in a place it is easy to break by accident.

The write publishes nothing sideways either: its own table, no trigger of any kind, foreign
keys only, and deliberately NOT in the `supabase_realtime` publication — a broadcast on
insert is a live tell to anyone watching the chat's channel. This is the direct lesson of
20260902220000, where a date written to an ungranted column still leaked a presence feed by
tripping the parent row's `updated_at` trigger.

`admin_meet_answers` is months, answers and distinct people, service-role only. Never a
chat, never a pair, never a name — the rate is the metric, the row is not. Distinct people
sits beside answers because one traveler answering both sides of their trip is not two
meetings.

### `my_report_status()` and `my_support_messages()` — what became of what you sent (20260902250000)

A reporter used to hear a thank-you and then silence, and concluded the app does not
moderate. Both records already existed and neither was readable: `reports` grants the
reporter every column except `status`, and `support_messages` has no select policy at all.
So both answers are SECURITY DEFINER functions, revoked from `anon`.

**The state is binary on purpose.** `reports.status` is `open` or `resolved:<action>`, where
the action is one of dismiss, warn, strike, suspend, ban, shadowban. A three-value state
with "action taken" in it IS a moderation outcome about another person, published to
anybody willing to file a report to find out — which makes the queue a scoreboard and the
reporter a spectator at somebody else's punishment. A dismissal and a ban come back byte
identical, and pgTAP 62 asserts that rather than assuming it.

A report about a BUSINESS is a report: `business_reports` is unioned in under the same
mapping, so somebody who reported a bar for how its doorman behaved does not read "Nothing
sent yet" on the page built to end that silence. Its five resolutions collapse to the same
word for the same reason.

Both functions only read. The `user_id is not null` half of each owner test is belt and
braces and is documented as such — the equality already excludes a null-author row, because
`null = null` is NULL rather than TRUE — and it is kept so that a later rewrite of the owner
test cannot quietly turn "no match" into "matches everybody's".

### `featured_traveler(int)` returns three (20260902260000)

The guest Travelers tab renders a lead card plus two rows against a function that ended in
`limit 1`. This is a **real widening** — three strangers' faces now reach a signed-out
device where one did — so every previous guard is restated unchanged, `is_blocked_pair` is
added, and what each row carries shrinks.

Three things a count breaks that one did not: one traveler with three windows in the same
city could fill all three slots (`distinct on (t.user_id)` in a subquery, because
`distinct on` needs its expressions to lead the ORDER BY and the ranking is a different
order); the order had no tiebreak, and the card and the photo are two separate calls to
this function, so a tie meant the two calls returned different PEOPLE (`f.user_id` last
makes the order total, and discloses nothing the client does not already receive); and the
photos are keyed by user_id rather than by list position, which is what keeps a face off
the wrong name when the two calls disagree anyway.

### `profiles.updated_at` stamps only for an edit (20260903020000)

The second presence leak through the same column in two days, and the fix is a different
SHAPE rather than one more exception.

`profiles` carries a BEFORE UPDATE trigger that stamps `updated_at = now()`, and
`updated_at` is in the client select grant behind `profiles_select_visible`, whose only
predicate is that the account is active. So any write the app makes for its own bookkeeping
publishes `select user_id, display_name, updated_at from profiles order by updated_at desc`
— every active traveler ranked by when they last opened the app, which is the presence
signal §7 rule 2 bans. 20260902220000 closed that for `touch_last_seen()` with a WHEN clause
naming `last_seen_on`. 20260903010000 then added `profiles.locale`, written once per launch
from `use-auth-listener`, and the leak was back — at launch granularity rather than the
daily one, because the locale write has no once-a-day guard.

**The client cannot fix it.** `locale` is deliberately not in any select grant, so the app
cannot read the value back to skip a redundant write.

**And extending the deny-list would not have fixed it either** — measured, not reasoned.
`and new.locale is not distinct from old.locale` reads a same-value rewrite as "locale did
not change", so the WHEN passes and the row is stamped exactly as before; it would have
suppressed only the rare launch after somebody changed their phone's language. So the clause
is inverted: it names the columns that ARE an edit (the profile's own content, the
verification state, the two audience settings) and stamps only when one of those changed.
A column added tomorrow is not on that list, so by default it stamps nothing and publishes
nothing. Forgetting now costs a stale timestamp nothing in the app reads; forgetting before
cost a presence feed.

`supabase/tests/database/64_only_an_edit_earns_a_stamp.test.sql` asserts the attack, the
counter-case (a real edit still stamps, including one that travels in the same statement as
a locale write), and a classification of **every** column on the table: each one either
appears in the trigger's list or on the bookkeeping list in that file, so a nineteenth
column fails a test until somebody decides which it is. It also documents the trap that made
its predecessor useless: `now()` is the transaction timestamp and a pgTAP file is one
transaction, so comparing a stamp against one captured a few statements earlier compares
`now()` with `now()`. `59_bookkeeping_is_not_presence` did that and passed with its own guard
deleted; both files now park `updated_at` in 2020 with the trigger disabled and ask whether
it moved.

**The end state, for whoever meets this a third time:** `revoke select (updated_at) on
public.profiles from authenticated`. The trigger only has to be careful because the column is
bulk-readable, and no screen reads its value. It cannot be done in one migration —
`PROFILE_COLUMNS` names `updated_at` in every profile query the installed builds make, and
Postgres refuses a select naming a column the role cannot read, so every profile screen on
every phone in the wild would answer `permission denied` the moment it deployed. The order
is: drop it from `PROFILE_COLUMNS`, ship that, let it reach the builds, then revoke.

**And this section asked its question of one of the four triggers on the table.** The next
one down had the same shape and a worse consequence — see 20260903030000 below, which also
carries the inventory so a third does not have to be found the same way.

### A trigger on `profiles` does nothing persistent until an edit moved (20260903030000)

The same launch write, the **other** trigger on the same table, and this one is not a leak —
it locks somebody out of their own profile.

`profiles` carries four triggers and 20260903020000 asked its question of one of them.
`profiles_screen_text` (20260817150000:210) is attached with no `when` clause, and the first
two statements of `screen_profile_text()` ran on **every** update of the row, before it had
looked at whether any text changed: it raised `daily profile update limit reached` once
thirty `(entity_type='profile', action='updated')` `moderation_events` rows existed for the
account in 24 hours, and then filed one more of exactly those rows.

So the once-per-launch `locale` write and the once-a-day `touch_last_seen()` each spent a
unit of a safety rate limit and filed a dated audit row. **After thirty cold starts in a day
the account could not update its own profile at all** — the cap is counted before the insert
and raises for the whole statement, so `updateOwnProfile`, the `onboarding_completed_at`
write that is the single fact making somebody discoverable, `set_visibility()`,
`set_group_adds()`, `set_listing_intent()`, the display-name mirror on a business rename and
`apply_verification_verdict` all raised. Thirty launches is a bad travel day on a flaky
connection.

**Is the audit row itself a leak? No, and it was established rather than assumed.**
`moderation_events` has RLS on with no client policy, is revoked from `anon` and from
`authenticated` (20260816190000:252, :336, :374) and appears in no view or callable function,
so the per-launch record was server-side only — not the bulk-readable presence feed
20260903020000 closed, and not a §7 rule 2 breach. It was still a behavioural record the
product never decided to keep, in the table whose purpose is moderation decisions. Both
halves went.

**The fix is inside the function, not a WHEN clause on the trigger, and the asymmetry with
its sibling is deliberate.** `set_updated_at()` has no opinion of its own, so the WHEN clause
_is_ the whole logic and there is nowhere else for it to live. `screen_profile_text()`
already contains the exact condition — it is the condition that decides what gets screened —
and a copy of it on the trigger would make two lists of screened columns that must agree.
They would drift in the dangerous direction: adding `occupation` to the text this function
screens means adding it to the `if` in the body, and the WHEN clause upstairs would then
silently stop the screen running for an occupation-only edit. That is a moderation control
failing **open**. One condition now guards all three things: screen the text, count the edit,
file the row.

The cap's meaning gets narrower and truer. Its author wrote it as text velocity
(20260817150000:171) and `screen_profile_text` is the only writer of the rows it counts; it
was never a general profile-write throttle, it was a text-edit throttle that happened to be
counting launches.

**Every trigger on `profiles`, because the third must not cost another round.** Two columns
and then a second trigger each had to be discovered separately by somebody re-asking the same
question, so the answers are written down and
`supabase/tests/database/65_only_an_edit_spends_the_cap.test.sql` asserts the list — a fifth
trigger fails a test until whoever adds it has classified it, the same job assertion 9 and 10
of `64_only_an_edit_earns_a_stamp` do for a new column.

- **`profiles_updated_at`** (BEFORE UPDATE, WHEN edited-columns) — nothing, since 20260903020000.
- **`profiles_screen_text`** (BEFORE UPDATE, no WHEN) — nothing, since 20260903030000. Was a
  unit of the cap and a dated audit row.
- **`profiles_reset_visibility`** (BEFORE UPDATE **OF** `verified`) — nothing, twice over.
  `update of` fires only for a statement that names that column, and `verified` is not in the
  client update grant, so no client statement can name it. The body then no-ops unless the
  badge actually went away, and its only effect is on the row's own `visible_to`. It does
  fire now — from `profile_photos_badge_follows_the_face` (20260904100000), the one writer
  of `verified = false` — and that is a real consequence of losing a badge, not bookkeeping.
- **`profiles_guest_minimal`** (BEFORE UPDATE, no WHEN) — nothing, but for a weaker reason
  worth knowing. It does run in full on every update, and it is harmless only because it is a
  pure assertion: no row, no stamp, no counter, and it reads only NEW, which for a
  bookkeeping write is unchanged from OLD. Give it a counter, a stamp or an insert and it
  becomes 20260903030000 again.

**The rule the next person needs, in one line:** a BEFORE UPDATE trigger on `profiles` must
either be scoped to the columns it cares about, or do nothing persistent until it has
established that one of them changed.

### `user_muted_words` takes adds and removals, not edits (20260903000000)

The table was granted all four verbs behind one `for all` policy while
`src/lib/database.types.ts` declared its `Update` as `never` and the client only ever
inserted and deleted — three sources of truth, two of them disagreeing, on a safety table.
Resolved toward least privilege: `update` is **revoked by name** (Supabase's default
privileges had already handed it to `authenticated`, so merely omitting it from the grant
list would have taken nothing back), and the `for all` policy is split into select/insert/
delete so the catalog says the same thing as the grant.

The split alone would not have been enough, and the measurement is the point: with no UPDATE
policy on the table, RLS does not refuse an update — it matches no rows, so the statement
reports success and changes nothing. `63_words_i_would_rather_not_see` asserts the refusal
from both a stranger and the owner, plus the privilege set itself, because a silent zero-row
update is not a refusal anybody can see.

## Three closures before the build (2026-09-02)

The founder asked for the one EAS build the native changes have been waiting on, and for
everything else to land first so the build is the last thing that moves. Three things were
open. Each is recorded here with the entry point of every piece, because the failure this
project keeps paying for is a capability with nothing on the other end of it.

### `admin_verification_queue` and `admin_business_verification_queue` (20260903040000)

`reason_en` became required on both verdict schemas on 2026-09-01 so that a rejection
written in the subject's own language stays adjudicable. The storefront half had a reader
(the `uncertain` mail quotes it); the selfie half was written into
`verification_requests.verdict` and read by nothing. Two views now exist, modelled exactly on
`admin_report_queue`: a service-role surface for the SQL editor, `reason` and `reason_en`
side by side, `revoke all ... from anon, authenticated` on the line after each `create`.
No RPC, no client, no `admin_resolve_verification` (re-running a verification is a separate
decision with consequences for `profiles.verified`).

**The revoke is the whole security of the file**, and the local shim mirrors Supabase's
default privileges (`local_supabase_shim.sql:98`), which is what lets
`66_a_verdict_the_founder_can_read` prove it: with either revoke deleted, the two refusals
for that view come back "lives" instead of `42501`. With the `->> 'reason_en'` expression
replaced by `null`, the "not a silent null" assertion fails on that view. All four mutations
were run.

### A group's own photo is checked before anybody but its uploader sees it (20260903050000)

`src/features/groups/api.ts` recorded the gap on 2026-09-01: a photo posted INTO a chat is
moderated through the `messages` row it creates, but a group's OWN picture is a column on
`groups`, written by `create_group`/`update_group` with no trigger, so it reached every
member and every invite holder unchecked. `app.json`'s camera string had promised Apple that
every photo is checked first; it was narrowed to "profile photos and chat photos" the same
day (cc82431) because this gap made the wider sentence untrue, and a group photo is neither.
Closed the way business photos (20260829180000) and post photos (20260902170000) were closed,
so the wider sentence could be restored if the founder chooses:

| Piece                                                           | Entry point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups.photo_status` (nullable)                                | set by the trigger; read by `my_chats`, `group_invite_preview`, `group_detail`, the `chat_photos_select_group` storage policy (through `can_view_group_photo`), and `src/features/groups/photo.ts`. Granted to no client role since 20260903130000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `groups_moderate_photo`                                         | `BEFORE INSERT OR UPDATE OF photo_path`; early-returns when the path did not move, so a rename or the worker's counter costs nothing persistent (the profiles rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `groups_poke_moderation_insert`, `_update`                      | poke the worker on a pending photo, so the admin watching "Checking this photo" waits seconds, not a cron minute. Two triggers: the UPDATE one is guarded on `old.photo_path is distinct from new.photo_path`, because `update_group` names `photo_path` on every call and a rename while a photo was pending poked the worker (a `worker_pokes` write and an HTTP request: persistent). A WHEN clause on an INSERT OR UPDATE trigger cannot mention OLD, which is why it is two                                                                                                                                                                                                                                                                           |
| `apply_group_photo_verdict(p_chat_id, p_photo_path, p_verdict)` | walked through by `moderation-worker/index.ts` queue 3d, with its own 4s slice of the 50s tick; `moderation-worker-queues.test.ts` fails if a door has no caller. Keyed on the chat AND the path the worker classified: a group is one row, so a verdict keyed on the chat alone would land on whatever photo the row wore by the time it arrived (the admin replaces the picture mid-classification, the trigger sets the new path pending, an allow approves a photo nobody looked at). Returns `false` and writes nothing when the group no longer wears that photo; the worker reports it as a note, not a failure, so the counter of the replacement is not bumped for a try it never had. The failsafe goes through the same door with the same path |
| `note_group_photo_attempt`                                      | the counter that makes MAX_ATTEMPTS reachable; the failsafe removes the photo (engine `failsafe`) rather than leaving it pending                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `chat_photos_select_group`                                      | now approved-only; the uploader keeps reading their own upload through `chat_photos_select_own`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `update_group`                                                  | `p_clear_photo` also clears `photo_status`, so an admin told "pick another" can choose no photo and the notice goes with it. Sent by the group page's photo control: tapping the tile opens a sheet, "Change photo" / "Remove photo" while a picture is up, "Pick another photo" / "Go without a photo" after a refusal (`groupPhotoActions` in `photo.ts`; `photo.test.ts` holds that the page maps `remove` onto `clearPhoto: true`). For a day this branch was a documented escape no screen could take                                                                                                                                                                                                                                                 |
| `my_chats`, `group_invite_preview`                              | restated (same OUT columns, `create or replace`): the path is handed out only when approved or the reader uploaded it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/features/groups/photo.ts`                                  | `groupPhotoView(group, ownUserId)`: the one client reading of the two columns together. `groupView(row, ownUserId)` is the row with `photo_path`, `photo_status` and `moderation_attempts` REMOVED and `photo: GroupPhotoView` in their place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `useGroup`                                                      | hands screens `groupView(...)` through react-query's `select`, so no screen can spell `.photo_path` on a group row however it binds it: the property is not on the object, and typecheck is in the gate. `photo.test.ts` also confines `GroupRow`, `fetchGroup` and `.from('groups')` to `api.ts`, `hooks.ts` and `photo.ts` (a `Pick<GroupRow, ...>` that leaves `photo_path` out is allowed: the celebration hook reads `photo_status` off the query cache). Polls every 5s while the raw row is pending, and stops on its own; without it the page said "checking" until it was left and reopened                                                                                                                                                       |

**Who sees what.** Approved: everyone in the group. Pending: the person who uploaded it and
nobody else (their own upload is readable to them regardless, so withholding it would hide
nothing and leave the person who chose the picture looking at an empty frame). To everybody
else a pending photo is NO photo, not a photo being checked: the first version of the page
told every member "A new group photo is being checked." and then, on refusal, nothing, so any
member could infer the admin's picture was refused. A verdict is for its subject alone.
`groupPhotoView` answers `none` for a non-uploader while a photo is pending, the tile draws
the glyph, and the only "checking" sentence, veil and spoken label are the uploader's — and
since 20260903130000 that answer is the server's, not the client's (below).
Rejected: nobody; the verdict removes the path and leaves the status so the group page can
tell the admin "That photo was not approved and has been removed. Pick another." Not a
strike: the ledger action is `group_photo_rejected`, which `is_strike_action` does not count,
and the test asserts the uploader's strike count stays at zero.

**The setter is the path.** Every group photo is uploaded into the uploader's own folder
(`chat_photos_insert_own` enforces it), so `split_part(photo_path, '/', 1)` is who set it,
and that is what the RPCs compare against `auth.uid()`. The trigger now requires it. Before
this migration `create_group` accepted any string as `p_photo_path`, which meant an admin
could name any object in the bucket they had learned the path of and
`chat_photos_select_group` would let every member read it. Your own upload, or nothing.

**Deploy window, established rather than assumed** (for 20260903050000; 20260903130000 took
the table-wide grant away and has its own, below). A phone on the previous bundle reads
`groups.photo_path` through `select *` (table-wide grant, so the new columns ride in unread)
and holds, for an unapproved photo, a path the bucket refuses to sign; `useChatPhotoUrl`
errors and the tile falls back to the group glyph, which is what a group with no photo draws.
The uploader still sees their own picture, with nothing said beside it. The chat list and the
invite screen read RPCs, and both mask server-side, so the old bundle draws the glyph there
too. Existing rows with a photo were put through the same check a new photo gets.

**Worker budget.** The ninth slice was paid for by trimming four others (chat photos 9 to 8,
messages 11 to 10, post photos 5 to 4, scans 4 to 3), not by raising the tick: 50s against a
cron that fires every minute, and a tick that overran would have the next one classify the
same rows twice. A slice is a floor, not a ceiling. The sum is still held at 50s by the test.

**What was NOT done, and why.** The chat list row (`src/features/chat/chat-row.tsx`) shows
the uploader their own pending photo with no "checking" beside it; saying so there would
need a `photo_state` OUT column on `my_chats` and a reader in that file, and a column with
no reader is the orphan pattern. The invite screen (`src/app/join-group/[token].tsx`) was
another agent's this round and needs **nothing**: the RPC masks the path server-side, so
its `photoUrl` is null for everyone but the uploader of an approved-or-own photo, and the
frame already falls back to its glyph. If it ever wants to say "checking" to the uploader,
it would need the same `photo_state` column on `group_invite_preview`, which would be an
OUT-column change (drop, recreate, restate both grants).

**Seen in passing, not fixed.** `apply_business_photo_verdict` and
`apply_business_post_photo_verdict` record a refusal as `photo_rejected` against the
owner's `subject_user_id`, and `is_strike_action('photo_rejected')` is true, so a business
owner's rejected photo DOES count toward the strike ledger that suspends accounts, while the
migration comments beside them say "explicitly NOT a strike". Out of this round's files;
recorded in PROGRESS.md for the founder.

**Every pgTAP assertion in `67_a_group_photo_is_checked` was run against the mutation that
removes what it names**, twice. The second pass (2026-09-02) added the race written as the
attack (the door's path guard removed: the stale allow lands on the replacement, tests 24,
25, 27, 30, 32, 33), the poke guard (removed: 'and does not poke the worker' alone), and the
attempts reset in the new-picture branch, which the first pass had asserted through a clear
that zeroed the counter on the way (the null-path branch's reset), so the assertion passed
with the line it named deleted; it now replaces a photo with three failed attempts on it and
no clear in between, and fails 46 and 47 under that mutation. The file's header carries the
full record, mutation by mutation, downstream failures included. `68`'s first assertion had
the same shape of hole: "an edit stamps updated_at" compared `now()` against a row
`register_business` had inserted with default `now()` in the same transaction, so it passed
with the stamp line deleted; it parks the stamp in 2020 first now (2 and 11 fail with the
stamp deleted), and its header's mutation record was rewritten to what actually happens
with the guard removed (3, 5, 7, 8, 12 fail: the verdict UPDATE raises 23514 inside
`lives_ok`, so the stamp assertion after it passes and the two failures the old record
named could never happen in one run).

### A verdict is for its subject alone, at the table (20260903130000)

20260903050000's header says a pending group photo is "the person who uploaded it, and
nobody else... To everybody else there is NO photo, not a photo being checked", because a
member who could watch "being checked" become nothing would know the picture was refused.
The PATH half was enforced — `my_chats`, `group_invite_preview` and
`chat_photos_select_group` all mask it. The STATUS half was enforced by
`src/features/groups/photo.ts` and by nothing else. `grant select on public.groups to
authenticated` (20260821010000:42) is TABLE-level and `groups_select_member` admits every
member of the room, so:

```sql
select photo_status from public.groups where name = 'Porto crew';  -- 'pending'
-- and, seconds later
select photo_status from public.groups where name = 'Porto crew';  -- 'rejected'
```

Those two reads are the forbidden inference, and they need an anon key and the group's name,
not the app. `67_a_group_photo_is_checked` did not catch it because every `pg_temp.status()`
call in it asserts the VALUE, never a refusal, so deleting the client guard failed nothing.
Client code is UX; Postgres is the boundary.

| Piece                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the column grant                    | `revoke select on public.groups from public, anon, authenticated`, then `grant select (chat_id, created_by, name, speaking, invites, max_stay_until, pin_id, plan_ended_at, created_at)`. The three photo columns and `photo_set_by` are granted to no client role — not even the setter, who reads their own through the function below. The idiom `profiles` (20260816190000:353) and `message_requests` (20260902210000:82) already use                                                                                                                                                                                                                                                                                             |
| `groups.photo_set_by`               | NEW. Written by the trigger on every change of `photo_path` and KEPT when a verdict removes the path, which is the one moment the subject can no longer be read off the path's first segment. No FK: a seeded or service-role path need not begin with a uuid that exists in `public.users`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `group_detail(p_chat_id)`           | NEW. `SECURITY DEFINER`, membership-gated exactly as `groups_select_member` is (a definer function gets no RLS of its own), masking with the rule `my_chats` already uses: approved is everybody's, pending and refused are `photo_set_by`'s. `moderation_attempts` is masked to 0 rather than dropped, so `GroupRow` keeps its shape. `fetchGroup` is its only caller                                                                                                                                                                                                                                                                                                                                                                 |
| `can_view_group_photo(object_name)` | NEW, and load-bearing rather than tidy. **An RLS policy's expression is evaluated with the READER's privileges**, so `chat_photos_select_group`, which names `g.photo_path` and `g.photo_status` inline, would not have answered false once the grant went column-level — it would have RAISED, and a policy that raises takes the whole select with it. Measured: with the policy left inline, every authenticated read of `storage.objects` dies with `permission denied for table groups`, and three test files (`03_chats_storage_rls`, `67`, `74`) die at their first storage read. Same shape as `can_view_business_photo` (20260827110000:103) and `can_view_photo_object` (20260816190100:15), which exist for the same reason |
| `fetchGroup`                        | `supabase.rpc('group_detail', ...)` instead of `.from('groups').select('*')`. `photo.test.ts` asserts the function body contains the RPC and does not contain `from('groups')`; `database.types.ts` types the table's `Row` as `never` so nothing can select it and typecheck                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**What is enforced, and what is said instead of claimed.** Approved: path and status to every
member. Pending: both to the setter alone — the row says `null, null` to everybody else,
not "pending with the path withheld", which is the same tell one step removed. Rejected: the
status to the setter alone, matched on `photo_set_by` precisely because the verdict removed
the path it would otherwise have been read from. NOT enforced, and written into the
migration header rather than claimed away: a photo **refused before this migration ran** has
no setter to backfill (its path is gone), so its `rejected` row is shown to nobody and its
admin sees no "pick another" until they choose a new picture. Fail closed. There are no
production users.

**Deploy window, and it is a real cost this time.** An OTA bundle is never applied on the
launch that downloads it, so for one launch every phone runs the previous client, whose
`fetchGroup` is `select('*')` — and Postgres refuses a star select unless every column is
granted. That read is `permission denied`: the group SETTINGS page shows its `LoadError`
with a Retry that keeps failing until the new bundle runs; the room HEADER destructures only
`data`, so it draws the group glyph and skips the plan banner; the chat list, the invite
screen and everything else in a room read RPCs and are untouched. Taken deliberately, in
preference to leaving a documented privacy promise on a client guard for another release.
`31_select_star_stays_readable` drops `groups` from its list in the same commit, which is
what documents that the app no longer star-reads this table.

**`74_a_verdict_is_for_its_subject_alone`** is written as the attack: a member who is not the
setter reaches for the fact by the table and by the function, and the setter's own read is
asserted beside it so a "fix" that hid the verdict from the person it is about would fail
too. Every assertion was run against the mutation that removes what it names; the file's
header carries the record, mutation by mutation, including the one that matters most — with
the table-level grant put back (the leak exactly as found), seven refusals come back "lives"
and nothing else in the suite moves, which is what proves the client guard was never the
thing holding it. The revoke names `public`, `anon` and `authenticated` and not
`service_role`, and test 32 is that: extend it to `service_role` and the file dies where the
moderation worker's own queue read is, because bypassrls is not bypass-grants.

### Every moderation queue is visible to the daily smoke test (20260903070000)

`admin_ops_health` (20260817150000) is the one-query liveness check `docs/DASHBOARD.md` calls
the daily smoke test and `docs/LAUNCH_RUNBOOK.md` reads before launch. It counted held first
messages, pending PROFILE photos and selfie verifications, so a stuck business, post, chat or
group photo queue (each holds at `pending` behind its own trigger and its own door) read as
all zeros to the founder, and the failure `moderation-worker-queues.test.ts` exists for (a
door with no worker behind it) would have been invisible in production. The view is
recreated (`drop view`, so the revoke is restated) with four more columns after the existing
seven, each counted by the predicate the worker selects with: `pending_business_photos`,
`pending_post_photos`, `pending_chat_photos`, `pending_group_photos`. `pending_photos` keeps
its name and its meaning (profile photos): the runbook's thresholds are written against it
and a view's columns cannot be renamed by `create or replace`. Entry point: `select * from
admin_ops_health;` in the SQL editor; no RPC, no client.
`69_every_queue_the_smoke_test_can_see` puts one item in each queue with the flag on and
asserts each column says one; a subquery's `pending` term replaced fails exactly the
assertion that names its queue, a subquery deleted outright kills the file at the first read
of the missing column, and the revoke deleted fails 'clients cannot read the smoke test'.
The title of this migration overclaims by two queues — see the section directly below, which
is the correction; the file itself is applied and untouched but for a comment saying so.

### The two queues that can pause (20260903140000)

20260903070000's title says "every moderation queue" and its body does not: it took the view
from three moderation-queue counts to seven, and the worker drains NINE. The two with no
column were storefront photos (`business_verifications` at `pending`) and impersonation scans
(`business_scans` at `pending`) — which are the two worst ones to leave out, because they are
the only queues in the product that PAUSE. Both worker branches are wrapped in `if (!prompt)
{ ... queue paused }`, so a `MODERATION_PROMPTS_BUSINESS` secret missing either key switches
that queue off while the worker keeps posting 200s. It has happened twice (`supabase/.deploy-request`,
2026-08-27: "until then those two queues pause and everything else keeps running") and both
times the smoke test read all zeros. This migration adds `pending_storefronts` and
`pending_scans` — the worker's own names for them — at the END, so the eleven existing columns
keep their names and order; drop-and-recreate, revoke restated.
`69_every_queue_the_smoke_test_can_see` now fills the eight queues a pgTAP file can fill
(held first messages are the ninth and 09_launch_hardening has held that column since 20260817150000) and asserts each column says one. Measured: each of the eight subqueries with
its `pending` term flipped to `approved` fails exactly the assertion that names its queue
(9 to 16) and nothing else; `pending_scans` deleted outright kills the file at the first read
of the missing column (planned 17, ran 0); the revoke deleted turns 17 'clients cannot read
the smoke test' into "lives".

### `screen_business_text` runs only for an edit (20260903060000)

`businesses_screen` fires `BEFORE INSERT OR UPDATE` with no `WHEN`, and the function
screened five text columns and stamped `updated_at` on every write to the row. The
enumeration of every write that is not an owner editing text, so it is not re-asked:

| Write                                 | Columns                                                             | Source                 |
| ------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `confirm_business_email`              | `state`, `listed_at`                                                | 20260827160000:566     |
| `apply_business_verification_verdict` | `verified_at`                                                       | 20260903010000:115     |
| `admin_resolve_business_verification` | `verified_at`                                                       | 20260827160000:246     |
| `apply_business_scan_verdict`         | `state`, `verified_at`                                              | 20260827120000:703     |
| `admin_resolve_business_report`       | `state`, `verified_at`, `active`                                    | 20260827120000:753-759 |
| `update_business_location`            | `lat`, `lng`, `city_id`, `address`                                  | 20260829160000:218     |
| owner toggling `public_preview`       | the RLS update grant; a switch                                      | 20260827100000:142-146 |
| `businesses_rename_resets`            | amends NEW in the same statement; its body is guarded top to bottom | 20260902120000         |
| cron                                  | none writes this table                                              |                        |
| photo or post counters                | none live on it; those are rows elsewhere                           |                        |

**What each cost.** (1) The classifier re-ran. `screen_first_message` is the regex
blocklist, not a model call, so the CPU is small, but the blocklist is a table the founder
grows, and a pattern added after a business wrote its description turned every write above
into `that text breaks our house rules`. Followed through: `apply_business_scan_verdict`'s
`state = 'flagged'` is the write that takes a plausible impersonator off the map, and it
would have failed on the impersonator's own old bio; the verification verdict would have
failed ten times and failsafe-refused a real business for a sentence it did not change; an
owner flipping `public_preview` would have been told their text breaks the rules on a screen
with no text on it. (2) `updated_at` was stamped. Unlike `profiles.updated_at` this is NOT a
leak: the column is absent from the client select grant, no RPC returns it, no client-readable
view carries it. It was still wrong ("last edited" meant "last touched by anything") and one
grant away from being the profiles leak, so it goes inside the same guard.

**The shape** is 20260903030000's: the condition lives in the function body beside the list
of five columns it screens, not in a `WHEN` clause that would be a second copy of that list
drifting in the direction that fails open. `68_only_an_edit_screens_a_business` parks
`updated_at` in 2020 with the trigger disabled and asks whether it moved (the `now()`-equals-
`now()` trap 59 fell into); with the guard removed, five of its assertions fail, on both
halves.

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
- **2026-09-01** — Strikes decay: the ladder counts a **rolling 90 days**, and the regex
  prefilter's blocks are not strikes at all. This reverses "strikes never expire in v1",
  which was written before the prefilter's false-positive rate was known: a lifetime
  counter closes an account in month eighteen for four bad nights spread over two years,
  and every rung of the ladder was being fed by a guess the app itself invited people to
  retry. `admin_report_queue` uses the same window so the reviewer's count and the
  ladder's count cannot disagree.
- **2026-09-01** — The app sends a **fourth kind of notification**: three within-trip clocks
  (`push_trip_starts_tomorrow`, `push_plan_is_soon`, `push_last_call`, all hourly under the
  pg_cron guard, 20260902040000). Every one is about the reader's OWN trip or OWN plan; a
  push reporting somebody else's activity is explicitly not covered and may not be added
  under this decision. The primer's promise was rewritten to name the fourth kind in the
  same bundle, before anybody was asked under it. `notification_prefs.trip_clocks`
  (default true, RLS to `auth.uid()`) switches only these three off; a chat push or an
  account notice must NEVER consult it, which pgTAP 49 asserts. The trip clock's body
  states an overlap count only when it is at least that city's `launch_cities.heat_k` —
  hard rule 6 applied to a sentence rather than to a map cell.
- **2026-09-01** — The home-screen badge is computed **at drain time**, not at enqueue
  time: `waiting_counts(uuid[])` (definer, revoked from every client role) is called once
  per push-worker batch. A `badge` column on `push_queue` would freeze the number at
  enqueue and would need populating at thirty-odd write sites. The client half is
  `useIconBadge(waiting)` beside the tab badge, so the icon and the tab cannot disagree.
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
- **2026-08-28** — Moderation latency is driven by a **fire-on-insert poke** (AFTER INSERT
  triggers calling a throttled `poke_worker`) with the every-minute cron kept as the
  backstop, not by shortening the cron. A poke reaches the worker in the same second and
  costs nothing when there is no work; a faster cron pays for an empty invocation every
  time. `poke_worker` swallows every error inside its own exception block, because the
  alternative is an insert that fails — a photo that cannot be sent is strictly worse than
  one that waits for the backstop.
- **2026-08-28** — The classifier's `effort` is set **per queue**, not globally: chat photos
  and held first messages run at `low` (bounded either/or calls somebody is watching a
  placeholder for), while verification, storefront and impersonation keep the default.
  Those three decide who somebody IS, nobody is waiting on them, and a wrong call costs a
  badge, a livelihood or an accusation. `max_tokens` stays generous everywhere — it is a
  ceiling, and unspent headroom is free; effort is the only real latency dial.
- **2026-08-28** — Any user-facing promise about how long moderation takes must be quoted
  from `admin_moderation_latency` (queued-to-verdict, per queue, last 7 days) rather than
  from an estimate. A promise nobody can keep is worse than no promise; the view exists so
  the number can be corrected downward or upward from evidence.
- **2026-08-28** — A photo and its caption are **one message row**, not two. Two rows
  deliver in the wrong order by construction (text is immediate, a photo waits for a
  verdict), and one row is also one thing to unsend, to react to and to report.
- **2026-08-28** — `room_messages` returns `photo_state` alongside a masked `image_path`.
  Masking alone is not enough: the client cannot draw a review state it cannot see, and the
  result was an empty bubble for the whole wait. The path stays masked for everyone but the
  sender, who could already read their own upload through `chat_photos_select_own`.
- **2026-09-04** — **A pin or a trip can be in any city.** The founder retired "launch
  dense, not wide" as a fence after being refused a pin in Manhattan: `pins.city_id` and
  `heat_history.city_id` point at `cities`, `validate_pin` resolves the city instead of
  gating on it, the map feeds and heat read a 50 km circle around the browsed city, and
  the rail is `featured_cities()` (launch cities plus any city whose visible plans clear
  its k). Rule 6's k is `coalesce(launch_cities.heat_k, 3)` in one place per function;
  a city is never named on the rail below its k. `request_city()` is gone.
- **2026-09-04** — **Travelers reaches a radius the viewer sets** (`profiles.travelers_radius_km`,
  default 32 km). The radius lives in the `trips_select_overlap` policy's predicate
  (`overlaps_own_trip`) and not only in `get_matches`, because a SECURITY INVOKER queue
  cannot widen past what RLS lets it read; the hello, the inbox chip and the meet
  question read the same number so no surface disagrees. Measured city centre to city
  centre from a trip the person typed, never from a device (rule 2); `get_matches` takes
  nothing but the caller's own trip ids (below) and pgTAP asserts the argument list.
- **2026-09-05** — **A trip can be as far ahead as somebody plans, and the queue can be
  one trip at a time.** The 180-day horizon is out of `overlaps_own_trip`, `get_matches`
  and `send_message_request` (20260905090000): a year of trips added in January is
  matched from the day each is added. `get_matches(p_trip_ids uuid[] default null)`
  narrows the queue to some of the caller's trips; the ids are joined to
  `trips where user_id = auth.uid()`, so a foreign id names nothing, and null is every
  trip (daily_spotlight's zero-argument call is unchanged). The choice is a view
  preference kept on the device per account (`features/matching/trip-selection`): it
  changes nothing about who can see the person, whose profile is shown to everyone the
  audience setting allows on every trip. The picker is the top of the Travelers tab.
- **2026-09-04** — **Every city has a clock.** `cities.timezone` from `geo-tz` at seed
  time (49,025 rows, threshold 5,000), read through `city_clock_zone()`; the three push
  clocks and the pin's hour check no longer inner-join `launch_cities`, so a trip to Porto
  gets its "tomorrow" push and a plan in Manhattan its last call.
- **2026-08-28** — Read receipts (Delivered / Read) are **not** built, and this is a product
  decision rather than a backlog item: there is no recipient-scoped column to hang them on,
  and they create response pressure that works against the safety posture. "Sending" and
  "Sent" are sender-side facts and carry no such cost.
