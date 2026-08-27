import { nextFreeSlot as freeSlot } from '@/features/profile/slots';

/**
 * The questions a profile can answer.
 *
 * Travel-shaped on purpose. A generic "two truths and a lie" produces a
 * generic answer; "this trip I really want to…" produces a plan, and a plan
 * is a thing another traveler can say yes to. That is the whole difference
 * between a profile somebody likes and a profile somebody messages.
 *
 * The keys are stored; the labels are not, so a question can be reworded (or
 * retired) in a client release without touching a single stored answer.
 */
export type TravelPrompt = {
  key: string;
  /** The question, as it reads on the profile above the answer. */
  label: string;
  /** What the empty field says, to show the shape of a good answer. */
  placeholder: string;
};

export const TRAVEL_PROMPTS: TravelPrompt[] = [
  {
    key: 'this_trip',
    label: 'This trip I really want to',
    placeholder: 'eat at every market stall in the old town',
  },
  {
    key: 'perfect_day',
    label: 'My perfect first day somewhere new',
    placeholder: 'walk until I am lost, then find breakfast',
  },
  {
    key: 'looking_for',
    label: 'I am looking for someone to',
    placeholder: 'split a taxi to the trailhead at six in the morning',
  },
  {
    key: 'best_meal',
    label: 'Best thing I have eaten on the road',
    placeholder: 'a fish grilled on a beach in Sicily by a man who spoke no English',
  },
  {
    key: 'always_pack',
    label: 'I always pack',
    placeholder: 'far too many books and one pair of socks',
  },
  {
    key: 'unpopular_opinion',
    label: 'Unpopular travel opinion',
    placeholder: 'the second-best city is always better than the best one',
  },
  {
    key: 'convince_me',
    label: 'Convince me to come along',
    placeholder: 'tell me there is a rooftop and I am already there',
  },
  {
    key: 'wont_do',
    label: 'The one thing I will not do',
    placeholder: 'get up early for a sunrise. I have seen it',
  },
];

/** How many a profile can carry. Three, and the cap is the point. */
export const MAX_PROMPTS = 3;

export const PROMPT_ANSWER_MAX = 240;

export function promptLabel(key: string): string {
  return TRAVEL_PROMPTS.find((prompt) => prompt.key === key)?.label ?? 'About me';
}

/**
 * The prompt's question, set to sit inside a sentence.
 *
 * Only the FIRST letter comes down, and not even that when the first word is
 * the pronoun "I". A blanket toLowerCase broke four of the eight questions —
 * the composer offered `Replying to "i am looking for someone to"` — and a
 * misspelt pronoun in the one sentence somebody is about to send a stranger
 * reads as carelessness about everything under it.
 */
export function promptLabelInline(key: string): string {
  const label = promptLabel(key);
  return /^I\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

export function promptPlaceholder(key: string): string {
  return TRAVEL_PROMPTS.find((prompt) => prompt.key === key)?.placeholder ?? '';
}

/**
 * The prompts still available to answer — the list minus what is already on
 * the profile, so the picker cannot offer the same question twice.
 */
export function unusedPrompts(taken: string[]): TravelPrompt[] {
  const used = new Set(taken);
  return TRAVEL_PROMPTS.filter((prompt) => !used.has(prompt.key));
}

/**
 * Where the next answer goes: the lowest free slot, so removing the middle
 * one and adding another does not leave a hole.
 *
 * The arithmetic moved to features/profile/slots when priorities arrived and
 * needed the same thing at a different cap. This stays as the prompts-shaped
 * door onto it, so no caller has to remember which number is theirs.
 */
export function nextFreeSlot(usedSlots: number[]): number | null {
  return freeSlot(usedSlots, MAX_PROMPTS);
}
