# App Store submission guide

Everything needed for TestFlight and App Review, in order. Blocked on exactly
one thing: the **Apple Developer Program membership** ($99/yr — founder ask
in PROGRESS.md). Everything below that needs no membership is already done.

## Readiness checklist

| Item                                                   | Status                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Bundle id `com.mattmoore.samewhere`                    | ✅ in app.json (locked before first submission)                                        |
| In-app account deletion (5.1.1(v))                     | ✅ Profile → Delete account (Edge Function)                                            |
| UGC safety set (1.2): report/block/moderate            | ✅ Phases 4–5, DB-enforced                                                             |
| UGC terms agreement + in-app guidelines (1.2)          | ✅ welcome screen consent + `/guidelines` screen                                       |
| Published developer contact (1.2)                      | ⚠️ in-app Contact us form ships; App Store Connect still needs a support address       |
| Permission purpose strings                             | ✅ photos + camera; microphone suppressed                                              |
| Encryption declaration (ITSAppUsesNonExemptEncryption) | ✅ app.json — no "missing compliance" stall                                            |
| EAS build profiles                                     | ✅ eas.json (development/preview/production)                                           |
| **Moderation pipeline actually ON**                    | ⚠️ ships dark by default — [runbook step 1](LAUNCH_RUNBOOK.md) BEFORE any review build |
| **EAS environment variables**                          | ⚠️ cloud builds don't read local `.env` — set them (below) or the app ships keyless    |
| Community guidelines + privacy policy (hosted)         | 📄 drafts in docs/legal/ — founder review, then host for the App Store URL field       |
| Apple Developer Program                                | ⬜ founder                                                                             |
| App icon final pass, screenshots                       | ⬜ after TestFlight build exists                                                       |
| Working name decision                                  | ✅ **Samewhere** — App Store search still owed (docs/NAMING.md)                        |

## EAS environment variables (do this before the first build)

`EXPO_PUBLIC_*` values are baked into the bundle at build time, and EAS builds
in the cloud — they never see your local `.env`, so a build made without this
step ships with no backend at all:

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR-REF.supabase.co --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value sb_publishable_... --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_POSTHOG_API_KEY --value phc_... --environment production --visibility plaintext
```

Repeat with `--environment preview` for TestFlight-only builds. Plaintext is
correct here: these are publishable keys, and privacy is enforced by RLS.

The PostHog line is **required, not optional**: a build made without it ships
with every `analytics.capture()` a silent no-op, four of the six §6 metrics
have no source at all, and the launch window cannot be measured after the
fact. The update workflows fail their preflight without the matching repo
secret for the same reason. Create the PostHog project in the **EU region**
(`https://eu.i.posthog.com`) — the privacy policy promises EU data residency,
and a US-cloud key does not answer on the EU host.

## TestFlight via EAS (once the Apple membership exists)

From any computer (no Mac needed — EAS builds in the cloud):

```bash
npm install -g eas-cli
eas login                      # Expo account (free)
eas init                      # links the project, writes the projectId
eas credentials               # let EAS manage certificates (recommended)
eas build --platform ios --profile production
eas submit --platform ios     # uploads the build to App Store Connect
```

Then in App Store Connect → TestFlight: add internal testers (instant) or an
external group (one-time beta review, ~1 day). Push notifications start
working in these builds automatically (Expo push + the deployed push-worker).

## Privacy nutrition labels (App Store Connect → App Privacy)

Declare **Data Linked to You**:

| Apple category      | What we actually collect                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contact Info        | Email address (sign-in)                                                                                                                                |
| User Content        | Profile photos, bio, first messages, chat messages, selfie (verification — deleted after review)                                                       |
| Identifiers         | User ID                                                                                                                                                |
| Other Personal Info | Display name, age, gender, home city/country, languages, social handles (revealed only after mutual accept)                                            |
| Location            | **None.** City-level _future intent_ only (trip city + dates, venue pins). No device location permission is ever requested — say this in review notes. |
| Usage Data          | Product analytics (PostHog), only if the key is configured                                                                                             |

Data used for tracking across apps/companies: **No**.

## Shipping changes without spending a build

EAS free plans include a limited number of iOS builds per month, and this
project hit 80% of one period's allowance in a day of iterating. Almost none
of that was necessary: this app's changes are overwhelmingly JavaScript, and
JavaScript ships over the air.

- **JS/TS, styles, copy, SQL** → Actions -> **TestFlight** -> `update`. No
  build spent. Testers get it the next time they fully close and reopen the
  app. `runtimeVersion` follows `app.json`'s `version`, so an update can only
  ever reach a build able to run it.
- **Native changes** → a real build is unavoidable: adding or removing a
  native module, anything under `plugins` in app.json, permission strings,
  icons/splash, the app version, or an SDK upgrade.
- **E2E** → `build=false` (the default) reuses the last simulator binary and
  pushes current JS to its `e2e` channel first. Only pass `build=true` after
  a native change.

Rough rule: if `npx expo prebuild` would produce different native projects,
it needs a build. Otherwise it does not.

**`modules/local-search` is the current example.** It is a local Expo module
(iOS only, Apple MapKit venue search). Autolinking picks up anything under
`modules/` with no config change — `nativeModulesDir` defaults to `./modules`
(expo-modules-autolinking/build/commands/autolinkingOptions.js). Because it is
native, it only exists in builds made after it was added: the JS side uses
`requireOptionalNativeModule`, which returns null rather than throwing on older
binaries, and the pin search falls back to address geocoding there. So the
feature ships dark over the air and lights up at the next build.

## App Review notes (paste into the Review Notes field)

> This is a travel friend-finding app, not a dating app, and the design
> enforces it: (1) every first message is screened by a moderation pipeline
> (keyword filter + LLM classification) BEFORE delivery; explicit or sexual
> content is blocked and repeat offenders are warned, suspended, or removed
> automatically. (2) Users can report and block from
> every profile and chat; blocking instantly severs visibility both ways.
> (3) Social media handles stay hidden until both users accept a chat.
> (4) The app never requests device location: the map shows only
> venue-level pins users type in for future plans, expiring within 72 hours.
> (5) Account deletion is in Profile → Delete account. (6) Selfie
> verification compares a selfie to profile photos server-side; the selfie is
> deleted after review.
>
> Demo account: [create one on TestFlight and fill in credentials here].

## Age rating

Answer the questionnaire honestly for a social app with user-generated
content and unrestricted web-free chat between adults: expect **17+**
(frequent/intense "unrestricted web access" is No; user-generated content
Yes with moderation). The DB enforces 18+ at profile level (age CHECK ≥ 18).

## Assets still to produce (needs a running build)

- 6.7" and 6.1" iPhone screenshots (map with pins + heat, travelers,
  request compose, chat with unlocked socials, profile)
- App Store icon 1024px (current icon.png is the working placeholder)
- Promotional text + description (draft from README/brief once the name is
  chosen — the name decision gates this)

## Expo Go: abandoned, do not retry

Two approaches were tried to get the app onto a phone without the $99
membership. Both failed, for reasons that will not change:

**Tunnelled dev server.** `expo start --tunnel` uses an ngrok token hardcoded
inside the Expo CLI (`AsyncNgrok.js` → `NGROK_CONFIG.authToken`) against Expo's
shared `exp.direct` account. There is no flag or env var to supply your own,
and that shared service refuses connections from GitHub runner IPs.

**EAS Update.** This published successfully — see
`.github/workflows/expo-go-publish.yml`, which works and is kept — but Expo Go
rejected the update as incompatible. Expo Go bundles native modules for one
SDK, and reconciling would mean downgrading the whole project off SDK 57,
giving up `expo-glass-effect` and the iOS 26 work.

Even when Expo Go works it cannot show the app icon, remote push, Liquid Glass,
or Sign in with Apple under the real bundle id. **TestFlight is the only path
that shows the actual product, and it is required before launch regardless.**

## The TestFlight pipeline (live as of 2026-08-19)

`.github/workflows/testflight.yml` — actions: `build`, `submit`,
`build-then-submit`. Five repository secrets drive it: `EXPO_TOKEN`,
`ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID`.

What the first flight taught, so nobody re-learns it:

1. **eas-cli cannot create iOS credentials non-interactively.** Its
   non-interactive path is a literal TODO that only reuses a certificate
   already on Expo's servers. `scripts/asc-provision.mjs` therefore mints the
   distribution certificate and App Store profile directly via the ASC API
   (registering the bundle id and the PUSH_NOTIFICATIONS / APPLE_ID_AUTH
   capabilities) and feeds the build through `credentials.json`.
2. **The p12 must be exported with `openssl pkcs12 -legacy`.** The EAS Mac's
   keychain import rejects OpenSSL 3's default encryption; the failure shows
   up as an opaque "Prepare credentials" error on the EAS side.
3. **The provisioning is stateless**: every build revokes the previous
   pipeline certificate and mints fresh. Apple emails a scary
   "null null has revoked your certificate" notice each time — "null null"
   is the API key's empty name. Expected. Safe ONLY while this pipeline is
   the team's sole signer; rework to key-reuse before any Mac/Xcode joins.
4. **The bundleIdCapabilities relationship endpoint rejects paging params.**
5. Build #4 (2026-08-19) proved the pipeline: signed .ipa in ~7 minutes.
   `submit` resolves the ASC app id from the bundle id at runtime and needs
   the App Store Connect app record to exist (founder-created, once).
