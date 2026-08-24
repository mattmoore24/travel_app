import { fireEvent, render, screen } from '@testing-library/react-native';

import { AudienceChip } from '@/features/pins/audience-chip';

// The map thinned out under a narrowed audience and said nothing about it.
// The empty banner covers the case where every pin goes; this chip covers the
// commoner one, where only some do.

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

beforeEach(() => mockPush.mockClear());

describe('AudienceChip', () => {
  it('says nothing while the audience is open, which is the default', () => {
    render(<AudienceChip audience="everyone" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['verified', 'Verified only', 'verified only'],
    ['verified_men', 'Verified men', 'verified men'],
    ['verified_women', 'Verified women', 'verified women'],
    ['verified_nonbinary', 'Verified non-binary', 'verified non-binary'],
  ] as const)('names %s on the map', (audience, label, spoken) => {
    render(<AudienceChip audience={audience} />);
    expect(screen.getByText(label)).toBeTruthy();
    // VoiceOver gets the state AND the way out of it, not just a label.
    expect(screen.getByRole('button').props.accessibilityLabel).toBe(
      `Showing ${spoken}. Change who you see.`
    );
  });

  // It is drawn selected because it IS on, unlike the date chips beside it
  // where selection is a choice among three.
  it('reads as on', () => {
    render(<AudienceChip audience="verified" />);
    expect(screen.getByRole('button').props.accessibilityState.selected).toBe(true);
  });

  it('is a way back to the setting, not a filter of its own', () => {
    render(<AudienceChip audience="verified_women" />);
    fireEvent.press(screen.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith('/visibility');
  });
});
