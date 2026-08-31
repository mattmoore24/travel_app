import { render, screen } from '@testing-library/react-native';

import { MapFilterSheet } from '@/features/pins/map-filter-sheet';
import { DEFAULT_FILTERS } from '@/features/pins/filters';
import { PIN_CATEGORIES } from '@/features/pins/pin-helpers';

// The filter sheet labels categories with the marker's own glyph, not emoji.
// The emoji labels contradicted the map twice (Museum, Sights) and put a red
// pushpin on screen in a palette that bans red outside destructive actions.

jest.mock('@/features/business/hooks', () => ({ useIsBusiness: () => false }));
// The Sheet is chrome this test does not exercise; render straight through it.
jest.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: unknown }) => children,
}));
// The kind rows draw the map's own artwork now, and PlaceGlyph's module
// (business-marker) imports react-native-maps, whose native module does not
// exist under jest.
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Marker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Polygon: () => null,
    Circle: () => null,
    PROVIDER_DEFAULT: 'default',
  };
});

function renderSheet(over: Partial<Parameters<typeof MapFilterSheet>[0]> = {}) {
  return render(
    <MapFilterSheet
      filters={DEFAULT_FILTERS}
      resultCount={3}
      totalCount={11}
      onChange={jest.fn()}
      onClose={jest.fn()}
      {...over}
    />
  );
}

describe('the category chips', () => {
  it('speak the plain category name, not a sticker before it', () => {
    renderSheet();
    // Exactly 'Bar': VoiceOver used to say 'cocktail glass Bar'.
    expect(screen.getByTestId('filter-category-bar').props.accessibilityLabel).toBe('Bar');
    for (const category of PIN_CATEGORIES) {
      expect(screen.getByTestId(`filter-category-${category.value}`).props.accessibilityLabel).toBe(
        category.label
      );
    }
  });

  it('carry no emoji anywhere in the category vocabulary', () => {
    for (const category of PIN_CATEGORIES) {
      expect(category.label).toMatch(/^[\x20-\x7e]+$/);
      expect('emoji' in category).toBe(false);
    }
  });
});

// The sheet used to be Apply-less without being live: it covered the map it
// claimed to be updating, so you ticked blind and only found out afterwards
// how much had gone. The counts say it in words.
describe('the survivor count', () => {
  it('says how many plans are on the map, above Done', () => {
    renderSheet({ resultCount: 3, totalCount: 11 });
    expect(screen.getByText('3 plans on the map')).toBeTruthy();
    expect(screen.getByText(/3 of 11 plans/)).toBeTruthy();
  });

  it('says No plans match with a Clear all when the FILTERS emptied the map', () => {
    renderSheet({
      filters: { ...DEFAULT_FILTERS, day: 'today' },
      resultCount: 0,
      totalCount: 11,
    });
    expect(screen.getByText('No plans match')).toBeTruthy();
    expect(screen.getAllByText('Clear all').length).toBeGreaterThan(0);
  });

  it('never blames the filters for a genuinely empty city', () => {
    // Default filters, zero everywhere: nothing was filtered out, so 'No
    // plans match' would be a lie and Clear all a button that does nothing.
    renderSheet({ resultCount: 0, totalCount: 0 });
    expect(screen.getByText('Nothing on the map yet.')).toBeTruthy();
    expect(screen.queryByText('No plans match')).toBeNull();
    expect(screen.queryByText('Clear all')).toBeNull();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it('keeps Done as Done — the map has already applied everything', () => {
    renderSheet({ resultCount: 0, totalCount: 11 });
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText(/Show \d/)).toBeNull();
    expect(screen.queryByText('Apply')).toBeNull();
  });
});
