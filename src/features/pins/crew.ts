import { countOf } from '@/lib/plural';
import type { PinCrewRow } from '@/lib/database.types';

/**
 * What the row of faces on an open plan says next to them.
 *
 * A bare number ("3") tells you nothing you could not see from the discs. A
 * name does: whose plan it is, or who is already in it, is the thing that
 * decides whether you tap Join. pin_crew returns the author first, so
 * `shown[0]` is always them.
 *
 * The viewer's own id matters, because the first run of this printed "Maestro
 * Test is in" on Maestro Test's own plan — the app introducing somebody to
 * themselves, directly above a line reading "Your plan".
 */
export function crewLabel(shown: PinCrewRow[], count: number, ownUserId: string | null): string {
  const mine = ownUserId != null && shown.some((person) => person.user_id === ownUserId);
  const first = shown.find((person) => person.user_id !== ownUserId)?.display_name?.trim();

  if (count <= 1) {
    if (mine) {
      return 'Just you so far';
    }
    return first ? `${first} is in` : 'Nobody yet. Be first.';
  }
  if (mine) {
    return `You and ${countOf(count - 1, 'other', 'others')} are in`;
  }
  if (first) {
    return `${first} and ${countOf(count - 1, 'other', 'others')} are in`;
  }
  return `${countOf(count, 'person', 'people')} in so far`;
}
