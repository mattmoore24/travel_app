import {
  clusterByScreen,
  clusterCategory,
  clusterIntentDate,
  clusterPins,
  clusterTitle,
  screenClusterPins,
  stackLabel,
  metersBetween,
} from '@/features/pins/cluster';
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
    chat_id: null,
    crew: 0,
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

describe('clusterCategory', () => {
  it('wears the one category everybody shares', () => {
    const [cluster] = clusterPins([pin({ category: 'bar' }), pin({ category: 'bar' })]);
    expect(clusterCategory(cluster)).toBe('bar');
  });

  it('wears the clear winner when there is one', () => {
    const [cluster] = clusterPins([
      pin({ category: 'bar' }),
      pin({ category: 'bar' }),
      pin({ category: 'hike' }),
    ]);
    expect(clusterCategory(cluster)).toBe('bar');
  });

  // The launch-density case: two plans, two categories. It used to draw
  // pins[0]'s glyph on both, which was a lie about half the stack.
  it('goes neutral when the plans disagree with no winner', () => {
    const [cluster] = clusterPins([pin({ category: 'bar' }), pin({ category: 'hike' })]);
    expect(clusterCategory(cluster)).toBe('mixed');
  });
});

describe('clusterIntentDate', () => {
  it('answers with the soonest day in the stack', () => {
    const [cluster] = clusterPins([
      pin({ intent_date: '2026-08-23' }),
      pin({ intent_date: '2026-08-22' }),
      pin({ intent_date: '2026-08-24' }),
    ]);
    expect(clusterIntentDate(cluster)).toBe('2026-08-22');
  });
});

describe('stackLabel', () => {
  it('counts, and stops widening past 99', () => {
    expect(stackLabel(3)).toBe('3');
    expect(stackLabel(120)).toBe('99+');
  });
});

describe('clusterByScreen', () => {
  // A 375x812pt screen. latitudeDelta spans the screen HEIGHT, so vertical
  // offsets convert through 812, not 375.
  const SCREEN = 375;
  const SCREEN_H = 812;
  const dLatFor = (pt: number, delta: number) => (pt * delta) / SCREEN_H;

  it('merges two venues drawn under one fingertip at city zoom', () => {
    const a = pin();
    const b = pin({ lat: a.lat + dLatFor(20, 0.09) });
    const venues = clusterPins([a, b]);
    expect(venues).toHaveLength(2); // ~246m apart: separate venues
    const merged = clusterByScreen(
      venues,
      { latitudeDelta: 0.09, longitudeDelta: 0.09 },
      SCREEN,
      SCREEN_H
    );
    expect(merged).toHaveLength(1);
    expect(screenClusterPins(merged[0])).toHaveLength(2);
  });

  it('leaves the same two venues alone once the zoom separates them', () => {
    const a = pin();
    const b = pin({ lat: a.lat + dLatFor(20, 0.09) });
    const venues = clusterPins([a, b]);
    const apart = clusterByScreen(
      venues,
      { latitudeDelta: 0.01, longitudeDelta: 0.01 },
      SCREEN,
      SCREEN_H
    );
    expect(apart).toHaveLength(2);
  });

  it('scales latitude by the screen height, so vertically clear stacks stay apart', () => {
    const a = pin();
    // 60pt of true vertical separation. Scaled by the WIDTH this read as
    // ~28pt — under the 44pt fingertip — and two clearly separate stacks
    // merged into one bubble.
    const b = pin({ lat: a.lat + dLatFor(60, 0.09) });
    const venues = clusterPins([a, b]);
    const apart = clusterByScreen(
      venues,
      { latitudeDelta: 0.09, longitudeDelta: 0.09 },
      SCREEN,
      SCREEN_H
    );
    expect(apart).toHaveLength(2);
  });

  it('passes the venue pass through untouched at high zoom', () => {
    const a = pin();
    const b = pin({ lat: a.lat + dLatFor(20, 0.09) });
    const venues = clusterPins([a, b]);
    const before = venues.map((v) => v.pins.map((p) => p.id));
    const apart = clusterByScreen(
      venues,
      { latitudeDelta: 0.01, longitudeDelta: 0.01 },
      SCREEN,
      SCREEN_H
    );
    // Each screen cluster wraps exactly one venue cluster, unchanged.
    expect(apart.map((s) => s.members.length)).toEqual([1, 1]);
    expect(venues.map((v) => v.pins.map((p) => p.id))).toEqual(before);
  });

  it('keys a merged bubble on its member ids, never on the region', () => {
    const a = pin();
    const b = pin({ lat: a.lat + dLatFor(20, 0.09) });
    const venues = clusterPins([a, b]);
    const atOneZoom = clusterByScreen(
      venues,
      { latitudeDelta: 0.09, longitudeDelta: 0.09 },
      SCREEN,
      SCREEN_H
    );
    const atAnother = clusterByScreen(
      venues,
      { latitudeDelta: 0.08, longitudeDelta: 0.08 },
      SCREEN,
      SCREEN_H
    );
    // The camera moved; the bubble's identity must not, or every pinch step
    // re-mounts the marker and it flashes.
    expect(atAnother[0].key).toBe(atOneZoom[0].key);
  });

  it('wraps everything as singles when there is no region yet', () => {
    const venues = clusterPins([pin(), pin({ lat: 13.9 })]);
    expect(clusterByScreen(venues, null, SCREEN, SCREEN_H)).toHaveLength(2);
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
