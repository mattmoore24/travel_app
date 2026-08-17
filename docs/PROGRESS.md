# Progress

Living status doc: what's done, what's next, what needs founder input.
Updated at every phase boundary (and mid-phase when something changes).

## Current status: **Phase 4 complete** (2026-08-16) — pending live keys for end-to-end

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

## Next: Phase 5 — Trust & safety pipeline

The Claude moderation classifier behind the existing `screen_first_message` seam (Edge
Function + ANTHROPIC_API_KEY secret), strike system (warn → suspend → ban) on
`moderation_events`, selfie verification flow (liveness vendor decision), photo moderation
swap-in for the Phase 1 stub, and the report review queue. The chokepoints, audit spine,
and server-owned columns are already in place, so Phase 5 is mostly replacing stub engines
with real ones.

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
4. **Supabase project (the one real blocker)** — create a free project at
   [supabase.com](https://supabase.com), then:
   - Put `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Project Settings →
     API) into `.env` locally.
   - Give me the project ref + a `SUPABASE_ACCESS_TOKEN` (or run
     `npx supabase link && npx supabase db push` yourself) so the migrations reach the
     hosted DB.
   - In Auth settings: decide **email confirmation** on/off for early testing (off = faster
     TestFlight loops; the app handles both).
5. **Apple Developer Program** ($99/yr) — needed before Apple Sign-In can be tested
   end-to-end (entitlement + Services ID, then enable the Apple provider in Supabase Auth).
   Email auth works without it. Also unlocks EAS dev builds, push (Phase 4), TestFlight
   (Phase 6).
6. **Bundle identifier** — still `com.mattmoore.travelapp` (change now if you want a
   different reverse-domain; painful later).
7. **Working name** — unchanged ask; candidates: Overlap, Pinned, Samewhere, Crossings,
   Meanwhile, Waypoint.
8. **Branch** — everything is on `claude/travel-app-initial-setup-ephphz`; merge to `main`
   via PR whenever you're ready.

## Open technical flags

Note per brief §6 ("instrument from day one"): PostHog wiring is scheduled for Phase 2 with
the first liquidity events (trips/matching) — Phase 1 has no meaningful liquidity events to
record. Flagging the small deferral for your sign-off.

See "Technical flags" in [`ARCHITECTURE.md`](ARCHITECTURE.md). New this phase: Apple
Sign-In/photo upload need an EAS dev build for full testing (Expo Go covers email auth +
everything else); selfie-verification liveness vendor still a Phase 5 decision.

## Phase ledger

| Phase                | Status  | Deliverable                                               |
| -------------------- | ------- | --------------------------------------------------------- |
| 0 — Repo & scaffold  | ✅ done | Fresh clone → `npx expo start` works                      |
| 1 — Auth & profiles  | ✅ done | Account + full profile viewable in app (E2E pending keys) |
| 2 — Trips & matching | ✅ done | Overlap request → accept → chat shell (E2E pending keys)  |
| 3 — The Map (hero)   | ✅ done | Compelling map with 15 pins (seeding path ready)          |
| 4 — Chat & realtime  | ✅ done | Full loop to live conversation (E2E pending keys)         |
| 5 — Trust & safety   | ⏭ next  | Flirty first message blocked + logged                     |
| 6 — Launch hardening | ⬜      | Geofenced launch cities, TestFlight, dashboards           |
