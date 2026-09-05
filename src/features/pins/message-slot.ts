/**
 * The one strip of map that carries a message, directly above the plan
 * list's peek (or the dock, when there is no list).
 *
 * Three or four different things used to compete for that strip on two
 * hand-tuned offsets that overlapped by about a chip's lower edge: the
 * places legend, the heat legend, and the empty or error banner. On a quiet
 * map that strip carries the only sentence explaining why the city looks
 * bare — and the least important occupant, a hint about a marker family, won
 * it in every screenshot of the last run. One selector, one explicit
 * priority, exactly one thing rendered.
 */

/** Highest first. The array IS the priority; nothing else encodes it. */
export const SLOT_ORDER = [
  // Failures outrank everything: an unexplained bare map is the one
  // impression this product cannot afford.
  'pins-error',
  'heat-error',
  // An owner whose own listing is missing from their own map: the one card
  // that says why, and (when it is the email code) what to do. Ahead of the
  // empty states — the missing chip is the more actionable absence — and it
  // silences the 'Tap a business' legend by winning the slot from it.
  'own-listing',
  // Empty states, most specific first.
  'empty-city',
  'viewport-empty',
  'way-home',
  // The two moments that most deserve the strip and never had it: the
  // arrival after signup, and the follow-up for the person who went first.
  'first-session',
  'first-pin',
  // The all-days heat fallback may NEVER draw unlabelled, so its footnote
  // outranks the teaching chips; the layer itself is gated on this slot.
  'heat-fallback',
  // Teaching chips last — a dismissible hint must not be the last thing
  // between a person and the primary action.
  'heat-legend',
  'places-legend',
] as const;

export type SlotKind = (typeof SLOT_ORDER)[number];

/** The single occupant of the message slot, or null for a clear strip. */
export function chooseSlot(flags: Partial<Record<SlotKind, boolean>>): SlotKind | null {
  for (const kind of SLOT_ORDER) {
    if (flags[kind]) {
      return kind;
    }
  }
  return null;
}
