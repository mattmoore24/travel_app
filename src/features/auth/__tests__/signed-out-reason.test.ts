import { signedOutNoticeCopy, signedOutReason } from '../signed-out-reason';

/**
 * supabase-js emits ONE SIGNED_OUT event whether the person tapped Sign out
 * or the server threw the refresh token away. The mapping is what decides
 * whether the app says something, and getting it wrong in the other
 * direction is worse than the bug it closes: a deliberate sign out answered
 * with "you have been signed out" reads as a fault in the app.
 */
describe('signedOutReason', () => {
  it('says nothing about an event that is not a sign out', () => {
    expect(signedOutReason('SIGNED_IN', false, 'active')).toBeNull();
    expect(signedOutReason('TOKEN_REFRESHED', false, 'not-apple')).toBeNull();
    expect(signedOutReason('INITIAL_SESSION', false, 'unknown')).toBeNull();
  });

  it('says nothing when somebody on this device asked for it', () => {
    expect(signedOutReason('SIGNED_OUT', true, 'not-apple')).toBeNull();
    expect(signedOutReason('SIGNED_OUT', true, 'active')).toBeNull();
    // Even a revoked Apple credential: the person pressed Sign out, and
    // whatever else is true, they know why they are signed out.
    expect(signedOutReason('SIGNED_OUT', true, 'revoked')).toBeNull();
  });

  it('names Apple when Apple is the reason', () => {
    expect(signedOutReason('SIGNED_OUT', false, 'revoked')).toBe('apple-revoked');
  });

  it('reads an intact credential as the session having been revoked', () => {
    // Every sign out this app performs is flagged, so an unflagged one came
    // from the server: another device signing out globally, a deleted
    // account, or the guest sweep.
    expect(signedOutReason('SIGNED_OUT', false, 'active')).toBe('revoked');
    expect(signedOutReason('SIGNED_OUT', false, 'not-apple')).toBe('revoked');
  });

  it('admits it does not know when it could not ask', () => {
    expect(signedOutReason('SIGNED_OUT', false, 'unknown')).toBe('unknown');
  });
});

describe('the line the notice shows', () => {
  const reasons = ['revoked', 'apple-revoked', 'unknown'] as const;

  it('has a title and a body for every reason', () => {
    for (const reason of reasons) {
      const copy = signedOutNoticeCopy(reason);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it('carries no em dash and none of the banned vocabulary', () => {
    for (const reason of reasons) {
      const copy = signedOutNoticeCopy(reason);
      const text = `${copy.title} ${copy.body}`;
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/\b(swipe|deck|match|request)\b/i);
    }
  });

  it('never promises that nothing is lost, because a swept guest lost it', () => {
    // The 'revoked' branch covers a deleted account and a guest the 30 day
    // sweep collected as well as a sign-out on another device. Telling those
    // two that everything is where they left it would be a lie.
    for (const reason of reasons) {
      expect(signedOutNoticeCopy(reason).body).not.toMatch(/nothing is lost/i);
    }
  });

  it('only the Apple branch mentions Apple', () => {
    expect(signedOutNoticeCopy('apple-revoked').body).toMatch(/Apple ID/);
    expect(signedOutNoticeCopy('revoked').body).not.toMatch(/Apple/);
    expect(signedOutNoticeCopy('unknown').body).not.toMatch(/Apple/);
  });
});
