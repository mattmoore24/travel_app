import { parseRecoveryLink } from '@/features/auth/recovery';

describe('parseRecoveryLink', () => {
  it('reads the tokens out of the fragment, which is where Supabase puts them', () => {
    const link =
      'samewhere://reset-password#access_token=abc.def&refresh_token=ghi&type=recovery&expires_in=3600';
    expect(parseRecoveryLink(link)).toEqual({
      kind: 'tokens',
      accessToken: 'abc.def',
      refreshToken: 'ghi',
    });
  });

  it('reads them out of the query string too', () => {
    const link = 'samewhere://reset-password?access_token=abc&refresh_token=ghi&type=recovery';
    expect(parseRecoveryLink(link)).toEqual({
      kind: 'tokens',
      accessToken: 'abc',
      refreshToken: 'ghi',
    });
  });

  it('reads a link that came back through the hosted page, not only the scheme', () => {
    // link.samewhere.io/reset has no `-password` in it. The old predicate
    // dropped this URL and, with it, a single-use recovery token.
    const link = 'https://link.samewhere.io/reset#access_token=abc&refresh_token=ghi&type=recovery';
    expect(parseRecoveryLink(link)).toEqual({
      kind: 'tokens',
      accessToken: 'abc',
      refreshToken: 'ghi',
    });
  });

  it('says an expired link has expired instead of doing nothing', () => {
    const link =
      'samewhere://reset-password#error=access_denied&error_description=Email+link+is+invalid+or+has+expired';
    expect(parseRecoveryLink(link)).toEqual({
      kind: 'error',
      message: 'That link has expired. Ask for a new one and open it within the hour.',
    });
  });

  it('ignores every other deep link the app receives', () => {
    expect(parseRecoveryLink('samewhere://join-group/abc123')).toBeNull();
    expect(parseRecoveryLink('samewhere://chat/1')).toBeNull();
    // The https invite lives on the same host as the reset page, and this
    // hook sees every incoming URL before the router does. Staying null here
    // is what keeps an invite from being swallowed into the reset screen.
    expect(parseRecoveryLink('https://link.samewhere.io/i/abc123')).toBeNull();
    expect(parseRecoveryLink(null)).toBeNull();
    expect(parseRecoveryLink(undefined)).toBeNull();
  });

  it('ignores a reset-password link carrying no tokens at all', () => {
    expect(parseRecoveryLink('samewhere://reset-password')).toBeNull();
  });
});
