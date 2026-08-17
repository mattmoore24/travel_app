# Travel App (working name TBD)

A free iPhone app for travelers to make **platonic** friends and see what other travelers are
doing in a city. Explicitly not a dating app — enforced by design (accept-gated messaging,
first-message moderation, no live location, ever).

Two surfaces:

- **The Map** (hero): drop future-dated intent pins ("I want to go to [place] on [day]", ≤72h
  expiry) and browse an anonymized heatmap of what's popular in the city.
- **Travelers**: post a trip, browse travelers with overlapping city + dates, send a
  Hinge-style message request the recipient must accept before chat opens.

Full product context: [`docs/PRODUCT_BRIEF.md`](docs/PRODUCT_BRIEF.md) ·
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/PROGRESS.md`](docs/PROGRESS.md) ·
[`docs/RESEARCH_NOTES.md`](docs/RESEARCH_NOTES.md)

Operating it: [`docs/LAUNCH_RUNBOOK.md`](docs/LAUNCH_RUNBOOK.md) (go-live, in order) ·
[`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) · [`docs/DASHBOARD.md`](docs/DASHBOARD.md)
(metrics + admin queries) · [`docs/APP_STORE.md`](docs/APP_STORE.md) ·
[`docs/legal/`](docs/legal) (policy drafts)

## Run it from a fresh clone

Prerequisites: Node 22+, npm 10+. No Mac/Xcode required for development.

```bash
git clone https://github.com/mattmoore24/travel_app.git
cd travel_app
npm install
cp .env.example .env   # keys: see docs/SUPABASE_SETUP.md; the app runs without them
npx expo start
```

Then:

- **iPhone**: install [Expo Go](https://expo.dev/go) and scan the QR code from the terminal.
- **Web (dev convenience only)**: press `w` in the terminal.
- **iOS Simulator** (only if on a Mac with Xcode): press `i`.

The app runs with placeholder screens before a Supabase project exists — the Profile tab shows
whether `.env` is wired up.

## Scripts

| Command                | What it does                           |
| ---------------------- | -------------------------------------- |
| `npx expo start`       | Start the dev server                   |
| `npm run typecheck`    | TypeScript check (`tsc --noEmit`)      |
| `npx expo lint`        | ESLint (expo config + prettier compat) |
| `npm test`             | Jest (jest-expo preset)                |
| `npm run format`       | Prettier write                         |
| `npm run format:check` | Prettier check (CI runs this)          |

CI (GitHub Actions) runs typecheck, lint, format check, tests, the database RLS suite, and a
Deno typecheck of the Edge Functions on every PR and on pushes to `main` — see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). A second workflow,
[`supabase-deploy.yml`](.github/workflows/supabase-deploy.yml), applies migrations and deploys
Edge Functions to the hosted project (trigger: commit any change to `supabase/.deploy-request`).

## Repo layout

```
src/app/          Expo Router routes: (auth), onboarding/, (tabs), edit-profile
src/components/   Shared UI (themed primitives, tab bars, form kit, photo grid)
src/features/     auth (session, sign-in flows) and profile (api, hooks, validation)
src/hooks/        Color-scheme/theme hooks
src/constants/    Theme tokens, language list
src/lib/          Supabase client, DB types, secure session store, query client
supabase/         migrations/ (schema + RLS), tests/ (pgTAP), shim/ (local test rig)
scripts/          db-test.sh — run the DB test suite on a throwaway local Postgres
docs/             Product brief, architecture, progress, research notes
.github/          CI workflow (app checks + database RLS tests)
```

## Database tests

The privacy invariants (social-handle gating, server-owned moderation columns, shadowban
visibility) are enforced in Postgres RLS and proven by a pgTAP suite:

```bash
# needs: postgresql server binaries + pgtap + pg_prove (see .github/workflows/ci.yml)
./scripts/db-test.sh
```

## Secrets

Never commit `.env`. `EXPO_PUBLIC_*` variables are embedded in the client bundle — only
publishable keys (Supabase anon key) go there; privacy is enforced by Postgres RLS, not by
hiding keys. Server-side secrets (Anthropic moderation key, service role) live in Supabase
Edge Function secrets. See [`.env.example`](.env.example).
