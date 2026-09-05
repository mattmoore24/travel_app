import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import VisibilityScreen from '@/app/visibility';
import type { ProfileAudience } from '@/lib/database.types';

// The rule that a narrowed audience costs a verified badge is enforced in the
// database (set_visibility raises, and 17_profile_visibility.test.sql proves
// it). What that CANNOT prove is the half that decides whether a traveler
// ever meets the error: the picker is supposed to be inert for an unverified
// account, not live-and-then-scolding. That is what these pin down.

// jest.mock factories are hoisted above every other binding, so the state
// they close over has to be named mock* to be allowed through.
const mockMutate = jest.fn();
const mockState: { verified: boolean; audience: ProfileAudience } = {
  verified: false,
  audience: 'everyone',
};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

// The group-adds rows are backed by a real query rather than a mocked hook, so
// without this the screen constructs a live Supabase client and leaves its
// timers running after the last assertion.
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));

jest.mock('@/features/profile/hooks', () => ({
  useOwnProfile: () => ({ data: { verified: mockState.verified } }),
  useOwnVisibility: () => ({ data: mockState.audience }),
  useSetVisibility: () => ({ mutate: mockMutate, isPending: false }),
  // The signed-out preview row (D22, 20260903080000). Left at the server's
  // default here; src/features/profile/__tests__/guest-preview.test.tsx is
  // the file that exercises it.
  useOwnGuestPreview: () => ({ data: true }),
  useSetGuestPreview: () => ({ mutate: jest.fn(), isPending: false }),
}));

beforeEach(() => {
  mockMutate.mockClear();
  mockState.verified = false;
  mockState.audience = 'everyone';
});

// StepScreen docks its continue button above the keyboard, which reads the
// safe area, so the screen needs a provider with real metrics under it.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// The screen also asks who may add you to a group, which is an ordinary
// query rather than a mocked hook, so it needs a client to ask on. Retries
// off: nothing here reaches a network, and a retrying query would keep the
// test process awake.
const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <VisibilityScreen />
      </SafeAreaProvider>
    </QueryClientProvider>
  );

const row = (label: string) => screen.getByLabelText(new RegExp(`^${label}\\.`));

describe('an unverified traveler', () => {
  it('is offered every audience, so the badge has a visible point', () => {
    show();
    for (const label of [
      'Everyone',
      'Verified only',
      'Verified men',
      'Verified women',
      'Verified non-binary',
    ]) {
      expect(row(label)).toBeTruthy();
    }
  });

  it('but cannot pick one, and is told why', () => {
    show();
    fireEvent.press(row('Verified women'));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(row('Verified women').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/Get your badge and they turn on/i)).toBeTruthy();
  });

  // A locked row must never swallow the tap in silence. On this screen it
  // opens verification — the door the row is locked behind — which the
  // spoken label also announces.
  it('is routed to verification by a tap on a locked row', () => {
    const { router } = jest.requireMock('expo-router');
    show();
    fireEvent.press(row('Verified women'));
    expect(router.push).toHaveBeenCalledWith('/verification');
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('can still stay on the default without being blocked by its own rule', () => {
    mockState.audience = 'verified';
    show();
    fireEvent.press(row('Everyone'));
    expect(mockMutate).toHaveBeenCalledWith('everyone');
  });
});

describe('a verified traveler', () => {
  beforeEach(() => {
    mockState.verified = true;
  });

  it('can pick any of them, non-binary included', () => {
    show();
    fireEvent.press(row('Verified non-binary'));
    expect(mockMutate).toHaveBeenCalledWith('verified_nonbinary');
  });

  it('sees which one is live', () => {
    mockState.audience = 'verified_men';
    show();
    expect(row('Verified men').props.accessibilityState.selected).toBe(true);
    expect(row('Verified women').props.accessibilityState.selected).toBe(false);
  });

  // Tapping the row you are already on is not a change; firing the mutation
  // would invalidate the queue and the map for nothing.
  it('does not re-save the audience already chosen', () => {
    mockState.audience = 'verified_women';
    show();
    fireEvent.press(row('Verified women'));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // The warning that explains an empty Travelers queue before somebody
  // reports it as a broken filter. Only while a narrowing is actually on.
  it('is warned that a narrowed audience thins both surfaces', () => {
    mockState.audience = 'verified';
    show();
    expect(screen.getByText(/fewer travelers/i)).toBeTruthy();
  });

  it('and is not warned when no narrowing is on', () => {
    show();
    expect(screen.queryByText(/fewer travelers/i)).toBeNull();
  });
});

// The founder set this to verified only, read the screen, and still expected
// a one-way filter. The both-ways rule was on the screen but it was the
// smallest thing on it AND it was inside the `verified` branch, so the person
// deciding whether the badge is worth a selfie never saw it at all.
describe('the both-ways rule', () => {
  it('is in the title, where it cannot be missed', () => {
    show();
    expect(screen.getByText(/who you see, and who sees you/i)).toBeTruthy();
  });

  it('is in the subtitle in both directions', () => {
    show();
    expect(screen.getByText(/can see you, and they are the only people you see/i)).toBeTruthy();
  });

  it.each([
    ['unverified', false],
    ['verified', true],
  ])('reaches a %s traveler, since both are choosing', (_name, verified) => {
    mockState.verified = verified;
    show();
    expect(screen.getByText(/passed the selfie check/i)).toBeTruthy();
  });

  // These are the VoiceOver labels too, so a one-way description was the
  // whole of what a VoiceOver user was told.
  it('is in every option that narrows, not only in the prose', () => {
    show();
    for (const label of [
      'Verified only',
      'Verified men',
      'Verified women',
      'Verified non-binary',
    ]) {
      expect(row(label).props.accessibilityLabel).toMatch(
        /see you, and they are the only ones you see/i
      );
    }
  });
});

/**
 * The second thing this screen decides.
 *
 * Being put in a group with strangers was the one place the app's
 * consent-before-exposure grammar broke: add_to_group inserts straight into
 * room_members. The rule is enforced there (41_who_can_add_me.test.sql proves
 * it); what this pins is that the screen a person looks on for "who can do
 * what to me" actually offers it, and says what each choice costs.
 */
describe('who can add you to a group', () => {
  it('offers both rules by name', () => {
    show();
    expect(screen.getByText('Anyone you have chatted with')).toBeTruthy();
    expect(screen.getByText('Only by invite link')).toBeTruthy();
  });

  it('says the consequence of each out loud, the way the audience block does', () => {
    show();
    expect(
      screen.getByText('They can add you straight into a group with people you have not met.')
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Nobody can add you. You join groups by opening a link, which is always your choice.'
      )
    ).toBeTruthy();
  });

  it('starts on the rule the database defaults to, so the screen and the server agree', () => {
    show();
    // Spoken as one sentence: the label and what it means.
    expect(
      screen.getByLabelText(
        'Anyone you have chatted with. They can add you straight into a group with people you have not met.'
      ).props.accessibilityState.selected
    ).toBe(true);
  });
});
