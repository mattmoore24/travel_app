import {
  credentialsFailure,
  credentialsProblem,
  emailChangeProblem,
  PASSWORD_MIN,
} from '../credentials';

describe('credentialsProblem', () => {
  const ok = { current: 'oldpassword', next: 'a-new-password', provider: 'email' };

  it('lets a real change through', () => {
    expect(credentialsProblem(ok)).toBeNull();
  });

  it('answers an Apple account with a sentence, not a form it cannot satisfy', () => {
    // updateUser({ password }) on an Apple-only account cannot succeed, so a
    // form here would be a control that never works.
    const problem = credentialsProblem({ ...ok, provider: 'apple' });
    expect(problem).toMatch(/Apple/);
    // ...and it says so even when both boxes are filled in correctly.
    expect(credentialsProblem({ current: '', next: '', provider: 'apple' })).toMatch(/Apple/);
  });

  it('asks for the current password first', () => {
    expect(credentialsProblem({ ...ok, current: '' })).toMatch(/password you use now/i);
  });

  it('holds the new password to the same floor sign-up does', () => {
    expect(credentialsProblem({ ...ok, next: 'x'.repeat(PASSWORD_MIN - 1) })).toMatch(
      String(PASSWORD_MIN)
    );
    expect(credentialsProblem({ ...ok, next: 'x'.repeat(PASSWORD_MIN) })).toBeNull();
  });

  it('refuses a change that changes nothing', () => {
    expect(credentialsProblem({ ...ok, next: ok.current })).toMatch(/already have/i);
  });

  it('handles a session with no provider recorded', () => {
    expect(credentialsProblem({ ...ok, provider: undefined })).toBeNull();
  });
});

describe('emailChangeProblem', () => {
  it('lets a real address through', () => {
    expect(emailChangeProblem('ana@example.com', 'old@example.com')).toBeNull();
  });

  it('asks for something to send to', () => {
    expect(emailChangeProblem('   ', 'old@example.com')).toMatch(/address you want/i);
  });

  it('rejects an address that is not one', () => {
    expect(emailChangeProblem('ana@example', 'old@example.com')).toMatch(/Check that address/);
    expect(emailChangeProblem('ana example.com', null)).toMatch(/Check that address/);
  });

  it('refuses the no-op before it costs a rate-limit slot, case and space blind', () => {
    expect(emailChangeProblem('  ANA@example.com ', 'ana@example.com')).toMatch(/already use/i);
  });

  it('has no current address to compare against on an account with none', () => {
    expect(emailChangeProblem('ana@example.com', null)).toBeNull();
  });
});

describe('credentialsFailure', () => {
  it('reads a throttle as wait, never as wrong', () => {
    // Re-checking the current password is a real sign-in attempt, so a few
    // wrong tries reach the limiter. Telling somebody who typed it correctly
    // that it is the wrong password is the failure this exists to avoid.
    expect(
      credentialsFailure({ message: 'For security purposes, you can only request this' })
    ).toMatch(/Wait a minute/);
  });

  it('names a wrong password as a wrong password', () => {
    expect(credentialsFailure({ message: 'Invalid login credentials' })).toMatch(
      /not the password/i
    );
  });

  it('names an address that is already taken', () => {
    expect(credentialsFailure({ message: 'Email address already registered' })).toMatch(
      /already an account/i
    );
  });

  it('falls back without leaking API English', () => {
    const text = credentialsFailure({ message: 'unexpected_failure: pgrst503' });
    expect(text).not.toMatch(/pgrst|unexpected_failure/);
    expect(text.length).toBeGreaterThan(0);
  });

  it('survives a PostgrestError, which is not an Error', () => {
    expect(() => credentialsFailure({ code: '42501', details: null })).not.toThrow();
    expect(() => credentialsFailure(undefined)).not.toThrow();
  });
});

describe('the words on this screen', () => {
  const strings = [
    credentialsProblem({ current: '', next: '', provider: 'email' }),
    credentialsProblem({ current: 'a', next: 'b', provider: 'apple' }),
    credentialsProblem({ current: 'oldpassword', next: 'short', provider: 'email' }),
    credentialsProblem({ current: 'same-password', next: 'same-password', provider: 'email' }),
    emailChangeProblem('', null),
    emailChangeProblem('nope', null),
    emailChangeProblem('a@b.com', 'a@b.com'),
    credentialsFailure({ message: 'Invalid login credentials' }),
    credentialsFailure({ message: 'For security purposes' }),
    credentialsFailure({ message: 'boom' }),
  ].filter((s): s is string => s != null);

  it('carries no em dash and none of the banned vocabulary', () => {
    for (const text of strings) {
      expect(text).not.toContain('—');
      expect(text).not.toMatch(/\b(swipe|deck|match|request)\b/i);
    }
  });
});
