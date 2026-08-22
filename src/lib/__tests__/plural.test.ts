import { countOf, isAre, plural } from '@/lib/plural';

describe('plural', () => {
  it('keeps one singular', () => {
    expect(plural(1, 'guest')).toBe('guest');
  });

  it('makes everything else plural, including zero', () => {
    expect(plural(0, 'guest')).toBe('guests');
    expect(plural(2, 'guest')).toBe('guests');
  });

  it('takes an irregular plural when the s rule does not work', () => {
    expect(plural(1, 'person', 'people')).toBe('person');
    expect(plural(3, 'person', 'people')).toBe('people');
  });
});

describe('countOf', () => {
  it('puts the number and the noun together', () => {
    expect(countOf(1, 'guest')).toBe('1 guest');
    expect(countOf(4, 'guest')).toBe('4 guests');
    expect(countOf(1, 'person', 'people')).toBe('1 person');
    expect(countOf(0, 'person', 'people')).toBe('0 people');
  });
});

describe('isAre', () => {
  it('agrees with the count', () => {
    expect(isAre(1)).toBe('is');
    expect(isAre(0)).toBe('are');
    expect(isAre(7)).toBe('are');
  });
});
