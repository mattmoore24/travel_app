import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChipRow } from '@/components/form/chip-row';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, MaxContentWidth, Motion, Radius, Space } from '@/constants/theme';
import { useBusinessDetail, useMyRatings, useRateBusiness } from '@/features/business/hooks';
import {
  answerComparison,
  BUCKET_LABEL,
  BUCKET_ORDER,
  comparisonRank,
  comparisonsDone,
  MAX_TAGS,
  startComparison,
  TAG_LABEL,
  TAG_ORDER,
} from '@/features/business/vocabulary';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessCategory, RatingBucket, RatingTag } from '@/lib/database.types';

const TAG_OPTIONS = TAG_ORDER.map((tag) => ({ value: tag, label: TAG_LABEL[tag] }));

/**
 * Rating a place, the way Beli does it (docs/BUSINESS_ACCOUNTS.md §3.10).
 *
 * The design constraint is ten seconds and nobody typing, and that is also
 * the safety argument: the extortion lever in a review system is the TEXT, so
 * there is none anywhere in here. Three buckets, three or four head-to-head
 * calls, a number. The binary search itself lives in features/business/
 * vocabulary; this file is the hands and the words.
 *
 * Deliberately not built on StepScreen. That scaffold docks one primary
 * button for a form to submit, and two of these three steps have nothing to
 * submit: tapping a bucket IS the answer. Making somebody tap a card and then
 * a Continue doubles the taps in the one flow whose whole point is being over
 * before you have thought about it.
 */
export default function RatePlaceScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string; category?: BusinessCategory }>();
  const placeId = params.id ?? null;

  // The place page hands over the name and category, which is every field
  // this screen needs. Anything else that can open a rating knows only an id,
  // and a missing category leaves useMyRatings disabled forever, stranding
  // somebody on the first question with no way forward. So ask for the detail
  // only when something is actually missing.
  const wantDetail = params.name == null || params.category == null;
  const detail = useBusinessDetail(wantDetail ? placeId : null);
  const name = params.name ?? detail.data?.name ?? '';
  const category = params.category ?? detail.data?.category ?? null;

  const ratings = useMyRatings(category);
  // A failed fetch is not a reason to stall. An empty list means the bucket
  // alone sets the score, which is exactly what a first rating does anyway.
  const listSettled = ratings.isSuccess || ratings.isError;
  // Re-rating a place already in the list would otherwise put it up against
  // itself, and "which did you prefer, this or this" has no answer.
  const mine = useMemo(
    () => (ratings.data ?? []).filter((row) => row.business_id !== placeId),
    [ratings.data, placeId]
  );

  const rate = useRateBusiness();
  const [bucket, setBucket] = useState<RatingBucket | null>(null);
  /** One entry per head-to-head answered: true means the new place won. */
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [stopped, setStopped] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [tags, setTags] = useState<RatingTag[]>([]);

  // The window is REPLAYED from the answers rather than stored beside them.
  // Storing it meant advancing the search inside an effect, because on a cold
  // open the list is still in flight when the first tap lands - and a handler
  // reading an empty list would skip the comparisons and score the place off
  // its bucket alone. Replaying costs four function calls and makes the whole
  // search a pure function of what the person has actually answered.
  const comparison = useMemo(() => {
    if (bucket == null || !listSettled) {
      return null;
    }
    return answers.reduce(
      (current, preferredNew) => answerComparison(current, bucket, mine, preferredNew),
      startComparison(bucket, mine)
    );
  }, [answers, bucket, listSettled, mine]);

  const rank = comparison ? comparisonRank(comparison) : null;
  const placed = comparison != null && (stopped || comparisonsDone(comparison, answers.length));

  // The one place this screen talks to the server about the rating itself.
  // The score is the server's to derive, so it cannot be shown until the row
  // is written - which also means somebody who swipes the modal away the
  // moment they see their number still keeps the rating.
  const writing = useRef(false);
  useEffect(() => {
    if (!placed || rank == null || score != null || writing.current) {
      return;
    }
    if (bucket == null || placeId == null) {
      return;
    }
    writing.current = true;
    rate
      .mutateAsync({ businessId: placeId, bucket, rank })
      .then((saved) => setScore(saved.score))
      .catch(() => {
        // The mutation cache owns the sentence. What is left to decide here is
        // state, and the honest reset is back to the first question: the
        // position we worked out describes a row that does not exist, and
        // answering the cards again costs ten seconds.
        writing.current = false;
        setBucket(null);
        setAnswers([]);
        setStopped(false);
      });
  }, [placed, bucket, placeId, rank, rate, score]);

  const toggleTag = (tag: RatingTag) => {
    setTags((current) =>
      current.includes(tag)
        ? current.filter((one) => one !== tag)
        : current.length < MAX_TAGS
          ? [...current, tag]
          : current
    );
  };

  const finish = async () => {
    // The rating is already saved - the number on screen came back from the
    // write that made it. Tags are a second pass over the same row, which the
    // upsert makes free, so picking none costs nothing.
    if (tags.length > 0 && bucket != null && rank != null && placeId != null) {
      try {
        await rate.mutateAsync({ businessId: placeId, bucket, rank, tags });
      } catch {
        return;
      }
    }
    router.back();
  };

  const stage =
    score != null
      ? 'score'
      : placed
        ? 'saving'
        : comparison?.against != null
          ? 'compare'
          : 'bucket';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <View style={styles.header}>
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            numberOfLines={1}
            style={styles.headerName}>
            {name}
          </ThemedText>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Close"
            haptic="light"
            scaleTo={0.9}
            hitSlop={6}
            onPress={() => router.back()}
            style={styles.close}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={16}
              tintColor={theme.textSecondary}
            />
          </PressableScale>
        </View>

        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          {/* Keyed on the stage so each question arrives as its own scene.
              Opacity is driven by the layout animation and nothing else. */}
          <Animated.View
            key={stage}
            entering={FadeIn.duration(Motion.standard)}
            exiting={FadeOut.duration(Motion.quick)}
            style={styles.scene}>
            {stage === 'bucket' ? (
              <>
                <ThemedText type="title" accessibilityRole="header">
                  How was it?
                </ThemedText>
                <ThemedText themeColor="textSecondary">Go with your gut.</ThemedText>
                <View style={styles.stack}>
                  {BUCKET_ORDER.map((option) => {
                    const picked = bucket === option;
                    return (
                      <PressableScale
                        key={option}
                        accessibilityRole="button"
                        accessibilityLabel={BUCKET_LABEL[option]}
                        accessibilityState={{ selected: picked }}
                        haptic="soft"
                        scaleTo={0.98}
                        onPress={() => setBucket(option)}
                        style={[
                          styles.card,
                          {
                            backgroundColor: picked ? theme.accentSoft : theme.surface,
                            borderColor: picked ? theme.accent : 'transparent',
                          },
                        ]}>
                        <ThemedText type="headline" style={styles.grow}>
                          {BUCKET_LABEL[option]}
                        </ThemedText>
                        <SymbolView
                          name={{
                            ios: 'chevron.right',
                            android: 'chevron_right',
                            web: 'chevron_right',
                          }}
                          size={14}
                          tintColor={picked ? theme.accent : theme.textTertiary}
                        />
                      </PressableScale>
                    );
                  })}
                </View>
                {/* Only ever seen on a cold open, while the list you are being
                    compared against is still on its way. */}
                {bucket != null ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Just a sec.
                  </ThemedText>
                ) : null}
              </>
            ) : null}

            {stage === 'compare' && comparison?.against != null ? (
              <>
                <ThemedText type="title" accessibilityRole="header">
                  Which did you prefer?
                </ThemedText>
                <ThemedText themeColor="textSecondary">
                  Whichever one you&apos;d go back to first.
                </ThemedText>
                <View style={styles.stack}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Preferred ${name}`}
                    haptic="soft"
                    scaleTo={0.98}
                    onPress={() => setAnswers((current) => [...current, true])}
                    style={[styles.choice, { backgroundColor: theme.surface }]}>
                    <ThemedText type="headline" style={styles.centered}>
                      {name}
                    </ThemedText>
                  </PressableScale>
                  <ThemedText
                    type="footnote"
                    themeColor="textSecondary"
                    style={styles.centered}
                    accessibilityElementsHidden
                    importantForAccessibility="no">
                    or
                  </ThemedText>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Preferred ${comparison.against.name}`}
                    haptic="soft"
                    scaleTo={0.98}
                    onPress={() => setAnswers((current) => [...current, false])}
                    style={[styles.choice, { backgroundColor: theme.surface }]}>
                    <ThemedText type="headline" style={styles.centered}>
                      {comparison.against.name}
                    </ThemedText>
                  </PressableScale>
                </View>
              </>
            ) : null}

            {stage === 'saving' ? (
              <View style={styles.waiting}>
                <ActivityIndicator color={theme.accent} />
                <ThemedText type="footnote" themeColor="textSecondary">
                  Finding its spot.
                </ThemedText>
              </View>
            ) : null}

            {stage === 'score' && score != null ? (
              <>
                <ThemedText type="title" accessibilityRole="header">
                  That&apos;s where it lands.
                </ThemedText>
                <View style={[styles.scoreCard, { backgroundColor: theme.surface }]}>
                  <ThemedText type="display" style={{ color: theme.accent }}>
                    {score.toFixed(1)}
                  </ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    in your list
                  </ThemedText>
                </View>
                <View style={styles.tags}>
                  <ThemedText type="callout">Tag it, if you like</ThemedText>
                  <ChipRow options={TAG_OPTIONS} selected={tags} onToggle={toggleTag} />
                  {/* The cap is said before anybody hits it: a fourth chip
                      that quietly does nothing reads as a broken chip. */}
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {tags.length >= MAX_TAGS
                      ? "That's three. Tap one off to swap it."
                      : 'Up to three, or none at all.'}
                  </ThemedText>
                </View>
              </>
            ) : null}
          </Animated.View>
        </ScrollView>

        {/* Docked, never inside the scroller: an action a person has to scroll
            to find is an action half of them never reach. */}
        {stage === 'compare' || stage === 'score' ? (
          <ThemedView style={styles.footer}>
            {stage === 'score' ? (
              <PrimaryButton label="Done" loading={rate.isPending} onPress={finish} />
            ) : (
              // Without this the only way out of a run of head-to-heads is
              // Close, which throws away the bucket already picked.
              <PrimaryButton
                variant="ghost"
                label="That's close enough"
                onPress={() => setStopped(true)}
              />
            )}
          </ThemedView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: Space.xl,
    paddingRight: Space.md,
    paddingTop: Space.md,
  },
  headerName: {
    flex: 1,
  },
  close: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: Space.xl,
    paddingTop: Space.md,
  },
  scene: {
    gap: Space.md,
  },
  stack: {
    gap: Space.md,
    paddingTop: Space.sm,
  },
  card: {
    minHeight: 72,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  grow: {
    flex: 1,
  },
  choice: {
    minHeight: 88,
    borderRadius: Radius.lg,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  waiting: {
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xxxl,
  },
  scoreCard: {
    borderRadius: Radius.lg,
    paddingVertical: Space.xl,
    paddingHorizontal: Space.lg,
    alignItems: 'center',
    gap: Space.xs,
  },
  tags: {
    gap: Space.md,
    paddingTop: Space.sm,
  },
  footer: {
    padding: Space.xl,
    paddingTop: Space.sm,
  },
});
