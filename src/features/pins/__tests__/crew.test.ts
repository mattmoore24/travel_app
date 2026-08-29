import { crewLabel } from '@/features/pins/crew';
import type { PinCrewRow } from '@/lib/database.types';

const person = (name: string | null, isOwner = false): PinCrewRow => ({
  user_id: `u-${name ?? 'x'}`,
  display_name: name,
  photo_path: null,
  is_owner: isOwner,
  joined_at: '2026-08-29T10:00:00Z',
});

const ME = 'u-Ana';

describe('the line next to the faces on an open plan', () => {
  it('names the person whose plan it is', () => {
    // pin_crew returns the author first, and that is the name that matters:
    // you are deciding whether to walk across a city to meet THEM.
    expect(crewLabel([person('Ana', true)], 1, null)).toBe('Ana is in');
  });

  it('counts the rest without listing them', () => {
    expect(crewLabel([person('Ana', true), person('Bo'), person('Cy')], 3, null)).toBe(
      'Ana and 2 others are in'
    );
    expect(crewLabel([person('Ana', true), person('Bo')], 2, null)).toBe('Ana and 1 other are in');
  });

  it('counts everybody, not only the faces it had room for', () => {
    // The sheet draws five discs; the count comes from the pin row, which
    // knows about the twelfth person nobody has space to see.
    const shown = [person('Ana', true), person('B'), person('C'), person('D'), person('E')];
    expect(crewLabel(shown, 12, null)).toBe('Ana and 11 others are in');
  });

  it('never introduces you to yourself', () => {
    // Run 76 photographed "Maestro Test is in" on Maestro Test's own plan,
    // directly above a line reading "Your plan, open to join".
    expect(crewLabel([person('Ana', true)], 1, ME)).toBe('Just you so far');
    expect(crewLabel([person('Ana', true), person('Bo')], 2, ME)).toBe('You and 1 other are in');
  });

  it('leads with somebody else once you are in it too', () => {
    // You already know you are going. The name worth printing is theirs.
    expect(crewLabel([person('Bo', true), person('Ana')], 2, ME)).toBe('You and 1 other are in');
  });

  it('says something true when there is nobody to name', () => {
    // A guest's feed carries no names at all, and pin_crew answers a guest
    // with nothing, so neither may render "undefined is in".
    expect(crewLabel([person(null)], 1, null)).toBe('Nobody yet. Be first.');
    expect(crewLabel([], 4, null)).toBe('4 people in so far');
  });
});
