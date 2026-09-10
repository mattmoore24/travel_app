import { Colors } from '@/constants/theme';

/**
 * The one place a marker colour is named.
 *
 * Markers hold constants rather than calling useTheme(), and that is
 * deliberate three times over. They sit on Apple's basemap, not on the app's
 * own surfaces, so a "surface" token would be describing the wrong ground.
 * Nocturne is dark-only — Colors.light and Colors.dark hold the same palette
 * — so the value is identical either way. And a marker that subscribed to a
 * theme event would re-render every pin on the map for a value that cannot
 * change.
 *
 * They are still READ from the palette rather than typed out again, so a
 * change to theme.highlight reaches the map instead of quietly leaving it
 * behind.
 */
export const MARK_AMBER = Colors.dark.highlight;
export const MARK_INK = Colors.dark.canvas;
export const MARK_EMBER = Colors.dark.ember;

/**
 * A plan for a later day burns one step dimmer: MARK_AMBER blended toward the
 * basemap ground, never drawn at alpha (a translucent disc would show the
 * map through it). Two steps only — a 45% amber on this basemap drops the
 * marker under the legibility floor, so the ramp is full or this, nothing
 * lower. Glyph ink on this value still reads at 5.7:1.
 *
 * No token, because there is nothing in the app's own surfaces this value
 * belongs to: it is amber pre-blended toward one specific ground.
 */
export const MARK_AMBER_LATER = '#CA784C';

/**
 * The marker stroke, and the one value here with no token — deliberately NOT
 * added to theme.ts. A named white in the palette is a licence for a white
 * FILL somewhere else, and white on this ground measures about 18:1, which is
 * how a screen ends up looking like a printout. It carves a mark out of the
 * basemap and out of a heat glow (roughly 10:1 against either), and it does
 * nothing else.
 */
export const MARK_RING = '#FFFFFF';

/**
 * A hex to its three channels, so the heat ramp can interpolate between two
 * named colours instead of carrying their numbers typed out a second time.
 * Accepts the six-digit form the palette uses.
 */
export function channelsOf(hex: string): [number, number, number] {
  const body = hex.replace('#', '');
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}
