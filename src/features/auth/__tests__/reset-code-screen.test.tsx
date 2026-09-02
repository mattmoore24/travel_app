import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ResetCodeScreen from '@/app/(auth)/reset-code';
import { useAuthStore } from '@/features/auth/store';

/**
 * The four states of the six-digit screen, rendered for real.
 *
 * firstrun-reset-web-path was recorded as superseded by "the six-digit code"
 * and the code did not exist: the sentence that closed the package pointed
 * at nothing. This file is the other end of that sentence. The api call is
 * mocked here because what is being proved is the screen's wiring - which
 * arguments leave it, which sentence comes back, what the store says
 * afterwards; `recovery-code.test.ts` proves the call under the mock reaches
 * `supabase.auth.verifyOtp` with `type: 'recovery'`.
 */
const mockVerify = jest.fn();
const mockReset = jest.fn();
jest.mock('@/features/auth/api', () => ({
  verifyRecoveryCode: (...args: unknown[]) => mockVerify(...args),
  requestPasswordReset: (...args: unknown[]) => mockReset(...args),
}));

let mockParams: Record<string, string> = {};
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouter.push(...args),
    back: (...args: unknown[]) => mockRouter.back(...args),
    replace: (...args: unknown[]) => mockRouter.replace(...args),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));

// StepScreen docks its button above the keyboard, which reads the safe area,
// so the screen needs a provider with real metrics under it.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ResetCodeScreen />
    </SafeAreaProvider>
  );

const HOUR = 60 * 60 * 1000;
const WRONG = {
  message: 'Token has expired or is invalid',
  code: 'otp_expired',
  status: 403,
};

beforeEach(() => {
  mockVerify.mockReset();
  mockReset.mockReset();
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  mockRouter.replace.mockReset();
  useAuthStore.getState().endRecovery();
  mockParams = { email: 'ana@example.com', sentAt: String(Date.now()) };
});

describe('code accepted', () => {
  it('hands the address and the six digits to the api, then raises the recovery flag', async () => {
    mockVerify.mockResolvedValue(undefined);
    show();

    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByText(/We sent a six-digit code to ana@example.com/)).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('reset-code-input'), '123456');
    fireEvent.press(screen.getByText('Use this code'));

    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('ana@example.com', '123456'));
    // The root renders ResetPasswordScreen instead of the stack while this
    // is non-null. The auth listener sets it on PASSWORD_RECOVERY; the
    // screen sets it again, so a missed event cannot leave somebody in the
    // tabs with the old password live.
    await waitFor(() => expect(useAuthStore.getState().recovery?.status).toBe('ready'));
  });

  it('keeps whatever was pasted around the digits out of the box', () => {
    show();
    fireEvent.changeText(screen.getByTestId('reset-code-input'), 'Your code: 12-34-56.');
    expect(screen.getByTestId('reset-code-input').props.value).toBe('123456');
  });

  it('does not ask the server about fewer than six digits', () => {
    show();
    fireEvent.changeText(screen.getByTestId('reset-code-input'), '12345');
    fireEvent.press(screen.getByText('Use this code'));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(screen.getByText('Six digits, from the email.')).toBeTruthy();
  });
});

describe('wrong code', () => {
  it('says so under the box, in one sentence for wrong and expired, and empties the box', async () => {
    mockVerify.mockRejectedValue(WRONG);
    show();

    fireEvent.changeText(screen.getByTestId('reset-code-input'), '654321');
    fireEvent.press(screen.getByText('Use this code'));

    expect(
      await screen.findByText(
        'That code is not right, or it has run out. Check the digits, or send yourself a new one.'
      )
    ).toBeTruthy();
    // The next attempt is six fresh digits, not an edit of these.
    expect(screen.getByTestId('reset-code-input').props.value).toBe('');
    // And nobody was signed in on the strength of a refused code.
    expect(useAuthStore.getState().recovery).toBeNull();
  });

  it('tells a rate limiter apart from a wrong code', async () => {
    mockVerify.mockRejectedValue({
      message: 'Request rate limit reached',
      code: 'over_request_rate_limit',
      status: 429,
    });
    show();
    fireEvent.changeText(screen.getByTestId('reset-code-input'), '654321');
    fireEvent.press(screen.getByText('Use this code'));
    expect(
      await screen.findByText('Too many tries just now. Wait a minute and go again.')
    ).toBeTruthy();
  });
});

describe('expired code', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('flips its own copy once the hour is up, and leads with sending another', () => {
    mockParams = { email: 'ana@example.com', sentAt: String(Date.now() - 2 * HOUR) };
    show();
    // The clock is read in an effect and the flip is a timer for the exact
    // minute the code dies, which for a two-hour-old code is now.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.getByText('That code has run out')).toBeTruthy();
    expect(
      screen.getByText(
        'The code we sent to ana@example.com has run out. Send yourself a fresh one.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('a fresh send puts it back to "Check your email" with a new hour on the clock', async () => {
    mockParams = { email: 'ana@example.com', sentAt: String(Date.now() - 2 * HOUR) };
    mockReset.mockResolvedValue(undefined);
    show();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.getByText('That code has run out')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send the code again'));
    });

    expect(mockReset).toHaveBeenCalledWith('ana@example.com');
    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByText('Sent. Give it a minute to turn up.')).toBeTruthy();
  });

  it('says a second code is already coming when the server throttles the send, rather than "Sent"', async () => {
    mockReset.mockRejectedValue({
      message: 'For security purposes, you can only request this after 42 seconds.',
      code: 'over_email_send_rate_limit',
      status: 429,
    });
    show();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send the code again'));
    });
    expect(
      screen.getByText('One is already on its way. Give it a minute before asking for another.')
    ).toBeTruthy();
    expect(screen.queryByText('Sent. Give it a minute to turn up.')).toBeNull();
  });
});

describe('no code in the mail', () => {
  it('says what to do with a mail that carries a link instead', () => {
    // The mail template decides which the mail carries (docs/SUPABASE_SETUP.md
    // §5); until the founder edits it, and for every mail sent before that,
    // this line is the whole answer to a screen asking for digits.
    show();
    expect(screen.getByText(/Got a link and no code\? Open the email on the phone/)).toBeTruthy();
    expect(screen.getByText(/tap the link\. It brings you straight here\./)).toBeTruthy();
    expect(
      screen.getByText('Nothing yet? Check your spam, and check the address above.')
    ).toBeTruthy();
  });

  it('offers the way back to the address, and no way to type a different one here', () => {
    show();
    fireEvent.press(screen.getByLabelText('Go back and use a different address'));
    expect(mockRouter.back).toHaveBeenCalled();
    // A second form taking an address AND a secret is a second place to
    // probe which addresses have accounts. The sign-in screen is one tap back.
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
  });

  it('sends nobody a code without an address to send it to', () => {
    mockParams = {};
    show();
    expect(screen.queryByTestId('reset-code-input')).toBeNull();
    expect(mockReset).not.toHaveBeenCalled();
  });
});

describe('the words', () => {
  it('carry no em dash, no banned vocabulary, and no presence claim', () => {
    show();
    const words = screen.toJSON();
    const text = JSON.stringify(words);
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/\b(swipe|deck|match|unmatch|request)\b/i);
    expect(text).not.toMatch(/\b(here now|nearby|near you)\b/i);
  });
});
