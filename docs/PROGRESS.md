# Progress

Living status doc: what's done, what's next, what needs founder input.
Updated at every phase boundary (and mid-phase when something changes).

## Current status: **Phase 0 complete** (2026-08-16)

### Done

- [x] Repo connected (`mattmoore24/travel_app`), push verified from first commit
- [x] Product brief committed (`docs/PRODUCT_BRIEF.md`) + research PDF
      (`docs/research/travel_app_research.pdf`) + distilled competitive notes
      (`docs/RESEARCH_NOTES.md`)
- [x] Expo SDK 57 + TypeScript scaffold (official default template, Expo Router,
      React 19 / RN 0.86)
- [x] Four-tab app skeleton matching the product IA: **Map · Travelers · Inbox · Profile**,
      each a designed empty state naming its phase; native SF Symbol tab bar + synced web tabs
- [x] Supabase client wiring (`src/lib/supabase.ts`) with graceful no-env fallback;
      `.env.example` template; React Query provider; Zustand installed
- [x] Tooling: ESLint (expo flat config + prettier-compat), Prettier, Jest (`jest-expo`,
      3 passing tests), strict TypeScript
- [x] GitHub Actions CI: typecheck + lint (max-warnings 0) + format check + tests on every PR
      and push to `main`
- [x] Verified: `tsc` clean, lint clean, tests pass, and `expo export` produces working iOS
      and web bundles for all four routes

### Phase 0 deliverable check

Fresh clone → `npm install` → `npx expo start` works with no `.env` required (Profile tab
shows Supabase wiring status). Verified via full iOS + web bundle export in this session.

## Next: Phase 1 — Auth & profiles

Apple Sign-In + email auth, onboarding flow (profile fields, photo upload with moderation
stub), profile view/edit, social handles stored but RLS-hidden. First Supabase migrations +
RLS tests land here.

**Blocked on founder for:** Supabase project keys (item 1 below). Everything else in Phase 1
can start without input; Apple Sign-In end-to-end testing waits on item 2.

## Needs founder input

1. **Supabase project (needed to start Phase 1)** — create a free project at
   [supabase.com](https://supabase.com) (any region near launch cities, e.g. `eu-west`),
   then from _Project Settings → API_ put into a local `.env` (copy `.env.example`):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   Also add both as GitHub Actions secrets later if CI ever needs a live backend (not yet).
   I'll handle schema, migrations, and RLS from there — no dashboard configuration needed
   beyond creating the project (though sharing the DB password / access token would let me
   drive migrations via CLI).

2. **Apple Developer Program** ($99/yr) — required for Sign in with Apple entitlements,
   push notifications (Phase 4), and TestFlight (Phase 6). An Expo account (free) is also
   needed for EAS builds; both can wait a bit into Phase 1 (email auth first), but Apple
   Sign-In can't ship without them.
3. **Bundle identifier** — placeholder set to `com.mattmoore.travelapp` in `app.json`.
   Fine to keep, or tell me the reverse-domain you want (it's painful to change after
   TestFlight).
4. **Working name** — code identity is neutral ("Travel App"). Candidate names to react to,
   all map/overlap-flavored rather than dating-flavored: **Overlap**, **Pinned**, **Samewhere**,
   **Crossings**, **Meanwhile**, **Waypoint**. No action needed until App Store assets
   (Phase 6), but the scheme/slug is easiest to rename early.
5. **Branch policy** — this session pushed to `claude/travel-app-initial-setup-ephphz` (the
   branch this remote session is locked to). Open a PR / merge it to `main` on GitHub when
   you're happy, or tell me if you want a different flow for future sessions.

## Open technical flags

See "Technical flags" in [`ARCHITECTURE.md`](ARCHITECTURE.md): unstable native-tabs
namespace, secure session storage planned for Phase 1, Expo Go limits (Apple Sign-In/push
need an EAS dev build), React Compiler experiment on, selfie-liveness vendor evaluation in
Phase 5.

## Phase ledger

| Phase                | Status  | Deliverable                                     |
| -------------------- | ------- | ----------------------------------------------- |
| 0 — Repo & scaffold  | ✅ done | Fresh clone → `npx expo start` works            |
| 1 — Auth & profiles  | ⏭ next  | Account + full profile viewable in app          |
| 2 — Trips & matching | ⬜      | Overlap request → accept → chat shell           |
| 3 — The Map (hero)   | ⬜      | Compelling map with 15 pins                     |
| 4 — Chat & realtime  | ⬜      | Full loop to live conversation                  |
| 5 — Trust & safety   | ⬜      | Flirty first message blocked + logged           |
| 6 — Launch hardening | ⬜      | Geofenced launch cities, TestFlight, dashboards |
