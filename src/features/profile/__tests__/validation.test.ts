import {
  basicsProblem,
  missingOnboardingFields,
  normalizeHandle,
  validateAge,
  validateBio,
  validateDisplayName,
  validateHandle,
} from '../validation';

describe('profile validation (client mirror of DB CHECK constraints)', () => {
  it('requires a non-empty display name up to 50 chars', () => {
    expect(validateDisplayName('Alice')).toBeNull();
    expect(validateDisplayName('   ')).not.toBeNull();
    expect(validateDisplayName('x'.repeat(51))).not.toBeNull();
  });

  it('enforces the 18+ age floor the DB also enforces', () => {
    expect(validateAge('18')).toBeNull();
    expect(validateAge('17')).not.toBeNull();
    expect(validateAge('121')).not.toBeNull();
    expect(validateAge('abc')).not.toBeNull();
    expect(validateAge('')).not.toBeNull();
  });

  it('caps bios at 500 chars', () => {
    expect(validateBio('x'.repeat(500))).toBeNull();
    expect(validateBio('x'.repeat(501))).not.toBeNull();
  });

  // The DB counts codepoints (`char_length`); a JS string's .length counts
  // UTF-16 units, where an emoji costs 2. The client must pass everything
  // the DB would pass, or an emoji writer is cut off at 250 and told 500.
  it('counts codepoints, matching char_length, so emoji cost 1 not 2', () => {
    expect(validateBio('🌍'.repeat(500))).toBeNull();
    expect(validateBio('🌍'.repeat(501))).not.toBeNull();
    // Non-BMP CJK (𠀀 is U+20000, .length 2, char_length 1).
    expect(validateBio('𠀀'.repeat(500))).toBeNull();
    expect(validateDisplayName('🌍'.repeat(50))).toBeNull();
    expect(validateDisplayName('🌍'.repeat(51))).not.toBeNull();
  });

  it('normalizes handles the way they are stored (bare, lowercase)', () => {
    expect(normalizeHandle('@Alice.Travels ')).toBe('alice.travels');
    expect(normalizeHandle('@@double')).toBe('double');
    expect(normalizeHandle('plain')).toBe('plain');
  });

  it('rejects empty and whitespace handles', () => {
    expect(validateHandle('@')).not.toBeNull();
    expect(validateHandle('has space')).not.toBeNull();
    expect(validateHandle('@ok_handle')).toBeNull();
  });
});

describe('step 3 cannot be passed without a gender', () => {
  const answered = { name: 'Alice', age: '28', gender: 'woman' as const };

  it('lets a fully answered step through', () => {
    expect(basicsProblem(answered)).toBeNull();
  });

  // The case that made this a finding: name and age valid, gender still at
  // the column default, and the old expression let Continue through — so the
  // women-only audience filter filled with 'unspecified' from people who were
  // never shown the question.
  it('refuses valid name and age while gender is still the column default', () => {
    const problem = basicsProblem({ ...answered, gender: 'unspecified' });
    expect(problem).not.toBeNull();
    expect(problem).toContain('gender');
    // The signup e2e taps Continue unanswered and asserts this prefix.
    expect(problem).toMatch(/^Pick a gender\./);
  });

  it.each(['woman', 'man', 'nonbinary'] as const)('accepts %s', (gender) => {
    expect(basicsProblem({ ...answered, gender })).toBeNull();
  });

  it('names the name and age problems in their own words first', () => {
    expect(basicsProblem({ ...answered, name: '  ' })).toBe(validateDisplayName('  '));
    expect(basicsProblem({ ...answered, age: '17' })).toBe(validateAge('17'));
  });

  // "Rather not say" was an option and a deliberate tap on it passed. Founder,
  // 2026-09-04: it "goes against our filters" — an unspecified profile sits in
  // none of the gendered audiences while being free to choose one. There is
  // no tap to honour any more; only the value counts.
  it('no longer accepts an opt-out, deliberate or not', () => {
    expect(basicsProblem({ name: 'Alice', age: '28', gender: 'unspecified' })).not.toBeNull();
  });
});

describe('onboarding completeness', () => {
  const base = {
    display_name: 'Alice',
    age: 28,
    home_city: 'Lisbon',
    home_country: 'Portugal',
    languages: ['en'],
  };

  it('passes with all required fields and a photo', () => {
    expect(missingOnboardingFields(base, 1)).toEqual([]);
  });

  it('accepts either city or country for home', () => {
    expect(missingOnboardingFields({ ...base, home_city: null }, 1)).toEqual([]);
    expect(missingOnboardingFields({ ...base, home_city: null, home_country: null }, 1)).toContain(
      'home'
    );
  });

  it('lists every missing requirement', () => {
    expect(
      missingOnboardingFields(
        { display_name: null, age: null, home_city: null, home_country: null, languages: [] },
        0
      )
    ).toEqual(['name', 'age', 'home', 'languages', 'profile photo']);
  });
});

describe('handles keep the shape their own platform uses', () => {
  it('takes the username out of a pasted profile link', () => {
    expect(normalizeHandle('https://www.instagram.com/alice/')).toBe('alice');
    expect(normalizeHandle('https://instagram.com/alice/?hl=en')).toBe('alice');
    expect(normalizeHandle('www.tiktok.com/@alice.travels')).toBe('alice.travels');
  });

  it('leaves a bare handle alone', () => {
    expect(normalizeHandle('alice')).toBe('alice');
    expect(normalizeHandle('https://instagram.com')).toBe('https://instagram.com');
  });

  it('keeps the case and the spaces a name or a number needs', () => {
    // The Facebook field's own placeholder asks for "Your name or profile
    // link", and the WhatsApp field asks for a phone number. Both used to be
    // refused outright for containing a space.
    expect(normalizeHandle('Matt Moore', false)).toBe('Matt Moore');
    expect(validateHandle('Matt Moore', false)).toBeNull();
    expect(normalizeHandle('  +44 7700  900123 ', false)).toBe('+44 7700 900123');
    expect(validateHandle('+44 7700 900123', false)).toBeNull();
  });

  it('still refuses a spaced-out username, where it is ambiguous', () => {
    expect(validateHandle('alice travels')).not.toBeNull();
  });
});
