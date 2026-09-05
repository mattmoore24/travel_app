/**
 * What a profile is still missing, and why each piece is worth a minute.
 *
 * Steps 6 through 11 of signup are six one-tap skips by design, and
 * docs/ONBOARDING.md section 2 records the founder asking for exactly that
 * shape, so moving them back into the funnel is not the answer. What was
 * missing is the SECOND ask: nothing anywhere noticed that a profile had no
 * prompt, no priorities and no bio, while the Travelers screen is built to
 * show all three. Somebody who skipped everything ended with a photo and a
 * name, and no surface ever said so.
 *
 * One function, so there is exactly one answer to "what is a complete
 * profile". The card on the profile page and the nudge on a stranger's
 * prompts both read it rather than each deciding for themselves.
 *
 * It deliberately does NOT list the photo or the name: those are required
 * steps with no skip, so an account that reached the app has them, and a card
 * offering back something nobody could have missed reads as noise.
 */

export type ProfileGapKey = 'trip' | 'prompt' | 'priorities' | 'bio' | 'occupation' | 'socials';

export type ProfileGap = {
  key: ProfileGapKey;
  /** The action, in the words of the control that does it. */
  title: string;
  /** Why it is worth doing, in one line. */
  body: string;
  /** The editor that already owns this section. */
  route: '/add-trip' | '/edit-prompt' | '/edit-priorities' | '/edit-profile';
  /** Which block of the long form to land on, where the route is one. */
  section?: 'about' | 'socials';
};

type GapsInput = {
  profile: { bio: string | null; occupation: string | null };
  prompts: unknown[];
  priorities: unknown[];
  trips: unknown[];
  handles: unknown[];
};

const filled = (value: string | null): boolean => (value ?? '').trim().length > 0;

export function profileGaps({ profile, prompts, priorities, trips, handles }: GapsInput): {
  gaps: ProfileGap[];
  count: number;
} {
  const gaps: ProfileGap[] = [];

  // Trips first, and not by taste: the matching runs on dates in a city, so a
  // profile with no trip is invisible to the feature the app exists for.
  if (trips.length === 0) {
    gaps.push({
      key: 'trip',
      title: 'Add a trip',
      body: 'Dates in a city. This is what puts you in front of people who will be there too.',
      route: '/add-trip',
    });
  }
  if (prompts.length === 0) {
    gaps.push({
      key: 'prompt',
      title: 'Answer a prompt',
      body: 'The bit people read before they decide to say hi.',
      route: '/edit-prompt',
    });
  }
  if (priorities.length === 0) {
    gaps.push({
      key: 'priorities',
      title: 'Say what you are after',
      body: 'What you are hoping to do, so the right people say hi.',
      route: '/edit-priorities',
    });
  }
  if (!filled(profile.bio)) {
    gaps.push({
      key: 'bio',
      title: 'Write a line about you',
      body: 'What should somebody say hi about? It sits under your photo.',
      route: '/edit-profile',
      section: 'about',
    });
  }
  if (!filled(profile.occupation)) {
    gaps.push({
      key: 'occupation',
      title: 'Say what you do',
      body: 'Two words is plenty. It gives somebody an easy thing to ask about.',
      route: '/edit-profile',
      section: 'about',
    });
  }
  if (handles.length === 0) {
    gaps.push({
      key: 'socials',
      title: 'Add your socials',
      body: 'Nobody sees these until you are both in a chat.',
      route: '/edit-profile',
      section: 'socials',
    });
  }

  return { gaps, count: gaps.length };
}
