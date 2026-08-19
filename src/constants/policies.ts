/**
 * In-app policy text (App Review guideline 1.2: a UGC app must let users see
 * and agree to content rules, and must publish a way to reach the developer).
 *
 * Kept bundled rather than linked so the rules are readable offline and
 * before sign-up. Source of truth for the long-form versions:
 * docs/legal/COMMUNITY_GUIDELINES.md and docs/legal/PRIVACY_POLICY.md — keep
 * them in step when either changes.
 */

/**
 * Founder's inbox for now — swap for a dedicated support address before
 * launch (it also appears in docs/legal/* and on the App Store listing).
 */
export const SUPPORT_EMAIL = 'mattmoorefb24@gmail.com';

export const ZERO_TOLERANCE =
  'Zero tolerance: flirting, sexual content, harassment, and abusive users are removed.';

export const GUIDELINE_SECTIONS = [
  {
    title: 'This is a friends app, not a dating app',
    body: 'Keep every message platonic. No flirting, no romantic or sexual advances, no comments on how someone looks. If you would not say it to a new friend in a hostel common room with everyone listening, do not send it.',
  },
  {
    title: 'How we enforce it',
    body: 'Every first message gets checked before it lands. Anything flirty, sexual, nasty or spammy never reaches the other person. Blocked messages and removed photos add up: 3 gets you a warning, 5 suspends you for a week, 7 is the end of the road.',
  },
  {
    title: 'Also not allowed',
    body: 'Harassment, hate speech, or discrimination. Fake profiles or photos that are not you. Spam, scams, or commercial solicitation. Sharing someone else’s private information. Explicit, suggestive, or violent photos. Anyone under 18.',
  },
  {
    title: 'Your privacy',
    body: 'We never collect your device location. Pins are plans you type in yourself, and they vanish within 72 hours. Your socials stay hidden until you and someone else both accept a chat. You can delete your account, and everything in it, from your profile whenever you like.',
  },
  {
    title: 'Staying safe',
    body: 'Meet somewhere public and tell a friend where you are going. Report anything that feels off, you are never wasting our time. Blocking hides you from each other everywhere, straight away.',
  },
] as const;
