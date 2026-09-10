import { fireEvent, render, screen } from '@testing-library/react-native';

import { MapFilterSheet } from '@/features/pins/map-filter-sheet';
import { DEFAULT_FILTERS } from '@/features/pins/filters';
import { PIN_CATEGORIES } from '@/features/pins/pin-helpers';

// The filter sheet labels categories with the marker's own glyph, not emoji.
// The emoji labels contradicted the map twice (Museum, Sights) and put a red
// pushpin on screen in a palette that bans red outside destructive actions.

const mockIsBusiness = jest.fn(() => false);
jest.mock('@/features/business/hooks', () => ({
  useIsBusiness: () => mockIsBusiness(),
  useOwnBusiness: () => ({ data: { category: 'hostel' } }),
}));
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

  it('says no plans fit these filters, with a Clear all, when the FILTERS emptied the map', () => {
    renderSheet({
      filters: { ...DEFAULT_FILTERS, when: 'next7' },
      resultCount: 0,
      totalCount: 11,
    });
    expect(screen.getByText('No plans fit these filters')).toBeTruthy();
    expect(screen.getAllByText('Clear all').length).toBeGreaterThan(0);
  });

  it('never blames the filters for a genuinely empty city', () => {
    // Default filters, zero everywhere: nothing was filtered out, so 'No
    // plans fit these filters' would be a lie and Clear all a button that
    // does nothing.
    renderSheet({ resultCount: 0, totalCount: 0 });
    expect(screen.getByText('Nothing on the map yet.')).toBeTruthy();
    expect(screen.queryByText('No plans fit these filters')).toBeNull();
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

/**
 * The When rail. Founder, 2026-09-10: "Let's start with anytime ... filters
 * where the user can quickly pick options within the next 7 days, next 30
 * days, or custom dates." Four chips, and under the fourth one row.
 */
describe('the When rail', () => {
  const custom = {
    ...DEFAULT_FILTERS,
    when: 'custom' as const,
    from: '2026-09-01',
    to: '2026-09-14',
  };

  it('offers anytime, the next week, the next month and a pick of dates, and nothing older', () => {
    renderSheet();
    for (const label of ['Anytime', 'Next 7 days', 'Next 30 days', 'Pick dates']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The three-day chips are gone with the three-day pin.
    expect(screen.queryByText('Any day')).toBeNull();
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.queryByText('Tomorrow')).toBeNull();
    expect(screen.queryByTestId('filter-pick-dates')).toBeNull();
  });

  it('shows the dates row only under Pick dates, printing the range', () => {
    const { unmount } = renderSheet({ filters: { ...DEFAULT_FILTERS, when: 'next7' } });
    expect(screen.queryByTestId('filter-pick-dates')).toBeNull();
    unmount();

    renderSheet({ filters: custom });
    // The row speaks the range it holds; the result line above Done prints
    // the same words, so the row is read through its own label.
    expect(screen.getByTestId('filter-pick-dates').props.accessibilityLabel).toMatch(
      /^Change the dates\. Currently Sep 1 – 14/
    );
    expect(screen.getAllByText(/Sep 1 – 14/).length).toBeGreaterThan(0);
  });

  it('counts inside the range rather than against the whole year, and names the range above Done', () => {
    renderSheet({ filters: custom, resultCount: 3, totalCount: 11 });
    expect(screen.getByText('3 plans in this range')).toBeTruthy();
    expect(screen.queryByText(/3 of 11 plans/)).toBeNull();
    expect(screen.getByText(/^3 plans, Sep 1 – 14/)).toBeTruthy();
    expect(screen.queryByText('3 plans on the map')).toBeNull();
  });

  it("names the city's week above Done under Next 7 days", () => {
    renderSheet({
      filters: { ...DEFAULT_FILTERS, when: 'next7' },
      clock: new Date(2026, 8, 10, 12, 0),
      resultCount: 3,
      totalCount: 11,
    });
    expect(screen.getByText(/^3 plans, Sep 10 – 16/)).toBeTruthy();
  });

  it('tapping Pick dates lights a real range and opens the calendar', () => {
    const onChange = jest.fn();
    renderSheet({ onChange, clock: new Date(2026, 8, 10, 12, 0) });
    fireEvent.press(screen.getByText('Pick dates'));
    // Seeded with the city's week rather than an empty row, so the map keeps
    // showing a range while the calendar is up.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ when: 'custom', from: '2026-09-10', to: '2026-09-16' })
    );
    expect(screen.getByText('Which days?')).toBeTruthy();
  });

  it('a business is not asked when', () => {
    mockIsBusiness.mockReturnValue(true);
    renderSheet();
    expect(screen.queryByText('Pick dates')).toBeNull();
    mockIsBusiness.mockReturnValue(false);
  });
});

/**
 * The sheet is where every mark is EXPLAINED. The map's permanent key
 * carries four words and sends people here; these are the sentences a word
 * cannot hold, and they include the one the dismissible places chip used to
 * carry, so nothing shipped is silently lost.
 */
describe('what the marks mean', () => {
  afterEach(() => mockIsBusiness.mockReturnValue(false));

  it('names the axis the marks separate on, not their colours', () => {
    renderSheet();
    // Somebody who cannot tell amber from gold gets nothing from a sentence
    // about hue, and this map no longer asks them to.
    expect(screen.getByText(/^Four kinds of mark\./)).toBeTruthy();
    expect(screen.getByText(/A filled pin is somebody's plan/)).toBeTruthy();
  });

  it('says whose plans, to a business', () => {
    mockIsBusiness.mockReturnValue(true);
    renderSheet();
    expect(screen.getByText(/A filled pin is a traveler's plan/)).toBeTruthy();
    expect(screen.queryByText(/A filled pin is somebody's plan/)).toBeNull();
  });

  it('uses the same word for a family that the map key does', () => {
    renderSheet();
    expect(screen.getByText('Plans')).toBeTruthy();
    expect(screen.queryByText('Travelers')).toBeNull();
  });

  it('calls it "Traveler plans" on a business account, in both places', () => {
    mockIsBusiness.mockReturnValue(true);
    renderSheet();
    expect(screen.getByText('Traveler plans')).toBeTruthy();
  });

  it('explains the badges, the dim and the ring', () => {
    renderSheet();
    expect(screen.getByText('A number means more than one plan at the same spot.')).toBeTruthy();
    expect(
      screen.getByText('The little pair of people means the plan is open to join.')
    ).toBeTruthy();
    expect(
      screen.getByText('A dimmer pin is a plan for a later day. The plan list says which.')
    ).toBeTruthy();
    expect(screen.getByText('A blue ring means that one is yours.')).toBeTruthy();
  });

  it('tells an owner what their own halo is, but only when it is on the map', () => {
    mockIsBusiness.mockReturnValue(true);
    const { unmount } = renderSheet({ ownChipOnMap: true });
    expect(screen.getByText('A blue ring means that one is your business.')).toBeTruthy();
    unmount();

    // A listing waiting on its email code is not in city_businesses yet, and
    // a sentence about a ring that is not drawn is the contradiction the old
    // chip already paid for.
    mockIsBusiness.mockReturnValue(true);
    renderSheet({ ownChipOnMap: false });
    expect(screen.queryByText('A blue ring means that one is your business.')).toBeNull();
  });

  it('keeps the rule 6 promise on the busy-areas row, word for word', () => {
    renderSheet();
    expect(
      screen.getByText(
        "Where plans are clustering. Never shown unless enough people are in on it, and never anyone's name."
      )
    ).toBeTruthy();
  });
});

describe('the words in this sheet', () => {
  /** Every string the sheet renders, both viewers. */
  function everyString(): string[] {
    const out: string[] = [];
    for (const business of [false, true]) {
      mockIsBusiness.mockReturnValue(business);
      const view = renderSheet({ ownChipOnMap: true });
      view.UNSAFE_root.findAll((node) => typeof node.type === 'string').forEach((node) => {
        const children = Array.isArray(node.props.children)
          ? node.props.children
          : [node.props.children];
        for (const child of children) {
          if (typeof child === 'string') {
            out.push(child);
          }
        }
        if (typeof node.props.accessibilityLabel === 'string') {
          out.push(node.props.accessibilityLabel);
        }
      });
      view.unmount();
    }
    mockIsBusiness.mockReturnValue(false);
    return out;
  }

  it('carries no emoji and no em dash', () => {
    for (const line of everyString()) {
      // Emoji are stickers where this app draws cartography, and an em dash
      // is the tell that a sentence was not read aloud.
      expect(line).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(line).not.toContain('\u2014');
    }
  });

  it('makes no presence claim and imports no dating vocabulary', () => {
    const banned = [/\bnearby\b/i, /\bnear you\b/i, /\bhere now\b/i, /\bswipe/i, /\bdeck\b/i];
    for (const line of everyString()) {
      for (const pattern of banned) {
        expect(line).not.toMatch(pattern);
      }
    }
  });
});
