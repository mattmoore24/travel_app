# Progress

Living status doc: what's done, what's next, what needs founder input.
Updated at every phase boundary (and mid-phase when something changes).

## Current status: **Phase 1 complete** (2026-08-16) — pending live keys for end-to-end

Phase 0 (repo, scaffold, CI, docs) finished earlier the same day; CI run #1 green.

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

## Next: Phase 2 — Trips & matching

Trip creation (city autocomplete via a places API), city+date overlap query, card-stack
browse, Hinge-style message requests with accept/decline inbox, chat shell on accept.
Phase 2 also adds the server-side chat-creation path that the Phase 1 handle-gate stubs
anticipate. **A places/geocoding API choice lands here** — I'll evaluate and propose in
ARCHITECTURE.md before building.

## Needs founder input

1. **Supabase project (the one real blocker)** — create a free project at
   [supabase.com](https://supabase.com), then:
   - Put `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Project Settings →
     API) into `.env` locally.
   - Give me the project ref + a `SUPABASE_ACCESS_TOKEN` (or run
     `npx supabase link && npx supabase db push` yourself) so the migrations reach the
     hosted DB.
   - In Auth settings: decide **email confirmation** on/off for early testing (off = faster
     TestFlight loops; the app handles both).
2. **Apple Developer Program** ($99/yr) — needed before Apple Sign-In can be tested
   end-to-end (entitlement + Services ID, then enable the Apple provider in Supabase Auth).
   Email auth works without it. Also unlocks EAS dev builds, push (Phase 4), TestFlight
   (Phase 6).
3. **Bundle identifier** — still `com.mattmoore.travelapp` (change now if you want a
   different reverse-domain; painful later).
4. **Working name** — unchanged ask; candidates: Overlap, Pinned, Samewhere, Crossings,
   Meanwhile, Waypoint.
5. **Branch** — everything is on `claude/travel-app-initial-setup-ephphz`; merge to `main`
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
| 2 — Trips & matching | ⏭ next  | Overlap request → accept → chat shell                     |
| 3 — The Map (hero)   | ⬜      | Compelling map with 15 pins                               |
| 4 — Chat & realtime  | ⬜      | Full loop to live conversation                            |
| 5 — Trust & safety   | ⬜      | Flirty first message blocked + logged                     |
| 6 — Launch hardening | ⬜      | Geofenced launch cities, TestFlight, dashboards           |
