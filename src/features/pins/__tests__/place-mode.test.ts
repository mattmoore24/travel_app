import fs from 'node:fs';
import path from 'node:path';

import { createDropGate, shouldDismissOnPan, splitSpotLabel } from '@/features/pins/place-mode';
import { between } from '@/lib/__tests__/source';

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

describe('the spot card is the answer, and the chips are the choices', () => {
  // Founder, 2026-09-04, with a screenshot of Bangkok: the venue names were
  // cut off at both screen edges, and "the actual location bubble is no
  // different than the three that are above it".

  it('splits a geocoded label at the first comma only', () => {
    expect(splitSpotLabel('Sao Chingcha Road, Phra Nakhon')).toEqual({
      primary: 'Sao Chingcha Road',
      secondary: 'Phra Nakhon',
    });
    // A name with its own comma keeps it; the geocoder joined name and
    // district with ", " once, and that is the only cut this makes.
    expect(splitSpotLabel('Bangkok Metropolitan Administration, Sao Chingcha Road')).toEqual({
      primary: 'Bangkok Metropolitan Administration',
      secondary: 'Sao Chingcha Road',
    });
    expect(splitSpotLabel('Wang Lang Market')).toEqual({
      primary: 'Wang Lang Market',
      secondary: null,
    });
    expect(splitSpotLabel('Somewhere, ')).toEqual({ primary: 'Somewhere', secondary: null });
  });

  it('the venue chips scroll rather than clip', () => {
    // A centred flex row of three long names overflowed the dock and was
    // clipped at both edges: a chip could shrink, the text in it could not.
    // `between`, never slice(indexOf): the map has other scrollers, and a
    // slice cut by a drifted anchor is '' and passes (source-anchors.test).
    const row = between(MAP, '{nearbyVenues.length > 0 ? (', '</ScrollView>');
    expect(row).toContain('<ScrollView');
    expect(row).toContain('horizontal');
    expect(row).toContain('showsHorizontalScrollIndicator={false}');
    expect(row).not.toContain('<View style={styles.nearbyRow}>');
    // Content centres while it fits: flexGrow on the content container.
    const styles = between(MAP, 'nearbyRow: {', 'nearbyChip: {');
    expect(styles).toContain('flexGrow: 1');
    expect(styles).toContain("justifyContent: 'center'");
    // And a chip is capped, not shrunk: inside a scroller shrink means nothing.
    const chip = between(MAP, 'nearbyChip: {', 'spotCard: {');
    expect(chip).toContain('maxWidth: 240');
    expect(chip).not.toContain('flexShrink');
  });

  it('the spot card does not dress like a chip', () => {
    const card = between(MAP, 'const spot =', '<View style={styles.confirmBar}>');
    // The pin's glyph in the pin's colour, the place over its area.
    expect(card).toContain("ios: 'mappin.and.ellipse'");
    expect(card).toContain('theme.highlight');
    expect(card).toContain('splitSpotLabel(placeLabel)');
    expect(card).toContain('{spot.primary}');
    expect(card).toContain('{spot.secondary}');
    // Sunken with a hairline, a card's corner: the chips are raised
    // surface pills. Same token family, three differences a glance can see.
    expect(card).toContain('backgroundColor: theme.surfaceSunken');
    const cardStyle = between(MAP, 'spotCard: {', 'spotText: {');
    expect(cardStyle).toContain('borderRadius: Radius.lg');
    expect(cardStyle).toContain('borderWidth: StyleSheet.hairlineWidth');
    expect(MAP).not.toContain('placeNamePill');
  });

  it('a searched venue gives the card its street or its area, and the states keep their words', () => {
    const card = between(MAP, 'const spot =', '<View style={styles.confirmBar}>');
    expect(card).toContain('searchedPlace.address ?? searchedPlace.locality');
    expect(card).toContain("'Nothing here. Drag to a street or a venue.'");
    expect(card).toContain("'Drop it here'");
  });
});
