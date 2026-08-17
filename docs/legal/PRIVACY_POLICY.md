# Privacy Policy (DRAFT)

> **Status: draft for founder review. Not yet published, not legal advice,
> and a proper legal review (including GDPR — first launch city is in the
> EU) is a separate, required step before launch.** Bracketed items need
> founder decisions.

_Last updated: [date]_

**[App name]** ("we") helps travelers make platonic friends. This policy
explains what we collect, why, and your choices.

## What we collect

- **Account**: email address; authentication is handled by Supabase Auth.
- **Profile you build**: display name, age, gender, home city/country,
  languages, bio, photos, and social media handles you choose to add.
- **Travel intent you share**: trip city and date ranges; map pins (a venue
  name, category, and date). Pins expire and are permanently deleted within
  72 hours.
- **Messages**: first-message requests and chats with people who accepted.
- **Verification selfie** (optional): compared automatically against your
  profile photos to award the verified badge, then **deleted after review**.
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
  visible to travelers you overlap with or who can see your pins.
- **Your social handles are hidden until you and another traveler both
  accept a chat.**
- Your trips are only visible to users with a genuinely overlapping trip.
- Heatmap data is aggregated and anonymous; areas with very few pins are
  never shown to others.

## Content moderation

To keep the app platonic and safe, first messages, photos, and verification
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
access, correct, export, or delete your data. Contact us:
**mattmoorefb24@gmail.com**.

## Children

This app is for adults 18+. We remove underage accounts.

## Changes

We'll notify you in-app about material changes to this policy.

**Contact**: mattmoorefb24@gmail.com _(interim — replace with a dedicated
support inbox before launch)_ · [legal entity name and address — still
required for GDPR]
