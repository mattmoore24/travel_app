import fs from 'node:fs';
import path from 'node:path';

import { after, between } from '@/lib/__tests__/source';

/**
 * THE MARKS AND THE KEY ARE ACTUALLY ON THE MAP, and this is a source scan
 * because that is the only way to see this class of defect.
 *
 * map-screen.tsx is four thousand lines and forty hooks deep, so mounting it
 * here would be a mock of the whole app rather than a test. What can be
 * checked cheaply and exactly is that each piece is REFERENCED where it has
 * to be, in the place it has to be: a key rendered nowhere, a colour still
 * typed out by hand in a third file, a swatch drawn to an alpha the layer
 * never paints. Every one of those passes a green component suite.
 *
 * The behaviour lives in pin-mark.test.tsx, map-key.test.tsx and
 * heat.test.ts. This file is about wiring.
 */
const PINS = path.join(__dirname, '..');
const SRC = path.join(__dirname, '..', '..', '..');

function read(file: string): string {
  return fs.readFileSync(path.join(PINS, file), 'utf8');
}

/**
 * The source with its comments removed.
 *
 * An assertion a correct EXPLANATION can break is an assertion about prose,
 * and this repo has paid for that twice: a docblock saying why a value was
 * retired failed the check that it was retired. Scan the code.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '');
}

/**
 * Every .ts/.tsx the app ships, so "nowhere in the app" means nowhere.
 * Tests are excluded: a test that NAMES the retired literal in order to
 * forbid it is not a file that draws it.
 */
function everySource(): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') {
          walk(full);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push({ file: path.relative(SRC, full), body: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('the key is on the map, and not in the message slot', () => {
  const map = read('map-screen.tsx');

  it('renders MapKey inside the browse header, above the place-mode block', () => {
    expect(map).toContain('<MapKey');
    const key = map.indexOf('<MapKey');
    const dateRow = map.indexOf('styles.dateRow');
    const placeMode = map.indexOf("{mode === 'place' ?");
    expect(dateRow).toBeGreaterThan(-1);
    expect(placeMode).toBeGreaterThan(-1);
    // Between the date row and the place-mode header: the third row of the
    // browse city bar, under the search bar and the Filters row.
    expect(key).toBeGreaterThan(dateRow);
    expect(key).toBeLessThan(placeMode);
  });

  it('never becomes a slot occupant', () => {
    // The strip is single-occupant by construction, so a permanent tenant
    // would silence pins-error, heat-error, own-listing, both empty states
    // and both arrival banners. Every slot branch is closed before the key
    // is rendered, so no `slot === ` guard can be open around it.
    // Nothing about the strip reaches the key's own JSX: not the selector,
    // not the offset the strip is positioned by.
    const key = between(map, '<MapKey', '/>');
    expect(key).not.toContain('slot');
    expect(key).not.toContain('messageSlot');
    // And it is drawn in the header, ABOVE every branch that renders into
    // the strip, rather than as one more of them.
    const branchesAfter = [...after(map, '<MapKey').matchAll(/\{slot === '/g)].length;
    const branchesTotal = [...map.matchAll(/\{slot === '/g)].length;
    expect(branchesTotal).toBeGreaterThan(5);
    expect(branchesAfter).toBe(branchesTotal);
  });

  it('is not gated on mapCovered, so it survives its own explanation opening', () => {
    // The Filters sheet is inline and dimmed={false} and leaves the header
    // live underneath, which is the whole reason the key lives here rather
    // than in the strip that Filters wipes.
    const guard = between(map, '{activeCity != null && !cityScale ? (', '<MapKey');
    expect(guard).not.toContain('mapCovered');
  });
});

describe('the two dismissible chips are gone', () => {
  const slot = read('message-slot.ts');
  const mapCode = code('map-screen.tsx');

  it.each(['heat-legend', 'places-legend', 'heatLegendLine', 'useHeatLegend', 'usePlacesLegend'])(
    'map-screen no longer mentions %s',
    (name) => {
      expect(mapCode).not.toContain(name);
    }
  );

  it('leaves nine slots, ending at the heat fallback', () => {
    const body = between(slot, 'export const SLOT_ORDER', '] as const');
    const kinds = [...body.matchAll(/'([a-z-]+)',/g)].map((match) => match[1]);
    expect(kinds).toHaveLength(9);
    expect(kinds[kinds.length - 1]).toBe('heat-fallback');
  });

  it('deletes the module that stored their dismissals', () => {
    expect(fs.existsSync(path.join(PINS, 'heat-legend.ts'))).toBe(false);
  });
});

describe('one place names a marker colour', () => {
  it('holds no hand-typed heat literal anywhere in the app', () => {
    // The swatch was a copied `rgba(255, 154, 90, 0.85)` in three files, at
    // roughly three times the alpha the layer has ever painted. A key that
    // lies about a mark is worse than no key.
    const offenders = everySource()
      .filter(({ body }) =>
        body
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .includes('rgba(255, 154, 90')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('retires gold from the map', () => {
    const marker = code('pin-marker.tsx');
    expect(marker).not.toContain('PIN_GOLD');
    expect(marker).not.toContain('#FFC168');
  });

  it('makes the marker files read the palette rather than retype it', () => {
    for (const file of ['pin-marker.tsx', 'heat.ts', 'place-pin-overlay.tsx']) {
      expect(read(file)).toContain("from './marker-colors'");
    }
    const overlay = code('place-pin-overlay.tsx');
    for (const hex of ['#FF9A5A', '#0E1020', '#FFFFFF']) {
      expect(overlay).not.toContain(hex);
    }
    // The ground dot measured 1.06:1 against the basemap: a target nobody
    // could see, for the whole of the gesture that needs it.
    expect(overlay).not.toContain('rgba(20,23,26');
  });

  it('derives the swatch from the layer instead of eyeballing it', () => {
    expect(read('heat-swatch.tsx')).toContain("from './heat'");
    const sheet = read('map-filter-sheet.tsx');
    expect(sheet).toContain('HeatSwatch');
    expect(sheet).not.toContain('heatSwatchWrap');
  });
});

describe('Dynamic Type reaches the marker text', () => {
  const marker = code('pin-marker.tsx');

  it('refuses nothing and caps three things', () => {
    // The stack count, the city pill's name, the city pill's count. Marker
    // artwork is cartography, but a NUMBER a person has to read is not
    // exempt: cap it, and let the body grow.
    expect(marker).not.toContain('allowFontScaling={false}');
    expect(marker.match(/maxFontSizeMultiplier={1\.3}/g)).toHaveLength(3);
  });
});

describe('a business is on the map rather than hunted for', () => {
  const chip = fs.readFileSync(path.join(PINS, '..', 'business', 'business-marker.tsx'), 'utf8');
  // The file's own long comment explains why displayPriority is never 'low'
  // here, and the explanation must not fail the check.
  const chipCode = chip.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('is a 30pt hollow ink chip that still holds 44pt', () => {
    expect(chip).toContain('const CHIP = 30');
    // 30 + 7 + 7 = 44, as 26 + 9 + 9 was before it grew.
    expect(chip).toContain('padding: 7');
    expect(chip).toContain('theme.surfaceSunken : theme.canvas');
  });

  it('takes its idle edge from textSecondary, not from theme.border', () => {
    // theme.border is 3.4:1 on the app's own ground and 2.80:1 on Apple's
    // washed land; textSecondary is 6.77:1 there.
    expect(chip).toContain('live ? theme.highlight : theme.textSecondary');
  });

  it('keeps a live post on two channels, never on hue alone', () => {
    expect(chip).toContain('shadowColor: theme.highlight');
    expect(chip).toContain('liveDot');
  });

  it('never goes back to displayPriority low', () => {
    // 'low' means "hide whenever this collides with anything higher", and a
    // decluttered annotation leaves the accessibility tree with it.
    expect(chipCode).not.toContain('displayPriority');
  });
});

describe('the city pill stops borrowing a stack offset', () => {
  const map = read('map-screen.tsx');

  it('uses its own derived offset', () => {
    expect(map).toContain('CITY_PILL_CENTER_OFFSET');
    expect(map).not.toContain('STACK_CENTER_OFFSET');
  });
});
