# App Store submission guide

Everything needed for TestFlight and App Review, in order.

## Readiness checklist

Two things block a submission that money cannot both fix: the **Apple
Developer Program membership** ($99/yr, founder ask in PROGRESS.md) and the
founder review of `docs/legal/`. The rest is done, or is listed here as
blocking so nothing discovers it on submission day.

| Item                                                   | Status                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Bundle id `com.mattmoore.samewhere`                    | done, in app.json (locked before first submission)                                           |
| In-app account deletion (5.1.1(v))                     | done, Profile then Delete account (Edge Function)                                            |
| **Sign in with Apple token revocation (5.1.1(v))**     | **BLOCKING** - code shipped, needs the .p8 key below; a logged no-op until then              |
| UGC safety set (1.2): report/block/moderate            | done, phases 4 to 5, DB-enforced                                                             |
| UGC terms agreement + in-app house rules (1.2)         | done, welcome screen consent + `/guidelines` and `/privacy` screens                          |
| Published developer contact (1.2)                      | done, <https://link.samewhere.io/support> plus the in-app Contact us form                    |
| Privacy policy URL (5.1.1(i))                          | done, <https://link.samewhere.io/privacy>, and the same summary ships inside the app         |
| Permission purpose strings                             | done, photos + camera; microphone suppressed                                                 |
| Encryption declaration (ITSAppUsesNonExemptEncryption) | done in app.json, no "missing compliance" stall                                              |
| EAS build profiles                                     | done, eas.json (development/preview/production)                                              |
| **Moderation pipeline actually ON**                    | **BLOCKING** - ships dark by default, [runbook step 1](LAUNCH_RUNBOOK.md) before review      |
| **EAS environment variables**                          | **BLOCKING** - cloud builds do not read local `.env`; set them (below) or the app is keyless |
| **Legal text signed off**                              | **BLOCKING** - `docs/legal/` are drafts with bracketed founder and lawyer items left in      |
| **Age-rating questionnaire answered**                  | **BLOCKING** - see Age rating below; the tiers changed and must be read off the form         |
| **Listing copy entered**                               | drafted below; needs pasting into App Store Connect per territory                            |
| **Name and trademark checks**                          | **BLOCKING** - docs/NAMING.md, never run; the bundle id is unchangeable after submission     |
| iPad, Mac and Vision Pro distribution                  | decided: iPhone only for v1, opt out in App Store Connect (see below)                        |
| Apple Developer Program                                | founder                                                                                      |
| App icon final pass, screenshots                       | after a TestFlight build exists                                                              |

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

## Sign in with Apple: the revocation key (5.1.1(v))

An app that offers **both** Sign in with Apple and in-app account deletion
must call Apple's revoke endpoint when the account goes. Apple has rejected
apps for exactly this since 2022, and this app ships both halves
(`usesAppleSignIn` in app.json, the button on the join and email screens).

The code is written and deployed: `store-apple-token` captures the
authorization code at sign-in and exchanges it for a refresh token into
`public.apple_refresh_tokens` (service role only), and `delete-account` spends
that token on `https://appleid.apple.com/auth/revoke` before it removes the
auth row. Until the key below exists, both degrade to a **logged no-op** —
grep the function logs for `apple revoke:` to see which branch was taken.

Create the key once the membership exists: Certificates, Identifiers &
Profiles → Keys → **+**, enable **Sign in with Apple**, download the `.p8`
(Apple lets you download it exactly once), and note the Key ID and Team ID.

```bash
supabase secrets set APPLE_TEAM_ID=ABCDE12345
supabase secrets set APPLE_KEY_ID=FGHIJ67890
supabase secrets set APPLE_CLIENT_ID=com.mattmoore.samewhere
supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_FGHIJ67890.p8)"
```

`APPLE_CLIENT_ID` is the **bundle id**, not a Services ID: the Services ID is
for a web sign-in flow this app does not have. The `.p8` never enters the repo
or the app bundle; it lives only in function secrets.

Then verify once, by hand, against a real TestFlight account: sign in with
Apple, delete the account from Profile, and confirm the function log says
`apple revoke: ok (200)` and that the app is gone from **Settings → your name
→ Sign in with Apple**. Record the run in `docs/PROGRESS.md`.

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

## Privacy nutrition labels (App Store Connect, App Privacy)

Every row here was read off the code, not off a memory of what the app does.
Get this wrong in the generous direction and the label is a lie; get it wrong
in the stingy direction and App Review rejects the build.

Declare **Data Linked to You**:

| Apple category                 | What we actually collect                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact Info                   | Email address (sign-in). A business account also gives an email for its confirmation code.                                                                                                                                                                                                         |
| User Content                   | Profile photos, bio, first messages, chat messages, business photos and posts, the verification selfie (deleted as soon as the check has an answer).                                                                                                                                               |
| **Sensitive Info**             | **The verification selfie is a face comparison, so it is biometric data** (decision D21, GDPR Art. 9, Apple's Sensitive Info bucket). Optional, consent-gated, no template computed, image deleted after the verdict. `docs/legal/PRIVACY_POLICY.md` says exactly this and the answers must match. |
| Identifiers                    | User ID, **and a Device ID**: the PostHog React Native SDK mints its own `distinct_id` and persists it on the device, whether or not you are signed in.                                                                                                                                            |
| Usage Data                     | Product interaction (screens opened, features used) through PostHog, on their EU cloud.                                                                                                                                                                                                            |
| Diagnostics                    | PostHog attaches device model, OS version, app version, locale and time zone to every event. That is Other Diagnostic Data whether we asked for it or not.                                                                                                                                         |
| Other Personal Info            | Display name, age, gender, home city and country, languages, social handles (revealed only once both people are in a chat).                                                                                                                                                                        |
| Other Personal Info (business) | Trading name, street address, map marker, opening hours, links (website, menu, phone, email, WhatsApp, socials), photos, and the email confirmation loop.                                                                                                                                          |
| Location                       | **None.** City-level future intent only (a trip city and dates, a venue pin). No location permission is ever requested. Say this in the review notes too.                                                                                                                                          |

Data used for **tracking** across apps and companies: **No.** Nothing here
goes to an advertising network, and there is no IDFA request anywhere in the
build.

Two things to re-check at submission, because both have moved before:

- If `EXPO_PUBLIC_POSTHOG_API_KEY` is genuinely absent from the production
  build, the Identifiers/Usage/Diagnostics rows are over-declaring. They are
  not absent in the plan (see the EAS variables section, which calls the key
  required), so declare them.
- If the verification pipeline ever changes to compute an embedding or a face
  template, the Sensitive Info row and the privacy policy's Verification
  section are both wrong the same day.
- **The Sign in with Apple refresh token** (`public.apple_refresh_tokens`,
  added 2026-08-31) is stored against the user id for the life of the account.
  It is a credential against Apple rather than one of Apple's own label
  categories, so whether it is declared at all — and if so, whether under
  Identifiers — is a question for the lawyer reviewing the policy. The privacy
  policy names it outright either way, in **What we collect** and in
  **Retention and deletion**, so the two cannot disagree by accident.

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

> Samewhere helps travelers find other travelers in the same city on the same
> dates, and meet in person. It is a platonic friend-finding app, not a dating
> app, and the design enforces that.
>
> 1. Every first message is screened by a moderation pipeline (keyword filter
>    plus LLM classification) BEFORE delivery. Explicit or harassing content is
>    blocked and never reaches the recipient; repeat offenders are warned,
>    suspended or removed automatically.
> 2. Report is on every profile, every business listing, every one-to-one
>    chat, on any single message inside a group or a business room, and on a
>    traveler-made group itself, from its group page. A group report does not
>    have to name a person, because the problem is sometimes the room. Anything
>    with no Report action of its own, and anything at all from a signed-out
>    visitor, goes through Contact us. Block is per person, from a profile or a
>    chat, and it severs visibility both ways immediately.
> 3. Social handles stay hidden until both people are in a chat together. This
>    is enforced by row-level security in Postgres, not by the client.
> 4. The app requests NO location permission and holds none. The map shows only
>    venue-level pins people typed in for future plans, and every pin is
>    permanently deleted within 72 hours. If a location framework appears in the
>    binary, it is used only to turn a typed address into a coordinate for a
>    business listing, never to read the device.
> 5. Account deletion is in Profile, then Delete account, and it removes both
>    sides of every chat.
> 6. Verification is optional. A selfie is compared server-side against the
>    user's own profile photos to check they are the same person; no face
>    template is computed and the selfie is deleted as soon as the check has an
>    answer. It is declared as Sensitive Info on the privacy card.
>
> How to verify the claims in five taps:
>
> - **Map tab**: pins are plans, each showing a venue and a day. Tap one; the
>   card names the day it expires.
> - **Travelers tab**: full-page profiles of people whose trip dates overlap
>   yours. There is no card stack and no yes/no gesture.
> - **Say hi**: write a first message. It is held for screening before the
>   other person sees anything.
> - **Chats tab**: open an accepted chat and look at the profile from it. The
>   socials row is present here and absent before the chat exists, which is
>   claim 3.
> - **Your profile** (the avatar in the top corner of any tab; there is no
>   profile tab). It is three different pages, so each one, exactly:
>   - _Traveler account_: House rules and help, Privacy, and Delete account
>     are one tap. Contact us is the "Send us a message" button inside either
>     of the first two.
>   - _Business account_ (the second demo account below): Privacy, "Send us a
>     message" (that is Contact us) and Delete account are one tap. The rules
>     a business is held to are printed on the page itself instead of behind
>     a House rules button, because the traveler rulebook is written for
>     somebody else.
>   - _Signed out, or browsing as a guest_: House rules and Privacy are one
>     tap, and Contact us is one more tap inside either. There is no Delete
>     account, because there is no account.
>
> Demo accounts (both on the production backend, both safe to write in):
>
> - Traveler: [email] / [password] - has a live trip, a pin, one accepted chat
>   and one pending first message, so claims 1 to 4 are all visible.
> - Business: [email] / [password] - owns a confirmed listing with photos,
>   hours and links, and a room travelers have written into. The tab set is
>   different from a traveler's, which is why a second account is needed.
>
> [FOUNDER: create both on the first TestFlight build and paste the
> credentials in. An empty demo-account field on a two-account-type app is a
> rejection.]

## Age rating

**Do not answer this from memory, and do not copy the number this document
used to carry.** Apple retired the old 4+/9+/12+/17+ ladder, added tiers in
between, and replaced the short form with a questionnaire that now includes
in-app-controls questions. The exact tier names and the exact questions must
be read off the live form in App Store Connect at submission time.

What matters is that this app has real answers to the questions that decide
the rating, and they are all evidenced in the code:

| Question the form asks about | The honest answer, and where it lives                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User-generated content       | Yes: profiles, photos, first messages, chats, business listings.                                                                                                                                                         |
| Is UGC moderated?            | Yes, and before delivery. Every first message is screened (brief §7 rule 5); photos and business content go through the same worker.                                                                                     |
| Reporting and blocking       | Yes: every profile, every business listing, every one-to-one chat, any single message in a group or room, and a group itself from its group page. A group report need not name a person. Blocking is instant and mutual. |
| Unrestricted web access      | No. The only web views are a business's own website and menu, opened in an in-app browser from a listing the owner confirmed.                                                                                            |
| Contests, gambling, ads      | None of it. No ads, no purchases, no paywall.                                                                                                                                                                            |
| Age restriction              | 18+ enforced in the database: `core_auth_profiles.sql` has `age between 18 and 120`, not a checkbox.                                                                                                                     |
| Location                     | No permission requested. Venue-level future intent only.                                                                                                                                                                 |
| Contact between users        | Yes, one to one and in groups, all of it moderated at first contact and reportable after.                                                                                                                                |

**This is the questionnaire's whole argument for a lower tier than
unmoderated chat earns**, and it is worth spending ten minutes on rather than
clicking through: the rating decides whether the app is discoverable by the
young solo travelers the brief is about, and whether Screen Time hides it.

[TO CONFIRM AT SUBMISSION: the tier the questionnaire produces, and whether
any answer above needs to change because of a question this table does not
anticipate. Write the resulting tier back into this document.]

## Assets still to produce (needs a running build)

### Screenshots

**The required display classes must be read off App Store Connect at
submission.** Apple consolidated the iPhone classes and the old 6.7-inch and
6.1-inch pair this document used to name is stale. Do not shoot against a
remembered size: open the Media Manager, read which iPhone class is mandatory
and which are optional, and shoot that. The largest current iPhone class
(around 6.9 inches) is the one to author at, because App Store Connect scales
down and never up.

Shoot five, ordered as claims rather than as a tour of the tabs. The first two
are the ones that appear in search results:

| #   | Filename             | The claim it makes                                                                             |
| --- | -------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `01-map-plans.png`   | The map with pins and one pin card open. Nobody else in this category has this screen.         |
| 2   | `02-overlap.png`     | A traveler whose dates overlap yours, with the shared window marked.                           |
| 3   | `03-first-hello.png` | A first message being written against a specific line of somebody's profile.                   |
| 4   | `04-socials.png`     | A chat with the socials row unlocked, captioned that it is hidden until you both chat.         |
| 5   | `05-promises.png`    | The map again, captioned with the two promises: no location, ever; every pin gone in 72 hours. |

Two rules that come out of past mistakes: **do not gate shot 1 on the heat
layer** (it needs seeded density and it is not what makes the screen
convincing), and **no filename or caption may carry the banned vocabulary**.
The old spec called shot 3 "request compose", which is how a banned word
reaches a caption.

### Everything else

- App Store icon at 1024px, drawn as artwork rather than upscaled from the
  in-app icon (see the `platform-app-icon` package).
- The listing copy below, pasted into App Store Connect.
- Localised metadata for the four launch markets (see Localisation below).

## Listing copy

Everything in this section is indexed or read by a human deciding in about
four seconds, so it is drafted here, in the app's own voice, rather than
written at submission time from whatever competitor is open in another tab.
The nearest references in this category are all dating apps and their grammar
is exactly what must not be imported.

`src/app/__tests__/copy-lint.test.ts` scans between the two markers below for
em dashes and for the banned vocabulary, so this section cannot drift.

<!-- listing-copy:start -->

**App Name** (30 characters, indexed)

```
Samewhere: Meet Travelers
```

**Subtitle** (30 characters, indexed)

```
Travel friends, never dates
```

It has to answer "is this a dating app?" before the reader thinks to ask, and
it does it without spending a single indexed character on the word dating.

**Keywords** (100 characters, indexed, no spaces after the commas, and never
a word already used in the name or subtitle)

```
solo,backpacker,hostel,trip buddy,abroad,nomad,expat,meetup,platonic,itinerary,city,plans,hangout
```

**Description.** App Store Connect shows only the first few RENDERED lines
before More, so the opening sentence carries all three of the map, the shared
dates and the word platonic inside its first 120 characters.

**Every paragraph in these fenced blocks is one physical line, deliberately.**
They are pasted verbatim, and App Store Connect keeps every newline it is
given: hard-wrapping this source at 80 columns put a line break in the middle
of a sentence on the store page. `src/app/__tests__/copy-lint.test.ts` fails
if a paragraph is re-wrapped.

```
A map of what other travelers have planned, and who is in your city on the same dates. Platonic, not a dating app.
Post your trip and see who else will be there while you are, with the days you share already marked. Samewhere is for finding people to eat, walk and explore with.

WHAT IT IS
Travelers post the city they will be in and the dates they are there.
The map shows plans people typed in themselves: a bar on Friday, a hike on Sunday, a hostel quiz tonight. Open a plan, see who is going, say hello.

WHY IT DOES NOT FEEL LIKE THE OTHER APPS
One person at a time, a whole page each, read in full. Say hello, or move on to the next one.
Your first message is read before it is delivered, so opening your inbox is not a gamble.
Your social handles stay hidden until you are both in a chat together. The database enforces that, not the app.

WHAT WE NEVER DO
We never collect your location. Not once, not in the background, not ever. The map shows plans, not people.
Every pin disappears within 72 hours. A plan is a plan, not a public diary.
Finding people, the map and messaging are free forever. No paywall, no premium tier, nothing held back to sell you later.

FOR HOSTELS, BARS AND CAFES
Hostels, bars, cafes and tour operators can claim a listing, put their hours, photos and links on the map, and answer travelers who write in. Travelers rate a business out of ten, anonymously.

SAFETY
Report a profile, a business listing, any message or a whole group, and block anybody: blocking is instant and both ways. Verification is one selfie and gives you a badge, and you can choose to be seen only by travelers who have one. Make plans in public places, and tell somebody where you are going.
```

**Promotional text** (170 characters, editable without a review)

```
Post your trip, drop your plans on the map, and find the travelers whose days overlap yours. Free, platonic, and it never asks where you are.
```

**What's New** (first release)

```
First release. Post a trip, put your plans on the map, and find the travelers who are in town when you are. Tell us what breaks: hello@samewhere.io
```

<!-- listing-copy:end -->

## Localisation

**The app's own strings stay English for v1** (decision D5: device conventions
for dates and times, English strings). **The listing does not.**

Localised App Store metadata is per-territory, needs no build, and ships
independently of the binary, so there is no reason for four launch markets to
read an English listing. Localise the name, subtitle, keywords, description
and screenshots' captions for:

| Territory | Locale | Launch city |
| --------- | ------ | ----------- |
| Portugal  | pt-PT  | Lisbon      |
| Mexico    | es-MX  | Mexico City |
| Thailand  | th     | Bangkok     |
| Indonesia | id     | Bali        |

"travel friends" and "amigos de viagem" are different search markets, and the
keyword field is per-locale. Have a native speaker read the subtitle and the
first three description lines at minimum; a machine-translated listing in this
category reads as a scam, which is the opposite of what the copy is for.

## iPad, Mac and Vision Pro distribution

**Decided: iPhone only for v1.** `app.json` has `supportsTablet: false`, and
App Store Connect must ALSO be told to opt out of Apple silicon Mac and Vision
Pro distribution, which are on by default.

The case for turning iPad on later is real: the first place a traveler plans a
trip is often a laptop or a tablet in a hostel common room, and the groundwork
exists (`MaxContentWidth` centring on twenty-plus roots). But nothing in this
build has been exercised once on those platforms, and three things would need
looking at first: the profile hero at `heroWidth * 1.15`, the intro tour's
fixed 320pt artwork, and every sheet. Shipping to two unexamined platforms to
save an opt-out click is not a trade worth making before the first review.

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
