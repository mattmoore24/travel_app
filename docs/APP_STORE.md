# App Store submission guide

Everything needed for TestFlight and App Review, in order. Blocked on exactly
one thing: the **Apple Developer Program membership** ($99/yr — founder ask
in PROGRESS.md). Everything below that needs no membership is already done.

## Readiness checklist

| Item                                                   | Status                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Bundle id `com.mattmoore.travelapp`                    | ✅ in app.json (change now or never)                                                   |
| In-app account deletion (5.1.1(v))                     | ✅ Profile → Delete account (Edge Function)                                            |
| UGC safety set (1.2): report/block/moderate            | ✅ Phases 4–5, DB-enforced                                                             |
| UGC terms agreement + in-app guidelines (1.2)          | ✅ welcome screen consent + `/guidelines` screen                                       |
| Published developer contact (1.2)                      | ✅ mattmoorefb24@gmail.com (interim — swap for a support inbox before launch)          |
| Permission purpose strings                             | ✅ photos + camera; microphone suppressed                                              |
| Encryption declaration (ITSAppUsesNonExemptEncryption) | ✅ app.json — no "missing compliance" stall                                            |
| EAS build profiles                                     | ✅ eas.json (development/preview/production)                                           |
| **Moderation pipeline actually ON**                    | ⚠️ ships dark by default — [runbook step 1](LAUNCH_RUNBOOK.md) BEFORE any review build |
| **EAS environment variables**                          | ⚠️ cloud builds don't read local `.env` — set them (below) or the app ships keyless    |
| Community guidelines + privacy policy (hosted)         | 📄 drafts in docs/legal/ — founder review, then host for the App Store URL field       |
| Apple Developer Program                                | ⬜ founder                                                                             |
| App icon final pass, screenshots                       | ⬜ after TestFlight build exists                                                       |
| Working name decision                                  | ⬜ founder (candidates in PROGRESS.md)                                                 |

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

## App Review notes (paste into the Review Notes field)

> This is a platonic travel friend-finding app — explicitly not a dating app,
> and the design enforces that: (1) every first message is screened by a
> moderation pipeline (keyword filter + LLM classification) BEFORE delivery;
> flirtatious/sexual content is blocked and repeat offenders are
> warned/suspended/banned automatically. (2) Users can report and block from
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
