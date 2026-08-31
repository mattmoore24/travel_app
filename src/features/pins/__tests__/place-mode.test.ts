import fs from 'node:fs';
import path from 'node:path';

import { createDropGate, shouldDismissOnPan } from '@/features/pins/place-mode';

const MAP = fs.readFileSync(path.join(__dirname, '..', 'map-screen.tsx'), 'utf8');

describe('the drop thud gate', () => {
  it("a programmatic move's landing is silent; a person's settle thuds", () => {
    const impacts: number[] = [];
    const gate = createDropGate(() => impacts.push(1));
    // Entering place mode: the app zooms, the pin lands, nobody chose it.
    gate.markProgrammatic();
    gate.dropped();
    expect(impacts).toHaveLength(0);
    // Then the person drags and lets go: that one is theirs.
    gate.dropped();
    expect(impacts).toHaveLength(1);
  });

  it('the flag is consumed by exactly one drop', () => {
    const impacts: number[] = [];
    const gate = createDropGate(() => impacts.push(1));
    gate.markProgrammatic();
    gate.dropped();
    gate.dropped();
    gate.dropped();
    expect(impacts).toHaveLength(2);
  });

  it('all of the app’s own camera moves mark the gate', () => {
    // enterPlaceMode's zoom step, flyTo's landing, and a nearby-venue chip
    // moving the pin onto its venue — the three programmatic
    // animateToRegion calls in place mode.
    expect(MAP.match(/dropGate\.markProgrammatic\(\);/g)).toHaveLength(3);
    // And the overlay's haptic goes through the gate, nowhere else.
    expect(MAP).toContain('onDrop={dropGate.dropped}');
  });
});

describe('the keyboard dismiss guard', () => {
  it('N region-change frames with lifted already true produce one dismiss', () => {
    let lifted = false;
    let dismissed = 0;
    for (let frame = 0; frame < 60; frame++) {
      if (shouldDismissOnPan(lifted)) {
        dismissed += 1;
      }
      lifted = true; // what the handler's setLifted(true) does
    }
    expect(dismissed).toBe(1);
  });

  it('the map screen dismisses through the guard, before lifting', () => {
    const at = MAP.indexOf('shouldDismissOnPan(lifted)');
    expect(at).toBeGreaterThan(-1);
    expect(MAP.indexOf('Keyboard.dismiss()', at)).toBeGreaterThan(-1);
    // Exactly one dismiss on this screen, and it is the guarded one.
    expect(MAP.match(/Keyboard\.dismiss\(\)/g)).toHaveLength(1);
  });
});

describe('the pill answers before the commit', () => {
  it('a centre that resolves to nothing says so and holds the button', () => {
    expect(MAP).toContain("'Nothing here. Drag to a street or a venue.'");
    expect(MAP).toContain(
      'disabled={placeCoords == null || lifted || (nothingHere && !searchedPlace)}'
    );
  });

  it('a geocode FAILURE degrades to the plain pill, never to a refusal', () => {
    // The catch path clears the flag: a device that cannot geocode right now
    // must still be able to pin.
    const catchAt = MAP.indexOf('.catch(() => {');
    expect(catchAt).toBeGreaterThan(-1);
    expect(MAP.indexOf('setNothingHere(false);', catchAt)).toBeGreaterThan(-1);
  });

  it('the resolved label reaches the form so nothing geocodes twice', () => {
    expect(MAP).toContain('initialLabel={placeLabel}');
  });
});
