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
] as const;

/**
 * The privacy policy, distilled from docs/legal/PRIVACY_POLICY.md for the
 * /privacy screen. Only the uncontested paragraphs of that draft are here:
 * the analytics bullet and the exact hosting region are still bracketed
 * founder decisions there, so neither is claimed here — shipping a guess in
 * a published policy is worse than saying less.
 *
 * Two recorded decisions shape the wording: the data-export promise is
 * narrowed to what Contact us can actually deliver (D20), and the selfie
 * check is named as biometric data (D21).
 */
export const PRIVACY_PROMISE =
  'We never collect your location. The map only shows plans people typed in themselves.';

export const PRIVACY_SECTIONS = [
  {
    title: 'What we collect',
    body: 'Your email address, and the profile you build: name, age, gender, home city, languages, bio, photos and any socials you add. Trips are a city and dates. Pins are a venue, a category and a day, and they are permanently deleted within 72 hours. Messages you send are stored so both sides of a chat can read them.',
  },
  {
    title: 'The selfie check',
    body: 'Getting verified is optional. Your selfie is compared automatically with your profile photos to confirm they show the same person. That comparison counts as biometric data, so it only happens because you chose to start it. The selfie is deleted once checked, and only the result is kept.',
  },
  {
    title: 'What we never collect',
    body: 'Your device location. The app never asks for it and has no permission to read it. We also never see your birthdate, your contacts, or any photo beyond the ones you pick.',
  },
  {
    title: 'What other travelers see',
    body: 'Your profile and your upcoming trips show to travelers who can reach them, like someone whose trip overlaps yours or someone who taps your pin. Posting a trip also makes you eligible to appear as the one featured traveler a signed-out visitor sees; delete the trip and you leave that spot. Your socials only show once you are both chatting, and the database enforces that. The heat on the map is anonymous, and areas with only a few plans are never shown.',
  },
  {
    title: 'Moderation',
    body: 'First messages, photos and selfies are checked automatically before they land, partly by an AI classifier we run through Anthropic\u2019s API. Decisions are logged so we can answer for them. Your content is never used to train AI models.',
  },
  {
    title: 'Where your data lives',
    body: 'Your account, photos and messages live in our database and photo storage, hosted by Supabase. Push notifications travel through Expo and Apple.',
  },
  {
    title: 'Deleting your account',
    body: 'Delete your account any time from your profile. Your profile, photos, trips, pins and chats are permanently deleted, for both sides of every chat. Moderation records are kept with your identity removed, because safety reports have to outlive the accounts they are about.',
  },
  {
    title: 'Your rights',
    body: 'Depending on where you live, you may have the right to see, correct or delete what we hold about you. Send us a message from Contact us in the app and a person will sort it out. This app is for adults 18 and over.',
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
