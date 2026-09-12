import type { Session } from '@supabase/supabase-js';

import { accountLoadVerdict, owesOnboarding, rootIsReady, sessionIsUnknown } from '../routing';

const session = (isAnonymous: boolean) =>
  ({ user: { id: 'u1', is_anonymous: isAnonymous } }) as unknown as Session;

describe('owesOnboarding', () => {
  it('leaves a signed-out visitor in the app, because guest mode is the front door', () => {
    expect(owesOnboarding(null, null)).toBe(false);
  });

  it('sends a new account to onboarding', () => {
    expect(owesOnboarding(session(false), null)).toBe(true);
  });

  it('leaves a finished account alone', () => {
    expect(owesOnboarding(session(false), '2026-08-01T00:00:00Z')).toBe(false);
  });

  // The one that matters. A guest is signed in and is never onboarded, so
  // the natural expression traps them in a flow the database refuses to let
  // them finish.
  it('never asks a guest to onboard, however long they stay one', () => {
    expect(owesOnboarding(session(true), null)).toBe(false);
    expect(owesOnboarding(session(true), undefined)).toBe(false);
  });

  it('and asks them the moment they convert to a real account', () => {
    expect(owesOnboarding(session(false), undefined)).toBe(true);
  });

  // The same trap, one account kind later. A business account's
  // onboarding_completed_at stays null forever on purpose, because that stamp
  // is what makes somebody a discoverable traveler. Without the guard, every
  // business would be held in a traveler flow it can never finish.
  it('never asks a business to onboard as a traveler', () => {
    expect(owesOnboarding(session(false), null, true)).toBe(false);
    expect(owesOnboarding(session(false), undefined, true)).toBe(false);
  });

  it('still asks an ordinary new account, which is what the flag distinguishes', () => {
    expect(owesOnboarding(session(false), null, false)).toBe(true);
  });

  /**
   * The fourth branch. Somebody part way through listing a business is not a
   * traveler who has not finished: register_business REFUSES an account
   * carrying onboarding_completed_at, so the flow they would be walked
   * through ends in a locked door. Steps 4 to 11 of the listing form had no
   * exit at all, so the real abandonment was killing the app, and the
   * in-memory flag went with it.
   */
  it('does not ask an account that is part way through listing a business', () => {
    expect(owesOnboarding(session(false), null, false, true)).toBe(false);
  });

  it('asks that same account the moment the flag comes down', () => {
    expect(owesOnboarding(session(false), null, false, false)).toBe(true);
  });

  it('a finished traveler is unaffected by the flag either way', () => {
    expect(owesOnboarding(session(false), '2026-08-30T00:00:00Z', false, true)).toBe(false);
    expect(owesOnboarding(session(false), '2026-08-30T00:00:00Z', false, false)).toBe(false);
  });

  it('a business that has registered is answered by the branch above it', () => {
    // Both true is the ordinary state between register_business succeeding
    // and the listing form putting the flag down.
    expect(owesOnboarding(session(false), null, true, true)).toBe(false);
  });
});

describe('rootIsReady', () => {
  const base = {
    initialized: true,
    session: session(false),
    sessionUnknown: false,
    supabaseConfigured: true,
    profileSettled: true,
    standingSettled: true,
    businessSettled: true,
    listingSettled: true,
  };

  it('holds until the persisted session is restored', () => {
    expect(rootIsReady({ ...base, initialized: false })).toBe(false);
  });

  it('holds a member until profile, standing and account kind have all settled', () => {
    expect(rootIsReady({ ...base, profileSettled: false })).toBe(false);
    expect(rootIsReady({ ...base, standingSettled: false })).toBe(false);
    // Committing before this one lands is what would flash a business
    // through the traveler tabs on every cold start.
    expect(rootIsReady({ ...base, businessSettled: false })).toBe(false);
    // And the fourth: committing before "is this account part way through
    // listing a business" lands drops a bar owner into traveler onboarding,
    // whose last step register_business refuses forever.
    expect(rootIsReady({ ...base, listingSettled: false })).toBe(false);
    expect(rootIsReady(base)).toBe(true);
  });

  it('never holds a signed-out visitor, who has nothing to look up', () => {
    expect(rootIsReady({ ...base, session: null, profileSettled: false })).toBe(true);
  });

  // The hold unmounts the navigator, so holding here threw away the
  // `router.replace` that carries a new guest back to the invite they opened.
  it('never holds a guest either, for the same reason', () => {
    expect(
      rootIsReady({
        ...base,
        session: session(true),
        profileSettled: false,
        standingSettled: false,
        businessSettled: false,
        listingSettled: false,
      })
    ).toBe(true);
  });

  // "Could not check" is held, with the offline card over the hold. Released
  // to signed-out would put a signed-in traveler on the guest map, which is
  // what an offline cold start with a stale token used to do.
  it('holds while the persisted session could not be checked', () => {
    expect(rootIsReady({ ...base, session: null, sessionUnknown: true })).toBe(false);
  });

  it('releases the moment a real answer lands, either way', () => {
    expect(rootIsReady({ ...base, session: null, sessionUnknown: false })).toBe(true);
    expect(rootIsReady({ ...base, session: session(false), sessionUnknown: false })).toBe(true);
  });
});

describe('sessionIsUnknown', () => {
  const retryable = { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 };

  it('reads a retryable refresh failure with no session as unknown', () => {
    expect(sessionIsUnknown({ session: null, error: retryable })).toBe(true);
  });

  it('reads an offline failure as unknown whatever its name', () => {
    expect(
      sessionIsUnknown({ session: null, error: new TypeError('Network request failed') })
    ).toBe(true);
  });

  // auth-js removed the session itself and emitted SIGNED_OUT: a real answer.
  it('reads a refusal the server sent as signed out', () => {
    expect(
      sessionIsUnknown({
        session: null,
        error: { name: 'AuthApiError', message: 'Invalid Refresh Token', status: 400 },
      })
    ).toBe(false);
  });

  it('is never unknown with a session in hand, or with no error at all', () => {
    expect(sessionIsUnknown({ session: session(false), error: retryable })).toBe(false);
    expect(sessionIsUnknown({ session: null, error: null })).toBe(false);
  });
});

describe('accountLoadVerdict', () => {
  const offline = new Error('Network request failed');
  const gone = { code: 'PGRST116', message: 'no rows' };
  const serverFailure = { code: '42501', message: 'permission denied' };
  const failed = { isError: true, hasData: false, everReached: true };

  it('never blocks or holds a guest, whose routing never depended on the row', () => {
    for (const error of [offline, gone, serverFailure]) {
      expect(accountLoadVerdict({ ...failed, session: session(true), error })).toBe('proceed');
      expect(
        accountLoadVerdict({ ...failed, session: session(true), error, everReached: false })
      ).toBe('proceed');
    }
  });

  it('never blocks a signed-out visitor', () => {
    expect(accountLoadVerdict({ ...failed, session: null, error: offline })).toBe('proceed');
  });

  it('proceeds with no failure, and on a background failure with the row still in memory', () => {
    const member = session(false);
    expect(
      accountLoadVerdict({
        session: member,
        isError: false,
        hasData: true,
        error: null,
        everReached: true,
      })
    ).toBe('proceed');
    expect(accountLoadVerdict({ ...failed, session: member, error: offline, hasData: true })).toBe(
      'proceed'
    );
  });

  // The offline card is already on screen for this one; the account error
  // would be a second voice with a Sign out on it.
  it('holds a member whose read failed offline while nothing has reached the server', () => {
    expect(
      accountLoadVerdict({ ...failed, session: session(false), error: offline, everReached: false })
    ).toBe('hold');
  });

  it('blocks a member whose read failed offline in a warm app', () => {
    expect(accountLoadVerdict({ ...failed, session: session(false), error: offline })).toBe(
      'block'
    );
  });

  it('blocks on a failure the server sent, cold or warm', () => {
    expect(accountLoadVerdict({ ...failed, session: session(false), error: serverFailure })).toBe(
      'block'
    );
    expect(
      accountLoadVerdict({
        ...failed,
        session: session(false),
        error: serverFailure,
        everReached: false,
      })
    ).toBe('block');
  });

  it('always blocks a row that is gone, so the closed-account screen is never held back', () => {
    expect(accountLoadVerdict({ ...failed, session: session(false), error: gone })).toBe('block');
    expect(
      accountLoadVerdict({ ...failed, session: session(false), error: gone, everReached: false })
    ).toBe('block');
  });
});
