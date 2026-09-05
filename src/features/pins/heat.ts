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
 * heat_cells() returns one row per cell, already past the k-threshold.
 *
 * It used to return one row per (cell, CATEGORY), which is why heat never
 * appeared anywhere: three different people had to be planning the same KIND
 * of thing inside the same 550m square. The threshold moved to the cell in
 * 20260823010000, so this is now a sort with a guard on it rather than the
 * fix it was written as. Summing stays correct either way and stays inside
 * rule 6 — every row the server sent was already thresholded, so adding two
 * can only make a number larger, and a cell still never resolves to a person.
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

/**
 * Which rows to draw when a day filter is on.
 *
 * A day filter evaluates the k-threshold against a third of the pins, so the
 * layer used to vanish exactly when somebody was trying hardest to use it.
 * When the day-filtered result is empty and the all-days one is not, the
 * all-days layer is drawn instead — LABELLED, always, by the caller: those
 * cells cleared k for their own pool (rule 6 holds), but an unlabelled
 * fallback would report "busy tomorrow" from a pool that is not tomorrow's.
 *
 * Never touches the server: both inputs are already-thresholded rows.
 */
export function heatWithFallback<T>(
  dayFiltered: boolean,
  filtered: T[],
  unfiltered: T[]
): { rows: T[]; fallback: boolean } {
  if (!dayFiltered || filtered.length > 0 || unfiltered.length === 0) {
    return { rows: filtered, fallback: false };
  }
  return { rows: unfiltered, fallback: true };
}

/**
 * Whether a heatmap VIEW may be recorded. The old `heatmap_rendered` fired
 * when heat data arrived, not when a person saw anything, so the founder
 * metric read healthy for a layer that had drawn zero pixels. A view needs
 * pixels: a non-empty mounted layer, a map not covered by a sheet, and not
 * place mode (the map is a viewfinder there). Once per city per session is
 * the caller's half.
 */
export function heatViewReady(args: {
  cells: number;
  covered: boolean;
  placing: boolean;
}): boolean {
  return args.cells > 0 && !args.covered && !args.placing;
}
