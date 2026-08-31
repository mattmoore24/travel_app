import { haptics } from '@/lib/haptics';

/**
 * Place mode's two gesture rules, as pure logic so both are unit-testable
 * instead of living inside map callbacks nobody can run under jest.
 */

/**
 * The drop thud means "you placed it here", so it must never fire for a
 * camera move the app itself made: entering place mode zooms in a step, and
 * picking a search result flies to it — both lift and drop the pin (that
 * motion is informative whoever caused it), and both used to thud as if the
 * person had chosen the spot. Entering place mode was a light-then-medium
 * inside one animation.
 *
 * Consume-on-drop rather than cleared in onRegionChangeComplete: the settle
 * handler runs before the overlay's drop effect, so a clear there would beat
 * the very read it exists for.
 */
export function createDropGate(impact: () => void = () => haptics.medium()) {
  let programmatic = false;
  return {
    /** Call immediately before each animateToRegion the app itself makes. */
    markProgrammatic() {
      programmatic = true;
    },
    /** Call when the pin drops. Thuds only for a person's own settle. */
    dropped() {
      if (programmatic) {
        programmatic = false;
        return;
      }
      impact();
    },
  };
}

/**
 * Whether a place-mode pan frame should dismiss the keyboard: only the
 * transition INTO lifted. onRegionChange fires once per FRAME of a pan, and
 * Keyboard.dismiss() on every frame ran for the whole duration of a drag on
 * the one screen that must hold 60fps. The behaviour the dismiss exists for
 * — the keyboard getting out of the way when you drag — is preserved by the
 * first call.
 */
export function shouldDismissOnPan(alreadyLifted: boolean): boolean {
  return !alreadyLifted;
}
