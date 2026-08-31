import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import { PinStackView } from '@/features/pins/pin-marker';

/**
 * The launch-density rules for a stacked marker. At launch nobody has a
 * profile photo, so a two-pin cluster used to draw two identical category
 * glyphs plus a count badge — three circles for two plans, wide enough to
 * clip at the screen edge. The rule now: entries that resolve to no photo
 * are dropped; when nothing resolves, the stack collapses to ONE glyph disc
 * plus the count, matching the single-marker silhouette.
 */
describe('PinStackView', () => {
  it('collapses to one glyph disc and one badge when no photo resolves', () => {
    render(<PinStackView faces={[null, null]} count={2} category="bar" />);
    // One glyph disc, not one per plan.
    expect(screen.UNSAFE_getAllByType(SymbolView)).toHaveLength(1);
    // No photo, no face image.
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    // The count still says how many plans are here.
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('draws only the faces that resolved, plus the badge', () => {
    render(
      <PinStackView
        faces={['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg', null]}
        count={3}
        category="bar"
      />
    );
    // Two faces; the unresolved third is dropped rather than drawn as a
    // duplicate glyph disc.
    expect(screen.UNSAFE_getAllByType(Image)).toHaveLength(2);
    expect(screen.UNSAFE_queryAllByType(SymbolView)).toHaveLength(0);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('wears the neutral glyph for a mixed-category cluster', () => {
    render(<PinStackView faces={[null, null]} count={2} category="mixed" />);
    const [glyph] = screen.UNSAFE_getAllByType(SymbolView);
    expect(glyph.props.name).toEqual({
      ios: 'mappin.and.ellipse',
      android: 'place',
      web: 'place',
    });
  });

  it('never scales the count badge: marker artwork is cartography', () => {
    render(<PinStackView faces={[null]} count={1} category="hike" />);
    expect(screen.getByText('1').props.allowFontScaling).toBe(false);
  });
});
