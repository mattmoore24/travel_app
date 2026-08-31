import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThreadHeader } from '@/features/chat/thread-header';

/**
 * One header row per thread, and one way out of it.
 *
 * The back control is the piece worth pinning: two identical labels on one
 * screen are ambiguous under VoiceOver, and a bare router.back() on a screen
 * a push notification can open cold does nothing at all (traps).
 */

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    replace: (href: string) => mockReplace(href),
    canGoBack: () => mockCanGoBack(),
  },
}));

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReturnValue(true);
});

describe('ThreadHeader', () => {
  it('carries exactly one back control, under a label nothing else shares', () => {
    render(<ThreadHeader title="Hostel crew" />);
    expect(screen.getAllByLabelText('Back')).toHaveLength(1);
  });

  it('goes back when there is somewhere to go back to', () => {
    render(<ThreadHeader title="Hostel crew" />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('lands on the tabs when the thread is the only route, which a cold deep link is', () => {
    mockCanGoBack.mockReturnValue(false);
    render(<ThreadHeader title="Hostel crew" />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows the name, and a subtitle when it is given one', () => {
    render(<ThreadHeader title="Hostel crew" subtitle="4 people in this chat" />);
    expect(screen.getByText('Hostel crew')).toBeTruthy();
    expect(screen.getByText('4 people in this chat')).toBeTruthy();
  });

  it('leaves the name a plain heading when there is nowhere for it to go', () => {
    // A business reading its own inbox is this case: the name belongs to a
    // traveler, and a traveler's profile is not a screen a business account
    // has. Back is then the only button on the row.
    render(<ThreadHeader title="Ana" onPressIdentity={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('makes the name a control only when there is somewhere for it to go', () => {
    const onPressIdentity = jest.fn();
    render(
      <ThreadHeader title="Ana" onPressIdentity={onPressIdentity} identityLabel="View profile" />
    );
    fireEvent.press(screen.getByLabelText('View profile'));
    expect(onPressIdentity).toHaveBeenCalled();
  });
});
