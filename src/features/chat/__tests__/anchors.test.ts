import { anchorAboutYours, anchorStartedFrom, parseAnchor } from '@/features/chat/anchors';

describe('parseAnchor', () => {
  it('reads every anchor the composer can emit', () => {
    expect(parseAnchor('trip')).toEqual({ kind: 'trip' });
    expect(parseAnchor('photo:0')).toEqual({ kind: 'photo' });
    expect(parseAnchor('languages')).toEqual({ kind: 'languages' });
    expect(parseAnchor('home')).toEqual({ kind: 'home' });
    expect(parseAnchor('bio')).toEqual({ kind: 'bio' });
    expect(parseAnchor('prompt:always_pack')).toEqual({
      kind: 'prompt',
      promptKey: 'always_pack',
    });
    expect(parseAnchor('pin:Rooftop bar')).toEqual({ kind: 'pin', venue: 'Rooftop bar' });
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
});
