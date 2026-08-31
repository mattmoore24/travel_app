import { consumeDeliberateSignOut, signOut, signOutWasDeliberate } from '@/features/auth/api';

/**
 * The flag that decides whether a person is told their session ended.
 *
 * It was briefly a 1000ms window alone, and that is the bug these tests
 * exist to keep out: auth-js does its POST to /logout BEFORE it removes the
 * session and emits SIGNED_OUT, with no client timeout, so on the hostel
 * wifi this app is built for the event routinely lands seconds after the tap.
 * A window alone answers a tapped Sign out with "your session ended and we
 * cannot say why", and answers Delete account by pre-empting the stack so the
 * replace to /join is dropped.
 *
 * The flag is not exported directly, so it is exercised the way the app does:
 * raise it through a sign-out, consume it in the listener's branch.
 */

// signOut() itself needs the network; the flag is raised by the same call the
// app makes, so the tests drive the exported pair around a simulated raise.
jest.mock('@/features/notifications/push', () => ({
  forgetPushToken: jest.fn(async () => {}),
}));

jest.mock('@/lib/apple-user', () => ({
  forgetAppleUser: jest.fn(async () => {}),
  rememberAppleUser: jest.fn(async () => {}),
  readAppleUser: jest.fn(async () => null),
}));

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      signOut: jest.fn(async () => ({ error: null })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
  },
}));

describe('the deliberate sign-out flag', () => {
  beforeEach(() => {
    // Drain anything a previous test left raised.
    consumeDeliberateSignOut(0);
    consumeDeliberateSignOut(0);
  });

  it('is false when nobody asked, which is what raises the notice', () => {
    expect(signOutWasDeliberate(1_000_000)).toBe(false);
  });

  it('survives a logout slower than any echo window', async () => {
    const started = 1_000_000;
    await signOut();
    // The event lands eight seconds later, which a 1s window would have
    // called a forced sign-out.
    expect(signOutWasDeliberate(started + 8_000)).toBe(true);
  });

  it('is consumed once, and the echo window covers the second event', async () => {
    await signOut();
    const at = 2_000_000;
    expect(signOutWasDeliberate(at)).toBe(true);
    consumeDeliberateSignOut(at);
    // The echo: a second, unflagged SIGNED_OUT within a second of the first.
    expect(signOutWasDeliberate(at + 500)).toBe(true);
    // And the next genuine forced sign-out, well after, is spoken about.
    expect(signOutWasDeliberate(at + 5_000)).toBe(false);
  });

  it('does not re-arm itself: consuming an unraised flag changes nothing', () => {
    const at = 3_000_000;
    consumeDeliberateSignOut(at);
    expect(signOutWasDeliberate(at + 10)).toBe(false);
  });
});
