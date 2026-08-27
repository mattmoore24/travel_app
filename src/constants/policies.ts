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
