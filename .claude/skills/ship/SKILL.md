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
- **Build, hosted — the working path for native changes.**
  `build-then-submit`. The account is on the **Starter plan** (upgraded
  2026-08-20): $19/month carrying $45 of build credit, with further usage
  billed at Expo's usage-based rates. So builds are no longer rationed to a
  monthly count, but they are **not free** — each one draws down real credit.
  Batch native changes rather than building per-commit, and keep shipping
  JavaScript over the air, which still costs nothing.
- **Build, local — BLOCKED as of 2026-08-20, and no longer needed.**
  `build-local-then-submit` cannot compile Expo SDK 57 on GitHub's `macos-15`
  image: every installed Xcode fails, in two contradictory ways. See `traps`
  for the swept table. The mechanism is sound and every other part of that
  path works (credentials on either OS, linkage proof, submit-by-path); only
  the toolchain is missing. It stays as a fallback worth re-testing if the
  subscription ever lapses or the runner image moves.
  How the local path works, for whenever it is testable again: this
  runs the identical EAS build process on GitHub's own macOS runner
  (`eas build --local`), which spends **no** EAS build allowance — Expo's
  servers are contacted only to check the project exists and to bump the
  remote build number. Standard macOS runners are free and unlimited on a
  **public** repository. Takes ~30-40 minutes (no build cache) plus Apple
  processing. It WAS the default for native changes until the toolchain
  broke; the hosted path above is the one that works.

**Simulator builds draw on the same credit.** Every E2E run with
`build: true` is a real iOS build. Leave it `false` unless native code
changed or `version` moved — a false run reuses the last binary and pushes
current JS to it over the `e2e` channel, which costs nothing.

**After any `version` bump, one E2E run needs `build: true`**: a false run
publishes an update for the new runtime that the reused binary cannot take,
and the fetch gate fails rather than screenshotting old JavaScript. The 0.2.0
one was run 109 (2026-09-04); `false` is right again since.

The workflow's own input description used to contradict this, claiming the
simulator could not reach `u.expo.dev`. It was wrong, and the evidence for it
was a step that died 0.1s after launching the app because of an errexit bug,
before it had waited for anything. Run 43 fetched the update and launched it.
If a future run cannot fetch, read the log — the step prints the updates
table and expo-updates' own log now — rather than concluding the path is
broken and spending a build.

**`EXPO_PUBLIC_*` is inlined at BUNDLE time.** So `eas update` needs the
Supabase secrets in its own job, not just in the job that drives the
simulator. Run 43 shipped a perfectly good update of an app that could not
reach its backend: empty map, "waiting on backend keys", and a flow that
died on a button a keyless app never renders. A BUILD hides this, because
EAS reads the same secrets from the project — so it is a failure mode only
the over-the-air path has, and the step now refuses to publish without
them.

**Never promise a build number before a build starts.** The remote
`buildNumber` increments when the build is requested, including for attempts
that are then refused or that fail — several numbers were burned that way on
2026-08-20. Read the number back from the finished build instead.

**The local path was not behind that wall**, which is why it was the default
until the toolchain broke. Its own limit is the repository being public. When the repo flips private at
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

**That happened on 2026-09-02: `version` is 0.2.0 in the tree.** The phone
has build 16 (`c9128c55`, commit `1cbe144`, 2026-08-30) and the e2e channel
has simulator build 13 (2026-08-22); both are runtime 0.1.0, and neither
takes an update published from this tree. The order of operations, from
`docs/APP_STORE.md` "The version moved to 0.2.0":

1. Run the build (`build-then-submit`) with the bump in it. It is the last
   thing to land in a batch of native changes, never the first.
2. Confirm the build installs from TestFlight and opens.
3. Only then publish updates. An update published between the bump and the
   install reaches nobody, and no run goes red to say so.

The first E2E run after the bump needs `build: true` once (above).

## 3b. A green deploy does not mean the workers run

`supabase functions deploy` reporting success means the code was UPLOADED.
It says nothing about whether the function runs — a bad import fails at the
first invocation, and the worker then does nothing every minute while every
check stays green. On 2026-08-21 that took moderation down for half an hour:
first messages held and never released, deploy green, nothing red anywhere.
The only thing that noticed was the ten-minute live-backend suite.

The deploy now POSTs each worker once and fails if it answers anything other
than 2xx / 401 / 403. Do not remove that step, and do not treat a green
`functions deploy` as evidence on its own.

For anything touching the workers, the moderation pipeline, or RLS on a path
the app depends on, run **Live backend tests** afterwards and read the result.
It is the only check that exercises the real project end to end, and its
"clean message RELEASED within 5 min" assertion is the canary for a dead
worker. Note that its "flirty message NEVER delivered" assertion passes
trivially when nothing is delivered at all, so a half-red run can still look
reassuring — read the whole list.

## 4. Verify — do not assume

Check the workflow run actually succeeded and report the update ID and the
commit it came from. "Published" without a run ID is a guess.

## Never

- Never put a key with `service_role` in the client bundle, in chat, or in
  the repo. The app uses the anon key only.
- Never commit `.env`. `.env.example` is the template.
- Never paste moderation classifier prompts into the repo — they live in the
  GitHub secret so the public repo cannot be read for how to evade them.
