# Onboarding, for a person and for a business

The plan for rebuilding both signup flows so that every part of a profile is
asked for once, in its own screen, with a sentence saying what it is for — and
so that nobody finishes without having seen what they just made.

Written 2026-08-29 from the founder's brief:

> "The profile creation portion for a business also should be much better, the
> user experience is confusing... There needs to be a detailed tutorial of all
> the sections of the business profile that can be added and what each button
> does, similar to how the individual user profile onboarding works. Both of
> these need to be very thorough and detailed with a full audit to optimize the
> user experience, with all formatting of the profile mirroring that of a hinge
> profile as much as possible. The business and individual should be prompted
> to add to each part of their profile during the onboarding, with detailed
> descriptions of what they are adding at that moment, with a small 'skip for
> now' button for only non-essential items. For example, a profile photo must
> be mandatory for every profile... It should also give you a final look of how
> your profile appears to other users at the end of onboarding, with the option
> to go back and edit any portion before completing the initial onboarding and
> a caveat at each step that this can be changed later at any time."

## 1. What is wrong today

**A person** answers seven screens. Three of them are honest one-thing screens
(name/age, home/languages, photo). One — "Anything else?" — carries occupation,
bio AND socials under the heading "All optional", which is three different
questions in one box with permission to ignore all of them. And three whole
sections of the profile are never mentioned at all: **prompts**, **top
priorities** and **trips**. Somebody finishes signup, lands on the map, and
their profile is a photo and a sentence — while the app's own Travelers screen
is built to show prompts and shared dates.

Trips are the worst of these, because trips are what the matching runs on. A
profile with no trip is invisible to the feature the app exists for.

**A business** answers three screens — name and category, where, email — and is
then dropped into a code screen. Everything that makes a listing worth looking
at (photos, description, hours, links) exists in the schema and in
`docs/BUSINESS_ACCOUNTS.md` §5, and none of it is ever asked for. The owner has
to find `business-storefront` afterwards and discover the sections one at a
time. That is the confusion the founder hit.

**Neither** flow ever shows you the thing you just made.

## 2. The rules this rebuild follows

1. **One question per screen**, with a title that asks it and a sentence under
   it saying what it is for and where it shows up.
2. **Mandatory is rare and stated.** A step with no skip has no skip button and
   its Continue explains what is missing. Everything else carries a small
   `Skip for now` ghost under Continue.
3. **A photo is mandatory on every profile**, person or business. Founder's
   call. For a business the first photo is the cover.
4. **Every step says it can be changed later**, in the same words, in the same
   place. A setting that feels permanent is one people get wrong and live with.
5. **The last step is the profile itself**, rendered by the same component a
   stranger gets, with a way back into any step before finishing.
6. **Nothing is lost by leaving.** Every step saves on the way past it, which
   is already true for a person and must become true for a business.
7. **Hinge's shape, not Hinge's words.** Photo first with the name over it,
   details beneath, prompts as cards. The vocabulary rules in
   `.claude/skills/design-review` still win: no swipe, no deck, no match, no
   hearts, no em dashes.

## 3. A person: thirteen steps

Two live in the auth stack and eleven in onboarding, continuous on one progress
bar, exactly as the two stacks already share `SIGNUP_TOTAL_STEPS`.

| #   | Screen               | Asks                           | Skippable          | Why it exists, in the subtitle                                                                            |
| --- | -------------------- | ------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------- |
| 1   | Email                | email                          | no                 | "Your email is never shown to other users."                                                               |
| 2   | Password             | password                       | no                 | —                                                                                                         |
| 3   | Who are you          | name, age, gender              | no                 | "The name people see, and your age. Your birthday stays yours."                                           |
| 4   | Where you are from   | home city, country, languages  | no                 | "Home base, not where you happen to be today."                                                            |
| 5   | Your photo           | photo at position 0, then more | **no**             | "One face, so people know who they are meeting. Add more if you like."                                    |
| 6   | What you do          | occupation                     | yes                | "Two words is plenty. It gives people something to ask about."                                            |
| 7   | About you            | bio                            | yes                | "What should somebody message you about?"                                                                 |
| 8   | Prompts              | up to 3 answered prompts       | yes                | "The bit people actually read. Answer one and you are ahead of most."                                     |
| 9   | What you are after   | top priorities                 | yes                | "What you are hoping to do, so the right people say hi."                                                  |
| 10  | Your trips           | one trip                       | yes                | "Dates in a city. This is the whole matching engine, so one trip is worth more than everything above it." |
| 11  | Socials              | handles                        | yes                | "Nobody sees these until you are both in a chat."                                                         |
| 12  | Who sees you         | audience                       | no (has a default) | the existing `AUDIENCE_BOTH_WAYS` copy                                                                    |
| 13  | Here is your profile | review                         | —                  | "Your profile. Tap any part of it to change it."                                                          |

Step 10 is the one that earns the extra length: the app's core loop cannot run
for a profile with no trip, and today nothing asks.

Step 5 moves photos from last to fifth, which is Hinge's order and the right
one: a face makes the rest of the questions feel worth answering, and a person
who quits after step 5 still has a profile somebody could act on.

Step 13 renders `ProfileView` in owner mode with every section's edit
affordance wired to jump back to the step that owns it, then `Looks right,
finish`. That is the only place `onboarding_completed_at` is stamped.

## 4. A business: thirteen steps

Steps 1 and 2 are on `/join`, exactly as for a person, so the bar is
continuous across the two stacks. Step 13 is on its own route for the same
reason, and `BUSINESS_TOTAL_STEPS` in `features/signup/steps.ts` is what keeps
the three stacks agreeing about the count.

| #   | Screen                  | Asks                                     | Skippable      | Note                                                                |
| --- | ----------------------- | ---------------------------------------- | -------------- | ------------------------------------------------------------------- |
| 1   | Email                   | sign-in email                            | no             | founder's copy: just for signing in                                 |
| 2   | Password                | password                                 | no             | —                                                                   |
| 3   | What a listing gets you | nothing                                  | no             | the offer, and the word free — §7 rule 1 in a sentence              |
| 4   | Name and kind           | name, category                           | no             | —                                                                   |
| 5   | Where is it             | city, **address**, pin                   | no             | address first, pin adjustable — §5 below                            |
| 6   | Is this right           | confirm address + pin                    | no             | the row is created here (`register_business`)                       |
| 7   | How to reach you        | business email, phone, WhatsApp, website | email required | the code is emailed here, and the reason is said here               |
| 8   | Photos                  | cover + more                             | **no**         | the real grid, in place; "Photos of the business, not of a person." |
| 9   | What it is              | description                              | yes            | "A couple of lines a traveler would want to read."                  |
| 10  | Hours                   | weekly hours + note                      | yes            | "Past midnight is fine. 20:00 to 2:00 reads as one night."          |
| 11  | Links                   | menu, booking, socials                   | yes            | one list for links, socials and contact                             |
| 12  | Here is your listing    | review                                   | —              | as a traveler sees it, and sends the code                           |
| 13  | The code                | six digits                               | no             | this is what turns the lights on                                    |

The business row is created at step 6 rather than at the end. It is
`unconfirmed` until step 13, and `unconfirmed` is fully dark — no marker, no
chat, no messages — so building the page while it waits is exactly what
`docs/BUSINESS_ACCOUNTS.md` §3.9 already describes. That also makes steps 8
through 11 ordinary edits of an existing row, which is how they will work
forever afterwards from the storefront screen.

Three things about this shape are load-bearing and easy to undo by accident.

**Step 3 is the offer, and it removes work rather than adding a screen.** The
entire value proposition a business used to get was a fourteen-word radio
subtitle on a screen headlined "What is your email?", and then twelve steps of
work began. The word _free_ appeared nowhere an owner could read it. Every
later step assumes that question has been answered, so answering it costs one
tap and is the reason the rest is worth doing. It draws the same
`ListingPreview` step 12 does, filled with a real seeded venue, because what a
traveler gets is the argument.

**The code is emailed at step 7, not at step 12.** Sending it where the
address is asked for is what stops step 12 reading as a bait: `city_businesses`
filters on `state = 'listed'`, so an owner who abandons in their mail app has
built a row no traveler can see. Steps 8 to 12 carry a six-digit box in the
footer so the code can be typed the minute it lands, and that box confirms
**inline** — it must never push `/business-email`, which ends with
`router.replace('/(tabs)')` and would drop a mid-signup owner out of the flow.
Step 12 does not spend a second code when the first is still live.

**Step 8 owns the photo grid.** It used to be a headline and a thousand points
of black with a button that routed into the middle of the settings form, and
it gated on `business_detail`, which is approved-only — so with photo
moderation on, an owner with a cover on screen was told they had none. The grid
is `features/business/business-photos.tsx`, shared with the editor, and the
step counts the owner's own rows.

## 5. Where is it: an address, then the pin

Founder's ask, in their words:

> "the business should be able to enter an address and confirm the pin
> location, or have the option to drag and drop a pin without entering an
> address. Address should be the default option, and the business will have the
> option to confirm the address and pin location after completing the 'where is
> it section'. The business should also be able to keep their address the same
> as whatever they entered while adjusting the pin location if needed."

Today step 2 is a city chip row and a map you tap. There is no address field at
all, and `businesses.place_label` — the column that exists for exactly this — is
never filled during signup.

The rebuilt step:

- **City chips**, unchanged in shape. But the server has to start meaning it:
  **there is no geofence on a business at all today.** `validate_pin` is the
  only caller of `haversine_km` in the whole schema, `register_business`
  validates the caller and nothing about geography, and
  `businesses.city_id` references `cities` rather than `launch_cities` — so a
  marker can sit anywhere on earth inside the plain -90..90 / -180..180
  CHECKs while the listing claims a city. (business-signup's own catch comment
  says the server refuses "a marker outside the city's radius". It does not.
  That sentence is about pins.) The rebuilt step adds the same radius check
  pins have had since August.
- **An address field, focused first**, with suggestions as you type. It shares
  the machinery `pin-search-field` already uses for travelers: the native
  `LocalSearch` module when the installed binary has it, geocoding as the
  fallback. Picking a suggestion sets **both** the address text and the pin.

  It needs its own column. `businesses.place_label` looks like the place to
  put it and is not: it is the "finding the door" note ("Two minutes from the
  station, blue door"), it is what business-edit calls "The bit the map can't
  tell anyone", and travelers already read it under "Getting there". An
  address overwriting that would delete the more useful of the two. So
  `businesses.address text check (char_length(address) <= 160)`, in the public
  column grant beside place_label, and `business_detail` DROPped and recreated
  to carry it.

- **A map under it** with the marker, draggable and tappable. Moving it sets the
  coordinates and **never touches the address text**. That is the founder's
  last sentence and it is the whole reason the two are separate pieces of state
  rather than one derived from the other.
- The address is **optional**. Somebody who would rather just place the marker
  types nothing and drags. The field being first and focused is what makes the
  address the default without making it a requirement.
- **Step 5 confirms both**: the address as typed, the map with the marker, and
  two ways back — `Fix the address` and `Move the marker`.

**Afterwards, moving the marker is not the business's to do.** The column
grant withholds lat, lng and city_id from the client on purpose — "a business
that could move its own marker could verify a surf shack and then become the
Marriott" — and `business_rename_resets` knocks a listed place back to
`unconfirmed` and clears `verified_at` on any such change. So the map lives in
signup, where the row is being created, and in a later editor only through a
server function that re-runs the geofence and accepts the badge cost. The
address text itself is an ordinary granted column and is editable any time.

## 6. Contact details, and what phone and WhatsApp can honestly do

Founder's ask:

> "Businesses should also be able to add additional contact information such as
> a WhatsApp or phone number to verify their identity, in addition to or as in
> alternative to an email."

Two halves, and only one of them is shippable today.

**Shippable now.** Phone and WhatsApp become first-class contact details on a
business: collected at step 6, shown to travelers, editable forever, validated
the way every other outbound value already is. `business_links` already has
`phone` and `whatsapp` in its `kind` enum with a validator trigger, so this is
a step that writes rows into a table that was built for it, not a new column.

**Not shippable without a decision from the founder.** Sending a _code_ to a
phone or a WhatsApp number needs an SMS or WhatsApp Business provider — Twilio
or similar — which is a paid account, a new secret and a new Edge Function.
Nothing in this project can send a text message today. So the confirmation code
stays on email until that is wired, and the app must not imply otherwise.

**And the email path has a live defect.** The founder's `@wustl.edu` address
never received a code while their Gmail did. That is the shape of Resend's
sandbox rule: with no verified sending domain, `onboarding@resend.dev` may only
deliver to the Resend account's own address. This project has been bitten by it
once already (`support-mailer`'s backoff comment records it). Two things follow:

1. **Founder action:** verify a domain in Resend and set `SUPPORT_FROM` to an
   address on it. Until that is done, no business but the founder's own can
   ever receive a code. Deferred to go-live on 2026-08-29 and written up as
   [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) step 2.
2. **Ours:** the app must stop claiming a delivery it cannot confirm.
   `outbound_mail` already records `delivery_error`, so a narrow caller-scoped
   RPC can tell the code screen "that address bounced" instead of leaving
   somebody staring at "Check your email".

## 6a. Changing the address or the password afterwards

Added 2026-08-31 (decision D38). Until then the only route to a password
change was "Forgot your password?" on the **signed out** screen, so using it
meant giving up the session first, and there was no route to an email change
at all: losing an inbox was the same as losing the account.

**D38 said hold the email half, and it shipped anyway. Here is why, so the
decision list is not quietly rewritten.** D38 reads: "Ship the password half
now (it needs no mail at all) and hold the email half until the sending domain
lands." The condition it names has since been met — the sending domain is live
and verified (`link.samewhere.io` through Resend), `SUPPORT_INBOX` and
`SUPPORT_FROM` are set to `hello@samewhere.io`, and the deploy that wired them
is green. The reset-password flow already depends on that same GoTrue mailer in
production, so the email change is not a new dependency, only a second caller
of one that is already carrying live traffic. The call to ship both halves was
Claude's, not the founder's, on that reading of the condition; if the premise
is wrong the remedy is to hide the email view, and the failure it would cause
is the one section 6 already documents once — a confirmation link that never
arrives, leaving somebody on "Check your inbox" for a change that cannot
complete.

`account-credentials` is one modal with four views, reachable from a
row on the traveler profile and on the business account page. It is registered
under `guard={signedIn}` rather than `signedIn && onboarded`, because a
business account never satisfies `onboarded` by design and an owner needs this
as much as a traveler does.

- **Password.** `updateUser({ password })` does not check the old one, so
  `changePassword` re-signs in with the session's own address first. That is a
  real sign-in attempt, so a few wrong tries hit the rate limiter and the error
  copy has to read as "wait", never as "wrong password". A success then calls
  `signOut({ scope: 'others' })`, which is what makes the change a remedy after
  a phone goes missing rather than a preference.
- **Email.** `updateUser({ email })` starts a confirmation round trip and the
  address does not move until the link is opened. Nothing writes the new
  address anywhere in the meantime, including `last-email`.
- **Which address is live when.** Whether a link also goes to the CURRENT
  address is Supabase's "Secure email change" project setting, which no code in
  this repo sets. The copy therefore says a second link _may_ arrive, and says
  plainly that the old address keeps signing you in until the change finishes.
  Asserting a project setting we do not control is the mistake
  `reset-password-screen` already made once about other sessions.
- **An Apple account** has no password of ours. The screen renders one sentence
  saying so instead of a form that cannot succeed, read from
  `session.user.app_metadata.provider`.

## 6b. The second ask, after the funnel

Added 2026-08-31. Steps 6 to 11 are six one-tap skips by design (section 2,
rule 2), and that stays. What was missing was the second ask: nothing anywhere
noticed that a profile had no prompt, no priorities and no bio, while the
Travelers screen is built to show all three. Somebody who skipped everything
ended with a photo and a name and was never told.

`src/features/profile/completion.ts` is the one answer to "what is a complete
profile": `profileGaps` returns the unanswered sections in order, trips first
because the matching runs on them. Two surfaces spend it and neither decides
for itself:

- **`finish-card.tsx`**, at the top of the owner's own profile. Every row hands
  over to the editor that already owns that section, which are the same routes
  onboarding pushes to. It is dismissible for the session (in memory, back on
  the next launch) and it draws nothing at all once the last gap closes.
- **`profile-view.tsx`**, under the first prompt on somebody ELSE's page, when
  the reader has none of their own. That is the moment a prompt argues for
  itself. The trigger is there and the definition is in `completion.ts`.

The photo and the name are deliberately never offered back: they are required
steps with no skip, so an account that reached the app has them.

## 7. What this does not change

- The §7 hard rules, all of them.
- `onboarding_completed_at` staying NULL forever for a business account, which
  is what `owesOnboarding` and `register_business` both key on.
- The audience step's constraint: `set_visibility` refuses a narrowed audience
  without a verified badge, so the four narrowed rows stay inert during signup
  with the reason said out loud.
- `StepShell` as the shared chrome. Thirteen steps is a lot of screens and
  exactly zero new layout components.
