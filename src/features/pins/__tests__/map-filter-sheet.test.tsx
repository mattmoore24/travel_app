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

describe('the category chips', () => {
  it('speak the plain category name, not a sticker before it', () => {
    render(<MapFilterSheet filters={DEFAULT_FILTERS} onChange={jest.fn()} onClose={jest.fn()} />);
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
