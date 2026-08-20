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
