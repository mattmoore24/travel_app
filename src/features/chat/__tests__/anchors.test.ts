import {
  anchorAboutYours,
  anchorStartedFrom,
  anchorTheyStartedFrom,
  footerAnchor,
  parseAnchor,
} from '@/features/chat/anchors';
import { ELEMENT_OPTIONS } from '@/app/compose-request';

describe('parseAnchor', () => {
  it('reads every anchor the composer can emit', () => {
    expect(parseAnchor('trip')).toEqual({ kind: 'trip' });
    expect(parseAnchor('photo:0')).toEqual({ kind: 'photo' });
    expect(parseAnchor('languages')).toEqual({ kind: 'languages' });
    expect(parseAnchor('home')).toEqual({ kind: 'home' });
    expect(parseAnchor('bio')).toEqual({ kind: 'bio' });
    expect(parseAnchor('priority')).toEqual({ kind: 'priority' });
    expect(parseAnchor('priority:2')).toEqual({ kind: 'priority' });
    expect(parseAnchor('prompt:always_pack')).toEqual({
      kind: 'prompt',
      promptKey: 'always_pack',
    });
    expect(parseAnchor('pin:Rooftop bar')).toEqual({ kind: 'pin', venue: 'Rooftop bar' });
  });

  // The title above says "every anchor the composer can emit" and used to
  // assert a completeness that was false: the composer offered 'priority'
  // while the parser fell through to 'bio' for it, so a hello about a plan
  // was announced as being about a bio the person may not even have. This
  // reads the composer's own option list, so a new chip value with no branch
  // fails here rather than shipping as a silent misattribution.
  it('never reads a composer option as the bio fallback', () => {
    for (const option of ELEMENT_OPTIONS) {
      if (option.value === 'bio') {
        continue;
      }
      expect({ value: option.value, kind: parseAnchor(option.value).kind }).not.toEqual({
        value: option.value,
        kind: 'bio',
      });
    }
  });

  it('falls back to the bio for anything it does not recognise', () => {
    // A retired anchor, or a newer one arriving on an older build. Better a
    // slightly wrong sentence than a raw key on somebody's screen.
    expect(parseAnchor('constellation')).toEqual({ kind: 'bio' });
  });

  it('treats a pin with no venue as a pin, not as a venue called nothing', () => {
    expect(parseAnchor('pin:')).toEqual({ kind: 'pin', venue: null });
    expect(parseAnchor('pin:   ')).toEqual({ kind: 'pin', venue: null });
  });
});

describe('anchorStartedFrom', () => {
  it('names the prompt, which used to be announced as the bio', () => {
    expect(anchorStartedFrom('prompt:always_pack', 'Theo')).toBe(
      'Started from Theo\'s answer to "I always pack"'
    );
  });

  it('says the dates without possessing them, because both people share them', () => {
    expect(anchorStartedFrom('trip', 'Theo')).toBe('Started from the dates you share');
  });

  it('stays grammatical without a name', () => {
    expect(anchorStartedFrom('photo:0', null)).toBe('Started from their photo');
    expect(anchorStartedFrom('home', null)).toBe('Started from where they are from');
  });

  it('carries the venue when a pin has one', () => {
    expect(anchorStartedFrom('pin:Rooftop bar', 'Theo')).toBe('Started from a pin at Rooftop bar');
    expect(anchorStartedFrom('pin:', 'Theo')).toBe('Started from a pin');
  });

  it('names the list for a priority, which used to be announced as the bio', () => {
    expect(anchorStartedFrom('priority', 'Theo')).toBe("Started from something on Theo's list");
    expect(anchorStartedFrom('priority:2', null)).toBe('Started from something on their list');
  });
});

describe('anchorAboutYours', () => {
  it('knows the two anchors it used to answer "your bio" for', () => {
    expect(anchorAboutYours('prompt:looking_for')).toBe(
      'your answer to "I am looking for someone to"'
    );
    expect(anchorAboutYours('pin:Rooftop bar')).toBe('your pin at Rooftop bar');
  });

  it('speaks to the reader about their own profile', () => {
    expect(anchorAboutYours('photo:0')).toBe('your photo');
    expect(anchorAboutYours('trip')).toBe('your travel plans');
    expect(anchorAboutYours('home')).toBe('where you are from');
  });

  it('falls back to the bio, same as the other renderer', () => {
    expect(anchorAboutYours('constellation')).toBe('your bio');
  });

  it('says the list for a priority, never the bio', () => {
    expect(anchorAboutYours('priority')).toBe('something on your list');
    expect(anchorAboutYours('priority:4')).toBe('something on your list');
  });
});

describe('anchorTheyStartedFrom', () => {
  it('composes for every kind without a name', () => {
    expect(anchorTheyStartedFrom('photo:0')).toBe('Started from your photo');
    expect(anchorTheyStartedFrom('trip')).toBe('Started from your travel plans');
    expect(anchorTheyStartedFrom('home')).toBe('Started from where you are from');
    expect(anchorTheyStartedFrom('pin:Rooftop bar')).toBe('Started from your pin at Rooftop bar');
    expect(anchorTheyStartedFrom('priority:1')).toBe('Started from something on your list');
  });
});

describe('footerAnchor', () => {
  const element = 'photo:0';

  it('gives the sender and the accepter DIFFERENT strings for the same hello', () => {
    // Alex sent a hello about Sam's photo. On Alex's screen the chat is
    // titled "Sam"; on Sam's it is titled "Alex".
    const senderReads = footerAnchor(element, 'alex', 'alex', 'Sam');
    const accepterReads = footerAnchor(element, 'alex', 'sam', 'Alex');
    expect(senderReads).toBe("Started from Sam's photo");
    expect(accepterReads).toBe('Started from your photo');
    expect(senderReads).not.toBe(accepterReads);
  });

  it("never puts the other person's name in the accepter's anchor", () => {
    expect(footerAnchor(element, 'alex', 'sam', 'Alex')).not.toContain('Alex');
    expect(footerAnchor('pin:Rooftop bar', 'alex', 'sam', 'Alex')).not.toContain('Alex');
  });

  it('treats an unknown sender as not-me only when it knows who me is', () => {
    // Sender id missing but the session is real: the reader did not send it.
    expect(footerAnchor(element, null, 'sam', 'Alex')).toBe('Started from your photo');
    // No session yet: fall back to the third person rather than telling a
    // still-loading reader the hello was about their profile.
    expect(footerAnchor(element, null, null, 'Alex')).toBe("Started from Alex's photo");
    expect(footerAnchor(element, 'alex', null, 'Alex')).toBe("Started from Alex's photo");
  });
});
