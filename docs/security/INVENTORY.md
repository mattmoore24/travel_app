# Inventory: every secret, service and surface

Read from the repository and the live project on 2026-09-06. Nothing in this
file is a secret value — it is the map of where the values live, what each one
grants, and which side of the client/server line it sits on.

**No secret value appears here, and none has ever appeared in this repository.**
SEC-001: 204 commits across all 7 branches scanned for 15 credential patterns,
all clean. There is no exposure-driven rotation owed. This list exists so that
_if_ one is ever exposed, the blast radius is already written down.

---

## 1. The line that matters

`EXPO_PUBLIC_*` is not a naming convention, it is a **compiler instruction**:
Expo inlines every one of those into the JavaScript bundle that ships to
phones. Anything with that prefix is public the moment a build leaves CI, and
anything without it must never acquire it.

| Name                            | In the app bundle? | Grants                                                                                                                                                                                      |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | **Yes**            | Nothing on its own; the project's address.                                                                                                                                                  |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **Yes**            | The `anon` role, and **only** what RLS lets `anon` do. This key is _designed_ to be public; the security is the policies, which is why "every table has RLS" is the first row of the audit. |
| `EXPO_PUBLIC_POSTHOG_API_KEY`   | **Yes**            | Write-only event ingest for one PostHog project. Cannot read.                                                                                                                               |
| `EXPO_PUBLIC_POSTHOG_HOST`      | **Yes**            | `https://eu.i.posthog.com`. EU region is a privacy-policy commitment, not a preference.                                                                                                     |

Everything below this line is server-side and must never gain an
`EXPO_PUBLIC_` prefix.

---

## 2. Server secrets — Supabase Edge Function environment

Set with `supabase secrets set`, or synced from GitHub Actions secrets by the
deploy workflow. Read at `Deno.env.get(...)` inside the functions.

| Secret                                             | Used by             | Grants / blast radius                                                                                                            |
| -------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                | `moderation-worker` | **Spend.** The one key in this project whose misuse costs money directly. See `COST_CONTROLS.md`.                                |
| `SUPABASE_SERVICE_ROLE_KEY`                        | every function      | **Full database access, RLS bypassed.** The crown jewel. Provided automatically by the platform inside functions.                |
| `SUPABASE_ANON_KEY`                                | `delete-account`    | Used to verify the caller's own JWT. Same key as the client's.                                                                   |
| `SUPABASE_URL`                                     | every function      | Address only.                                                                                                                    |
| `MODERATION_PROMPTS`                               | `moderation-worker` | Not a credential; the classifier's system prompts. Kept out of the repo because publishing them is publishing the evasion guide. |
| `MODERATION_PROMPTS_BUSINESS`                      | `moderation-worker` | Same.                                                                                                                            |
| `RESEND_API_KEY`                                   | `support-mailer`    | Send email as the support domain. Misuse = phishing from a domain users trust.                                                   |
| `SUPPORT_FROM`, `SUPPORT_INBOX`                    | `support-mailer`    | Addresses, not credentials.                                                                                                      |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` | `store-apple-token` | Identifiers. Useless without the private key.                                                                                    |
| `APPLE_PRIVATE_KEY`                                | `store-apple-token` | **Signs Apple identity assertions.** Sign in with Apple token exchange.                                                          |

Also held in the database's **vault** (never in the repo, never in an env var
the app can read): `project_url` and `service_role_key`, which `pg_cron` uses
through `public.invoke_edge_worker(text)` to call the two workers.
`worker_status()` reports these as _present, length N_ and never their value.

---

## 3. CI secrets — GitHub Actions

The repository is **public**, so every Actions log is world-readable for ever.
`.github/scripts/` carries a log redactor with its own tests
(`apple-log-shapes.test.ts`) precisely because of this.

| Secret                                                                                | Grants                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                                                               | Supabase management API — deploy, secrets, config.                                                      |
| `SUPABASE_DB_PASSWORD`                                                                | Direct Postgres superuser-adjacent access.                                                              |
| `SUPABASE_PROJECT_REF`                                                                | Identifier.                                                                                             |
| `ANTHROPIC_API_KEY`                                                                   | Spend. Synced to the function environment.                                                              |
| `MODERATION_PROMPTS`, `..._BUSINESS`                                                  | See above.                                                                                              |
| `RESEND_API_KEY`                                                                      | Send as the support domain.                                                                             |
| `EXPO_TOKEN`                                                                          | **Publish an over-the-air update** to every installed app. Effectively code execution on users' phones. |
| `ASC_KEY_P`, `ASC_KEY_ID`, `ASC_ISSUER_ID`                                            | App Store Connect API — upload builds, manage TestFlight.                                               |
| `APPLE_PUSH_KEY_P`, `APPLE_SIGNIN_KEY_P`, `APPLE_SIGNIN_KEY_ID`, `APPLE_TEAM_ID`      | Send pushes as the app; sign Apple identity assertions.                                                 |
| `EXPO_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`, `..._POSTHOG_API_KEY`, `..._POSTHOG_HOST` | Public by design (§1); secrets only so builds are reproducible without a local `.env`.                  |
| `DEMO_PASSWORD`, `TEST_EMAIL_BASE`                                                    | E2E fixtures. Non-production accounts.                                                                  |
| `SUPPORT_FROM`                                                                        | Address.                                                                                                |

**If one had to be rotated first**, the order is: `EXPO_TOKEN` (ships code to
phones), `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_PASSWORD` (all user data),
`ANTHROPIC_API_KEY` (money), then the Apple keys. None needs rotating today.

---

## 4. Third-party services

| Service                               | Holds                                          | Region                  |
| ------------------------------------- | ---------------------------------------------- | ----------------------- |
| Supabase                              | Everything: auth, database, storage, functions | eu-central-1            |
| Anthropic                             | Moderation content in transit; classifications | API                     |
| PostHog                               | Product analytics events                       | EU (`eu.i.posthog.com`) |
| Resend                                | Support email delivery                         | —                       |
| Apple (APNs, ASC, Sign in with Apple) | Push tokens, builds, identity                  | —                       |
| Expo / EAS                            | Builds and OTA updates                         | —                       |
| Cloudflare                            | `web/` — marketing and legal site              | —                       |

---

## 5. Attack surface

**Edge Functions** — seven, and **all seven have `verify_jwt: true`** (read
live). No unauthenticated entry point.

| Function            | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `moderation-worker` | The classifier loop. The only paid-API caller.    |
| `push-worker`       | Drains `push_queue` to APNs.                      |
| `delete-account`    | App Review 5.1.1(v): storage objects + auth user. |
| `support-mailer`    | Support inbox delivery.                           |
| `featured-photo`    | Signed URLs for the featured surface.             |
| `guest-janitor`     | Expires guest accounts.                           |
| `store-apple-token` | Sign in with Apple refresh-token exchange.        |

**Storage buckets** — five, and **all five are private** (`public = false`).
Since `20260906110000`: 5 MB and `image/jpeg` on every one.

| Bucket                  | Standing per-user cap |
| ----------------------- | --------------------- |
| `profile-photos`        | 30 objects            |
| `chat-photos`           | 200 objects, 120/day  |
| `verification-selfies`  | 10 objects            |
| `business-photos`       | policy-gated          |
| `business-verification` | policy-gated          |

**Database** — RLS enabled on **every** table in `public`, no exceptions. 15
server-owned tables carry RLS with zero policies, which denies every API role
(`app_config`, `push_queue`, `outbound_mail`, `moderation_events`,
`apple_refresh_tokens`, `moderation_spend`, and the rest). 10 `admin_*` views
are granted only to `postgres` and `service_role`.

**Public web** — `web/`, static, on Cloudflare: marketing, privacy policy,
terms, community guidelines, and the Apple app-site-association file. No write
path, no credentials.
