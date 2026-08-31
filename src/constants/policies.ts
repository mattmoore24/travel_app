/**
 * In-app policy text (App Review guideline 1.2: a UGC app must let users see
 * and agree to content rules, and must publish a way to reach the developer;
 * 5.1.1(i): the privacy policy must be reachable in-app, not only on the
 * store listing).
 *
 * Kept bundled rather than linked so the rules are readable offline and
 * before sign-up. Source of truth for the long-form versions:
 * docs/legal/COMMUNITY_GUIDELINES.md and docs/legal/PRIVACY_POLICY.md, and
 * the hosted store-listing pages (WebLinks.privacy / WebLinks.support in
 * src/constants/links.ts) publish the same documents — all of them move
 * together when any one changes.
 *
 * 'House rules' is the ONE user-facing name for the rulebook (decision D32):
 * every button, title and error the app shows says house rules.
 * docs/legal/COMMUNITY_GUIDELINES.md keeps its filename — App Review, Apple's
 * forms and any future dispute expect that phrase — and 'Community
 * guidelines' survives only in docs/legal and App Store Connect.
 */

export const ZERO_TOLERANCE =
  'Treat everyone here with respect and kindness. Explicit content, harassment and spam are not allowed.';

export const GUIDELINE_SECTIONS = [
  {
    title: 'Respect and kindness',
    body: "Treat people the way you'd treat someone you just had a good chat with in the common room. That's the whole rule.",
  },
  {
    title: 'Moderation',
    body: 'First messages and photos are checked before they land. Repeat problems mean losing your account.',
  },
  {
    title: 'Also not allowed',
    body: 'Harassment, hate speech, or discrimination. Fake profiles or photos that are not you. Spam, scams, or commercial solicitation. Sharing someone else’s private information. Explicit or violent photos. Anyone under 18.',
  },
  {
    title: 'Your privacy',
    body: 'We never collect your location. Pins are plans you type, and they vanish within 72 hours. Your socials only show once you are both chatting. Delete your account, and everything in it, any time from your profile.',
  },
  {
    // The one section of docs/legal/COMMUNITY_GUIDELINES.md that never made
    // it into the app, and the only one that is about the moment the product
    // exists for: two strangers actually meeting.
    title: 'Meeting up',
    body: 'Make plans in public places, and tell someone where you are going. Report anything that feels off. You are never wasting our time.',
  },
] as const;

/**
 * The four safety promises, at the two moments they decide something.
 *
 * The reason somebody picks this over GAFFL, Couchsurfing or Bumble BFF is
 * that it collects no location, expires pins within 72 hours, hides socials
 * until both sides are chatting, and screens every first message. All four
 * are true and enforced in Postgres, and until now all four lived in the
 * fourth section of a rulebook behind a button nobody opens: the product's
 * whole differentiator was invisible at the moment it decides an install.
 *
 * These are exported rather than typed into each screen so the intro tour,
 * the sign-up gate and GUIDELINE_SECTIONS cannot drift apart. The body is the
 * 'Your privacy' section's first three sentences, said in the second person.
 */
export const SAFETY_PROMISE_TITLE = 'We never ask where you are';

export const SAFETY_PROMISE_BODY =
  'Pins are plans you type, and they are gone within 72 hours. Your socials only show once you are both chatting.';

/**
 * The line under every sign-up gate in the app: the map, travelers, chat, a
 * business, a room, a group invite. One string, six moments.
 */
export const SIGN_UP_GATE_NOTE = 'Takes a minute. Always free, and we never ask where you are.';

/**
 * What a stranger is told where somebody's socials would be. The gate is
 * enforced by RLS (hard rule 4), so this says what the database does, not
 * what we intend.
 */
export const SOCIALS_HIDDEN_NOTE = 'Your socials stay hidden until you are both chatting.';

/**
 * The privacy policy, distilled from docs/legal/PRIVACY_POLICY.md for the
 * /privacy screen. Nothing bracketed in that draft is claimed here: the exact
 * Supabase region and the legal entity are still founder and lawyer answers,
 * and shipping a guess in a published policy is worse than saying less.
 *
 * `source` names the heading in docs/legal/PRIVACY_POLICY.md each section
 * summarises, and src/app/__tests__/privacy-screen.test.tsx asserts every one
 * of them is still a real heading there. The header comment was the only
 * thing keeping the two in step before, and it had already failed once: the
 * meeting-safety section of the house rules was dropped from the app for
 * months and nothing noticed.
 *
 * Two recorded decisions shape the wording: the data-export promise is
 * narrowed to what Contact us can actually deliver (D20), and the selfie
 * check is named as biometric data (D21).
 */
export const PRIVACY_PROMISE =
  'We never collect your location. The map only shows plans people typed in themselves.';

export const PRIVACY_SECTIONS = [
  {
    // The location denial leads, because it is the strongest sentence in the
    // document and the one a cautious traveler opened this screen to find.
    title: 'What we never collect',
    source: 'What we deliberately do NOT collect',
    body: 'Your device location. The app never asks for it and has no permission to read it, so the map can only ever show plans people typed in themselves. We also never see your birthdate, your contacts, or any photo beyond the ones you pick, and we never follow you around other apps.',
  },
  {
    title: 'What we collect',
    source: 'What we collect',
    body: 'Your email address, and the profile you build: name, age, gender, home city, languages, bio, photos and any socials you add. Trips are a city and dates. Pins are a venue, a category and a day, and they are permanently deleted within 72 hours. Messages you send are stored so both sides of a chat can read them. If you sign in with Apple, we also keep one token Apple gives us, for the single purpose of telling Apple to forget your account when you delete it; nobody can read it and it is destroyed with your account. We also record which screens get opened, so we can tell which parts of the app are working.',
  },
  {
    title: 'The selfie check',
    source: 'Verification, and why we call it biometric',
    body: 'Getting verified is optional. Your selfie is compared automatically with your profile photos to confirm they show the same person. Nothing measures your face and no template of it is worked out. That comparison still counts as biometric data, so it only happens because you chose to start it. The selfie is deleted once checked, and only the result is kept.',
  },
  {
    title: 'What other travelers see',
    source: 'How your information is shared with other users',
    body: 'Your profile and your upcoming trips show to travelers who can reach them, like someone whose trip overlaps yours or someone who taps your pin. Posting a trip also makes you eligible to appear as the one featured traveler a signed-out visitor sees, but only while you are set to everyone: narrow who can see you and a signed-out visitor cannot see you at all. Your socials only show once you are both chatting, and the database enforces that. The heat on the map is anonymous, and areas with only a few plans are never shown.',
  },
  {
    title: 'Moderation',
    source: 'Content moderation',
    body: 'First messages, photos and selfies are checked automatically before they land, partly by an AI classifier we run through Anthropic\u2019s API. Decisions are logged so we can answer for them, and repeated problems can cost you your account. Your content is never used to train AI models.',
  },
  {
    title: 'If we get it wrong',
    source: 'Appeals, and a person at the end of it',
    body: 'Anything decided automatically can be looked at again by a person. If a message was blocked, a photo removed or an account restricted, write to us from Contact us and somebody will read the decision itself, not just the log. We answer within 30 days.',
  },
  {
    title: 'Where your data lives',
    source: 'Who processes your data for us',
    body: 'Your account, photos and messages live with Supabase, in the EU. Push notifications travel through Expo and Apple, analytics through PostHog in the EU, the moderation and selfie checks through Anthropic, and our email through Resend. None of them may use your data for anything but running Samewhere, and none of them is an advertising company.',
  },
  {
    title: 'Deleting your account',
    source: 'Retention and deletion',
    body: 'Delete your account any time from your profile. Your profile, photos, trips, pins and chats are permanently deleted, for both sides of every chat. If you signed in with Apple, we tell Apple to forget the account as part of the same deletion. Moderation records are kept with your identity removed, because safety reports have to outlive the accounts they are about.',
  },
  {
    title: 'Your rights',
    source: 'Your rights',
    body: 'Depending on where you live, you may have the right to see, correct or delete what we hold about you. Send us a message from Contact us in the app and a person will sort it out within 30 days. This app is for adults 18 and over.',
  },
] as const;

/**
 * The same rules, for the account that runs a bar rather than travels.
 *
 * The traveler sections above were the only rulebook a business was ever
 * offered, and they are written about pins, socials and "your profile", none
 * of which a business has. Worse, "Also not allowed" bans commercial
 * solicitation, which reads as banning the exact thing a business account is
 * for. Founder, testing as a business: "every aspect of the business account
 * [must be] perfected and fully optimized for business users."
 *
 * Nothing here is a new rule. It is §7 and rule 8 of docs/BUSINESS_ACCOUNTS.md
 * said to the person who owns the premises.
 */
export const BUSINESS_ZERO_TOLERANCE =
  'Be the business you say you are, and let travelers come to you.';

export const BUSINESS_RULE_SECTIONS = [
  {
    title: 'Your listing is you',
    body: 'The name over the door, photos of the business rather than of a person, and hours that are true. Changing your name or moving your marker takes you off the map until you confirm your email again.',
  },
  {
    title: 'Travelers write first',
    body: 'You reply to anyone who writes in, and you post to your own chat. You cannot message a traveler who has not written to you, and you cannot join a traveler plan or another business chat.',
  },
  {
    title: 'What gets checked',
    body: 'Your name, description, posts and photos go through the same check every message here does. Reports are read by a person.',
  },
  {
    title: 'Your rating',
    body: 'Travelers rate you out of ten. You never see who rated you, and nothing shows until five of them have.',
  },
] as const;
