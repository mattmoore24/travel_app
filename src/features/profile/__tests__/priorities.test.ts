import {
  MAX_PRIORITIES,
  PRIORITY_MAX,
  priorityPlaceholder,
  validatePriority,
} from '@/features/profile/priorities';

describe('the cap', () => {
  it('is six, matching the slot range the database enforces', () => {
    expect(MAX_PRIORITIES).toBe(6);
  });

  // Both numbers also live in the migration's check constraints. If either
  // moves, this is the reminder that the other has to move with it, because
  // the client would otherwise offer a field the database refuses.
  it('is forty characters, matching the column check', () => {
    expect(PRIORITY_MAX).toBe(40);
  });
});

describe('validatePriority', () => {
  it('accepts the entries this section exists for', () => {
    for (const entry of [
      'day trip to Sintra',
      'learn to surf',
      'techno night in Berghain',
      'hike the Seven Hanging Valleys',
    ]) {
      expect(validatePriority(entry)).toBeNull();
    }
  });

  it('accepts exactly forty and refuses forty-one', () => {
    expect(validatePriority('a'.repeat(40))).toBeNull();
    expect(validatePriority('a'.repeat(41))).toBe('A few words is plenty.');
  });

  it('refuses a sentence, which is the whole point of the cap', () => {
    expect(validatePriority('I really want to see the old town at night')).not.toBeNull();
  });

  it('refuses whitespace, so a blank row cannot be saved as one', () => {
    expect(validatePriority('')).not.toBeNull();
    expect(validatePriority('   ')).not.toBeNull();
  });

  it('measures the trimmed value, so trailing spaces do not spend the budget', () => {
    expect(validatePriority(`  ${'a'.repeat(40)}  `)).toBeNull();
  });
});

describe('priorityPlaceholder', () => {
  it('gives every row of the list a different example', () => {
    const shown = Array.from({ length: MAX_PRIORITIES }, (_, i) => priorityPlaceholder(i));
    expect(new Set(shown).size).toBe(MAX_PRIORITIES);
  });

  it('wraps rather than running off the end', () => {
    expect(priorityPlaceholder(MAX_PRIORITIES)).toBe(priorityPlaceholder(0));
  });

  // The first placeholder is what every account sees, whoever they are and
  // wherever they are going, so it cannot name a city. "day trip to Sintra"
  // sat at index 0 and was photographed on a Bangkok-only account.
  it('leads with a city-neutral example', () => {
    expect(priorityPlaceholder(0)).toBe('rooftop for the sunset');
  });

  // Placeholders are shown inside a field capped at PRIORITY_MAX, so one
  // that could not itself be typed would be an example of the wrong thing.
  it('only suggests entries that would themselves pass', () => {
    for (let i = 0; i < MAX_PRIORITIES; i += 1) {
      expect(validatePriority(priorityPlaceholder(i))).toBeNull();
    }
  });
});
