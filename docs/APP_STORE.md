# App Store submission guide

Everything needed for TestFlight and App Review, in order.

## Readiness checklist

The **Apple Developer Program membership** is live (build 17 reached
TestFlight on it), so the one thing money cannot fix is the founder review of
`docs/legal/`. The rest is done, or is listed here as blocking so nothing
discovers it on submission day.

| Item                                                   | Status                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle id `com.mattmoore.samewhere`                    | done, in app.json (locked before first submission)                                                                                                                                    |
| In-app account deletion (5.1.1(v))                     | done, Profile then Delete account (Edge Function)                                                                                                                                     |
| Sign in with Apple provider enabled                    | done — the deploy enables it and re-reads it; run #105 (2026-09-04) printed "Verified against a fresh GET", enabled: true, client IDs `com.mattmoore.samewhere`. Needs no key (below) |
| Sign in with Apple token revocation (5.1.1(v))         | done — verified end to end on 2026-09-04: `apple revoke: ok (200)` from a real TestFlight deletion, read out of the live function log by the Apple revoke log workflow                |
| UGC safety set (1.2): report/block/moderate            | done, phases 4 to 5, DB-enforced                                                                                                                                                      |
| UGC terms agreement + in-app house rules (1.2)         | done, welcome screen consent + `/guidelines` and `/privacy` screens                                                                                                                   |
| Published developer contact (1.2)                      | done, <https://link.samewhere.io/support> plus the in-app Contact us form                                                                                                             |
| Privacy policy URL (5.1.1(i))                          | done, <https://link.samewhere.io/privacy>, and the same summary ships inside the app                                                                                                  |
| Permission purpose strings                             | done, photos + camera; microphone suppressed                                                                                                                                          |
| Encryption declaration (ITSAppUsesNonExemptEncryption) | done in app.json, no "missing compliance" stall; the reasoning is under Export compliance                                                                                             |
| EAS build profiles                                     | done, eas.json (development/preview/production)                                                                                                                                       |
| **Moderation pipeline actually ON**                    | **BLOCKING** - ships dark by default, [runbook step 1](LAUNCH_RUNBOOK.md) before review                                                                                               |
| **EAS environment variables**                          | **BLOCKING** - cloud builds do not read local `.env`; set them (below) or the app is keyless                                                                                          |
| **Legal text signed off**                              | **BLOCKING** - `docs/legal/` are drafts with bracketed founder and lawyer items left in                                                                                               |
| **Age-rating questionnaire answered**                  | **BLOCKING** - see Age rating below; the tiers changed and must be read off the form                                                                                                  |
| **Listing copy entered**                               | drafted below; needs pasting into App Store Connect per territory                                                                                                                     |
| **Name and trademark checks**                          | **BLOCKING** - docs/NAMING.md, never run; the bundle id is unchangeable after submission                                                                                              |
| iPad, Mac and Vision Pro distribution                  | decided: iPhone only for v1, opt out in App Store Connect (see below)                                                                                                                 |
| Apple Developer Program                                | done, membership active; builds 15 to 17 were signed and delivered on it                                                                                                              |
| App icon final pass, screenshots                       | icon: brief and measurements under Assets, artwork still needed; screenshots need a build                                                                                             |

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

## Sign in with Apple: the provider and the revoke key (5.1.1(v))

**Two independent halves, and they are constantly conflated.**

|                   | (a) the sign-in working                                                                                 | (b) the revoke on deletion                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| What it is        | the Supabase Auth provider on, with the bundle id as an acceptable token audience                       | `delete-account` calling `https://appleid.apple.com/auth/revoke` before it deletes    |
| Needs a key?      | **No.** No `.p8`, no Services ID, no client secret.                                                     | Yes — a Sign in with Apple `.p8` from Apple's portal.                                 |
| Who does it       | `supabase-deploy.yml` → "Enable the Apple auth provider", on every deploy                               | `supabase-deploy.yml` → "Sync Sign in with Apple secrets", once the two secrets exist |
| Broken looks like | the Apple button signs nobody in: "Provider ... is not enabled", or "Unacceptable audience in id_token" | nothing at all, until App Review rejects the app                                      |

(a) without (b) is an app that signs people in and is rejected under 5.1.1(v).
(b) without (a) is a revoke path nobody can reach. Both are required, and
neither one being done says anything about the other.

### (a) The provider — automatic, no key

`.github/scripts/enable-apple-provider.mjs` PATCHes the project's auth config
through the Supabase Management API (`external_apple_enabled`,
`external_apple_client_id`), then **re-reads it with a fresh GET** and fails if
the provider is not on or the bundle id is not in its client IDs. It is
idempotent — it appends the bundle id only when it is missing, does nothing at
all when the state is already right, and never reorders an existing entry,
because the FIRST client ID is the one a web `signInWithOAuth` flow would use.
It also fingerprints every non-Apple key in the auth config before and after and
fails if any of them moved, which is what proves the PATCH is partial rather
than a whole-document replace. Nothing from that config is ever printed: the
same response carries the Twilio token and the captcha secret.

`external_apple_client_id` is the **bundle id**. The app signs in with
`supabase.auth.signInWithIdToken({ provider: 'apple' })`, the native path;
Supabase Auth checks the `aud` of Apple's identity token against the client IDs,
and a device's identity token is audienced to the app's bundle id. A Services ID
is the audience of the **web** redirect flow, which this app does not have.
`external_apple_secret` is that same web flow's client secret and is deliberately
never sent — Supabase's own guide: "If you're building a native app only, you do
not need to configure the OAuth settings."

**It has run.** Supabase deploy run #105 (2026-09-04, commit `0cefdbd`) printed
`Read back — enabled: true`, `Read back — client IDs: com.mattmoore.samewhere`,
and the same 238-key / `575d25567319e7dc` fingerprint before and after, so the
PATCH is partial in fact and not only on the schema's word. The provider was
already on when the step first ran, which is the idempotent branch ("Nothing to
change") doing its job rather than the step being skipped.

### (b) The revoke — needs the key, and stays a no-op without it

An app that offers **both** Sign in with Apple and in-app account deletion must
call Apple's revoke endpoint when the account goes. Apple has rejected apps for
exactly this since 2022, and this app ships both halves (`usesAppleSignIn` in
app.json, the button on the join and email screens).

The code is written and deployed: `store-apple-token` captures the authorization
code at sign-in and exchanges it for a refresh token into
`public.apple_refresh_tokens` (service role only), and `delete-account` spends
that token on `https://appleid.apple.com/auth/revoke` before it removes the auth
row. Until the key exists, both degrade to a **logged no-op** — grep the function
logs for `apple revoke:` to see which branch was taken.

**What the founder does, in a browser, once — DONE 2026-09-04.** The key was
created, both secrets were added, and Supabase deploy run #105 synced all four
function secrets. Kept here because it is the recipe for a rotated key:

1. Apple Developer → Certificates, Identifiers & Profiles → **Keys** → **+**,
   enable **Sign in with Apple**, download the `.p8` (Apple lets you download it
   exactly once), note the 10-character Key ID.
2. GitHub → Settings → Secrets and variables → Actions → **New repository
   secret**, twice:
   - `APPLE_SIGNIN_KEY_ID` — the Key ID from step 1.
   - `APPLE_SIGNIN_KEY_P8` — the FULL text of `AuthKey_XXXXXXXXXX.p8`, BEGIN and
     END lines included.
3. Run the deploy: commit any change to `supabase/.deploy-request` (works from
   any branch), or Actions → **Supabase deploy** → Run workflow, which GitHub
   only lists once that workflow file is on the default branch.

**The `APPLE_SIGNIN_` prefix is deliberate.** `ASC_KEY_ID` is already a
repository secret and it is the **App Store Connect API key** — a different key,
from a different section of Apple's portal, used by `scripts/asc-provision.mjs`
to mint signing certificates. Naming this one `APPLE_KEY_ID` would have put it
one dropdown away, and swapping them fails silently: the revoke would sign its
JWT with the wrong key and Apple would answer 400 at deletion time, to nobody.

The deploy maps the two new secrets onto the four names
`supabase/functions/_shared/apple.ts` reads, and takes the other two from what
the repo already has:

| Edge Function secret | comes from                                            |
| -------------------- | ----------------------------------------------------- |
| `APPLE_KEY_ID`       | `APPLE_SIGNIN_KEY_ID` (new)                           |
| `APPLE_PRIVATE_KEY`  | `APPLE_SIGNIN_KEY_P8` (new)                           |
| `APPLE_TEAM_ID`      | the `APPLE_TEAM_ID` repo secret `testflight.yml` uses |
| `APPLE_CLIENT_ID`    | a literal in the workflow, `com.mattmoore.samewhere`  |

With the two secrets absent the step **warns and carries on**, naming what stays
a no-op: a deploy must not go red for a founder errand that has not happened yet.
With a value present but malformed — a Key ID that is not ten uppercase
alphanumerics, a `.p8` pasted without its BEGIN line — it **fails loudly**, after
the migrations and the functions have already deployed. That asymmetry is the
point: both callers wrap the Apple work in `try`/`catch`, so a key that looks set
and cannot be parsed produces `apple revoke: threw:` in a log nobody reads and an
account deletion that leaves the app listed under Settings. The `.p8` never
enters the repo, the app bundle, or a workflow log.

Doing it by hand instead, from a machine with the Supabase CLI:

```bash
supabase secrets set APPLE_TEAM_ID=ABCDE12345
supabase secrets set APPLE_KEY_ID=FGHIJ67890
supabase secrets set APPLE_CLIENT_ID=com.mattmoore.samewhere
supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_FGHIJ67890.p8)"
```

### The one hand-run nothing can automate — done 2026-09-04

Verified end to end against the live project. The founder signed in with Apple
on TestFlight, created an account and deleted it from Profile; the function log
says:

```
2026-09-04T12:33:11  apple revoke: ok (200)
```

The same window also holds a deletion from the evening before the key existed,
which answered `no token for this account, nothing to revoke` — so the before
and the after are both on the record, and the pass is not an artefact of reading
one line in isolation.

**How to re-run it**, after a key rotation or any change to the four `APPLE_*`
function secrets:

1. **Sign out and sign in with Apple again first**, and this is not a formality.
   The refresh token that gets revoked is captured by `store-apple-token` AT
   SIGN-IN, and with no usable key it returns early without storing anything. An
   Apple session older than the key has nothing to spend, and deleting it prints
   `no token for this account` — which reads like a pass and proves nothing.
2. Delete the account from Profile.
3. Read the log: commit any change to `.github/apple-revoke-request` and the
   **Apple revoke log** workflow prints which of the six branches ran. Nothing in
   the app itself distinguishes them — `delete-account` returns
   `{ deleted: true }` whether Apple was told or not, deliberately, because a
   deletion must never be refused over a revoke.

**Read `ok (200)` for exactly what it is.** Apple documents 200 as the answer
both when it revokes a token and when the token "was previously invalid", so the
status code alone says the wiring is correct, not that a live grant was
withdrawn. What carries the second claim is the sequence: a sign-in that stored a
token, then a deletion minutes later that spent it.

**Settings → your name → Sign in with Apple** is the user-visible half, and it is
worth a look but not worth arguing with: the list is cached, so _gone_ is good
confirmation while _still listed_ may just be staleness. Deleting the app from
the phone does not remove the entry, and signing in again re-creates it, so the
check is one-shot.

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

## The APNs entitlement: what is established, and what is not

`aps-environment` decides which APNs the binary registers against. Get it
wrong toward `development` on a TestFlight build and registration still
returns a token, the token still looks fine, and delivery silently never
happens. That is the one failure in this subsystem that cannot be told apart
from any other, so it is written down rather than remembered.

**None of it is on a phone yet (as of 2026-09-02, with the 0.2.0 build not yet
run), and an update will not put it there.** The
whole `expo-notifications` plugin block is native config — the icon, the
colour, the Android channel id and `mode` are all read at prebuild and written
into the generated `ios/` and `android/` projects. An installed build cannot
see a line of it. And the block is NEW: before this pass app.json had no
expo-notifications entry at all, so no build in existence was made with any of
it.

The trap, for as long as `version` was still `0.1.0`, was that shipping it
over the air looked like it worked. `runtimeVersion` is
`{ policy: "appVersion" }`, so while the version matched the installed
build's, an `update` carrying this app.json was **accepted** by the TestFlight
build already on the phone — the runtime versions matched, the workflow went
green, the founder force-quit and reopened and got the new JavaScript. What
they did not get was a rebuilt binary, so whatever `aps-environment` that
build was signed with was still what it had. If that value was `development`,
push registration kept succeeding against the APNs sandbox and delivery kept
never happening, on an app that had just reported a successful deploy.

That window closed with the bump to 0.2.0 ("The version moved to 0.2.0"
below): an update now publishes against runtime 0.2.0 and reaches no 0.1.0
install at all, which trades the silent-acceptance trap for the orphaning
one. Neither is a rebuilt binary; only the build changes the answer.

So: **a green `update` run is evidence about JavaScript and about nothing
else.** It is not evidence that push is configured, and it is not evidence
that push is broken either. Only a build changes the answer, and only the
`codesign` check below reads it.

What the existing build actually carries was NOT established from here — there
is no Xcode and no Apple account on this machine. `scripts/asc-provision.mjs`
registers the PUSH_NOTIFICATIONS capability on the bundle id, so the entitlement
is present; its VALUE came from the profile rather than from app.json, because
app.json had nothing to say. Run the `codesign` line below against the first
build made after this change and record the answer.

**Established from the installed package** (`expo-notifications@57.0.11`, read
on 2026-09-01):

- The config plugin is what adds the entitlement. `plugin/build/withNotificationsIOS.js:9`
  destructures `{ mode = 'development' }`, and `:11-12` writes it into the
  entitlements plist — but only `if (!config.modResults['aps-environment'])`.
- This app config has no `ios.entitlements` block, so nothing pre-sets that
  key and the plugin's own default is what would land. `app.json` now passes
  `"mode": "production"` explicitly, and
  `src/app/__tests__/notification-config.test.ts` fails if it is dropped.
- The other three options passed here (`icon`, `color`, `defaultChannel`) are
  Android-only, per the plugin's own `withNotifications.d.ts`. `mode` is the
  only iOS one, and until this pass it was the one not set.
- `defaultChannel` only NAMES a channel — it writes
  `com.google.firebase.messaging.default_notification_channel_id` into the
  manifest. Creating the channel is the app's job, and nothing here did it, so
  the id pointed at nothing. `push.ts` now calls `setNotificationChannelAsync`
  with the same id on the registration path, and
  `src/app/__tests__/notification-config.test.ts` fails if the two drift. That
  half is JavaScript and ships over the air; the manifest entry still needs the
  build.

**Established from Expo's own SDK 57 documentation**
(<https://docs.expo.dev/versions/v57.0.0/sdk/notifications/>, under App
config): _"The iOS APNs entitlement is always set to 'development'. Xcode
automatically changes this to 'production' in the archive generated by a
release build."_ Note that the v57 configurable-properties table does not list
`mode` at all, even though the installed plugin accepts it — the doc page is
describing the older behaviour, and its second sentence is a claim about
**Xcode**, not about EAS.

**NOT established: whether EAS credential sync rewrites the value.** It does
not, as far as anything readable from here says. The one Expo page about EAS
and entitlements
(<https://docs.expo.dev/build-reference/ios-capabilities/>) describes capability
**sync**: EAS reads the introspected entitlements and turns the matching
capability on or off in the Apple Developer Console — `aps-environment` is
listed there as the entitlement string for Push Notifications. That is EAS
reading the key's PRESENCE, and the page says nothing anywhere about
rewriting its VALUE. So the reconciliation Expo's SDK page describes is
Xcode's, at archive time, from the provisioning profile — and nothing in this
repo, this sandbox, or those two pages proves it fires under EAS's manual
signing. There is no Xcode and no Apple account here, so it could not be
checked; setting `mode` explicitly means it does not have to be.

**How it is settled, on every production build from now on.** The
`TestFlight` workflow's "Prove the binary carries what it should" step
downloads the finished .ipa from EAS, unzips it, and reads `aps-environment`
out of it in the two places the value lives. It runs on an ubuntu runner, so
there is no `codesign`; what there is, is the artifact itself:

- `Payload/Samewhere.app/embedded.mobileprovision`, the provisioning profile
  the build was signed with: a CMS (PKCS#7) envelope around an XML plist.
  `openssl smime -verify -noverify -inform der` opens the envelope and
  Python's `plistlib` reads `Entitlements.aps-environment` out of it. (Apple
  strips this file when it re-signs the app for delivery, which is why the
  installed app on a phone does not have one; the .ipa EAS hands over is the
  pre-upload export, and does.)
- The executable's own code signature, where the signed entitlements plist is
  embedded verbatim. That is exactly what `codesign -d --entitlements :-`
  prints, and it is greppable, so it is read too.

Both must say `production`, and the step fails the run if either says
anything else or if neither can be read. The answer is written to the run's
step summary next to the build number and the EAS build id, both read back
from the finished build rather than promised. Record them in
`docs/PROGRESS.md`. Until a run has been read, "push is configured" is a
guess in exactly the way the change-review skill means.

The by-hand version, for anyone with a Mac and a reason:

```bash
# after `eas build --platform ios --profile production`, download the .ipa
unzip -o -q app.ipa -d ipa && codesign -d --entitlements :- ipa/Payload/*.app
```

`<key>aps-environment</key><string>production</string>` is the answer you
want.

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

## Export compliance: why the encryption answer is "exempt"

`app.json` sets `ios.infoPlist.ITSAppUsesNonExemptEncryption: false`, which is
what stops every upload stalling on App Store Connect's "missing compliance"
prompt. The file is JSON and cannot carry the reasoning beside the key, so the
reasoning is here. It was derived once, against Apple's questionnaire, and it
should not have to be derived again.

The app encrypts two things, and both are exempt:

1. **The Supabase session at rest.** `src/lib/secure-session-store.ts`
   generates an AES-256 key, keeps it in the iOS keychain, and holds the
   session ciphertext in AsyncStorage — Supabase's own documented pattern,
   used because SecureStore caps a value at about 2KB and a session is
   bigger. What is encrypted is an access token and a refresh token: nothing
   but authentication material. That is the exemption for encryption "limited
   to authentication", and the fact that the algorithm is standard AES from a
   third-party JS library rather than from the OS does not change it, because
   the test is what the encryption is FOR.
2. **Everything on the wire**, which is HTTPS to Supabase, to Expo's update
   server and to PostHog. Encryption the operating system provides is exempt
   on its own terms.

**The one change that reverses this.** If the app ever encrypts USER CONTENT
at rest under a key of its own — messages, photos, anything that is not a
credential — the answer stops being exempt. It then needs the year's
self-classification report, and App Store Connect adds the French encryption
declaration on top. Anybody adding client-side encryption of message bodies is
adding that paperwork with it, and should say so in the same PR.

This is a self-classification, not legal advice, and it is written down so the
lawyer reviewing `docs/legal/` is reviewing a stated position rather than an
assumption.

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
  `expo.locales` and the files it points at, icons/splash, the app version, or
  an SDK upgrade.
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

### Shipped in 0.2.0: the notification config

The 0.2.0 build is the first one made with any of it. Everything in this
table is prebuild input, so no build before it carried a line of it, and
no update could have:

| Landed in 0.2.0                                   | Why it could not ship over the air                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The `expo-notifications` plugin block in app.json | `plugins` is prebuild input: the notification icon, the tint colour, the Android channel id and `mode` all land in native projects    |
| `assets/images/notification-icon.png`             | referenced by that block; on iOS an absent icon is a grey square, and a bad path fails the prebuild minutes into a run                |
| `mode: "production"` → `aps-environment`          | an entitlement, and the one whose wrong value is silent (see "The APNs entitlement" above); the workflow now reads it off every build |
| The App Store review prompt (`expo-store-review`) | a native module, and it needed the `version` bump that moves `runtimeVersion` with it (below)                                         |

The JavaScript half of push already shipped over the air and already worked
against whatever binary was installed: `push.ts` (registration, the
foreground handler, `setNotificationChannelAsync` for the Android channel
app.json names), the primer, the routing, and the settings row. What the
build adds is the native half: the entitlement value, the icon, the channel
id in the manifest.

**The hand-run, on the first 0.2.0 install.** The workflow proves the
entitlement; only a phone proves delivery.

1. Read the run's step summary: `aps-environment: production`, the build
   number and the EAS build id. If the step is red, stop; nothing below can
   pass.
2. Install the build from TestFlight, open the app, and accept the push
   primer when it asks. Nothing on the phone shows the token: the
   Notifications row on the profile page (`NotificationsRow`) says whether
   notifications are on and offers to turn them on, and that is all it
   renders. Read it from the database instead, in the SQL editor:
   `select token, platform, updated_at from push_tokens where user_id = '<your user id>';`
   (`push_tokens`, 20260816220000: one row per device token, reassigned to
   whichever account last registered on that phone).
3. Send yourself one notification from the Expo push tool at
   <https://expo.dev/notifications> against that token, with the app in the
   background. Watch it land on the lock screen.

   It carries the APP icon, not the plugin's. `icon` and `color` in the
   expo-notifications block are ANDROID-ONLY — they are what stops an
   undeclared icon rendering as a grey square there — so an iOS notification
   says nothing about whether either is right. Those two stay unproven until
   there is an Android build; the only iOS-relevant option in that block is
   `mode`, and the build reads it off the signature.

4. Record the build id and both answers in `docs/PROGRESS.md`.

A push that never arrives on a build whose summary says `production` is a
different bug from the one this section is about; look at the worker and the
token table before the entitlement.

### The version moved to 0.2.0, and what that orphans

`runtimeVersion` is `{ policy: "appVersion" }`, so an update only ever reaches
builds whose `version` matches the one it was published against. Bumping
`version` to 0.2.0 for the native module therefore has a consequence
`app.json` cannot carry a comment for, so it is written here:

**Every 0.1.0 install is orphaned from updates until the 0.2.0 build is
installed.** From the moment the bump is on the branch, an `update` run
publishes against runtime 0.2.0, and a phone still on a 0.1.0 build stops
receiving it: it keeps the JavaScript it last downloaded, and no run goes red
to say so. That is the intended half. The half to manage by hand is the
order of operations:

1. Do the build (`build-then-submit`) with the bump in it. It is the last
   thing to land in a batch of native changes, never the first.
2. Confirm the build installs from TestFlight and opens.
3. Only then publish updates. An update published between the bump and the
   install reaches nobody, and one published before the bump would have
   reached 0.1.0 phones with JavaScript that expects the module.

The e2e simulator binary is a 0.1.0 build too, so the next E2E run needs
`build=true` once: the "Fetch the published update" gate cannot find a
runtime-0.2.0 update on a runtime-0.1.0 binary, and says so rather than
screenshotting the old JavaScript.

### Shipped in 0.2.0: the App Store review prompt

Everything about this product is free, so the star rating and search ranking
are the whole of paid acquisition, and with nothing asking for a review the
rating would be shaped entirely by the minority who arrive at the listing
angry. The moment worth converting already existed and was already detected:
`useAcceptedCelebration` fires when a first message you sent turns into a
chat, and it already refuses to fire in a burst on a fresh install.

The four things that had to land in the same change, and did:

1. `package.json`: `expo-store-review` at `~57.0.2`, the version
   `expo@57.0.13`'s own `bundledNativeModules.json` pins for SDK 57. Nothing
   under `plugins`: it has no config plugin and needs no Info.plist key.
   `src/features/matching/__tests__/use-accepted-celebration.test.tsx` fails
   if it is dropped, if anything appears under `plugins` for it, or if the
   version bump below is reverted while the module stays.
2. `app.json`: `version` 0.2.0, and `package.json` agrees. See the section
   above for what the bump orphans.
3. `src/features/matching/use-accepted-celebration.ts`: the ask follows the
   notice being dismissed with its X, a beat (`Motion.slow`) after the card
   has left the screen, never on top of it. Gated on the same AsyncStorage
   seen-set that marks a fresh install's history as old news: one sentinel
   entry (`store-review:asked`) in that set, under the same key, not a second
   key. The stored value stays readable by a bundle that predates it, which
   matters because an update is never applied on the launch that downloads
   it.
4. A hand-run, below. Apple owns the dialog and throttles it, so there is no
   screenshot and the E2E suite cannot photograph it.

**The rules, and how each is kept.** All of them are proved in the test file
named above; each assertion was watched going red with its guard removed
before it was kept.

- **Once per install, ever.** The sentinel is written before Apple is called,
  so nothing inside the call can lead to a second one; a later launch reads
  it back.
- **Never during onboarding.** `onboarding_completed_at` must be set on the
  own profile. The tabs are not mounted for a traveler who owes onboarding,
  but the rule is the hook's to keep, not the router's.
- **Never after a bad moment, as far as the hook can see one.** Five signals
  are readable from the queries the hook already has, the root layout
  already keeps live, or the screens that show the moment already hold: the
  account's standing is not `active` (moderation acted on it); a hello of
  theirs was refused by moderation in the last 24 hours (`sent_requests`
  rows in state `blocked`); a chat closed this session (a block in either
  direction severs it, and a leave closes it); a block was made this
  session, from anywhere in the app (the `blocks` count, baselined at its
  first answer, read through the same cache entry as the Blocked screen and
  only while the ask is unspent); and **a photo of theirs was refused**, in
  either of the two places the app says so. A profile photo: the grid's own
  `['photos', userId]` entry (same key, same fetch as `useOwnPhotos`, run
  only while the ask is unspent), a rules rejection on a photo uploaded in
  the last 24 hours — the row carries no verdict time, and the verdict lands
  within the worker's tick of the upload, so the upload time stands in the
  way a hello's does. A failsafe hold ("could not be checked, try again",
  `moderation_engine = 'failsafe'`) is nobody's fault and is not counted; it
  is read through the same `photoRejection` helper the grid uses to draw it
  on warning rather than danger. A group photo: the group page's
  `['group', chatId]` entry, which polls every five seconds while a photo is
  pending, watched through the query cache for a row moving INTO `rejected`
  this sitting — that is the admin having just read "That photo was not
  approved and has been removed. Pick another." `groups` carries no verdict
  time, so a group first seen already refused is history, and a group open
  on no screen is not watched. (A business owner's photos are not here
  because a business never sends a hello, so the ask never arises for one.)
  A **report** is the one bad moment the hook cannot see: nothing in the app
  reads reports back, so there is no query to baseline. The "block them too"
  that follows a report of a person is caught by the block signals; a report
  on its own is not.
- **Never from "Go to chat".** That button is a departure into a task, a
  thread the person is usually about to type in, and Apple's guidance is not
  to interrupt one. The X is the one moment the person has registered good
  news and is doing nothing else. The card calls a different callback for
  each so the hook can tell them apart, and the ask is kept for a later X.
- **Never on top of a card.** With several accepts queued, the ask waits for
  the last X; a card that comes up in the beat before Apple is called cancels
  the ask for that moment.
- **Never on a binary that cannot show it.** The package is required at the
  moment it is needed, inside a catch: its native entry is
  `requireNativeModule('ExpoStoreReview')`, which throws on a build made
  before the module existed, and a static import would take the whole tabs
  layout down with it. `isAvailableAsync()` must answer exactly `true`; a
  `false`, an `undefined` (what jest's native mock answers), or a missing
  module all leave the ask unspent for a build that can.
- **No custom pre-prompt.** Apple already throttles the real one, and a
  second ask in front of it is the thing App Review dislikes.

**What TestFlight can and cannot show.** `StoreReviewModule.swift`'s
`isAvailableAsync` answers `!isRunningFromTestFlight()`, and it detects
TestFlight by the sandbox receipt with no embedded provisioning profile. That
is Apple's own rule surfacing: `requestReview` has no effect in an app
distributed through TestFlight. So on a TestFlight build the dialog will
never appear, by design, and the ask is not spent. What a TestFlight hand-run
CAN prove is the wiring: every time the moment is earned and every gate
passes, the hook captures `review_prompt_requested` to PostHog with
`available: true | false`. On TestFlight it arrives as `available: false`.
The dialog itself is seen in exactly two places: a development build
(Xcode or a dev client, where Apple shows it every time) and the App Store
release, where Apple throttles it to a few times a year per person.

**The hand-run, on TestFlight.** Two traveler accounts, both with a trip in
the same city on overlapping dates.

1. From account A, say hi to account B from Travelers. From account B, accept
   it.
2. Back on account A: the "Connected with B" card comes up at the bottom of
   whatever tab is open. Tap the **X**, not "Go to chat".
3. Nothing visible happens next; that is correct on TestFlight. Open PostHog
   and find `review_prompt_requested` with `available: false` on account A's
   `distinct_id`, within the minute.
4. Repeat with a third account accepting. The card comes up, the X dismisses
   it, and a SECOND `available: false` event arrives. That is correct too:
   the once-per-install flag is only written when Apple could be asked, and
   on TestFlight it never can be, so the ask stays unspent for the App Store
   install this phone may become. The once-per-install proof is the jest
   file's, and the App Store build's.
5. Record the event's timestamp and the build number in `docs/PROGRESS.md`.

**The hand-run, on the App Store build**, once there is one: step 2 again,
on an install that has never been asked. The sheet comes up a beat after the
card has gone. Whether it does on any given tap is Apple's throttle, not a
defect; the event with `available: true` is the evidence the moment was
converted.

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

### The app icon: three crops, not one file

**Status: not done, and it needs a designer or an image tool.** Everything
below is the brief for that work, plus the measurements of what is in the
repo today, so the next pass starts from numbers rather than from an
impression.

**What is there now.** Five PNGs, and three of them are the same file:

| File                          | Size  | Alpha | Mark fills | Job                             |
| ----------------------------- | ----- | ----- | ---------- | ------------------------------- |
| `icon.png`                    | 1024² | no    | 55% × 66%  | the App Store and home screen   |
| `splash-icon.png`             | 1024² | yes   | 37% × 44%  | the splash, at `imageWidth` 200 |
| `android-icon-foreground.png` | 1024² | yes   | 37% × 44%  | the adaptive icon's foreground  |
| `brand-mark.png`              | 1024² | yes   | 37% × 44%  | nothing: no call site           |
| `android-icon-monochrome.png` | 432²  | yes   | 45% × 41%  | the themed Android icon         |

The middle three are byte-identical (`md5 e6bfa4a4…`). One drawing is being
asked to be a store icon, a splash mark and an adaptive foreground, and those
are three different safe areas.

**`brand-mark.png` is the trap in this set.** The package plan says to leave
it alone as the in-app mark. It is not the in-app mark: nothing imports it.
The mark on the welcome screen, the intro tour and Profile is
`splash-icon.png` (`src/components/animated-icon.tsx:37`,
`src/app/profile-me.tsx:64`, `src/features/intro/intro-tour.tsx:243`). So
re-cropping `splash-icon.png` for the splash silently redraws three in-app
screens. **Repoint those three imports to `brand-mark.png` first**, in the
same commit or before it, and then the splash crop is free to change.

**What each file needs.**

- **`icon.png` — the one that matters.** 1024×1024, no alpha, no rounded
  corners (Apple applies the mask), no glow, no drop shadow. Drawn to be read
  at **60pt in a search row**, which is where a decision gets made, and above
  the screenshots on the product page. Today's mark fills 55% of the width, so
  at 60pt the campfire is about 33pt across and the two crossed logs are two
  white bars with a gap between them and the flame. That gap is the first
  thing to close. The ground is `accentDeep` `#2A4C9B`, which is the one
  correct use of that value: a fill under white.
- **`splash-icon.png` — its own crop.** It renders at `imageWidth: 200` on
  `#0E1020`, and the mark inside it currently fills 37% of the canvas, so what
  a person actually sees on launch is about **74pt wide** in the middle of a
  phone. Either the crop tightens or the `imageWidth` goes up; the crop is the
  better answer, because it does not change the plugin config.
- **`android-icon-foreground.png` — a different circle again.** The adaptive
  icon is 108dp with only the inner 72dp guaranteed visible under any mask.
  Today's mark is well inside that, and undersized for it.
- **`brand-mark.png` — the in-app mark**, once the three imports above point
  at it. It is the only one of the set that may keep transparency and near
  white logs, because it is only ever drawn on `canvas`.
- **`android-icon-monochrome.png`** is already its own file at the right size.
  Leave it.

**How to accept it, since nothing here is automated.** Render the 1024 at
60pt. Render it in grayscale, because the amber against the blue is the whole
signal and it has to survive as a value difference. Put it in a mock search
row beside five apps in this category. If the campfire reads as a campfire in
all three, it is done. This is the `screens` skill's rule applied to a single
asset: the picture answers, not the file size.

**Any of this costs an EAS build**, because the icon paths are native config.
Land it with the next batched build rather than on its own.

### Everything else

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

### The permission dialogs are in the binary, and have the longest lead time

The listing is data and ships whenever you like. The permission sheets are
not: `expo.locales` in app.json points at `locales/<lang>.json`, and those
files are read **at prebuild**, written into `<lang>.lproj/InfoPlist.strings`,
and compiled into the app. So a translation added the day before a submission
is a translation that is not in the build, and the wait is a full EAS build
and a TestFlight round trip. Of everything on the localisation list this is
the item to start first.

`locales/en.json` exists today with the three declared usage strings in it.
Adding pt-PT, es-MX, th or id is then a new file beside it and one line in
`expo.locales`, which is the whole reason the English one is there at all: the
strings were inline in the plugin block, where the second language would have
had nowhere to go.

**Two copies of the same sentence, and they must not drift.** The plugin block
in app.json still carries `photosPermission` and `cameraPermission`, because
that is what writes the base `Info.plist` values every non-localised device
falls back to, and `locales/en.json` carries the same words for English.
Change one, change the other in the same commit.

**No double quotes in a locale string.** The generator writes
`KEY = "value";` with no escaping (`@expo/config-plugins`,
`build/ios/Locales.js`), so a `"` in the copy produces a strings file that
does not parse and a permission dialog that falls back to nothing.

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
