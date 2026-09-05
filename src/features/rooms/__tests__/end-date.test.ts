import { endDateLabel, seedEndDate, FALLBACK_END_DAYS } from '@/features/rooms/end-date';
import { addDays, toISODate } from '@/features/trips/dates';

/**
 * What "Pick a day" opens on.
 *
 * The default itself does not move — "No end date" stays selected — so every
 * case here is about the OTHER option's prefill. The one that matters is the
 * last: a seed that reaches into the past would hand a brand-new group a
 * closing day that has already been and gone.
 */
const TODAY = new Date(2026, 8, 1); // 1 September 2026, local
const iso = (date: Date) => toISODate(date);

const trip = (start: Date, end: Date, city?: string) => ({
  start_date: iso(start),
  end_date: iso(end),
  cities: city ? { name: city } : null,
});

describe('seedEndDate', () => {
  it('takes the end of the trip you are on', () => {
    const seed = seedEndDate([trip(addDays(TODAY, -3), addDays(TODAY, 4), 'Lisbon')], TODAY);
    expect(seed.iso).toBe(iso(addDays(TODAY, 4)));
    expect(seed.cityName).toBe('Lisbon');
  });

  it('takes the end of the next one when you are between trips', () => {
    const seed = seedEndDate([trip(addDays(TODAY, 10), addDays(TODAY, 20), 'Porto')], TODAY);
    expect(seed.iso).toBe(iso(addDays(TODAY, 20)));
    expect(seed.cityName).toBe('Porto');
  });

  it('prefers the trip you are on over the one after it', () => {
    const seed = seedEndDate(
      [
        trip(addDays(TODAY, 30), addDays(TODAY, 40), 'Bangkok'),
        trip(addDays(TODAY, -1), addDays(TODAY, 2), 'Lisbon'),
      ],
      TODAY
    );
    expect(seed.cityName).toBe('Lisbon');
  });

  it('takes the nearest future trip when there are several', () => {
    const seed = seedEndDate(
      [
        trip(addDays(TODAY, 30), addDays(TODAY, 40), 'Bangkok'),
        trip(addDays(TODAY, 5), addDays(TODAY, 9), 'Porto'),
      ],
      TODAY
    );
    expect(seed.cityName).toBe('Porto');
  });

  // The whole reason the filter is here and not left to the caller: a group
  // seeded with a day that has passed cannot be created at all (create_group
  // refuses it), so the picker would open on a value the server will reject.
  it('ignores a trip that has already finished', () => {
    const seed = seedEndDate([trip(addDays(TODAY, -20), addDays(TODAY, -10), 'Madrid')], TODAY);
    expect(seed.iso).toBe(iso(addDays(TODAY, FALLBACK_END_DAYS)));
    expect(seed.cityName).toBeNull();
  });

  it('falls back to thirty days out when there is no trip at all', () => {
    expect(seedEndDate([], TODAY).iso).toBe(iso(addDays(TODAY, FALLBACK_END_DAYS)));
    expect(seedEndDate(undefined, TODAY).iso).toBe(iso(addDays(TODAY, FALLBACK_END_DAYS)));
  });

  it('carries no city when the trip has none joined', () => {
    const seed = seedEndDate([trip(TODAY, addDays(TODAY, 3))], TODAY);
    expect(seed.cityName).toBeNull();
  });
});

describe('endDateLabel', () => {
  it('says the city and the day when the day came from a trip', () => {
    expect(endDateLabel({ iso: '2026-09-04', cityName: 'Lisbon' })).toBe('Lisbon, Sep 4');
  });

  it('says only the day when it did not', () => {
    expect(endDateLabel({ iso: '2026-09-04', cityName: null })).toBe('Sep 4');
  });

  it('asks for one when there is no day yet', () => {
    expect(endDateLabel(null)).toBe('Pick a day');
  });
});
