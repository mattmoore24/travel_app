/**
 * In-app policy text (App Review guideline 1.2: a UGC app must let users see
 * and agree to content rules, and must publish a way to reach the developer).
 *
 * Kept bundled rather than linked so the rules are readable offline and
 * before sign-up. Source of truth for the long-form versions:
 * docs/legal/COMMUNITY_GUIDELINES.md and docs/legal/PRIVACY_POLICY.md — keep
 * them in step when either changes.
 */

/** Founder: replace before submission (also in docs/legal/*). */
export const SUPPORT_EMAIL = 'support@example.com';

export const ZERO_TOLERANCE =
  'Zero tolerance: flirting, sexual content, harassment, and abusive users are removed.';

export const GUIDELINE_SECTIONS = [
  {
    title: 'This is a friends app, not a dating app',
    body: 'Keep every message platonic. No flirting, no romantic or sexual advances, no comments on how someone looks. If you would not say it to a new friend in a hostel common room with everyone listening, do not send it.',
  },
  {
    title: 'How we enforce it',
    body: 'Every first message is screened before it is delivered — flirtatious, sexual, harassing, or spam messages never reach the recipient. Blocked messages and removed photos earn strikes: 3 is a warning, 5 suspends your account for a week, 7 is a permanent ban.',
  },
  {
    title: 'Also not allowed',
    body: 'Harassment, hate speech, or discrimination. Fake profiles or photos that are not you. Spam, scams, or commercial solicitation. Sharing someone else’s private information. Explicit, suggestive, or violent photos. Anyone under 18.',
  },
  {
    title: 'Your privacy',
    body: 'We never collect your device location — pins are venue-level plans you type in yourself, and they disappear within 72 hours. Your social handles stay hidden until you and another traveler both accept a chat. You can delete your account, and everything in it, from your profile at any time.',
  },
  {
    title: 'Staying safe',
    body: 'Meet in public places and tell someone where you are going. Report anything that feels off — you are never wasting our time. Blocking someone hides you from each other everywhere, instantly.',
  },
] as const;
