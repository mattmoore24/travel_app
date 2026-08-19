import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInUp,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Fonts, Radius, Space, Type } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

/**
 * The welcome sequence keeps the splash screen's exact palette and never
 * theme-switches, same as the splash itself: one indigo field from app icon
 * to first swipe. Colors are deliberately hardcoded to the icon's values.
 */
const FIELD = '#2A4C9B';
const AMBER = '#F0A93C';
const ON_AMBER = '#2A1A00';
const WHITE = '#FFFFFF';
const WHITE_SOFT = 'rgba(255,255,255,0.78)';
const BADGE_BG = 'rgba(255,255,255,0.14)';
const GHOST_BORDER = 'rgba(255,255,255,0.4)';

/** Same size and position as the native splash icon — the handoff depends on it. */
const MARK = 200;
/** The mark shrinks to this scale as it glides up to become the page emblem. */
const EMBLEM_SCALE = 0.35;
/** Emblem center sits this far below the top inset once docked. */
const EMBLEM_CENTER = (MARK * EMBLEM_SCALE) / 2 + 8;
/**
 * The tour is a fixed full-screen composition with no scroll, so unbounded
 * Dynamic Type would push the join/browse buttons off small screens with no
 * way to reach them. Capped the way Apple caps its own onboarding scenes;
 * everything said here is re-learnable in the app at full text size.
 */
const MAX_FONT_SCALE = 1.2;

type Page = {
  icon: SymbolViewProps['name'];
  title: string;
  body: string;
};

/** Three tabs, three sentences. Anything longer does not get read. */
const PAGES: Page[] = [
  {
    icon: { ios: 'map.fill', android: 'map', web: 'map' },
    title: 'See what people are up to',
    body: "The map shows plans people have dropped in your city. Dinner, a hike, a night out. Tap one to see who's going.",
  },
  {
    icon: { ios: 'person.2.fill', android: 'group', web: 'group' },
    title: 'Find people on your dates',
    body: "Add your trips and you'll see who else is in town while you are. Same dates, same city, that is the whole idea.",
  },
  {
    icon: { ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' },
    title: 'Say hi, then make plans',
    body: 'Send someone a first message. If they accept, we let you know and your chat opens up.',
  },
];

/** Welcome + the three explainers; the last explainer carries the choice. */
const PAGE_COUNT = PAGES.length + 1;

/**
 * One layer of a page, moving slower than the scroll for depth. Different
 * factors on siblings (icon vs text) give each swipe real parallax; the fade
 * keeps the neighbor's content from lingering at the screen edge.
 */
function PageLayer({
  scrollX,
  index,
  width,
  factor,
  style,
  children,
}: {
  scrollX: SharedValue<number>;
  index: number;
  width: number;
  factor: number;
  style?: object;
  children: ReactNode;
}) {
  const animated = useAnimatedStyle(() => {
    const offset = scrollX.value - index * width;
    return {
      opacity: interpolate(
        offset,
        [-width * 0.75, 0, width * 0.75],
        [0, 1, 0],
        Extrapolation.CLAMP
      ),
      transform: [{ translateX: offset * factor }],
    };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * The campfire mark, picked up pixel-for-pixel from where the splash leaves
 * it: full size at screen center on the welcome page, then it glides up and
 * shrinks into a small emblem that stays docked under the status bar for the
 * rest of the tour. The scroll position drives it directly, so it tracks the
 * finger — this is the transition that makes the tour feel like one scene.
 */
function TourMark({
  scrollX,
  width,
  height,
  topInset,
}: {
  scrollX: SharedValue<number>;
  width: number;
  height: number;
  topInset: number;
}) {
  const rise = height / 2 - topInset - EMBLEM_CENTER;

  // The glow breathes on the welcome page like a fire does, then hands its
  // light off as the mark departs.
  const breath = useSharedValue(0.55);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(0.95, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
  }, [breath]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity:
      breath.value * interpolate(scrollX.value, [0, width * 0.7], [1, 0], Extrapolation.CLAMP),
  }));
  const markStyle = useAnimatedStyle(() => {
    const p = interpolate(scrollX.value, [0, width], [0, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY: -p * rise }, { scale: 1 - p * (1 - EMBLEM_SCALE) }],
    };
  });

  return (
    <View pointerEvents="none" style={styles.markLayer}>
      <Animated.View style={[styles.markWrap, markStyle]}>
        <Animated.View style={[styles.glow, glowStyle]}>
          <Image
            source={require('@/assets/images/logo-glow.png')}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
          />
        </Animated.View>
        <Image
          source={require('@/assets/images/splash-icon.png')}
          style={styles.mark}
          contentFit="contain"
        />
      </Animated.View>
    </View>
  );
}

function Dot({
  scrollX,
  index,
  width,
}: {
  scrollX: SharedValue<number>;
  index: number;
  width: number;
}) {
  const animated = useAnimatedStyle(() => {
    const range = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      width: interpolate(scrollX.value, range, [7, 22, 7], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, range, [0.35, 1, 0.35], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.dot, animated]} />;
}

function TourButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: 'amber' | 'ghost';
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic="light"
      scaleTo={0.96}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={styles.buttonContainer}
      style={[styles.button, tone === 'amber' ? styles.buttonAmber : styles.buttonGhost]}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.buttonLabel, tone === 'amber' ? styles.labelAmber : styles.labelGhost]}>
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * First launch only, rendered instead of the tabs until dismissed. Opens on a
 * welcome scene that the splash screen dissolves straight into (identical
 * indigo, identical mark position), then three swipes explain the three tabs,
 * ending in the join-or-browse choice. The mark, the parallax layers and the
 * dots are all driven by the live scroll offset, so every transition is
 * continuous rather than page-snapped (docs/DESIGN.md, guest-first).
 */
export function IntroTour({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const pagerRef = useAnimatedRef<Animated.ScrollView>();
  const scrollX = useSharedValue(0);
  const settled = useSharedValue(0);

  const onPageSettled = (next: number) => {
    haptics.selection();
    setPage(next);
  };

  const scrollHandler = useAnimatedScrollHandler((event) => {
    'worklet';

    scrollX.value = event.contentOffset.x;
    const next = Math.round(event.contentOffset.x / width);
    if (next !== settled.value && next >= 0 && next < PAGE_COUNT) {
      settled.value = next;
      scheduleOnRN(onPageSettled, next);
    }
  });

  const skipStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollX.value,
      [(PAGE_COUNT - 2) * width, (PAGE_COUNT - 1) * width],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));

  const last = page === PAGE_COUNT - 1;
  // Slotted under the mark (screen center is where the splash left it) and
  // capped above the dots: on short screens the box shrinks instead of the
  // button sliding off the bottom or into the dots.
  const welcomeTop = height / 2 + MARK / 2 + Space.md;
  const welcomeBottom = insets.bottom + 64;

  return (
    // No entrance fade: the splash overlay fades out over this, and two
    // stacked fades over the window's white root would let white bleed
    // through mid-crossover. Solid from the first frame keeps the indigo
    // field unbroken from app icon to tour.
    <Animated.View style={[StyleSheet.absoluteFill, styles.root]} testID="intro-tour">
      <StatusBar style="light" animated />

      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}>
        {/* Page 0: the welcome scene the splash dissolves into. The text rises
            in a stagger timed to land as the splash fade completes. */}
        <View style={{ width, height }}>
          <PageLayer
            scrollX={scrollX}
            index={0}
            width={width}
            factor={0.3}
            style={[styles.welcomeBlock, { top: welcomeTop, bottom: welcomeBottom }]}>
            <View style={styles.welcomeCopy}>
              <Animated.Text
                entering={FadeInUp.delay(350).duration(500)}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={styles.wordmark}>
                Samewhere
              </Animated.Text>
              <Animated.Text
                entering={FadeInUp.delay(500).duration(500)}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={styles.tagline}>
                Connect. Plan. Explore.
              </Animated.Text>
              <Animated.Text
                entering={FadeInUp.delay(650).duration(500)}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={styles.welcomeLine}>
                Welcome to the Samewhere community.
              </Animated.Text>
            </View>
            <Animated.View
              entering={FadeInUp.delay(820).duration(500)}
              style={styles.welcomeAction}>
              <TourButton
                label="Show me around"
                tone="amber"
                onPress={() => pagerRef.current?.scrollTo({ x: width, animated: true })}
              />
            </Animated.View>
          </PageLayer>
        </View>

        {PAGES.map((item, i) => {
          const index = i + 1;
          const choice = index === PAGE_COUNT - 1;
          return (
            <View
              key={item.title}
              style={[
                styles.page,
                { width, paddingTop: insets.top + MARK * EMBLEM_SCALE + 8, paddingBottom: 96 },
              ]}>
              <PageLayer scrollX={scrollX} index={index} width={width} factor={0.55}>
                <View style={styles.iconBadge}>
                  <SymbolView name={item.icon} size={44} tintColor={WHITE} />
                </View>
              </PageLayer>
              <PageLayer
                scrollX={scrollX}
                index={index}
                width={width}
                factor={0.25}
                style={styles.textLayer}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.pageTitle}>
                  {item.title}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.pageBody}>
                  {item.body}
                </Text>
                {choice ? (
                  <View style={styles.choice}>
                    <TourButton
                      label="Make my profile"
                      tone="amber"
                      onPress={() => {
                        onDone();
                        router.push('/join');
                      }}
                    />
                    <TourButton label="Just looking for now" tone="ghost" onPress={onDone} />
                  </View>
                ) : null}
              </PageLayer>
            </View>
          );
        })}
      </Animated.ScrollView>

      <TourMark scrollX={scrollX} width={width} height={height} topInset={insets.top} />

      {/* Entrance fade and scroll-driven fade on separate views: Reanimated
          rejects an entering animation and an animated style sharing opacity. */}
      <Animated.View
        entering={FadeIn.delay(900).duration(400)}
        style={[styles.skip, { top: insets.top + Space.sm }]}>
        <Animated.View style={skipStyle}>
          <Pressable hitSlop={12} disabled={last} onPress={onDone} accessibilityRole="button">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.skipLabel}>
              Skip
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>

      <Animated.View
        entering={FadeIn.delay(900).duration(400)}
        pointerEvents="none"
        style={[styles.dots, { bottom: insets.bottom + Space.lg }]}>
        {Array.from({ length: PAGE_COUNT }, (_, i) => (
          <Dot key={i} scrollX={scrollX} index={i} width={width} />
        ))}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 900,
    backgroundColor: FIELD,
  },
  markLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markWrap: {
    width: MARK,
    height: MARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
  },
  mark: {
    width: MARK,
    height: MARK,
  },
  welcomeBlock: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.xl,
  },
  welcomeCopy: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Space.md,
  },
  wordmark: {
    fontFamily: Fonts.rounded,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '800',
    color: WHITE,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: AMBER,
    textAlign: 'center',
  },
  welcomeLine: {
    ...Type.body,
    color: WHITE_SOFT,
    textAlign: 'center',
  },
  welcomeAction: {
    alignSelf: 'stretch',
    marginTop: Space.md,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xl,
    paddingHorizontal: Space.xl,
  },
  iconBadge: {
    width: 104,
    height: 104,
    borderRadius: Radius.xl,
    backgroundColor: BADGE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLayer: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: Space.lg,
  },
  pageTitle: {
    ...Type.title,
    color: WHITE,
    textAlign: 'center',
  },
  pageBody: {
    ...Type.body,
    color: WHITE_SOFT,
    textAlign: 'center',
    maxWidth: 320,
  },
  choice: {
    alignSelf: 'stretch',
    gap: Space.sm,
    marginTop: Space.md,
  },
  buttonContainer: {
    alignSelf: 'stretch',
  },
  button: {
    minHeight: 54,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    paddingHorizontal: Space.xxl,
  },
  buttonAmber: {
    backgroundColor: AMBER,
  },
  buttonGhost: {
    borderWidth: 1.5,
    borderColor: GHOST_BORDER,
  },
  buttonLabel: {
    ...Type.headline,
  },
  labelAmber: {
    color: ON_AMBER,
  },
  labelGhost: {
    color: WHITE,
  },
  skip: {
    position: 'absolute',
    right: Space.lg,
  },
  skipLabel: {
    ...Type.callout,
    color: WHITE_SOFT,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Space.xs,
  },
  dot: {
    height: 7,
    borderRadius: 4,
    backgroundColor: WHITE,
  },
});
