# Progress

Living status doc: what's done, what's next, what needs founder input.
Updated at every phase boundary (and mid-phase when something changes).

## Current status: **Phase 9 — the craft pass** (2026-08-19)

### Phase 9 — Research-backed beauty + the founder's fix list

Six parallel research agents surveyed the HIG, award-tier apps, map UX,
motion, color, and the RN engineering of all of it — full synthesis and the
deliberately-deferred ideas list in [`DESIGN.md`](DESIGN.md) ("The craft
pass"). Shipped on top of it:

- [x] **Drop-a-pin rebuilt in place** (founder ask): docked amber action →
      placement mode on the same map — fixed center pin with lift/settle
      springs + haptics, on-device address search (CLGeocoder, no keys, no
      user location), form as a sheet over the map, posted pin drops in
      selected
- [x] **Map pins redesigned** (founder ask): emoji stickers → ringed indigo
      category-glyph markers, amber star for curated seeds; correct Apple
      Maps anchoring (`centerOffset` — `anchor` is Google-only), collision
      priority, camera nudge above the detail sheet
- [x] **Avatar first-tap bug** (founder ask): root causes addressed — glass
      is now decorative-only under touch targets, and press-scale transforms
      moved off the Pressable's hit rect (Fabric hit-tests transformed rects)
- [x] **Press physics + haptic vocabulary everywhere** — PressableScale +
      semantic haptics; spring tokens match the iOS system feel
- [x] **HIG iOS 26 fixes** — untinted glass tab bar, Title Case sections,
      warm ink text, staggered card entrances, brand-indigo splash overlay
      (was template blue), campfire mark on the welcome hero
- [x] **E2E now drives the signed-in app** — throwaway account created and
      onboarded per run, Maestro signs in, drops a real pin through the new
      flow, opens the profile via the avatar, account destroyed after

**Audit outcome (2026-08-19):** live-backend canary 17/17 twice; simulator E2E
walked sign-in → place mode → pan → form → **a real pin posted and refetched
onto the map** → signed-in Travelers → profile via the avatar's FIRST tap.
Screenshots confirmed the indigo tab tint and the amber dock. Two cosmetic
fixes from the screenshots (back chevron said "(tabs)"; PHOTOS → Photos) are
committed but their on-device validation run could not start: the GitHub
Actions minutes ran out. **Decision: the repo goes PUBLIC while building**
(unlimited free standard-runner minutes) and flips private before real users
arrive — runbook step 4 is the gate. Prep is done: the moderation classifier
prompts moved to the `MODERATION_PROMPTS` secret and were redacted from all
git history before publication. The founder adds that GitHub secret, flips
visibility, then the next Supabase deploy re-arms the worker (it fails closed
until then). The one stray test account (an early workflow bug skipped its
teardown) was deleted by the founder on 2026-08-19 — no test data remains
visible to real users.

**The founder's idea batch (2026-08-19)** — all shipped and E2E-validated:

- [x] **First-run tour, now cinematic** — the splash dissolves into an indigo
      welcome scene (the campfire mark never leaves the screen), "Connect.
      Plan. Explore. / Welcome to the Samewhere community." staggers in, and
      "Show me around" starts the tour: the mark glides up into a docked
      emblem while pages parallax underneath, dots and all driven by the live
      scroll offset. Ends in join-or-browse; 'Skip' stays in the corner (the
      E2E flows key off it)
- [x] **Guest profile screen** — the header avatar always lands somewhere real
      now: signed out it invites join/sign-in (root cause: the route lived
      inside the auth guard, so guest taps silently no-oped)
- [x] **Demo travelers** — Actions → **Demo travelers** seeds/purges six
      AI-portrait personas (Lisbon ×3, Bangkok ×3) with pins and overlapping
      trips so Travelers/matching/requests are testable on a phone; `[demo]`
      bios, `DEMO_PASSWORD`-gated sign-in; purge is a runbook step 4 gate
- [x] **Pins wear their poster's face** — signed-in users see the poster's
      photo in the marker (guests get plain glyphs, enforced server-side);
      the pin sheet links to profile and message request
- [x] **One clear signup** — email/password page says it's step one of two,
      then a single profile builder (photos, basics, bio) ends in "Create
      account"; everything editable later
- [x] **Copy pass + the yes moment** — casual, direct copy throughout, em
      dashes gone from app copy; when a message request is accepted, a
      full-screen celebration springs the accepter's photo in with haptics
      and opens the chat ("{name} said yes")

## Phase 8 complete — Samewhere is on TestFlight, audited end-to-end (2026-08-19)

### Phase 8 — Identity, TestFlight, and Claude's eyes

- [x] **Name: Samewhere** (six rounds, ~950 candidates — [`NAMING.md`](NAMING.md)); slug,
      scheme, and bundle ID (`com.mattmoore.samewhere`) all wired. Apple accepted the app
      record under the name, which doubles as the availability check
- [x] **Dusk palette** — indigo `#2A4C9B` + burnt amber, every pair WCAG-checked
      ([`DESIGN.md`](DESIGN.md)); **campfire mark** (O4) rendered to icon / splash /
      adaptive-icon / in-app brand from `assets/icon-src/`
- [x] **TestFlight pipeline** — Actions → **TestFlight** builds, signs, and submits with
      zero interactive steps; certificates are minted per-build straight from the App
      Store Connect API ([`APP_STORE.md`](APP_STORE.md) has the war stories). **The app
      is live on TestFlight**
- [x] **Claude's eyes: simulator E2E** — Actions → **E2E simulator** builds the app,
      drives it with Maestro on an iOS simulator, and pushes screenshots to the
      `e2e-results` branch, so the agent can see and audit real native pixels
- [x] **Live-backend canary** — anon-key-only integration tests against the production
      Supabase (Actions → **Live backend tests**, weekly + on demand): 17/17 green,
      including a real Claude moderation release (~21 s) and a flirty message that never
      arrived
- [x] **Two real bugs caught by the harnesses**: signups were silently dead-ended by the
      email-confirmation toggle (now off for v1 — see runbook), and the selected tab
      rendered iOS system blue instead of the accent (fixed: `NativeTabs` needed
      `tintColor`)

---

## Phase 7 complete — design overhaul + guest mode + rooms (2026-08-17)

### Phase 7 — Beautiful, frictionless, and room-shaped

Research-backed redesign (sources in [`DESIGN.md`](DESIGN.md)): iOS 26 Liquid
Glass is the native language now, and `expo-glass-effect` ships in our SDK, so
"modern" means native rather than imitated.

- [x] **Design system** — trail-green palette (deliberately unlike every dating
      app), warm canvas, seven-role type scale, 4pt spacing, elevation/motion
      sets, `GlassSurface` primitive with an opaque fallback
- [x] **Three tabs** — Map · Travelers · Chat, with Profile behind the header
      avatar; 9 photo slots per profile
- [x] **Guest mode** — the tabs are the front door for everyone. No account
      needed for the map (curated pins in full, user pins with no identity
      attached), the heat layer, one featured traveler, or reading an
      establishment room. The account is asked for at the moment of action
- [x] **14-day traveler window** — matching opens two weeks before arrival, and
      cards show the whole stay, not just the overlap
- [x] **Establishment rooms** — hostels/hotels run a room; joining asks only
      when you leave; membership ends 7 days after that, capped at 30; staff
      can remove messages and members; pin/mute/archive plus 14-day
      auto-archive (Hinge-style: archived stays readable)
- [x] **Reactions and photo messages** — long-press for quick emoji; chat
      photos go through the same moderation pipeline as profile photos, which
      is not optional in a publicly-readable room
- [x] 36 new database assertions (suite: **268**)
- [x] **Screen-by-screen visual redesign** — map pin detail is a real bottom
      sheet under floating glass controls; traveler cards lead with a 4:5
      photo; the chat list splits into requests / pinned / chats / rooms /
      archived; both profile screens open on a full-bleed hero photo with the
      name set over a gradient scrim, and your own gallery shows empty slots up
      to the six-photo target rather than describing the gap
- [x] **Web preview is honest again** — the web-only tab bar was anchored to
      the top and floating over every screen title (web reports a zero top
      safe-area inset). It now sits at the bottom like the real iOS tab bar,
      and screens reserve room for it

---

## Phase 6 complete (2026-08-17)

### 🎉 The backend is LIVE

The Supabase project exists and is provisioned: all migrations applied (schema + 9,062
cities), `push-worker`, `moderation-worker`, and `delete-account` deployed. Provisioning
runs from GitHub Actions (**Supabase deploy** workflow) because development happens from a
phone — credentials live in GitHub's encrypted secret store, never in the repo or a chat.

**Before real users touch it, do [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) step 1**: the
moderation pipeline ships _dark_ (photos auto-approve; messages get the regex filter only)
until `ANTHROPIC_API_KEY` is set, both workers are scheduled, and the two `app_config`
flags are flipped.

### Phase 6 — Launch hardening: done

**Database (pgTAP suite now 232 asserts, all green):**

- [x] **Velocity caps** on every hot write path — messages 30/min; requests 30/day; reports
      10/day; trips 20/day; pins 30/day; photos 25/day; blocks 50/day; profile updates
      30/day; plus storage-object ceilings (30 photos / 10 selfies). The Phase 2–5 caps
      bounded _state_; delete-and-recreate churn defeated them, so these bound _rate_
- [x] **Oracle-proof errors**: every relationship failure in `send_message_request` now
      returns one indistinguishable message — distinct errors let a sender detect a block
- [x] **Profile text screening**: `display_name`/`bio` (broadcast to every overlapping
      traveler) now pass the same pre-filter as first messages
- [x] **Admin metrics views** (service-role only): `admin_liquidity` (the liquidity
      number), `admin_request_funnel`, `admin_moderation_stats`, `admin_pin_stats`, and
      `admin_ops_health` — the one-query liveness check for both workers and pg_cron
- [x] Account-deletion cascade proven: profile, photos, trips, pins, requests, tokens, and
      reports all die; the moderation audit spine survives with the subject nulled

**App:**

- [x] **In-app account deletion** (App Review 5.1.1(v)) — Profile → Delete account →
      `delete-account` Edge Function (storage both buckets, chats for both sides, auth user)
- [x] **Guidelines + consent + support contact** (App Review 1.2) — `/guidelines` readable
      before sign-up, consent line on the welcome screen, support mailto
- [x] "Be the first pin" empty state on the map, per city and per date filter
- [x] `eas.json` build profiles, encryption declaration, microphone permission suppressed
- [x] `trip_created` now carries `starts_within_days` so §6's _within-trip-window_
      retention is actually computable

**Docs (the launch-operations set):**

- [x] [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) — go-live in order, with rollback levers
- [x] [`APP_STORE.md`](APP_STORE.md) — privacy labels, review notes, TestFlight, EAS env vars
- [x] [`DASHBOARD.md`](DASHBOARD.md) — every §6 metric mapped to a PostHog insight or SQL view
- [x] [`legal/`](legal) — community guidelines + privacy policy drafts (founder review, then legal)
- [x] `supabase/seed/launch_pins.sql` — 20 curated pins across the four launch cities

**Verification:**

- [x] Adversarial launch audit (4 lenses → 23 agents, App Store / abuse / privacy / ops):
      22 findings, 15 confirmed, all fixed. Standouts: the block-detection oracle; unbounded
      storage uploads; profile text bypassing moderation entirely; Edge Functions having no
      static checks; cloud builds shipping with no backend keys
- [x] typecheck, lint, format, 25 Jest, 232 pgTAP, Deno typecheck of all three functions

---

Previous phases below.

## Phase 5 complete (2026-08-17)

### Phase 5 — Trust & safety: done

**Database (pgTAP suite now 209 asserts, all green):**

- [x] **Hard rule 5 completed**: with `require_llm_moderation` on, a first message that
      clears the regex pre-filter is HELD (`pending_moderation` — invisible to the
      recipient, masked as "sent" to the sender, no push) until the Claude classifier's
      verdict; the only exit from the held state is a service-role-only RPC. Fail-closed:
      API outages never deliver an unscreened message (and never strike innocent senders —
      failsafe blocks are non-strike and retryable)
- [x] Server-only `app_config` flags (`require_llm_moderation`, `require_photo_moderation`,
      both default off) keep keyless dev/CI on exact Phase 2–4 behavior
- [x] **Strike ladder** on the `moderation_events` audit spine: 3 strikes → warning push,
      5 → 7-day suspension, 7 → permanent ban; suspensions auto-lift (pg_cron, guarded);
      all transitions audit-logged and pushed
- [x] **Standing gates in Postgres**: suspended/banned accounts refused at
      `send_message_request`, `respond_to_message_request`, chat-message RLS, and
      verification; blocks filed while a message is held sever it, and release re-validates
      the pair (belt and braces — both tested)
- [x] Photo moderation swap-in: flag on → uploads hold at `pending` (owner-only visible)
      for Claude vision review; reject = strike + push; flag off = Phase 1 stub behavior
- [x] Selfie verification: write-only `verification-selfies` bucket (no client reads,
      ever), `submit_verification` RPC (own-folder + object checks, one pending, 3/day),
      Claude-vision likeness verdict → `profiles.verified` badge + server-only evidence.
      Honestly labeled a likeness check, not identity/liveness verification
- [x] **Admin report review queue**: `admin_report_queue` view (status, strike count,
      report totals per reported user) + `admin_resolve_report`
      (dismiss/warn/strike/suspend/ban/shadowban) — service-role only, runtime-guarded
- [x] 75 new pgTAP assertions covering every gate, privilege, and ladder step above

**Edge Function (`supabase/functions/moderation-worker`):**

- [x] Drains all three queues (~1/min schedule): held messages, pending photos, pending
      verifications; `claude-opus-5` with structured outputs (typed allow/block verdicts);
      model refusals treated as blocks; retry bookkeeping with failsafe caps;
      `ANTHROPIC_API_KEY` lives only as a Supabase secret

**App:**

- [x] Account gate screen (suspended-with-date / banned) at the root navigator —
      `users.status` + `suspended_until` are self-readable; DB enforcement is independent
- [x] Get-verified flow: profile-tab entry → selfie capture (front camera, library
      fallback) → write-only upload → status card (in review / rejected reason / verified)
- [x] Photo grid shows "In review" / "Removed" badges from the live moderation status
- [x] Code-review pass: 12 findings, all fixed. Standouts: the strike ladder's
      suspend→lift path could launder a shadowban into a fully active account; a
      shadowbanned sender's released message would have ghost-notified its recipient (now
      full-illusion suppression: "delivered" to the sender, silently declined in the DB);
      the Phase 5 migration would have failed on any already-provisioned database (enum
      value now lands via its own ALTER TYPE migration); admin actions that can't apply
      logged phantom audit events (now raise); verification selfies are deleted from
      storage the moment a verdict lands
- [x] Verified: typecheck, lint, format, 25 Jest tests, 209 pgTAP tests

### Phase 5 deliverable check

"A flirtatious first message from a test account is blocked before delivery and logged":
proven twice over in `08_trust_safety.test.sql` — the pre-filter path blocks instantly
(Phase 2, still tested) and the classifier path holds → blocks → strikes → notifies without
the recipient ever seeing a row. Live end-to-end additionally needs the Supabase project +
`ANTHROPIC_API_KEY` secret + the two flags flipped (see
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)).

---

Previous phases below.

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

## Next: ship it

All six phases are built. What remains is founder-gated, not engineering-gated:

1. **Runbook step 1** — Anthropic key + schedule the workers + flip the two flags, so
   moderation is live before anyone real uses it.
2. **Apple Developer Program** → EAS build → TestFlight (guide written and waiting).
3. **Decide the name**, set the support email, get the legal drafts reviewed.
4. **Open Lisbon only**, seed pins every couple of days, watch `admin_liquidity` toward
   500–1,000 before opening city #2.

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
4. **Supabase project (the one real blocker)** — full step-by-step walkthrough now lives
   in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) (~15 min: create project → copy two keys →
   `.env` → `supabase db push` → auth settings → verify).
5. **Anthropic API key + live moderation** — ✅ **DONE 2026-08-18.** Key synced to Edge
   Function secrets; both workers scheduled by pg_cron from
   `20260817230000_schedule_workers.sql`; Vault credentials set via
   `public.set_worker_credentials()`; both `app_config` flags flipped to `true`.
   Verified: `worker_status()` shows 200s on consecutive ticks and
   `admin_ops_health` reads all zeros.

   **Exercised 2026-08-19.** The live-backend canary (Actions → **Live backend tests**,
   `tests/live/live-backend.mjs`, also scheduled weekly) ran the runbook's own check
   against the production project: a clean first message was released by a real Claude
   verdict in ~21 s, a flirty first message was still undelivered after a 4-minute
   watch, and 17/17 checks passed — handle gating pre/post-accept, guest RLS, and
   delete-account teardown included.

   **Email confirmation is OFF for v1.** The canary's first run caught that with
   Supabase's "Confirm email" toggle on, `signUp` returns no session and the app has no
   confirmation deep-link flow — every real signup silently dead-ended. The toggle is
   now off (founder, 2026-08-19). Before public launch: either keep it off knowingly or
   build the deep-linked confirmation flow, then re-enable.

6. **Apple Developer Program** ($99/yr) — needed before Apple Sign-In can be tested
   end-to-end (entitlement + Services ID, then enable the Apple provider in Supabase Auth).
   Email auth works without it. Also unlocks EAS dev builds, push (Phase 4), TestFlight
   (Phase 6).
7. **Bundle identifier** — now `com.mattmoore.samewhere`. Deliberately kept under the
   `com.mattmoore` namespace rather than `com.samewhere.*`, because the convention is to
   use a reverse-domain you actually control and `samewhere.com` belongs to someone else.
   This is the last comfortable moment to change it — it is fixed after the first App
   Store submission.
8. **Working name** — **Samewhere**, chosen after six rounds and ~950 candidates
   ([`NAMING.md`](NAMING.md)). One check is still owed and only the founder can run
   it: an **App Store search** for the name. The sandbox can reach neither the
   iTunes Search API nor RDAP/WHOIS, so no collision check was possible from here.
   Everything is wired up, but treat the name as provisional until that search
   comes back clean — it is cheap to swap now and expensive after submission.
9. **Branch** — everything is on `claude/travel-app-initial-setup-ephphz`; merge to `main`
   via PR whenever you're ready.

## Open technical flags

Note per brief §6 ("instrument from day one"): PostHog wiring is scheduled for Phase 2 with
the first liquidity events (trips/matching) — Phase 1 has no meaningful liquidity events to
record. Flagging the small deferral for your sign-off.

See "Technical flags" in [`ARCHITECTURE.md`](ARCHITECTURE.md). New this phase: selfie
verification shipped as an honestly-labeled Claude-vision likeness check — a certified
liveness vendor stays a deliberate deferral until fraud data justifies the cost; LLM
moderation adds ~1min max delivery latency (worker schedule) while the flag is on.

## Phase ledger

| Phase                 | Status  | Deliverable                                               |
| --------------------- | ------- | --------------------------------------------------------- |
| 0 — Repo & scaffold   | ✅ done | Fresh clone → `npx expo start` works                      |
| 1 — Auth & profiles   | ✅ done | Account + full profile viewable in app (E2E pending keys) |
| 2 — Trips & matching  | ✅ done | Overlap request → accept → chat shell (E2E pending keys)  |
| 3 — The Map (hero)    | ✅ done | Compelling map with 15 pins (seeding path ready)          |
| 4 — Chat & realtime   | ✅ done | Full loop to live conversation (E2E pending keys)         |
| 5 — Trust & safety    | ✅ done | Flirty first message blocked + logged (proven in pgTAP)   |
| 6 — Launch hardening  | ✅ done | Rate limits, deletion, dashboards, runbook, store prep    |
| 7 — Design overhaul   | ✅ done | Guest-first 3-tab app, rooms, photo-forward screens       |
| 8 — Name & TestFlight | ✅ done | Samewhere on TestFlight; E2E + live canary both green     |
