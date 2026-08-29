import { countOf } from '@/lib/plural';
import type { PinCrewRow } from '@/lib/database.types';

/**
 * What the row of faces on an open plan says next to them.
 *
 * A bare number ("3") tells you nothing you could not see from the discs. A
 * name does: whose plan it is, or who is already in it, is the thing that
 * decides whether you tap Join. pin_crew returns the author first, so
 * `shown[0]` is always them.
 */
export function crewLabel(shown: PinCrewRow[], count: number): string {
  const first = shown[0]?.display_name?.trim();
  if (count <= 1) {
    return first ? `${first} is in` : 'Nobody yet. Be first.';
  }
  if (first) {
    return `${first} and ${countOf(count - 1, 'other', 'others')} are in`;
  }
  return `${countOf(count, 'person', 'people')} in so far`;
}
