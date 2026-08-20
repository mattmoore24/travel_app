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
    body: 'Treat everyone here the way you would someone you had a good chat with at your hostel. That is the whole rule.',
  },
  {
    title: 'Moderation',
    body: 'First messages and photos are checked before they land, so explicit or abusive content never reaches anyone. Repeat problems mean losing access to the app.',
  },
  {
    title: 'Also not allowed',
    body: 'Harassment, hate speech, or discrimination. Fake profiles or photos that are not you. Spam, scams, or commercial solicitation. Sharing someone else’s private information. Explicit or violent photos. Anyone under 18.',
  },
  {
    title: 'Your privacy',
    body: 'We never collect your device location. Pins are plans you type in yourself, and they vanish within 72 hours. Your socials are only shared once you and someone else are chatting. You can delete your account, and everything in it, from your profile whenever you like.',
  },
] as const;
