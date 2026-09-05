import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Radius, Space, Springs } from '@/constants/theme';
import { PlaceGlyph } from '@/features/business/business-marker';
import { cityNow, clockTime } from '@/features/business/vocabulary';
import {
  metersBetween,
  clusterCategory,
  clusterIntentDate,
  clusterTitle,
} from '@/features/pins/cluster';
import type { PinCluster } from '@/features/pins/cluster';
import { daysFor } from '@/features/pins/filters';
import { planListHeights } from '@/features/pins/bottom-stack';
import { burnOutLabel, intentLabel, pinSubtitle, pinTitle } from '@/features/pins/pin-helpers';
import { toISODate } from '@/features/trips/dates';
import { PinGlyph } from '@/features/pins/pin-marker';
import { useTheme } from '@/hooks/use-theme';
import { countOf } from '@/lib/plural';
import type { CityBusinessRow, CityPinRow } from '@/lib/database.types';

/**
 * The what's-on list, as the map's OWN bottom sheet — never a directory tab
 * (founder decision D4). Discovery used to be strictly marker by marker: to
 * learn what is happening in Bangkok you panned, tapped each amber disc, read
 * the card, closed it, and repeated. Eleven pins on a city-wide map look like
 * nothing; eleven rows are a scene.
 *
 * Three detents. The peek is a grab handle and one line — the only place the
 * city's plan count is ever stated — and it ships visible by default, because
 * a peek that has to be discovered is a list nobody finds.
 *
 * The sheet's surface runs to the SCREEN BOTTOM, and the map's dock stands on
 * an opaque plate cut from the same surface (the map screen's `dockFooting`),
 * so the strip, the button and the tab-bar clearance read as one card. It
 * used to stop short of the dock, which left its lower edge as a hard cut
 * across the map with the button floating in the gap below it — three
 * stacked slabs where there is one thing. `footing` is how much of the card
 * that plate covers. Every detent is measured from the screen bottom and
 * every top edge lands exactly where it did when the sheet stopped short (see
 * features/pins/bottom-stack). No detent covers the primary action, because
 * the dock is painted OVER the sheet rather than left underneath it.
 *
 * The entrance and every detent change ride a translateY transform in
 * useAnimatedStyle, never a Slide preset: the Slide family animates the
 * view's real layout and freezes the frame it snapshotted (see traps).
 */

/**
 * The visible height of the collapsed strip, and `styles.header`'s minHeight.
 *
 * 56, not 76: the strip is the top of the map's bottom card, and its content
 * measures 8 + grabber 4 + gap 8 + one callout line 20 + 8 = 48, so the old
 * value carried 28pt of empty surface under one line of text. That is a good
 * part of why a single sentence read as a slab. Still well clear of
 * HitTarget, and the measured height below grows it with Dynamic Type.
 */
export const PLAN_LIST_PEEK = 56;

/** What the collapsed strip says. The count MUST be the filtered pin count. */
export function planListSummary(cityName: string, pinCount: number, todayCount: number): string {
  if (pinCount === 0) {
    return `Nothing pinned in ${cityName} yet`;
  }
  const plans = `${countOf(pinCount, 'plan')} in ${cityName}`;
  return todayCount > 0 ? `${plans} · ${todayCount} today` : plans;
}

/**
 * How many of the filtered pins are for today. The city clock LEADS when one
 * is given, and the device-local and UTC candidate days stay matched — the
 * same "widen, never swap" tolerance the map's own Today filter applies (see
 * filterDates). Passing the city clock as `now` instead DROPPED those two
 * candidates, so the peek's count disagreed with the markers it summarised.
 */
export function todayCount(pins: CityPinRow[], now = new Date(), city: Date | null = null): number {
  const today = daysFor('today', now, city)!;
  return pins.filter((pin) => today.has(pin.intent_date)).length;
}

export type PlanSection = {
  /** 'Today' / 'Tomorrow' / the weekday, from the cluster's soonest plan. */
  title: string;
  rows: PinCluster[];
};

/**
 * Rows grouped by day, soonest day first, nearest the map centre first
 * within a day. Rows are CLUSTERS: two plans at one bar are one row, exactly
 * as they are one marker.
 */
export function planSections(
  clusters: PinCluster[],
  centre: { lat: number; lng: number } | null,
  now = new Date()
): PlanSection[] {
  const byDay = new Map<string, PinCluster[]>();
  for (const cluster of clusters) {
    const day = clusterIntentDate(cluster);
    const list = byDay.get(day) ?? [];
    list.push(cluster);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rows]) => ({
      title: intentLabel(day, now),
      rows: centre
        ? [...rows].sort(
            (a, b) =>
              metersBetween(centre.lat, centre.lng, a.lat, a.lng) -
              metersBetween(centre.lat, centre.lng, b.lat, b.lng)
          )
        : rows,
    }));
}

/**
 * Which businesses the list may show: only those with something on, and for
 * a business viewer only their own listing — a business never reads the map
 * as a directory of anything (the same rule its pin feed already obeys).
 */
export function listableBusinesses(
  places: CityBusinessRow[],
  isBusinessViewer: boolean,
  ownBusinessId: string | null
): CityBusinessRow[] {
  const live = places.filter((place) => place.has_live_post);
  return isBusinessViewer ? live.filter((place) => place.id === ownBusinessId) : live;
}

/**
 * What a business's row says under its name.
 *
 * "Something on tonight" was the whole of it, for every business, forever: the
 * map has always known WHICH businesses have news (city_businesses returns
 * has_live_post) and never what the news is, so the one piece of fresh content
 * a business produces reached a traveler only if they tapped that exact marker
 * among six clusters. A quiz night that nobody can read is a quiz night nobody
 * goes to, which is why a bar stops posting.
 *
 * The time is the VENUE's, approximated from its longitude the same way the
 * open line is (cityNow), because "21:00" has to mean nine at that door and
 * not nine wherever the reader happens to be sitting. And the day comes first,
 * so a post for Friday cannot read as tonight.
 *
 * Falls back to the old line whenever the words are missing rather than
 * inventing any: `live_post` is merged in from a second call that a phone
 * running ahead of its own database will not have.
 */
export function whatsOnLine(place: CityBusinessRow, clock: Date): string {
  const post = place.live_post;
  if (post == null) {
    return 'Something on tonight';
  }
  if (post.happens_at == null) {
    return post.title;
  }
  const at = cityNow(new Date(post.happens_at), place.lng);
  return `${post.title} · ${intentLabel(toISODate(at), clock)} ${clockTime(at)}`;
}

export type PlanListDetent = 'peek' | 'half' | 'full';
type Detent = PlanListDetent;

export function PlanList({
  cityName,
  pins,
  clusters,
  places,
  isBusinessViewer,
  ownBusinessId,
  centre,
  collapsed,
  detent,
  onDetentChange,
  footing,
  peekHeight,
  onPeekHeight,
  onSelectPin,
  onSelectVenue,
  onSelectBusiness,
  clock,
}: {
  cityName: string;
  /** The FILTERED pins — the same array the markers render, or the peek lies. */
  pins: CityPinRow[];
  /** clusterPins(pins), already in memory on the map screen. */
  clusters: PinCluster[];
  places: CityBusinessRow[];
  isBusinessViewer: boolean;
  ownBusinessId: string | null;
  /** The map's settled centre, so panning re-sorts rows by distance. */
  centre: { lat: number; lng: number } | null;
  /** Another sheet owns the bottom of the screen: yield to it. */
  collapsed: boolean;
  /**
   * CONTROLLED by the map screen, which needs to know when the list stands
   * past its peek: an expanded list buries whatever the message slot put
   * under it, so the slot and the heatmap-view gate both read this. While
   * `collapsed` is true the list folds to its peek whatever this says, and
   * comes back here when the covering sheet goes.
   */
  detent: PlanListDetent;
  onDetentChange: (next: PlanListDetent) => void;
  /**
   * The opaque base the map's dock stands on, measured from the SCREEN
   * bottom: the tab-bar clearance, the dock's measured height and the step
   * between them, or the bare clearance for an owner with no dock. The
   * sheet runs under it.
   */
  footing: number;
  /**
   * The peek strip's height, OWNED BY THE MAP SCREEN. Held there rather than
   * here for two reasons: the message strip anchors on the card's real top
   * edge, and this component remounts on every `mode` change, so local state
   * would re-seed to the constant and spring the card's top edge back into
   * place on every return from place mode at the accessibility sizes.
   */
  peekHeight: number;
  /** The header's measured height, back up to the owner of `peekHeight`. */
  onPeekHeight: (height: number) => void;
  onSelectPin: (pin: CityPinRow) => void;
  onSelectVenue: (clusterKey: string) => void;
  onSelectBusiness: (businessId: string) => void;
  /**
   * The browsed city's wall clock (cityClockNow). "Today" in the summary,
   * the section titles and the row labels is the CITY's today — the same
   * authority the markers and the filter chips read.
   */
  clock?: Date;
}) {
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  // Measured from the screen bottom, never into the city rail, and landing
  // every top edge where the old split layout put it. See bottom-stack.
  const heights: Record<Detent, number> = planListHeights({
    footing,
    peekHeight,
    windowHeight,
  });

  // The detent is React state on the MAP SCREEN, not a shared value here: the
  // rows render into the accessibility tree only while the list is open, so a
  // collapsed peek never offers VoiceOver (or a test driver) a hundred
  // off-screen targets — and the map screen needs the detent to know when the
  // expanded list is the thing covering the map. While another sheet owns the
  // bottom of the screen the list folds to its peek; it comes back to where
  // it was when that sheet goes.
  const effective: Detent = collapsed ? 'peek' : detent;
  const expanded = effective !== 'peek';
  const target = heights[effective];

  // How much of the sheet is up: the detent's height, sprung on every detent
  // change, plus the finger's own offset while a drag is live. Derived from
  // state rather than written from an effect, so the layout is never handed
  // to an entrance preset and content can grow mid-flight (see traps).
  const drag = useSharedValue(0);
  const sprung = useDerivedValue(() => withSpring(target, Springs.snap), [target]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(sprung.value + drag.value) }],
  }));

  const snapTo = (next: Detent) => {
    onDetentChange(next);
  };

  const pan = Gesture.Pan()
    .enabled(!collapsed)
    .onUpdate((event) => {
      // Dragging down shrinks what is shown; clamp to the detent range.
      drag.value = Math.min(
        heights.full - target,
        Math.max(heights.peek - target, -event.translationY)
      );
    })
    .onEnd(() => {
      // Snap to whichever detent is nearest where the finger left it.
      const at = target + drag.value;
      let best: Detent = 'peek';
      for (const candidate of ['half', 'full'] as Detent[]) {
        if (Math.abs(heights[candidate] - at) < Math.abs(heights[best] - at)) {
          best = candidate;
        }
      }
      // Both springs share a config, so their sum reads as one motion from
      // where the finger left off to the chosen detent.
      drag.value = withSpring(0, Springs.snap);
      runOnJS(onDetentChange)(best);
    });

  const cityDayISO = clock != null ? toISODate(clock) : null;
  const sections = useMemo(
    () => planSections(clusters, centre, clock ?? new Date()),
    // Day-level key: the clock object is new every render, the titles only
    // change when the city's calendar day does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clusters, centre, cityDayISO]
  );
  const businesses = useMemo(
    () => listableBusinesses(places, isBusinessViewer, ownBusinessId),
    [places, isBusinessViewer, ownBusinessId]
  );
  const summary = planListSummary(
    cityName,
    pins.length,
    todayCount(pins, new Date(), clock ?? null)
  );

  if (pins.length === 0 && businesses.length === 0) {
    return null;
  }

  // Where each section's rows start in the flat testID numbering, so a row's
  // id is stable however the sections split.
  const sectionStarts = sections.map((_, index) =>
    sections.slice(0, index).reduce((sum, section) => sum + section.rows.length, 0)
  );

  return (
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.sheet,
          Elevation.sheet,
          { height: heights.full, backgroundColor: theme.surface },
          animatedStyle,
        ]}>
        <GestureDetector gesture={pan}>
          <Pressable
            testID="plan-list-peek"
            accessibilityRole="button"
            accessibilityLabel={summary}
            accessibilityHint={
              collapsed ? undefined : expanded ? 'Collapses the list' : 'Opens the list of plans'
            }
            disabled={collapsed}
            onPress={() => snapTo(expanded ? 'peek' : 'half')}
            onLayout={(event) =>
              onPeekHeight(Math.max(PLAN_LIST_PEEK, Math.round(event.nativeEvent.layout.height)))
            }
            style={styles.header}>
            <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
            <View style={styles.summaryRow}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.summaryText}>
                {summary}
              </ThemedText>
              <SymbolView
                name={{ ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }}
                size={13}
                tintColor={theme.textSecondary}
              />
            </View>
          </Pressable>
        </GestureDetector>

        <ScrollView
          // The frame is clipped to the SCREEN BOTTOM rather than left
          // hanging below it. The sheet is a fixed heights.full box that
          // slides, so at any detent under full its lower (full - target)
          // points are off screen, and anything the content puts down there
          // cannot be scrolled into view at all — 234pt of it at the half
          // detent, before this. Plain layout, changed in the same commit as
          // the detent: never hand it to an entering or a layout preset,
          // which is what would freeze the frame (see traps).
          style={[styles.list, { marginBottom: heights.full - target }]}
          // ...and the last row clears the dock's plate, which is opaque and
          // painted over the bottom `footing` points of this frame.
          contentContainerStyle={[styles.listContent, { paddingBottom: footing + Space.lg }]}
          // At the peek the rows are clipped off screen; take them out of the
          // accessibility tree and the touch path too, or VoiceOver and any
          // test driver would be offered targets nobody can see.
          pointerEvents={expanded ? 'auto' : 'none'}
          accessibilityElementsHidden={!expanded}
          importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}>
          {sections.map((section, sectionIndex) => (
            <View key={section.title} style={styles.section}>
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                {section.title.toUpperCase()}
              </ThemedText>
              {section.rows.map((cluster, rowIndex) => (
                <PlanRow
                  key={cluster.key}
                  cluster={cluster}
                  index={sectionStarts[sectionIndex] + rowIndex}
                  clock={clock ?? new Date()}
                  onPress={() =>
                    cluster.pins.length === 1
                      ? onSelectPin(cluster.pins[0])
                      : onSelectVenue(cluster.key)
                  }
                />
              ))}
            </View>
          ))}

          {businesses.length > 0 ? (
            <View style={styles.section}>
              {/* The heading no longer claims tonight. The rows below now carry
                  the day a post is for, and a standing notice or a Friday quiz
                  night sitting under a heading that says tonight is a heading
                  telling a traveler something the row beneath it denies. */}
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
                WHAT&apos;S ON
              </ThemedText>
              {businesses.map((place, index) => (
                <Pressable
                  key={place.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${place.name}. ${whatsOnLine(place, clock ?? new Date())}`}
                  // By index: the venue's map chip carries the same name in
                  // its own label, and a suite driving this row by its words
                  // tapped the chip's coordinates instead, which sit under
                  // the tab bar (runs 106 and 120 both landed on Travelers).
                  testID={`whats-on-row-${index}`}
                  onPress={() => onSelectBusiness(place.id)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: theme.surfaceSunken },
                    pressed && styles.pressed,
                  ]}>
                  <PlaceGlyph category={place.category} live onSurface size={26} />
                  <View style={styles.rowText}>
                    <ThemedText type="callout" numberOfLines={1}>
                      {place.name}
                    </ThemedText>
                    <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                      {whatsOnLine(place, clock ?? new Date())}
                    </ThemedText>
                  </View>
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={14}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/**
 * One plan (or one venue's stack of plans) as a row. The SAME content for
 * every viewer: a guest's and a business's pin feed are identity-stripped
 * server-side (features/guest/hooks), so a row that led with a name would
 * degrade to nothing for two of the three account kinds. No name, no face,
 * for anyone — which is also the simplest thing to keep honest.
 */
function PlanRow({
  cluster,
  index,
  clock,
  onPress,
}: {
  cluster: PinCluster;
  index: number;
  /** The browsed city's clock; its today owns the word 'Today'. */
  clock: Date;
  onPress: () => void;
}) {
  const theme = useTheme();
  const single = cluster.pins.length === 1 ? cluster.pins[0] : null;
  const category = clusterCategory(cluster);
  const open = single != null && single.chat_id != null;

  const title = single ? (pinSubtitle(single) ?? pinTitle(single)) : clusterTitle(cluster);
  const details = single
    ? [
        pinSubtitle(single) ? pinTitle(single) : null,
        intentLabel(single.intent_date, clock),
        burnOutLabel(single.expires_at),
        open && single.crew > 0 ? `${single.crew} going` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : `${countOf(cluster.pins.length, 'plan')} · ${intentLabel(clusterIntentDate(cluster), clock)}`;

  return (
    <Pressable
      testID={`plan-list-row-${index}`}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${details}${open ? ', open to join' : ''}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surfaceSunken },
        pressed && styles.pressed,
      ]}>
      <PinGlyph
        category={category === 'mixed' ? 'other' : category}
        seeded={single?.seeded ?? false}
        size={26}
      />
      <View style={styles.rowText}>
        <ThemedText type="callout" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
          {details}
        </ThemedText>
      </View>
      {open ? (
        <ThemedText type="footnote" themeColor="accent">
          Open to join
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    // To the screen bottom. The sheet's own lower edge stops being a visible
    // edge, which is the strip of bare map this change exists to remove.
    // `overflow` is load-bearing: the sheet is a full-height box that lives
    // below this frame and slides up into it.
    bottom: 0,
    overflow: 'hidden',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderCurve: 'continuous',
  },
  // min, not fixed: the summary line scales with Dynamic Type, and the peek
  // detent follows the measured height rather than clipping it.
  header: {
    minHeight: PLAN_LIST_PEEK,
    paddingTop: Space.sm,
    paddingBottom: Space.sm,
    paddingHorizontal: Space.lg,
    gap: Space.sm,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  summaryText: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Space.lg,
    // paddingBottom is injected: it has to clear the dock's plate, whose
    // height is measured.
    gap: Space.lg,
  },
  section: {
    gap: Space.sm,
  },
  sectionTitle: {
    paddingTop: Space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.7,
  },
});
