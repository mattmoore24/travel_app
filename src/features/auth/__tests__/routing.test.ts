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
});

describe('rootIsReady', () => {
  const base = {
    initialized: true,
    session: session(false),
    supabaseConfigured: true,
    profileSettled: true,
    standingSettled: true,
  };

  it('holds until the persisted session is restored', () => {
    expect(rootIsReady({ ...base, initialized: false })).toBe(false);
  });

  it('holds a member until their profile and standing have both settled', () => {
    expect(rootIsReady({ ...base, profileSettled: false })).toBe(false);
    expect(rootIsReady({ ...base, standingSettled: false })).toBe(false);
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
      })
    ).toBe(true);
  });
});
