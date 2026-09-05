import {
  compositeAlpha,
  heatPeakAlpha,
  heatRings,
  heatViewReady,
  heatWithFallback,
  mergeHeatCells,
  HEAT_CELL_RADIUS_M,
  type HeatRing,
} from '@/features/pins/heat';
import type { HeatCellRow } from '@/lib/database.types';

function cell(over: Partial<HeatCellRow>): HeatCellRow {
  return { cell_lat: 1, cell_lng: 2, pin_count: 3, ...over };
}

describe('mergeHeatCells', () => {
  // The server counts a cell across every category now, so it sends one row
  // per spot. This stays as the guard for the day it sends two.
  it('adds two rows on one spot together instead of stacking discs', () => {
    const merged = mergeHeatCells([cell({ pin_count: 3 }), cell({ pin_count: 4 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(7);
  });

  it('keeps genuinely different spots apart', () => {
    const merged = mergeHeatCells([
      cell({ cell_lat: 1, cell_lng: 2 }),
      cell({ cell_lat: 1.01, cell_lng: 2 }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('paints the busiest cell last so it wins where two overlap', () => {
    const merged = mergeHeatCells([
      cell({ cell_lat: 1, pin_count: 9 }),
      cell({ cell_lat: 2, pin_count: 3 }),
      cell({ cell_lat: 3, pin_count: 6 }),
    ]);
    expect(merged.map((c) => c.count)).toEqual([3, 6, 9]);
  });

  it('has nothing to say about an empty layer', () => {
    expect(mergeHeatCells([])).toEqual([]);
  });
});

describe('heatRings', () => {
  const rings = (count: number) => heatRings({ key: 'k', lat: 0, lng: 0, count });
  const alphaOf = (ring: HeatRing) => Number(ring.fill.match(/,\s*([\d.]+)\)$/)![1]);

  it('draws three rings, largest first', () => {
    const r = rings(3);
    expect(r).toHaveLength(3);
    expect(r[0].radius).toBe(HEAT_CELL_RADIUS_M);
    expect(r[2].radius).toBeLessThan(r[0].radius);
  });

  it('gets stronger toward the centre, which is what fakes the falloff', () => {
    // Every ring carries the same alpha; the falloff is how many overlap.
    const perRing = alphaOf(rings(3)[0]);
    expect(compositeAlpha(perRing, 1)).toBeLessThan(compositeAlpha(perRing, 2));
    expect(compositeAlpha(perRing, 2)).toBeLessThan(compositeAlpha(perRing, 3));
  });

  it('lands the stacked centre exactly on the cap, not past it', () => {
    for (const count of [1, 2, 5, 12, 50]) {
      const centre = compositeAlpha(alphaOf(rings(count)[0]), 3);
      expect(centre).toBeCloseTo(heatPeakAlpha(count), 3);
    }
  });

  it('runs amber toward ember as a cell gets busier, never through another hue', () => {
    const green = (count: number) => Number(rings(count)[2].fill.match(/rgba\(255, (\d+)/)![1]);
    expect(green(1)).toBe(154);
    expect(green(5)).toBe(107);
    // Red stays pinned: this is one light source intensifying, not a hue swap.
    expect(rings(9)[2].fill.startsWith('rgba(255,')).toBe(true);
  });

  it('never gets opaque enough to hide the street underneath', () => {
    expect(compositeAlpha(alphaOf(rings(50)[0]), 3)).toBeLessThanOrEqual(0.3);
  });
});

describe('heatWithFallback', () => {
  // A day filter evaluates k against a third of the pins, so the layer used
  // to vanish exactly when somebody was trying hardest to use it.
  const a = cell({ pin_count: 3 });

  it('falls back to the all-days pool only when the day emptied and the pool is not', () => {
    expect(heatWithFallback(true, [], [a])).toEqual({ rows: [a], fallback: true });
  });

  it('never falls back when the day-filtered layer has something', () => {
    const day = cell({ pin_count: 4 });
    expect(heatWithFallback(true, [day], [a])).toEqual({ rows: [day], fallback: false });
  });

  it('never falls back with no day filter on', () => {
    expect(heatWithFallback(false, [], [a])).toEqual({ rows: [], fallback: false });
  });

  it('has nothing to fall back to when both pools are empty', () => {
    expect(heatWithFallback(true, [], [])).toEqual({ rows: [], fallback: false });
  });
});

describe('heatViewReady', () => {
  // heatmap_rendered measured data arrival; heatmap_viewed needs pixels a
  // person can see. Once-per-city is the caller's half.
  it('needs a non-empty layer', () => {
    expect(heatViewReady({ cells: 0, covered: false, placing: false })).toBe(false);
    expect(heatViewReady({ cells: 2, covered: false, placing: false })).toBe(true);
  });

  it('does not fire while a sheet covers the map', () => {
    expect(heatViewReady({ cells: 2, covered: true, placing: false })).toBe(false);
  });

  it('does not fire in place mode, where the map is a viewfinder', () => {
    expect(heatViewReady({ cells: 2, covered: false, placing: true })).toBe(false);
  });
});
