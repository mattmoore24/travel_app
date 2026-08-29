/**
 * In-app policy text (App Review guideline 1.2: a UGC app must let users see
 * and agree to content rules, and must publish a way to reach the developer).
 *
 * Kept bundled rather than linked so the rules are readable offline and
 * before sign-up. Source of truth for the long-form versions:
 * docs/legal/COMMUNITY_GUIDELINES.md and docs/legal/PRIVACY_POLICY.md — keep
 * them in step when either changes.
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
