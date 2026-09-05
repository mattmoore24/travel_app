import { verifyRecoveryCode } from '@/features/auth/api';
import { recoveryCodeProblem, resendOutcome } from '@/features/auth/recovery';

/**
 * The other end of the six-digit screen: `verifyRecoveryCode` reaches
 * `supabase.auth.verifyOtp` with `type: 'recovery'`, which is the call that
 * turns six digits into the recovery session `ResetPasswordScreen` finishes.
 *
 * The mocked client is legitimate here for the reason sign-out.test.ts gives:
 * what is being proved is the ARGUMENT SHAPE of a client call. Without
 * `type: 'recovery'` GoTrue would look the token up as a magic link and refuse
 * every code, and auth-js would announce a success as SIGNED_IN rather than
 * PASSWORD_RECOVERY, which is the event the auth listener raises the recovery
 * flag on.
 *
 * The jest.mock factories below are hoisted above the imports at the top, so
 * the module under test sees the mocks (the same shape as sign-out.test.ts).
 */
const mockVerifyOtp = jest.fn();

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      verifyOtp: (params: unknown) => mockVerifyOtp(params),
      signOut: jest.fn(async () => ({ error: null })),
      updateUser: jest.fn(async () => ({ error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
    from: jest.fn(() => ({ delete: () => ({ eq: jest.fn(async () => ({ error: null })) }) })),
    rpc: jest.fn(async () => ({ error: null })),
  },
}));

jest.mock('expo-apple-authentication', () => ({}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));
jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[jest]' })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationHandler: jest.fn(),
}));

describe('verifyRecoveryCode', () => {
  beforeEach(() => mockVerifyOtp.mockReset());

  it('asks GoTrue to verify a RECOVERY otp for the address, with the digits as the token', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { session: { access_token: 'a', refresh_token: 'r' }, user: { id: 'u' } },
      error: null,
    });
    await verifyRecoveryCode('  ana@example.com ', '123456');
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      email: 'ana@example.com',
      token: '123456',
    });
  });

  it('throws the server error as it came, so the screen can name it', async () => {
    const refused = {
      message: 'Token has expired or is invalid',
      code: 'otp_expired',
      status: 403,
    };
    mockVerifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: refused });
    await expect(verifyRecoveryCode('ana@example.com', '000000')).rejects.toBe(refused);
  });

  it('refuses to call a verify that returned no session a success', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { session: null, user: { id: 'u' } }, error: null });
    await expect(verifyRecoveryCode('ana@example.com', '123456')).rejects.toThrow(
      /did not open a session/
    );
  });
});

describe('the sentence under the box', () => {
  it('names wrong and expired together, because GoTrue answers both the same way', () => {
    const sentence =
      'That code is not right, or it has run out. Check the digits, or send yourself a new one.';
    expect(
      recoveryCodeProblem({ message: 'Token has expired or is invalid', code: 'otp_expired' })
    ).toBe(sentence);
    expect(recoveryCodeProblem({ message: 'Token has expired or is invalid' })).toBe(sentence);
  });

  it('never reads a rate limiter as a wrong code', () => {
    expect(
      recoveryCodeProblem({
        message: 'Request rate limit reached',
        code: 'over_request_rate_limit',
      })
    ).toBe('Too many tries just now. Wait a minute and go again.');
  });

  it('names no connection as no connection', () => {
    expect(recoveryCodeProblem({ message: 'Network request failed' })).toBe(
      'No connection. Checking the code needs the internet.'
    );
  });

  it('falls to a generic sentence for anything else, never the transport text', () => {
    expect(recoveryCodeProblem({ message: 'Database error saving user' })).toBe(
      'Could not check that code. Try again in a moment.'
    );
    expect(recoveryCodeProblem(undefined)).toBe(
      'Could not check that code. Try again in a moment.'
    );
  });
});

describe('what "Send it again" says afterwards', () => {
  it('is optimistic for a refusal that would otherwise be an account oracle', () => {
    expect(resendOutcome(null)).toBe('sent');
    expect(resendOutcome({ message: 'User not found', status: 400 })).toBe('sent');
  });

  it('says wait for the per-address throttle, which leaks nothing', () => {
    expect(
      resendOutcome({
        message: 'For security purposes, you can only request this after 42 seconds.',
        code: 'over_email_send_rate_limit',
      })
    ).toBe('wait');
  });

  it('says offline when nothing left the phone', () => {
    expect(resendOutcome({ message: 'Network request failed' })).toBe('offline');
  });
});
