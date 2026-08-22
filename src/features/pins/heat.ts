import type { HeatCellRow } from '@/lib/database.types';

/** How wide one heat cell reads on the map, in metres. */
export const HEAT_CELL_RADIUS_M = 275;

/** A cell after every category on the same spot has been added together. */
export type MergedHeatCell = {
  key: string;
  lat: number;
  lng: number;
  count: number;
};

/**
 * heat_cells() returns one row per (cell, category), each already past the
 * k-threshold on its own. Drawn as-is, a corner with a bar cluster AND a food
 * cluster stacked two identical translucent discs on exactly the same spot —
 * which reads as one slightly darker disc, not as "twice as much going on".
 *
 * Summing them here is the fix, and it stays inside rule 6: every row the
 * server sent was already thresholded, so adding two of them can only ever
 * make a number larger. Nothing is revealed that was not already public, and
 * a cell still never resolves to a pin or a person.
 */
export function mergeHeatCells(cells: HeatCellRow[]): MergedHeatCell[] {
  const merged = new Map<string, MergedHeatCell>();
  for (const cell of cells) {
    const key = `${cell.cell_lat}:${cell.cell_lng}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += cell.pin_count;
    } else {
      merged.set(key, {
        key,
        lat: cell.cell_lat,
        lng: cell.cell_lng,
        count: cell.pin_count,
      });
    }
  }
  // Busiest last, so the brightest cell paints over its quieter neighbours
  // where two of them overlap.
  return [...merged.values()].sort((a, b) => a.count - b.count);
}

/**
 * One ring of a cell's glow.
 *
 * react-native-maps draws a Circle at one flat alpha, which gives a hard
 * edge and reads as a territory boundary rather than a place that is busy.
 * Three concentric circles, each smaller and stronger, fake the falloff a
 * real heat layer has — and they cost three shapes per cell, which at the
 * k-thresholded densities this app deals in is nothing.
 */
export type HeatRing = { key: string; radius: number; fill: string };

const RING_SCALES = [1, 0.7, 0.4] as const;

/**
 * Amber at one pin, ember by five, and never opaque enough to hide a street.
 *
 * One light source intensifying rather than a hue swap: a scale that runs
 * through green or blue stops reading as heat on a dark basemap, and red is
 * the one hue this app does not use.
 */
export function heatFill(count: number, alpha: number): string {
  const t = Math.min(Math.max((count - 1) / 4, 0), 1);
  const g = Math.round(154 + (107 - 154) * t);
  const b = Math.round(90 + (84 - 90) * t);
  return `rgba(255, ${g}, ${b}, ${alpha})`;
}

/**
 * How dark the CENTRE of a cell gets once all three rings have stacked.
 * Capped well short of opaque so a busy corner still shows its streets.
 */
export function heatPeakAlpha(count: number): number {
  return Math.min(0.1 + count * 0.05, 0.3);
}

export function heatRings(cell: MergedHeatCell): HeatRing[] {
  // Every ring carries the SAME alpha, and the falloff comes from how many
  // of them overlap: one at the rim, two in the middle, three at the centre.
  // Translucent layers composite as 1-(1-a)^n, so solving that for the peak
  // is what keeps the centre exactly at the cap instead of drifting past it
  // — which is how the naive version ended up more opaque than intended.
  const exact = 1 - Math.pow(1 - heatPeakAlpha(cell.count), 1 / RING_SCALES.length);
  // Rounded DOWN, not to nearest: rounding up would put the stacked centre a
  // hair over the cap, and the cap is the promise that the street stays
  // readable through the glow.
  const perRing = Math.floor(exact * 10000) / 10000;
  return RING_SCALES.map((scale, index) => ({
    key: `${cell.key}:${index}`,
    radius: HEAT_CELL_RADIUS_M * scale,
    fill: heatFill(cell.count, perRing),
  }));
}

/** What a viewer actually sees after `n` of those rings have stacked. */
export function compositeAlpha(perRing: number, layers: number): number {
  return 1 - Math.pow(1 - perRing, layers);
}
