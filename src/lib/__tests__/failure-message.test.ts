import fs from 'node:fs';
import path from 'node:path';

import {
  FAILURE_COPY_VALUES,
  GENERIC_SAVE_FAILURE,
  NO_CONNECTION,
  isOffline,
  loadFailureMessage,
  saveFailureMessage,
} from '@/lib/failure-message';

describe('what a person is told when something fails', () => {
  it('recognises a dropped connection however it is dressed', () => {
    expect(isOffline(new TypeError('Network request failed'))).toBe(true);
    expect(isOffline({ message: 'Failed to fetch' })).toBe(true);
    expect(isOffline({ status: 0, message: '' })).toBe(true);
  });

  it('does not mistake a real answer from the database for one', () => {
    expect(isOffline({ message: 'already connected with this traveler' })).toBe(false);
    expect(isOffline({ message: 'trip is entirely in the past' })).toBe(false);
  });

  it('never shows the transport its own words', () => {
    // The exact string a traveller on hostel wifi used to be shown.
    expect(saveFailureMessage(new TypeError('Network request failed'))).toBe(
      'No connection. This one needs the internet.'
    );
  });

  it('says which thing did not load', () => {
    expect(loadFailureMessage({ message: 'Failed to fetch' }, 'your chats')).toBe(
      'No connection, so your chats could not load.'
    );
    expect(loadFailureMessage({ message: 'boom' }, 'your chats')).toBe(
      'Your chats could not load.'
    );
  });
});

/**
 * The connection banner (src/components/ui/connection-banner.tsx) appears
 * above whatever the screen underneath is already saying about its failed
 * load, so the two are read together. They are built from one phrase here so
 * they cannot drift into two accounts of one fact.
 */
describe('one phrase for a dropped connection', () => {
  it('leads every offline sentence with it', () => {
    expect(saveFailureMessage(new TypeError('Network request failed'))).toMatch(
      new RegExp(`^${NO_CONNECTION}`)
    );
    expect(loadFailureMessage({ message: 'Failed to fetch' }, 'the map')).toMatch(
      new RegExp(`^${NO_CONNECTION}`)
    );
  });

  it('is short enough and plain enough to sit in a bar under the notch', () => {
    // Two words, no full stop: the bar is a label, not a sentence, and the
    // sentence forms below it are what the SCREENS say.
    expect(NO_CONNECTION).toBe('No connection');
  });

  it('carries none of the banned vocabulary it is about to be shown in', () => {
    expect(NO_CONNECTION).not.toMatch(/\b(swipe|deck|match|unmatch|request)\b/i);
    expect(NO_CONNECTION).not.toContain('—');
    // A presence claim is the one thing a connection bar must never make:
    // §7 rule 2 is why this app has no idea where anybody is.
    expect(NO_CONNECTION).not.toMatch(/\b(here now|near you|nearby)\b/i);
  });
});

describe('the D3 rule: the database may not write user-facing copy', () => {
  it('answers a stable hint code before reading any prose', () => {
    // The hint wins even when the message has drifted from every known
    // fragment — that is the whole point of keying on a code.
    expect(saveFailureMessage({ message: 'some reworded fragment', hint: 'trip_cap' })).toBe(
      'Five trips is the most you can have posted at once. Delete one from your profile to add this.'
    );
  });

  it('never returns the banned unmatch fragment as itself', () => {
    const said = saveFailureMessage({ message: 'cannot unmatch a closed conversation' });
    expect(said).toBe('This chat has already ended.');
    expect(said).not.toMatch(/unmatch/i);
  });

  it('answers every relationship failure with the identical sentence', () => {
    // The database raises ONE message for undiscoverable, blocked, no
    // overlap and no pin (an existence oracle otherwise); the client must
    // not fan that back out into different sentences.
    const byFragment = saveFailureMessage({ message: 'recipient unavailable' });
    const byHint = saveFailureMessage({
      message: 'recipient unavailable',
      hint: 'recipient_unavailable',
    });
    expect(byFragment).toBe('You cannot say hi to this traveler right now.');
    expect(byHint).toBe(byFragment);
  });

  it('says why a one to one cannot open, instead of the generic', () => {
    // open_direct_chat raises this for a blocked pair, a business and a guest
    // recipient alike, with no hint and no terminator, so it fell straight
    // through to "Something went wrong. Try that again." on the founder's
    // phone when he messaged somebody in his own group.
    const said = saveFailureMessage({ message: 'that traveler is unavailable', code: '42501' });
    expect(said).toBe('You cannot message this traveler one to one right now.');
    // Not the say-hi sentence: there is no say-hi on this path.
    expect(said).not.toContain('say hi');
  });

  it('passes a real written sentence through unchanged', () => {
    expect(saveFailureMessage({ message: 'This chat has ended.' })).toBe('This chat has ended.');
    expect(saveFailureMessage({ message: 'That date has already passed.' })).toBe(
      'That date has already passed.'
    );
  });

  it('answers an unmapped lowercase fragment with the generic, never itself', () => {
    const said = saveFailureMessage({ message: 'some internal constraint went sideways' });
    expect(said).toBe(GENERIC_SAVE_FAILURE);
  });

  it('maps the schema fragments a screen can actually hit', () => {
    expect(saveFailureMessage({ message: 'active trip limit reached (5)' })).toBe(
      'Five trips is the most you can have posted at once. Delete one from your profile to add this.'
    );
    expect(saveFailureMessage({ message: 'request already sent to this traveler' })).toBe(
      'You already said hi. It will be in Chat if they answer.'
    );
    expect(saveFailureMessage({ message: 'already connected with this traveler' })).toBe(
      'You two already have a chat.'
    );
    expect(saveFailureMessage({ message: 'sending too fast, give it a moment' })).toBe(
      'One moment, then try again.'
    );
    expect(saveFailureMessage({ message: 'three pins is the limit' })).toBe(
      'Three pins is the limit. Unpin one first.'
    );
  });

  it('answers the whole guest wall family with one door', () => {
    expect(saveFailureMessage({ message: 'make an account first' })).toBe(
      'Make an account to do that.'
    );
    expect(saveFailureMessage({ message: 'make an account to send photos' })).toBe(
      'Make an account to do that.'
    );
    expect(saveFailureMessage({ message: 'make an account to post a trip' })).toBe(
      'Make an account to do that.'
    );
  });

  it('answers both names for the rulebook, so the deploy order cannot matter', () => {
    // 20260901140000_the_rules_have_one_name.sql renames the sentence six
    // live functions raise. An installed build reading the NEW text and a
    // new build reading the OLD one both happen during the OTA gap, and in
    // neither case may anybody be shown the raw Postgres sentence.
    const rules = 'That breaks our house rules. Reword it and try again.';
    expect(saveFailureMessage({ message: 'that text breaks our community guidelines' })).toBe(
      rules
    );
    expect(saveFailureMessage({ message: 'that text breaks our house rules' })).toBe(rules);
    // And the hint beats both, which is what all six now send.
    expect(saveFailureMessage({ message: 'anything at all', hint: 'guidelines' })).toBe(rules);
  });

  it('makes that migration send the CODE, not just the new prose', () => {
    // The failure D3 exists to stop, on the day the prose changed: five of
    // the six reworded raises carried no hint, so the only way this module
    // could recognise them was by matching an English sentence the same
    // migration was in the middle of rewriting. A hint survives a rewording;
    // a prose key does not.
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'supabase',
        'migrations',
        '20260901140000_the_rules_have_one_name.sql'
      ),
      'utf8'
    );
    const raises = sql.match(/raise exception 'that text breaks our house rules'[^;]*;/g) ?? [];
    expect(raises).toHaveLength(6);
    for (const raise of raises) {
      expect(raise).toContain("hint = 'guidelines'");
    }
  });

  it('ships no banned vocabulary and no em dash in any sentence of its own', () => {
    // The same words src/app/__tests__/copy-lint.test.ts bans in migration
    // literals, applied to every sentence this module can say.
    const banned = /\b(swipe|deck|match|unmatch|request)\b/i;
    for (const sentence of FAILURE_COPY_VALUES) {
      expect(sentence).not.toMatch(banned);
      expect(sentence).not.toContain('—');
    }
  });
});
