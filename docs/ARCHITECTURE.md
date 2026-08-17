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

## Privacy & secrets model

- `EXPO_PUBLIC_*` env vars ship inside the client bundle. Only the Supabase URL + anon key
  belong there. **RLS is the security boundary, not key secrecy.**
- Server secrets (ANTHROPIC_API_KEY, service role) exist only as Supabase Edge Function
  secrets; they never appear in this repo or the app bundle.
- `.env` is gitignored; `.env.example` is the committed template.

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
