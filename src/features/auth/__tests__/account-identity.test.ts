import { accountLoadFailure } from '@/features/auth/load-error';
import { likelyEmailTypo } from '@/features/auth/email-typos';

/**
 * The two halves of "an account you cannot get back into".
 *
 * A closed account cannot be produced from a Maestro run and a typo cannot be
 * proven by one either - the address that fails is the one nobody ever reads.
 * Both are pure functions for exactly that reason.
 */

describe('why the profile did not load', () => {
  it('reads a missing row as an account that is gone', () => {
    // What .single() throws for a deleted row. A PostgrestError, which is NOT
    // an Error - `instanceof` would swallow it and every branch after it.
    const noRow = { code: 'PGRST116', message: 'JSON object requested, 0 rows', details: '' };
    expect(noRow instanceof Error).toBe(false);
    expect(accountLoadFailure(noRow)).toBe('gone');
  });

  it('reads a session that is nobody as gone', () => {
    expect(accountLoadFailure({ status: 401 })).toBe('gone');
    expect(accountLoadFailure({ status: 403 })).toBe('gone');
    expect(accountLoadFailure({ code: 'PGRST301' })).toBe('gone');
  });

  it('does NOT read insufficient_privilege as a closed account', () => {
    // 42501 is a missing GRANT, not a missing row. This project has already
    // shipped a migration that revoked a table and left one column ungranted;
    // if that happened to profiles, every signed-in person would get 42501 at
    // once and be told their account had been closed. A grant regression is
    // an outage, and an outage must read as one, with a Try again.
    expect(accountLoadFailure({ code: '42501', message: 'permission denied' })).toBe('network');
  });

  it('leaves a dropped connection saying what it is', () => {
    // The commonest failure by far, and the one Try again is for.
    expect(accountLoadFailure(new TypeError('Network request failed'))).toBe('network');
    expect(accountLoadFailure({ code: 'PGRST301x' })).toBe('network');
    expect(accountLoadFailure({ status: 500 })).toBe('network');
    expect(accountLoadFailure(null)).toBe('network');
    expect(accountLoadFailure(undefined)).toBe('network');
    expect(accountLoadFailure('boom')).toBe('network');
  });
});

describe('the address somebody meant', () => {
  it('catches the domains people actually mistype', () => {
    expect(likelyEmailTypo('mara@gmial.com')).toBe('mara@gmail.com');
    expect(likelyEmailTypo('mara@hotmial.com')).toBe('mara@hotmail.com');
    expect(likelyEmailTypo('mara@yahho.com')).toBe('mara@yahoo.com');
    expect(likelyEmailTypo('mara@outlok.com')).toBe('mara@outlook.com');
    expect(likelyEmailTypo('  Mara@GMAIL.CON  ')).toBe('Mara@gmail.com');
  });

  it('says nothing about an address that works', () => {
    // The nudge sits under the field of somebody halfway through signup, so
    // being wrong about a real domain is worse than saying nothing at all.
    for (const address of [
      'mara@gmail.com',
      'mara@yahoo.co.uk',
      'mara@gmail.com.au',
      'mara@hostelworld.com',
      'mara@some-tiny-isp.net',
      'mara@',
      '@gmail.com',
      'mara',
      '',
    ]) {
      expect(likelyEmailTypo(address)).toBeNull();
    }
  });

  it('keeps the part before the @ exactly as it was typed', () => {
    expect(likelyEmailTypo('Mara.O+travel@gmai.com')).toBe('Mara.O+travel@gmail.com');
  });
});
