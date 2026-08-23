import type { Session } from '@supabase/supabase-js';

import { owesOnboarding } from '../routing';

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
