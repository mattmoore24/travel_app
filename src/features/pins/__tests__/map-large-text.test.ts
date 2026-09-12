import { after, between, source } from '@/lib/__tests__/source';

/**
 * The map at the accessibility sizes, and before it has a city.
 *
 * A source scan, for the reason markers-are-wired gives: map-screen.tsx is
 * four thousand lines and forty hooks deep, and what is being pinned here
 * is WHERE a thing is drawn and WHAT it is capped at, which a render of the
 * whole screen would prove no better and cost a mock of the app. The caps
 * themselves are the shared rule (constants/theme FontCap); these pin the
 * places on this screen that take them.
 */
const map = source('src/features/pins/map-screen.tsx');
const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('before the cities answer', () => {
  // The whole no-map branch: from the MapView's close to the status scrim.
  const branch = between(map, '</MapView>', '{/* A ground for the status bar.');

  it('draws the chrome where the search bar and the peek will stand, never null', () => {
    expect(branch).toContain('<Skeleton width="70%" height={HitTarget} radius={Radius.pill} />');
    expect(branch).toContain(
      '<Skeleton width="100%" height={PLAN_LIST_PEEK} radius={Radius.lg} />'
    );
    // The pending arm used to be `: null}`; the only null left in the
    // branch is the one a ternary has to end on.
    expect(branch).not.toContain(': null}');
  });

  it('keeps the error and the empty answer, in that order, ahead of the chrome', () => {
    const error = branch.indexOf('featuredQuery.isError ? (');
    const empty = branch.indexOf('featuredQuery.isSuccess ? (');
    const chrome = branch.indexOf('styles.preCitiesBar');
    expect(error).toBeGreaterThan(-1);
    expect(empty).toBeGreaterThan(error);
    expect(chrome).toBeGreaterThan(empty);
  });

  it('is the branch with no map: nothing here mounts a MapView', () => {
    expect(branch).not.toContain('<MapView');
    // And inert: a shimmer must not take a tap meant for nothing.
    expect(branch).toContain('pointerEvents="none"');
  });

  it('sits where the real chrome sits', () => {
    // The city bar's own offset and the dock's own clearance, so the swap
    // to the real thing does not move anything.
    expect(branch).toContain('{ top: insets.top + Spacing.two }');
    expect(branch).toContain('{ bottom: dockBottom }');
  });
});

describe('the two arrival notices', () => {
  const firstSession = between(map, "{slot === 'first-session' ? (", ') : null}');
  const firstPin = between(map, "{slot === 'first-pin' && activeCity ? (", ') : null}');

  it.each([
    ['first-session', firstSession],
    ['first-pin', firstPin],
  ])('%s caps its lines at the chrome cap and lets the footnote wrap', (_, notice) => {
    // Every ThemedText in the card carries the cap: chrome floating over
    // the hero, which at AX5 covered most of it.
    const texts = notice.match(/<ThemedText[\s\S]*?>/g) ?? [];
    expect(texts.length).toBeGreaterThanOrEqual(2);
    for (const text of texts) {
      expect(text).toContain('maxFontSizeMultiplier={FontCap.chrome}');
    }
    const footnote = texts.find(
      (text) => text.includes('type="footnote"') && text.includes('themeColor="textSecondary"')
    );
    // The footnote is the sentence that tells a first-time pinner what
    // happens next. It is read, so it is never clipped: at the accessibility
    // sizes two lines held about half of it, with no way to see the rest.
    expect(footnote).toBeDefined();
    expect(footnote).not.toContain('numberOfLines');
  });

  it.each([
    ['first-session', firstSession, 'setFirstSessionDismissed(true)'],
    ['first-pin', firstPin, 'setFirstPinDismissed(true)'],
  ])('%s can be put away with a 44pt close', (_, notice, dismiss) => {
    expect(notice).toContain(`<NoticeClose onPress={() => ${dismiss}} />`);
    // And the wrapper lets the tap through to it.
    expect(notice).not.toContain('pointerEvents="none"');
  });

  it('the close is a hit target with a unique spoken name', () => {
    const close = between(map, 'function NoticeClose(', 'const SEEDED_LABEL');
    expect(close).toContain('accessibilityLabel="Dismiss"');
    expect(close).toContain('style={styles.noticeClose}');
    const style = between(map, '  noticeClose: {', '  },');
    expect(style).toContain('width: HitTarget');
    expect(style).toContain('height: HitTarget');
  });

  it('a dismissal empties the slot rather than hiding the card over it', () => {
    const flags = between(map, 'chooseSlot({', '})');
    expect(flags).toContain("'first-session': firstSession && !firstSessionDismissed,");
    expect(flags).toContain("'first-pin': ownPinIsOnlyPin && !firstPinDismissed,");
  });
});

describe('the docks', () => {
  it('cap both dock labels at the control cap', () => {
    const labels = map.match(/<ThemedText[^>]*styles\.dockLabel[^>]*>/g) ?? [];
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label).toContain('maxFontSizeMultiplier={FontCap.control}');
    }
  });
});

describe('the pin card', () => {
  const card = between(map, 'function PinCard(', 'function CrewRow(');

  it('reserves its hero from the storage path, not the resolved URL', () => {
    expect(flat(card)).toContain(
      'const hero = !pin.seeded && !isOwn && pin.photo_path != null && !photoQuery.isError && !viewerIsBusiness;'
    );
    expect(card).toContain('const photo = photoSourceState(photoQuery, pin.photo_path);');
  });

  it('draws the hero through RemoteImage under the name gradient', () => {
    const hero = between(card, '<View style={styles.hero}>', '<LinearGradient');
    expect(hero).toContain('<RemoteImage');
    expect(hero).toContain('source={photo.source}');
    expect(hero).toContain('pending={photo.pending}');
    expect(hero).toContain('transition={Motion.standard}');
    expect(hero).not.toContain('<Image');
    // The band IS the door to the profile. A retry target inside it would
    // be the deepest responder and take every tap once the photo failed.
    expect(hero).toContain('retry={false}');
  });

  it('draws the pinner avatar through RemoteImage, flat, with the glyph as its fallback', () => {
    const avatar = between(card, 'style={[styles.avatar,', '</View>');
    expect(avatar).toContain('<RemoteImage');
    expect(avatar).toContain('skeleton="flat"');
    expect(avatar).toContain('fallback={');
    expect(avatar).toContain("ios: 'person.fill'");
    expect(avatar).not.toContain('<Image');
  });
});

describe('the plan list', () => {
  it('is told when the pins are still on their way, placeholder data excluded', () => {
    // The element, not the `useState<PlanListDetent>` generic above it.
    const list = between(map, '<PlanList\n', '/>');
    expect(list).toContain('pending={pinsQuery.isPending && !pinsQuery.isPlaceholderData}');
  });
});

describe('the marker', () => {
  // Up to the docblock of the stacked marker that follows it.
  const marker = between(
    map,
    'function CityPinMarker(',
    'Several plans at one venue, as ONE marker'
  );

  it('keys its rasterisation window on the face having loaded', () => {
    expect(marker).toContain('const [faceLoads, setFaceLoads] = useState(0);');
    const key = between(marker, 'useMarkerTracking(', ');');
    expect(key).toContain('${faceLoads}');
    expect(key).toContain('${photoUri ?? ');
  });

  it('hands the face its cache key and its load callback', () => {
    const view = between(marker, '<PinMarkerView', '/>');
    expect(view).toContain('photoPath={pin.photo_path}');
    expect(view).toContain('onFaceLoad={() => setFaceLoads((count) => count + 1)}');
  });

  it('never mutates a ref from the load callback', () => {
    expect(after(marker, 'const [faceLoads')).not.toMatch(/faceLoads\.current/);
  });
});
