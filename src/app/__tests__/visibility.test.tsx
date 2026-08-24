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

jest.mock('@/features/profile/hooks', () => ({
  useOwnProfile: () => ({ data: { verified: mockState.verified } }),
  useOwnVisibility: () => ({ data: mockState.audience }),
  useSetVisibility: () => ({ mutate: mockMutate, isPending: false }),
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

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <VisibilityScreen />
    </SafeAreaProvider>
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
    expect(screen.getByText(/need the badge/i)).toBeTruthy();
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
