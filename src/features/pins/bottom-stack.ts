/**
 * The bottom of the map, as arithmetic.
 *
 * The map used to end in three floating slabs with strips of bare map
 * between them: a message chip, then the plan list's peek clipped flat
 * mid-screen, then the Drop-a-pin pill, then the tab bar. The founder's word
 * for it was "looks bad", and the reason it looked bad is that the peek's
 * sheet stopped 152pt short of the screen and its lower edge was a cut.
 *
 * Now the sheet runs to the screen's bottom edge and the dock stands on a
 * plate cut from the same surface, so the strip, the button and the tab-bar
 * clearance read as ONE card. These are the numbers that composition needs.
 * They live here rather than inline in a 3,700-line screen because they are
 * the kind of thing a unit test can execute, the way message-slot.ts is.
 */

/**
 * The room kept clear at the top of the map, so no detent ever rises into
 * the city rail. The rail is about 130pt plus the notch.
 */
export const RAIL_RESERVE = 180;

/**
 * The base the dock stands on, measured from the SCREEN bottom: the tab-bar
 * clearance, the dock's own height, and the step between them.
 *
 * `dockHeight` is MEASURED, never `DOCK_MIN_HEIGHT`: the button's label
 * scales with Dynamic Type, and a plate built on the constant is a plate the
 * button's top edge hangs over at the accessibility sizes. A business with
 * no live listing has no dock at all, and its card stands on the bare
 * tab-bar clearance.
 */
export function dockFootingOf({
  dockBottom,
  dockHeight,
  dockShown,
  gap,
}: {
  dockBottom: number;
  dockHeight: number;
  dockShown: boolean;
  gap: number;
}): number {
  return dockShown ? dockBottom + dockHeight + gap : dockBottom;
}

/**
 * The one strip of map that carries a message: one gap above the card's real
 * top edge, or above the bare footing when there is no list.
 *
 * `peekHeight` is the strip's MEASURED height for the same reason the dock's
 * is. Composed from the 56pt constant instead, the chip sat behind the
 * card's own top edge at the accessibility sizes, which is where the sentence
 * explaining a bare map went to hide.
 */
export function messageSlotOf({
  footing,
  peekHeight,
  planListShown,
  gap,
}: {
  footing: number;
  peekHeight: number;
  planListShown: boolean;
  gap: number;
}): number {
  return planListShown ? footing + peekHeight + gap : footing;
}

/**
 * The plan list's three detents, measured from the SCREEN bottom because the
 * sheet's own bottom edge is now the screen's.
 *
 * `usable` takes `windowHeight - RAIL_RESERVE` outright. The split layout
 * subtracted the sheet's anchor as well and then added it back, and
 *
 *   anchor + (windowHeight - anchor - RAIL_RESERVE) === windowHeight - RAIL_RESERVE
 *
 * so the full detent's top edge never depended on the anchor at all. That
 * identity is what lets the sheet drop to the screen edge without moving a
 * single detent. The half detent takes its fraction of the room ABOVE the
 * footing, or it would sink by the footing's whole height.
 */
export function planListHeights({
  footing,
  peekHeight,
  windowHeight,
}: {
  footing: number;
  peekHeight: number;
  windowHeight: number;
}): { peek: number; half: number; full: number } {
  const usable = Math.max(footing + peekHeight, windowHeight - RAIL_RESERVE);
  const contentRange = usable - footing;
  const peek = footing + peekHeight;
  return {
    peek,
    half: Math.max(peek, footing + Math.round(contentRange * 0.55)),
    full: usable,
  };
}
