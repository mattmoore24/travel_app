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
  list. §6 metrics: `map_viewed`, `heatmap_viewed`, `pin_created`, `pin_tapped`.
  (`heatmap_viewed` replaced `heatmap_rendered` 2026-08-31: a view now requires
  drawn pixels on an uncovered map rather than heat data arriving, so the
  series legitimately drops at the rename.)
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
taken away, so the rule is not enforced only at write time.

Honest consequence, stated in the picker as well as here: the three gendered options
match `profiles.gender`, so a traveler who has not set a gender ("Rather not say") is in
none of them. `verified_nonbinary` was added a revision after the rest (founder,
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
- **Sign in with Apple adds four**, same rule and the same place (set them with
  `supabase secrets set`, recipe in docs/APP_STORE.md): `APPLE_TEAM_ID`,
  `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (the **bundle id** — the Services ID is
  for the web) and `APPLE_PRIVATE_KEY` (the .p8 contents). Read by
  `supabase/functions/_shared/apple.ts` and by nothing else; `appleConfig()`
  returns null when any is missing, which is what makes both Apple functions
  degrade instead of throwing.
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
`DEVICE_LOCALE`, `DEVICE_LANGUAGE`, `USES_24_HOUR_CLOCK`, `FIRST_WEEKDAY` and
`DEVICE_TIME_ZONE`, read once at module load from `expo-localization` and frozen for the
process. Anything that formats a date or a time is to take its locale from there rather
than naming one.

**What is actually migrated: nothing yet.** The helper has no production call sites. Eleven
display formatters still name `'en'` — `app/place/[id].tsx:50`,
`app/(tabs)/my-business.tsx:49`, `features/pins/map-filter-sheet.tsx:121`,
`features/pins/pin-helpers.ts:66` and `:292`, `features/trips/dates.ts:29` and `:30`,
`features/chat/separators.ts:6`, `:7`, `:50` and `:55` — and each is a screen a traveler
reads. A twelfth, `features/pins/pin-helpers.ts:312`, names `'en-US'` on purpose and must
keep it: `cityClockNow` reads the parts back by name to build a Date, so it is machine
parsing rather than display, and a locale-dependent format there would be a bug. Moving the
eleven is its own package; until it lands, this section is a decision and a debt, not a
description.

**Expiry condition.** Revisit the English-only strings decision when a non-English launch
city is added, or when a launch market's retention lags the others by enough to suspect the
language. Until then this is a decision, not an omission, and it does not need re-deriving.

**RTL is not handled.** Every directional style in the app is physical (`marginLeft`,
`textAlign: 'left'`) rather than logical (`marginStart`, `'start'`). That is harmless while
no RTL locale is declared and becomes a forty-file retrofit the day one is. Adding Arabic or
Hebrew to the listing is not a metadata change; it is that retrofit first.

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
- **2026-08-28** — Read receipts (Delivered / Read) are **not** built, and this is a product
  decision rather than a backlog item: there is no recipient-scoped column to hang them on,
  and they create response pressure that works against the safety posture. "Sending" and
  "Sent" are sender-side facts and carry no such cost.
