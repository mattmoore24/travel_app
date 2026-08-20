---
name: ship
description: Get a change onto the founder's phone. Use whenever work is finished and needs to reach TestFlight — decides between an over-the-air update and an EAS build, runs the gate, and verifies the result. Also use when asked "is this on my build?", "publish this", or "why isn't my TestFlight updated?".
---

# Shipping Samewhere

The founder works from a phone and tests through TestFlight. There are two
ways to reach that phone, and picking the wrong one is expensive.

## 1. Decide: update or build?

**Default to an over-the-air update.** The free EAS plan allows a small
number of iOS builds per month and the founder has already been warned at
80% once. A build is only required when the _native_ layer changed:

| Changed                                                                                                            | Needs a build?                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Anything under `src/`, `app.json` extra fields, JS deps that ship JS only                                          | No — update                                      |
| `modules/` (local native modules)                                                                                  | **Yes**                                          |
| A new native dependency, or one whose native code changed                                                          | **Yes**                                          |
| `app.json` native config: bundle id, permissions/`infoPlist`, icons, splash, entitlements, `expo-build-properties` | **Yes**                                          |
| Expo SDK upgrade                                                                                                   | **Yes**                                          |
| `runtimeVersion` / version bump in `app.json`                                                                      | **Yes** (it changes which builds accept updates) |

If unsure, `npx expo prebuild --no-install --clean` on a scratch copy and
diff the generated `ios/` — a change there means a build.

## 2. Gate

Never push without all four passing:

```
npm run typecheck && npx expo lint && npm run format:check && npm test
```

If a migration is part of the change, it deploys through
`.github/workflows/supabase-deploy.yml` — read `traps` first, the
`RETURNS TABLE` rule has bitten this repo.

## 3. Push, then publish

Commit small and conventional (`feat:` / `fix:` / `chore:` / `docs:`), push
to the working branch, then:

- **Update:** GitHub Actions → `TestFlight` workflow → run with
  `action: update`. It publishes `eas update --branch production`. The
  founder gets it by force-quitting and reopening the app — no App Store
  round trip, no build quota.
- **Build, free — BLOCKED as of 2026-08-20.** `build-local-then-submit`
  cannot compile Expo SDK 57 on GitHub's `macos-15` image: every installed
  Xcode fails, in two contradictory ways. See `traps` for the swept table.
  The mechanism is sound and every other part of the path works (credentials,
  linkage proof, submit-by-path); only the toolchain is missing. Re-test when
  Expo or the runner image moves. Until then a native change needs the hosted
  builder below. What follows describes the path for when it works again.
- **Build, free (when it works):** the same workflow with
  **`build-local-then-submit`**. This
  runs the identical EAS build process on GitHub's own macOS runner
  (`eas build --local`), which spends **no** EAS build allowance — Expo's
  servers are contacted only to check the project exists and to bump the
  remote build number. Standard macOS runners are free and unlimited on a
  **public** repository. Takes ~30-40 minutes (no build cache) plus Apple
  processing. **This is the default for native changes.**
- **Build, hosted:** `build-then-submit`. Faster and cached, but spends one of
  the plan's monthly iOS builds. Reserve it for when the local path is broken
  or the quota is genuinely spare.

**Hosted quota is a hard wall, and simulator builds share it.** Every E2E run
with `build: true` spends one of the same monthly iOS builds a TestFlight
release does. When it runs out, EAS refuses the job at queue time — nothing is
built and nothing is consumed, but the hosted path stays closed until the 1st
of the month. The remote `buildNumber` is incremented _before_ the refusal, so
a rejected attempt still burns a build number; do not promise a specific one
until a build actually starts.

**The local path is not behind that wall**, which is why it is the default.
Its own limit is the repository being public. When the repo flips private at
launch (`docs/LAUNCH_RUNBOOK.md`), macOS minutes start billing at 10x against
the 2,000 free minutes a month — roughly 200 real macOS minutes, or about five
builds. Revisit the shipping strategy at that point.

**A local build must prove itself.** The workflow checks the generated
`ExpoModulesProvider.swift` for every native module it expects, and greps the
.ipa for a real Supabase host (the client falls back to
`placeholder.supabase.co`, so finding _a_ supabase URL proves nothing). Add a
check there whenever a build could plausibly succeed while shipping nothing.

`runtimeVersion` is `{policy: 'appVersion'}`, so an update only reaches
builds whose `version` in `app.json` matches. Bumping `version` orphans
every existing install from future updates until a new build ships.

## 4. Verify — do not assume

Check the workflow run actually succeeded and report the update ID and the
commit it came from. "Published" without a run ID is a guess.

## Never

- Never put a key with `service_role` in the client bundle, in chat, or in
  the repo. The app uses the anon key only.
- Never commit `.env`. `.env.example` is the template.
- Never paste moderation classifier prompts into the repo — they live in the
  GitHub secret so the public repo cannot be read for how to evade them.
