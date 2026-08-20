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
- **Build:** the same workflow with the build action. Costs quota and takes
  ~20 minutes plus Apple processing. Say so before starting one.

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
