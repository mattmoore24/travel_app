/**
 * What the Travelers queue is for, said once and used everywhere: the count
 * line, the empty wall's title, and the settle VoiceOver hears. One phrase,
 * so the three can never disagree about which trips are in view.
 *
 * `noun` is the bare thing ("Lisbon", "Lisbon and Porto", "these 3 trips",
 * "all your trips"); `where` is the same with its preposition, for a
 * sentence about dates ("in Lisbon", "across all your trips").
 */
export type QueueScope = { noun: string; where: string };

export function queueScope(
  cities: readonly string[],
  tripsInView: number,
  narrowed: boolean
): QueueScope {
  if (cities.length === 1) {
    return { noun: cities[0], where: `in ${cities[0]}` };
  }
  if (cities.length === 2 && tripsInView === 2) {
    const noun = `${cities[0]} and ${cities[1]}`;
    return { noun, where: `in ${noun}` };
  }
  if (narrowed) {
    const noun = `these ${tripsInView} trips`;
    return { noun, where: `across ${noun}` };
  }
  return { noun: 'all your trips', where: 'across all your trips' };
}
