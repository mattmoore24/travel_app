import { clusterPins, clusterTitle, stackLabel, metersBetween } from '@/features/pins/cluster';
import type { CityPinRow } from '@/lib/database.types';

let seq = 0;
function pin(over: Partial<CityPinRow> = {}): CityPinRow {
  seq += 1;
  return {
    id: `pin-${String(seq).padStart(3, '0')}`,
    user_id: 'u',
    display_name: 'Theo',
    age: 29,
    verified: false,
    photo_path: null,
    venue_name: 'Mad Monkey',
    note: null,
    place_label: null,
    category: 'bar',
    lat: 13.7563,
    lng: 100.5018,
    intent_date: '2026-08-22',
    seeded: false,
    seed_note: null,
    expires_at: '2026-08-24T00:00:00Z',
    ...over,
  };
}

/** ~1 degree of latitude is 111km, so this converts metres to a lat offset. */
const north = (metres: number) => metres / 111_000;

describe('clusterPins', () => {
  it('merges plans at the same venue into one marker', () => {
    const clusters = clusterPins([pin(), pin(), pin()]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].pins).toHaveLength(3);
  });

  it('keeps venues a street apart apart', () => {
    const a = pin();
    const b = pin({ lat: a.lat + north(400) });
    expect(clusterPins([a, b])).toHaveLength(2);
  });

  it('merges just inside the radius and not just outside it', () => {
    const a = pin();
    expect(clusterPins([a, pin({ lat: a.lat + north(20) })])).toHaveLength(1);
    expect(clusterPins([a, pin({ lat: a.lat + north(60) })])).toHaveLength(2);
  });

  it('gives the same answer whatever order the rows arrive in', () => {
    const rows = [pin(), pin({ lat: 13.9 }), pin(), pin({ lat: 13.9 })];
    const forwards = clusterPins(rows).map((c) => c.pins.map((p) => p.id).sort());
    const backwards = clusterPins([...rows].reverse()).map((c) => c.pins.map((p) => p.id).sort());
    expect(backwards).toEqual(forwards);
  });

  it('has nothing to say about an empty map', () => {
    expect(clusterPins([])).toEqual([]);
  });
});

describe('clusterTitle', () => {
  it('names the venue when everybody agrees on one', () => {
    const clusters = clusterPins([pin(), pin()]);
    expect(clusterTitle(clusters[0])).toBe('Mad Monkey');
  });

  it('counts instead when the pins disagree about where they are', () => {
    const a = pin({ venue_name: 'Mad Monkey' });
    const clusters = clusterPins([a, pin({ venue_name: 'The rooftop', lat: a.lat })]);
    expect(clusterTitle(clusters[0])).toBe('2 plans here');
  });
});

describe('stackLabel', () => {
  it('counts, and stops widening past 99', () => {
    expect(stackLabel(3)).toBe('3');
    expect(stackLabel(120)).toBe('99+');
  });
});

describe('metersBetween', () => {
  it('is zero for a point against itself', () => {
    expect(metersBetween(13.7563, 100.5018, 13.7563, 100.5018)).toBe(0);
  });

  it('measures a degree of latitude at about 111km', () => {
    expect(metersBetween(0, 0, 1, 0)).toBeGreaterThan(110_000);
    expect(metersBetween(0, 0, 1, 0)).toBeLessThan(112_000);
  });
});
