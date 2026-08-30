import type { GroupSpeaking } from '@/lib/database.types';

/**
 * Who may post in a group, as the two screens that ask it say it.
 *
 * One constant, two importers (new-group and group settings) — the pair had
 * drifted into duplicates, and a label edited in one place would have split
 * the same control into two vocabularies. 'Only people I pick', because
 * 'Only who I pick' reads as a typo.
 */
export const SPEAKING_OPTIONS: { value: GroupSpeaking; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'granted', label: 'Only people I pick' },
];
