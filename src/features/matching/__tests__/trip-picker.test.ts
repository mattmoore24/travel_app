import {
  TRIP_CHIP_STRINGS,
  tripChipLabels,
  tripSpokenLabel,
} from '@/features/matching/trip-picker';
import type { TripWithCity } from '@/features/trips/api';

const year = new Date().getFullYear() + 1;

function trip(id: string, city: string, start: string, end: string, approximate = false) {
  return {
    id,
    city_id: 1,
    start_date: start,
    end_date: end,
    approximate,
    cities: { name: city },
  } as unknown as TripWithCity;
}

describe('the chip says the city, and only as much more as it has to', () => {
  it('one trip per city is the city alone', () => {
    const labels = tripChipLabels([
      trip('a', 'Lisbon', `${year}-03-04`, `${year}-03-09`),
      trip('b', 'Bangkok', `${year}-05-01`, `${year}-05-10`),
    ]);
    expect(labels.get('a')).toBe('Lisbon');
    expect(labels.get('b')).toBe('Bangkok');
  });

  it('two trips to one city carry their start month', () => {
    const labels = tripChipLabels([
      trip('a', 'Lisbon', `${year}-03-04`, `${year}-03-09`),
      trip('b', 'Lisbon', `${year}-10-01`, `${year}-10-06`),
      trip('c', 'Bangkok', `${year}-05-01`, `${year}-05-10`),
    ]);
    expect(labels.get('a')).toMatch(/^Lisbon · Mar/);
    expect(labels.get('b')).toMatch(/^Lisbon · Oct/);
    expect(labels.get('c')).toBe('Bangkok');
  });

  it('two trips to one city in one month carry the day', () => {
    const labels = tripChipLabels([
      trip('a', 'Lisbon', `${year}-03-04`, `${year}-03-09`),
      trip('b', 'Lisbon', `${year}-03-20`, `${year}-03-25`),
    ]);
    expect(labels.get('a')).toMatch(/^Lisbon · Mar 4/);
    expect(labels.get('b')).toMatch(/^Lisbon · Mar 20/);
  });
});

describe('what VoiceOver hears', () => {
  it('says the city and the dates', () => {
    expect(tripSpokenLabel(trip('a', 'Lisbon', `${year}-03-04`, `${year}-03-09`))).toMatch(
      /^Lisbon, Mar 4 – 9/
    );
  });

  it('invents no day for rough dates', () => {
    const spoken = tripSpokenLabel(trip('a', 'Lisbon', `${year}-09-01`, `${year}-09-30`, true));
    expect(spoken).toMatch(/^Lisbon, sometime in Sep/);
    expect(spoken).not.toMatch(/\d{1,2} –/);
  });

  it('never claims presence', () => {
    // The component's own strings, not copies typed here.
    for (const text of [
      tripSpokenLabel(trip('a', 'Lisbon', `${year}-03-04`, `${year}-03-09`)),
      ...Object.values(TRIP_CHIP_STRINGS),
    ]) {
      expect(text).not.toMatch(/here now|near you|nearby|swipe|deck|match/i);
    }
  });
});
