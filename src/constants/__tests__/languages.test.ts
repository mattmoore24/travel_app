import { LANGUAGES, languageLabel, matchesLanguage } from '@/constants/languages';

describe('LANGUAGES', () => {
  it('leads with English', () => {
    expect(LANGUAGES[0].value).toBe('en');
  });

  it('has no duplicate codes', () => {
    const codes = LANGUAGES.map((l) => l.value);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is alphabetical by English name after English itself', () => {
    const rest = LANGUAGES.slice(1).map((l) => l.label);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'en'));
    expect(rest).toEqual(sorted);
  });

  it('still knows every code the old curated list used', () => {
    // Profiles created before the list was widened store these.
    const previouslyOffered = [
      'en',
      'es',
      'pt',
      'fr',
      'de',
      'it',
      'nl',
      'sv',
      'da',
      'no',
      'pl',
      'tr',
      'ru',
      'uk',
      'ar',
      'he',
      'hi',
      'th',
      'vi',
      'id',
      'ms',
      'zh',
      'ja',
      'ko',
    ];
    for (const code of previouslyOffered) {
      expect(LANGUAGES.some((l) => l.value === code)).toBe(true);
    }
  });
});

describe('languageLabel', () => {
  it('gives the English name', () => {
    expect(languageLabel('pt')).toBe('Portuguese');
  });

  it('falls back to the code rather than rendering nothing', () => {
    expect(languageLabel('zz')).toBe('zz');
  });
});

describe('matchesLanguage', () => {
  const spanish = LANGUAGES.find((l) => l.value === 'es')!;

  it('matches the English name', () => {
    expect(matchesLanguage(spanish, 'span')).toBe(true);
  });

  it('matches the endonym', () => {
    expect(matchesLanguage(spanish, 'español')).toBe(true);
  });

  it('matches the endonym typed without accents', () => {
    expect(matchesLanguage(spanish, 'espanol')).toBe(true);
  });

  it('matches nothing unrelated', () => {
    expect(matchesLanguage(spanish, 'welsh')).toBe(false);
  });

  it('lets an empty query through', () => {
    expect(matchesLanguage(spanish, '   ')).toBe(true);
  });
});

/**
 * Searching a language by its ISO code. Languages is a required onboarding
 * field that gates finishing signup, so a search that returns nothing lands
 * inside the funnel on a screen with no fallback but a 200-entry
 * alphabetical-by-ENGLISH-name list.
 */
describe('matchesLanguage by code', () => {
  const find = (query: string) => LANGUAGES.filter((l) => matchesLanguage(l, query));

  it('finds German by code, English name and endonym alike', () => {
    for (const query of ['de', 'German', 'Deutsch']) {
      expect(find(query).map((l) => l.value)).toContain('de');
    }
  });

  it('finds the launch markets by the codes on their airline sites', () => {
    expect(find('pt').map((l) => l.value)).toContain('pt');
    expect(find('th').map((l) => l.value)).toContain('th');
    expect(find('id').map((l) => l.value)).toContain('id');
  });

  it('does not let a two-letter code over-match half the list', () => {
    // 'pt' is equality on the code plus whatever the NAMES genuinely
    // contain, which is the point of === over includes. Portuguese must not
    // arrive because its English name has a p, a t and everything between.
    const codes = find('pt').map((l) => l.value);
    expect(codes).toContain('pt');
    expect(codes.length).toBeLessThan(5);
  });

  it('is case and accent insensitive on the code too', () => {
    expect(find('DE').map((l) => l.value)).toContain('de');
    expect(find(' de ').map((l) => l.value)).toContain('de');
  });
});
