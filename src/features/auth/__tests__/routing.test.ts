import type { Session } from '@supabase/supabase-js';

import { owesOnboarding, rootIsReady } from '../routing';

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
});
