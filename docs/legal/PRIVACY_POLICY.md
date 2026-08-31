# Privacy Policy (DRAFT)

> **Status: draft for founder review. Not yet published, not legal advice,
> and a proper legal review (including GDPR and the DSA — the first launch
> city is in the EU) is a separate, required step before launch.** Bracketed
> items still need a founder decision or a lawyer's answer, and every one of
> them is marked in place rather than guessed at.
>
> This document has two live copies that must move with it:
> `web/privacy/index.html`, which is what `https://link.samewhere.io/privacy`
> serves and what App Store Connect points at, and `PRIVACY_SECTIONS` in
> `src/constants/policies.ts`, which is the in-app summary on the `/privacy`
> screen. Each in-app section names the heading here that it summarises, and
> `src/app/__tests__/privacy-screen.test.tsx` fails if that heading stops
> existing, so a section cannot be renamed or dropped on one side only.

_Last updated: [date of publication]_

**Samewhere** ("we") helps travelers make friends. This policy explains what
we collect, why, who touches it, and what you can ask us to do about it.

## What we collect

- **Account**: your email address. Sign-in is handled by Supabase Auth.
- **Profile you build**: display name, age, gender, home city and country,
  languages, bio, photos, and any social handles you choose to add.
- **Travel intent you share**: trip cities and date ranges, and map pins (a
  venue, a category, an optional note and a day). Pins are permanently
  deleted within 72 hours.
- **Messages**: first messages you send, and the chats, groups and business
  rooms you take part in.
- **Verification selfie** (optional): a face comparison. It has its own
  section below, because it is the most sensitive thing in this list and a
  bullet is not enough room to be precise about it.
- **Usage analytics**: which screens you open and which features you use,
  recorded through PostHog. The PostHog mobile library also creates its own
  identifier for your installation and stores it on your device, and attaches
  your device model, operating system version, app version, language and time
  zone to every event. Once you sign in, events are tied to your user id.
  Events go to PostHog's **EU** cloud (`eu.i.posthog.com`). There is no
  in-app analytics opt-out today; if that changes, this paragraph changes
  with it.
- **Support messages**: if you write to us from Contact us, we keep your
  message and the address you asked us to reply to, along with the one word
  you picked for what it is about, so an urgent message can be answered first.
- **A Sign in with Apple token** (only if you sign in with Apple): Apple
  issues a refresh token once, at your first sign-in, and we keep it for the
  life of your account for exactly one purpose. When you delete your account
  we have to tell Apple to forget it too, and this token is the only thing
  that can make that call. It is held on our server where no app, browser or
  signed-in user can read it, including you; it is never sent anywhere except
  to Apple, and it is destroyed with your account. If you signed up with an
  email address, this does not exist for you.

## What we deliberately do NOT collect

- **Your device location. Never.** The app asks for no location permission
  and holds none. The map shows only venue-level future plans that people
  typed in themselves.
- Your birthdate. We store an age number only.
- Your contacts, your photo library beyond the photos you pick, your
  microphone, your calendar, or anything about what you do in other apps.
- We do not track you across other companies' apps or websites, and we do not
  sell anything about you to anybody.

## Verification, and why we call it biometric

Getting the verified badge is optional and nothing else in the app is
withheld if you skip it.

Here is exactly what happens. You take a selfie in the app; the photo library
is never offered, because a picture chosen from a library proves nothing. The
selfie goes into a private storage bucket that only you can write to and no
other user can read. A server-side worker then signs short-lived links to
that selfie and to up to two of your approved profile photos, sends those
images to Anthropic's vision model with one question, "Is this selfie
plausibly the same person as the profile photos?", and stores the answer.

Three facts about that, all of which we hold ourselves to:

- **No face template is computed.** Nothing measures your face, no faceprint
  or embedding is produced, and nothing derived from your face is retained.
- **The selfie is deleted as soon as a verdict lands**, whichever way the
  verdict went.
- **What survives is the verdict text and the badge.** Nothing else.

Even so, a check that compares one face against another is biometric
processing. Under the GDPR it is Article 9 special category data, and Apple
puts it in the Sensitive Info category on the App Store privacy card. We
treat it that way rather than argue the point: we process it **only on your
explicit consent**, which is you choosing to start the check, only for that
one purpose, and only for as long as it takes to answer the question.

The badge is a plausibility check against casual catfishing. It is not
identity verification: there is no document check and no liveness challenge.

> [LEGAL REVIEW: decision D21 was to declare this as biometric / Sensitive
> Info rather than rely on the no-template argument. Confirm that call, and
> confirm the App Store privacy card answers match this section exactly.]

## Business accounts

A business account is a different thing from a traveler account and collects
a different set. If you run a listing, we hold:

- The **trading name**, the description, and the category.
- A **street address, a city, and the map marker you place on your door**,
  plus any note about finding the entrance. A listing's location is the
  business's own address, which is public information about a premises. It is
  not anybody's whereabouts.
- **Opening hours**, and any note about what the hours miss.
- **Links** you add: website, menu, phone, email, WhatsApp number, and social
  handles.
- **Photos** of the business.
- The **email address** the confirmation code is sent to. Confirming that
  address is what puts a listing on the map. Changing the name or moving the
  marker takes the listing off the map until a new code is confirmed.
- Posts you write in your own room, and replies to travelers who wrote to you.

Two things are deliberately public: **a listing is visible to everyone,
including people who are signed out**, because being findable is the whole
point of it; and a business never sees who rated it. Travelers rate a
business out of ten, ratings are anonymous to the business, and **no public
number appears until at least five travelers have rated it**.

Deleting a business account deletes the listing with it, from **Profile →
Delete account**, the same door a traveler uses. The listing, its photos,
links, hours, posts and room go with it.

## How your information is shared with other users

- Your profile (name, age, photos, bio, languages, verified badge) is visible
  to any signed-in traveler who can reach it: someone whose trip overlaps
  yours, someone who taps one of your pins, or someone opening your profile
  from a chat or a group you share.
- **Your social handles are hidden until you and another traveler are both in
  a chat together.** This is enforced by the database, not just by the app.
- Your upcoming trips are part of your profile, so any signed-in traveler who
  can open your profile can see them. Finished trips are private to you.
- **You choose who can see you.** The visibility setting (Everyone, Verified
  only, Verified men, Verified women, Verified non-binary) works in both
  directions and is enforced in the database.
- **One traveler at a time can be shown to signed-out visitors.** The
  Travelers tab shows a single featured card for a city: name, age, photo,
  bio, languages, city and dates. It is chosen automatically from whoever in
  that city other travelers are writing to most. You are eligible only if you
  have a trip in that city **and** your visibility is set to Everyone, which
  is the default. Narrow your visibility to anything else and a signed-out
  visitor cannot see you at all, there or anywhere else. Nobody can message
  you without an account.
- Heat on the map is aggregated and de-identified. Areas with only a few
  plans are never shown to anybody.

## Content moderation

First messages, profile photos, business content and verification selfies are
screened automatically before they land. The screening runs server-side and
uses an AI classifier through Anthropic's API. Moderation decisions and
reports are logged so we can answer for them. **Your content is never used to
train AI models.**

Reports are anonymous to the person reported. Blocking somebody hides you
from each other everywhere, immediately.

## Appeals, and a person at the end of it

**Any automated decision can be reviewed by a human.** If a message was
blocked, a photo removed, a verification refused, or an account warned,
suspended or removed, write to us from **Contact us** in the app (it is open
to signed-out users, which is the point) or to hello@samewhere.io, and a
person will look at the decision itself, not just at the log. We answer
within 30 days and we tell you what we decided and why.

This is how we meet GDPR Article 22 on decisions taken by automated means,
and DSA Article 17 on telling you why your content was restricted.

## Who processes your data for us

We use a small number of providers, and only ever share what a provider needs
to do its job:

| Provider      | What it does for us                                                              |
| ------------- | -------------------------------------------------------------------------------- |
| **Supabase**  | Database, file storage, and authentication. Hosted in the EU.                    |
| **Expo**      | Over-the-air app updates, and the push notification service.                     |
| **Apple**     | Push delivery through APNs, and Sign in with Apple.                              |
| **PostHog**   | Product analytics, on their EU cloud.                                            |
| **Anthropic** | The moderation and verification classifiers, run server-side. No model training. |
| **Resend**    | Sending our email: support replies and business confirmation codes.              |

Every one of them is bound by terms that require them to protect your
information at least as well as this policy does, to use it only to provide
their service to us, and never to sell it or use it for their own
advertising. We do not sell your data to anyone, and none of these providers
is an advertising network.

> [FOUNDER: confirm a data processing agreement is in place with each of the
> six before publication, and record the date each was signed. All six
> publish a standard DPA.]

## Where your data lives

Your account, photos and messages are stored with Supabase (Postgres and
object storage) in the **EU** ([exact region: confirm in the Supabase
dashboard before publishing]). Analytics events are stored in PostHog's EU
cloud. Push notifications travel through Expo and Apple. Content sent for
moderation or verification is processed by Anthropic's API and is not
retained by us beyond the verdict.

## Retention and deletion

- **Pins**: deleted within 72 hours, always.
- **Verification selfies**: deleted as soon as the check has an answer.
- **Finished trips**: kept on your profile only for you.
- **Delete your account any time** from **Profile → Delete account**. Your
  profile, photos, trips, pins, first messages and chats (for both sides) are
  permanently deleted, and a business listing goes with the account that runs
  it. It is immediate and it cannot be undone.
- **The Sign in with Apple token** is spent and then destroyed as part of that
  deletion: we call Apple to revoke your sign-in before the account row goes,
  so Apple stops treating this app as one you have signed into. Nothing about
  it survives the deletion.
- **Moderation records** are kept with your identity removed. Safety records
  have to outlive the accounts they are about, or a banned account is a fresh
  start.

## Your rights

Depending on where you live (including the EU under the GDPR), you have
rights to see, correct, export, restrict or delete what we hold about you,
and to object to some of it.

Deletion you can do yourself, in the app, in one tap, and it is thorough:
**Profile → Delete account** removes everything listed above, on both sides
of every chat. For anything else, write to us from **Contact us** in the app
or to hello@samewhere.io. **A person handles these by hand**, and we reply
within 30 days, which is the maximum the GDPR allows. There is no
self-service export button today, and we would rather say so than promise
one.

> [FOUNDER: 30 days is the statutory ceiling, not a target. Shorten this
> sentence to whatever you can actually keep once there is a real inbox
> volume to judge it against, and build the export function when the first
> request arrives (decision D20 was to narrow the promise now, not to build
> it now).]

You can also complain to your local data protection authority. In Portugal
that is the CNPD.

## Children

This app is for adults, 18 and over. Age is checked when an account is made
and the database refuses anything under 18. If you believe somebody on
Samewhere is under 18, report them and pick **They are under 18**; those
reports go to the front of our queue and a person reviews them.

## Changes to this policy

The current version of this policy is always at
`https://link.samewhere.io/privacy`, and the summary in the app is updated in
the same release. If we make a material change, we will change the date at
the top and say so on that page. We do not currently have a way to notify you
inside the app, and this document will not claim one until we do.

**Contact**: the in-app **Contact us** form, or hello@samewhere.io ·
[legal entity name, registered address and, if one is required, an EU
representative: still needed for the GDPR and for the DSA point of contact]
