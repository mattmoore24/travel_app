import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ComposeRequestScreen from '@/app/compose-request';

/**
 * The one path a hello travels must never destroy the words on it.
 *
 * Hitting the daily cap used to early-return a full-screen card, unmounting
 * the composer and the two minutes of writing inside it. The cap is now an
 * opaque overlay in the same tree, so the draft survives "Keep my message" —
 * and the at-the-door guard shows the card BEFORE anybody writes into a box
 * that cannot send, without ever eating a draft that already exists.
 */

// jest.mock factories are hoisted, so shared state is named mock*.
const mockMutateAsync = jest.fn();
const mockBudget: { data: { used: number; allowed: number } | undefined } = {
  data: { used: 0, allowed: 8 },
};
const mockParams: Record<string, string> = { userId: 'u1', name: 'Nora', photoPath: '' };
let mockRisky = false;

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/matching/hooks', () => ({
  useDraftWarning: () => mockRisky,
  useFirstMessageBudget: () => ({ data: mockBudget.data }),
  useSendRequest: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: null }),
}));

beforeEach(() => {
  mockBudget.data = { used: 0, allowed: 8 };
  mockRisky = false;
  delete mockParams.draft;
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ComposeRequestScreen />
    </SafeAreaProvider>
  );

const sendResult = (overrides: Record<string, unknown>) => ({
  request_id: null,
  delivered: false,
  queued: false,
  blocked: false,
  capped: false,
  allowed: 8,
  ...overrides,
});

const DRAFT = 'Both in Bangkok next week, up for a market run?';
const typeDraft = () =>
  fireEvent.changeText(
    screen.getByPlaceholderText('Say something they can actually reply to.'),
    DRAFT
  );

describe('the mid-session cap', () => {
  it('keeps the message: the overlay lifts and the draft is still there', async () => {
    mockMutateAsync.mockResolvedValue(sendResult({ capped: true, allowed: 8 }));
    show();
    typeDraft();
    fireEvent.press(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText('That is your 8 for today')).toBeTruthy());
    // The composer is still mounted underneath — this is an overlay, not a
    // replacement screen.
    fireEvent.press(screen.getByText('Keep my message'));

    expect(screen.queryByText('That is your 8 for today')).toBeNull();
    expect(screen.getByDisplayValue(DRAFT)).toBeTruthy();
  });
});

describe('the at-the-door cap', () => {
  it('shows the card before anybody writes into a box that cannot send', () => {
    mockBudget.data = { used: 8, allowed: 8 };
    show();
    expect(screen.getByText('That is your 8 for today')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Say something they can actually reply to.')).toBeNull();
  });

  it('never eats a draft that was handed in', () => {
    mockBudget.data = { used: 8, allowed: 8 };
    mockParams.draft = DRAFT;
    show();
    expect(screen.getByDisplayValue(DRAFT)).toBeTruthy();
  });

  it('never flashes over a budget that has not loaded', () => {
    mockBudget.data = undefined;
    show();
    expect(screen.queryByText(/for today$/)).toBeNull();
    expect(screen.getByPlaceholderText('Say something they can actually reply to.')).toBeTruthy();
  });
});

describe('the advisory after a refusal', () => {
  it('keeps the red card while the draft still reads blocked', async () => {
    mockRisky = true;
    mockMutateAsync.mockResolvedValue(sendResult({ blocked: true }));
    show();
    typeDraft();
    fireEvent.press(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText("That message can't be sent")).toBeTruthy());
    expect(screen.queryByText("That reads better. Send when you're ready.")).toBeNull();
  });

  it('shows the refusal, not the finish line, while the refused text stands', async () => {
    // The preview can be behind or blind: an explicit message under 12
    // characters, or a Send inside the debounce, reaches the server with
    // risky still false. The refusal itself must never be answered with
    // congratulations on the exact text that was refused.
    mockRisky = false;
    mockMutateAsync.mockResolvedValue(sendResult({ blocked: true }));
    show();
    typeDraft();
    fireEvent.press(screen.getByText('Send'));

    await waitFor(() => expect(screen.getByText("That message can't be sent")).toBeTruthy());
    expect(screen.queryByText("That reads better. Send when you're ready.")).toBeNull();
  });

  it('gives a rewrite a visible finish line once the draft actually changed', async () => {
    mockRisky = false;
    mockMutateAsync.mockResolvedValue(sendResult({ blocked: true }));
    show();
    typeDraft();
    fireEvent.press(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText("That message can't be sent")).toBeTruthy());

    fireEvent.changeText(
      screen.getByPlaceholderText('Say something they can actually reply to.'),
      'Both in Bangkok next week, want to trade market finds?'
    );

    await waitFor(() =>
      expect(screen.getByText("That reads better. Send when you're ready.")).toBeTruthy()
    );
    expect(screen.queryByText("That message can't be sent")).toBeNull();
    // A finish line, not a guarantee: the words never promise delivery.
    expect(screen.queryByText(/will be delivered|goes straight out|guarantee/i)).toBeNull();
  });

  it('never congratulates an emptied box', async () => {
    mockRisky = false;
    mockMutateAsync.mockResolvedValue(sendResult({ blocked: true }));
    show();
    typeDraft();
    fireEvent.press(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText("That message can't be sent")).toBeTruthy());

    fireEvent.changeText(
      screen.getByPlaceholderText('Say something they can actually reply to.'),
      ''
    );

    expect(screen.queryByText("That reads better. Send when you're ready.")).toBeNull();
  });
});
