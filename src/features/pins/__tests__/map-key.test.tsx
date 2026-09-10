import { fireEvent, render, screen } from '@testing-library/react-native';

import { ALL_MARKER_KINDS, DEFAULT_FILTERS, type MarkerKind } from '@/features/pins/filters';
import { MapKey } from '@/features/pins/map-key';

// PlaceGlyph's module reaches react-native-maps, whose native module does not
// exist under jest. The key draws the chip, not the Marker around it.
jest.mock('react-native-maps', () => ({
  __esModule: true,
  default: () => null,
  Marker: () => null,
  Circle: () => null,
  PROVIDER_DEFAULT: 'default',
}));

/**
 * The map's key is permanent chrome, so what it says has to be true of the
 * map underneath it at every moment — including after somebody unticks a
 * family. A key that names a mark the map is not drawing is worse than no
 * key at all, which is the failure mode the two dismissible chips had in a
 * quieter form: they pointed at business chips on maps that had none.
 */
function renderKey(kinds: MarkerKind[] = DEFAULT_FILTERS.kinds, viewerIsBusiness = false) {
  const onPress = jest.fn();
  render(<MapKey kinds={kinds} viewerIsBusiness={viewerIsBusiness} onPress={onPress} />);
  return onPress;
}

/** The one element VoiceOver hears, found by the label contract itself. */
function chip() {
  return screen.getByLabelText(/^Map key\. /);
}

describe('what the key prints', () => {
  it('names all four families by default', () => {
    renderKey();
    expect(screen.getByText('Plans')).toBeTruthy();
    expect(screen.getByText('Businesses')).toBeTruthy();
    expect(screen.getByText('Picks')).toBeTruthy();
    expect(screen.getByText('Busy areas')).toBeTruthy();
  });

  it('drops a word the moment its family is unticked', () => {
    renderKey(ALL_MARKER_KINDS.filter((kind) => kind !== 'businesses'));
    expect(screen.queryByText('Businesses')).toBeNull();
    expect(screen.getByText('Plans')).toBeTruthy();
  });

  it('says whose plans, on a business account', () => {
    renderKey(DEFAULT_FILTERS.kinds, true);
    // An owner's own chips are on this map too, so a bare "Plans" would be
    // ambiguous about whose.
    expect(screen.getByText('Traveler plans')).toBeTruthy();
    expect(screen.queryByText('Plans')).toBeNull();
  });

  it('says "Busy areas", never a bare "Busy"', () => {
    // An unqualified busy claim reads as a presence claim, and this layer is
    // scoped to a city that may be a continent away (§7 rule 2).
    renderKey();
    expect(screen.queryByText('Busy')).toBeNull();
  });

  it('still draws a key when only one family is on', () => {
    for (const kind of ALL_MARKER_KINDS) {
      const { unmount } = render(
        <MapKey kinds={[kind]} viewerIsBusiness={false} onPress={jest.fn()} />
      );
      expect(screen.getByLabelText(/^Map key\. /)).toBeTruthy();
      unmount();
    }
  });
});

describe('what VoiceOver hears', () => {
  it('is one element, spoken from the same words it prints', () => {
    renderKey();
    expect(chip().props.accessibilityLabel).toBe('Map key. plans, businesses, picks, busy areas.');
  });

  it('shortens with the printed words rather than drifting from them', () => {
    renderKey(['travelers', 'heat']);
    expect(chip().props.accessibilityLabel).toBe('Map key. plans, busy areas.');
  });

  it('is a button that says where it goes', () => {
    renderKey();
    expect(chip().props.accessibilityRole).toBe('button');
    expect(chip().props.accessibilityHint).toBe('Opens filters, where each mark is explained');
  });

  it('hides its artwork, so four marks are not four more stops', () => {
    renderKey();
    const hosts = screen.UNSAFE_root.findAll((node) => typeof node.type === 'string');
    const hidden = hosts.filter((node) => node.props.accessibilityElementsHidden === true);
    // One wrapper per family drawn, each hidden on BOTH platforms' prop.
    expect(hidden).toHaveLength(4);
    for (const node of hidden) {
      expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
    }
  });

  it('exposes exactly one labelled element, not one per pair', () => {
    renderKey();
    const labelled = screen.UNSAFE_root.findAll((node) => typeof node.type === 'string').filter(
      (node) => typeof node.props.accessibilityLabel === 'string'
    );
    expect(labelled).toHaveLength(1);
  });
});

describe('the door it opens', () => {
  it('fires once', () => {
    const onPress = renderKey();
    fireEvent.press(chip());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
