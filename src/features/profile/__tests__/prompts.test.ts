import {
  MAX_PROMPTS,
  TRAVEL_PROMPTS,
  nextFreeSlot,
  promptLabel,
  promptLabelInline,
  promptPlaceholder,
  unusedPrompts,
} from '@/features/profile/prompts';

describe('the prompt list', () => {
  it('has no duplicate keys, because the key is what gets stored', () => {
    const keys = TRAVEL_PROMPTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('offers more questions than a profile can hold, so there is a choice', () => {
    expect(TRAVEL_PROMPTS.length).toBeGreaterThan(MAX_PROMPTS);
  });

  it('gives every question a placeholder that shows the shape of an answer', () => {
    for (const prompt of TRAVEL_PROMPTS) {
      expect(prompt.placeholder.length).toBeGreaterThan(0);
      expect(prompt.label.length).toBeGreaterThan(0);
    }
  });
});

describe('promptLabel', () => {
  it('reads back a stored key', () => {
    expect(promptLabel('this_trip')).toBe('This trip I really want to');
  });

  it('survives a question that has since been retired', () => {
    // Old answers outlive the questions they answered, so this must never
    // render as an empty heading or a raw key.
    expect(promptLabel('a_question_we_removed')).toBe('About me');
    expect(promptPlaceholder('a_question_we_removed')).toBe('');
  });
});

describe('unusedPrompts', () => {
  it('never offers a question the profile already answers', () => {
    const left = unusedPrompts(['this_trip', 'perfect_day']);
    expect(left.map((p) => p.key)).not.toContain('this_trip');
    expect(left).toHaveLength(TRAVEL_PROMPTS.length - 2);
  });
});

describe('nextFreeSlot', () => {
  it('fills from the top', () => {
    expect(nextFreeSlot([])).toBe(0);
    expect(nextFreeSlot([0])).toBe(1);
  });

  it('reuses a hole left in the middle', () => {
    expect(nextFreeSlot([0, 2])).toBe(1);
  });

  it('says no when the profile is full', () => {
    expect(nextFreeSlot([0, 1, 2])).toBeNull();
  });
});

describe('promptLabelInline', () => {
  it('leaves the pronoun alone when the question opens with it', () => {
    expect(promptLabelInline('looking_for')).toBe('I am looking for someone to');
    expect(promptLabelInline('always_pack')).toBe('I always pack');
  });

  it('drops the first letter into a sentence otherwise', () => {
    expect(promptLabelInline('this_trip')).toBe('this trip I really want to');
  });

  it('leaves a pronoun in the middle of the question alone', () => {
    expect(promptLabelInline('best_meal')).toBe('best thing I have eaten on the road');
  });

  it('falls back for a question that has been retired', () => {
    expect(promptLabelInline('gone_forever')).toBe('about me');
  });
});
