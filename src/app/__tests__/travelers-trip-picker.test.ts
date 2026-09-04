import fs from 'node:fs';
import path from 'node:path';

/**
 * The Travelers tab's trip picker (2026-09-05): which of the reader's own
 * trips the queue is built from. Founder: "select one, multiple, or all of
 * their planned trips ... this would only impact who is showing on their
 * travelers page". These scans hold the shape the screen has to keep.
 */
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

describe('the Travelers tab picks its trips', () => {
  const screen = src('src/app/(tabs)/travelers.tsx');

  it('asks the server for the chosen trips, and only once the stored choice is read', () => {
    // Fetching every trip and then the chosen ones a beat later flashed the
    // wrong queue on every open; the query waits for hydration.
    // Both the stored choice and the trips: with either missing the
    // selection resolves to every trip, and the focus refetch waits on the
    // same flag because refetch() ignores `enabled`.
    expect(screen).toContain(
      'const queueReady = tripSelection.hydrated && tripsQuery.data != null;'
    );
    expect(screen).toContain('useMatches(selectedTrips, queueReady)');
    expect(screen).toContain('if (queueReady) {\n      refetchMatches();');
    expect(screen).toContain('effectiveSelection(tripSelection.selected, tripIds)');
  });

  it('the header is rendered once, above the page keyed on the person', () => {
    // Inside the keyed page the rail was torn down on every Next: scroll
    // position gone, header fading in again with each face.
    expect(screen).toContain('function QueueHeader(');
    const header = screen.indexOf('<QueueHeader');
    const keyed = screen.indexOf('key={current.userId}');
    expect(header).toBeGreaterThan(-1);
    expect(keyed).toBeGreaterThan(header);
  });

  it('the picker stands where "Today in <city>" was, and that chip is gone', () => {
    expect(screen).not.toContain('`Today in ${');
    expect(screen).not.toContain('spotlightChip');
    expect(screen).toContain('<TripPicker');
    // Only with something to choose between.
    expect(screen).toContain('trips.length > 1 ? (');
  });

  it('says what the queue is for in one phrase, everywhere it is said', () => {
    // The count line, the wall's title and the VoiceOver settle all read
    // queueScope, so they cannot disagree about which trips are in view.
    expect(screen).toContain(
      'const scope = queueScope(citiesInView, tripsInView.length, narrowed);'
    );
    expect(screen).toContain('remainingLine(queue.length - 1, scope.where)');
    expect(screen).toContain("`That's everyone on your dates ${scope.where}`");
    expect(screen).toContain("`${countOf(queue.length, 'traveler')} ${scope.where}`");
    expect(screen).not.toContain('candidate.match.my_city_name');
    expect(screen).not.toContain('with travel plans matching yours');
  });

  it("says it is checking while a tap's new queue loads", () => {
    expect(screen).toContain('`Checking ${scope.noun}…`');
    expect(screen).toContain('matchesQuery.isFetching && matchesQuery.isPlaceholderData');
  });

  it('an empty wall the selection emptied offers the way back', () => {
    expect(screen).toContain("label: 'Show all trips', onPress: tripSelection.selectAll");
    expect(screen).toContain("You're only looking at ${");
  });

  it('keeps the last queue on screen while the next one loads', () => {
    const hooks = src('src/features/matching/hooks.ts');
    expect(hooks).toContain('placeholderData: (previous) => previous,');
    expect(hooks).toContain('userId != null && ready');
    expect(hooks).toContain("queryKey: ['matches', userId, key]");
  });

  it('sends the server nothing but trip ids', () => {
    const api = src('src/features/matching/api.ts');
    expect(api).toContain('tripIds == null ? {} : { p_trip_ids: tripIds }');
    expect(api).not.toMatch(/latitude|longitude|coords/i);
  });
});
