import {
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
