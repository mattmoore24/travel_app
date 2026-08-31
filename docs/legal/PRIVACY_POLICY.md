# Privacy Policy (DRAFT)

> **Status: draft for founder review. Not yet published, not legal advice,
> and a proper legal review (including GDPR — first launch city is in the
> EU) is a separate, required step before launch.** Bracketed items need
> founder decisions.
>
> The in-app summary of this document is `PRIVACY_SECTIONS` in
> `src/constants/policies.ts`, rendered on the `/privacy` screen — keep the
> two in step when either changes. The in-app version deliberately omits the
> two bracketed paragraphs below (the PostHog analytics bullet and the exact
> hosting region) until they are answered.

_Last updated: [date]_

**Samewhere** ("we") helps travelers make friends. This policy
explains what we collect, why, and your choices.

## What we collect

- **Account**: email address; authentication is handled by Supabase Auth.
- **Profile you build**: display name, age, gender, home city/country,
  languages, bio, photos, and social media handles you choose to add.
- **Travel intent you share**: trip city and date ranges; map pins (a venue
  name, category, and date). Pins expire and are permanently deleted within
  72 hours.
- **Messages**: first-message requests and chats with people who accepted.
- **Verification selfie** (optional): a **biometric face comparison**. The
  selfie is compared automatically against your profile photos to check they
  are of the same person, which is what awards the verified badge. The selfie
  is **deleted after review**, and the comparison result is the only thing
  kept. Under GDPR this is Article 9 special-category data and we process it
  only with your explicit consent, given by choosing to start the check; it is
  optional, and nothing else in the app is withheld if you skip it. Apple
  classifies it as Sensitive Info, so it must also be declared on the App Store
  privacy card. [Added 2026-08-30 after the UX audit found the face comparison
  was nowhere disclosed. NEEDS LEGAL REVIEW along with the rest of this
  document.]
- **Usage analytics**: app events (screens viewed, features used) via
  PostHog, tied to your user ID. [If PostHog is not enabled at launch,
  delete this bullet.]

## What we deliberately do NOT collect

- **Your device location. Never.** The app has no location permission. The
  map shows only venue-level future plans you type in yourself.
- Your birthdate (we store an age number only), contacts, or photos beyond
  the ones you pick.

## How your information is shared with other users

- Your profile (name, age, photos, bio, languages, verified badge) is
  visible to any signed-in traveler who can reach it: someone whose trip
  overlaps yours, someone who taps one of your pins, or someone opening your
  profile from a chat or a group you share.
- **Your social handles are hidden until you and another traveler both
  accept a chat.** This is enforced by the database, not just by the app.
- Your upcoming trips are part of your profile, so any signed-in traveler who
  can open your profile can see them. Trips that have finished are private to
  you.
- **One traveler at a time is shown to signed-out visitors.** The Travelers
  tab shows a single featured card — name, age, photo, bio, languages, city
  and dates — to people who have not made an account, chosen automatically
  from whoever in that city other travelers are messaging most. Posting a
  trip is what makes you eligible. Nobody can message you without an account,
  and there is currently no way to opt out of being featured; if you would
  rather not be, delete your trip or your account.
- Heatmap data is aggregated and anonymous; areas with very few pins are
  never shown to others.

## Content moderation

To keep the app safe, first messages, photos, and verification
selfies are screened automatically (including by an AI classifier run
server-side via Anthropic's API). Moderation decisions and reports are
logged. We never use your content to train AI models.

## Where your data lives

Data is stored with Supabase (Postgres + storage) in the EU ([region —
confirm: eu-west]). Push notifications are delivered via Expo and Apple.

## Retention & deletion

- Pins: deleted within 72 hours, always.
- Verification selfies: deleted once reviewed.
- **Delete your account any time** in Profile → Delete account: your
  profile, photos, trips, pins, requests, and chats (for both sides) are
  permanently deleted. Anonymized moderation records (with your identity
  removed) are retained as required for safety.

## Your rights

Depending on where you live (including the EU/GDPR), you may have rights to
access, correct, export, or delete your data. Use **Contact us** in the app,
or write to the support address on our App Store listing.

## Children

This app is for adults 18+. We remove underage accounts.

## Changes

We'll notify you in-app about material changes to this policy.

**Contact**: the in-app **Contact us** form, or [support address — still
required here and on the App Store listing] · [legal entity name and address
— still required for GDPR]
