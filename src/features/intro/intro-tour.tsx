import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Motion, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

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
    body: "Add your trip and you'll see travelers who are in town when you are. No swiping, no games.",
  },
  {
    icon: { ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' },
    title: 'Say hi, then make plans',
    body: "Send someone a first message. If they're into it, a chat opens up. Your hostel probably has a group chat too.",
  },
];

/**
 * First launch only. Explains the three tabs, then offers the account or the
 * door. Rendered as an overlay above the tabs so a guest can see the real app
 * behind it the second they dismiss (docs/DESIGN.md, guest-first).
 */
export function IntroTour({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const last = page === PAGES.length;
  // One extra page: the three explainers, then the join-or-browse choice.
  const total = PAGES.length + 1;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== page) {
      haptics.selection();
      setPage(next);
    }
  };

  return (
    <Animated.View
      entering={FadeIn.duration(Motion.standard)}
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.canvas }]}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.skipRow}>
          {!last ? (
            <Pressable hitSlop={12} onPress={onDone} accessibilityRole="button">
              <ThemedText type="callout" themeColor="textSecondary">
                Skip
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.pager}>
          {PAGES.map((item) => (
            <View key={item.title} style={[styles.page, { width }]}>
              <View style={[styles.iconBadge, { backgroundColor: theme.accentSoft }]}>
                <SymbolView name={item.icon} size={44} tintColor={theme.accent} />
              </View>
              <ThemedText type="title" style={styles.center}>
                {item.title}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.center}>
                {item.body}
              </ThemedText>
            </View>
          ))}

          {/* The choice, phrased so browsing sounds like a real option. */}
          <View style={[styles.page, { width }]}>
            <View style={styles.markWrap}>
              <Image
                source={require('@/assets/images/logo-glow.png')}
                style={styles.glow}
                contentFit="contain"
              />
              <View style={styles.markBadge}>
                <Image
                  source={require('@/assets/images/splash-icon.png')}
                  style={styles.mark}
                  contentFit="contain"
                />
              </View>
            </View>
            <ThemedText type="title" style={styles.center}>
              Ready when you are
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              Have a look around first if you want. You&apos;ll need a profile to message people or
              drop a pin, and it only takes a minute.
            </ThemedText>
          </View>
        </ScrollView>

        <View style={styles.dots}>
          {Array.from({ length: total }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === page ? theme.accent : theme.hairline,
                  width: i === page ? 20 : 7,
                },
              ]}
            />
          ))}
        </View>

        <View style={styles.actions}>
          {last ? (
            <>
              <PrimaryButton
                label="Make my profile"
                onPress={() => {
                  onDone();
                  router.push('/email');
                }}
              />
              <PrimaryButton variant="ghost" label="Just looking for now" onPress={onDone} />
            </>
          ) : (
            <ThemedView style={styles.hint}>
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.center}>
                Swipe to keep going
              </ThemedText>
            </ThemedView>
          )}
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 900,
  },
  safe: {
    flex: 1,
  },
  skipRow: {
    height: 32,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.lg,
    paddingHorizontal: Space.xl,
  },
  center: {
    textAlign: 'center',
  },
  iconBadge: {
    width: 104,
    height: 104,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 200,
    height: 200,
  },
  markBadge: {
    width: 104,
    height: 104,
    borderRadius: Radius.xl,
    backgroundColor: '#2A4C9B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: 88,
    height: 88,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Space.xs,
    paddingVertical: Space.lg,
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },
  actions: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
    gap: Space.sm,
    minHeight: 120,
    justifyContent: 'flex-end',
  },
  hint: {
    paddingBottom: Space.xl,
    backgroundColor: 'transparent',
  },
});
