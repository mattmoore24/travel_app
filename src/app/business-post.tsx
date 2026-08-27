import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, NativeAppearance, Radius, Space } from '@/constants/theme';
import { useOwnBusiness } from '@/features/business/hooks';
import { formatDate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const TITLE_MIN = 2;
const TITLE_MAX = 80;
const BODY_MAX = 600;

/** The database's caps, mirrored so the screen can say them out loud. */
const CAP_UNVERIFIED = 3;
const CAP_VERIFIED = 10;

/**
 * The three shapes a post can have, which is the founder's decision and the
 * reason there is no ceiling on any of them (docs/BUSINESS_ACCOUNTS.md §3.3).
 * Nothing is picked by default: "keep it up" has to be a choice somebody
 * makes rather than the one they land on by not choosing.
 */
type Shape = 'happens' | 'ends' | 'open';

const SHAPES: { value: Shape; title: string; detail: string }[] = [
  {
    value: 'happens',
    title: "It's happening on a date",
    detail: 'It clears itself the morning after.',
  },
  { value: 'ends', title: 'Take it down on', detail: 'It stays up through that whole day.' },
  {
    value: 'open',
    title: 'Keep it up until I take it down',
    detail: 'No end date. It sits on your page until you take it off.',
  },
];

async function fetchLivePosts(businessId: string) {
  const { data, error } = await supabase
    .from('business_posts')
    .select('id')
    .eq('business_id', businessId)
    .is('archived_at', null);
  if (error) {
    throw error;
  }
  return data ?? [];
}

async function createPost(input: {
  businessId: string;
  title: string;
  body: string | null;
  happensAt: string | null;
  endsAt: string | null;
}) {
  const { error } = await supabase.from('business_posts').insert({
    business_id: input.businessId,
    title: input.title,
    body: input.body,
    happens_at: input.happensAt,
    ends_at: input.endsAt,
  });
  if (error) {
    throw error;
  }
}

/** Tonight at eight, or tomorrow if tonight has already gone. */
function defaultHappensAt(): Date {
  const date = new Date();
  date.setHours(20, 0, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function defaultEndsAt(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
}

/**
 * "Take it down on Sunday" means Sunday is still a day it is up, so the row
 * expires at the end of that day rather than at midnight going into it.
 */
function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 0);
  return copy;
}

function ShapeRow({
  shape,
  selected,
  onPress,
  children,
}: {
  shape: (typeof SHAPES)[number];
  selected: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View>
      <PressableScale
        accessibilityRole="radio"
        accessibilityLabel={shape.title}
        accessibilityState={{ selected }}
        haptic="selection"
        scaleTo={0.98}
        onPress={onPress}>
        <ThemedView
          type={selected ? 'accentSoft' : 'backgroundElement'}
          // The border is always drawn and only ever changes colour, so
          // picking a row cannot shove the fine print below it.
          style={[styles.shapeRow, { borderColor: selected ? theme.accent : 'transparent' }]}>
          <SymbolView
            name={
              selected
                ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                : {
                    ios: 'circle',
                    android: 'radio_button_unchecked',
                    web: 'radio_button_unchecked',
                  }
            }
            size={20}
            tintColor={selected ? theme.accent : theme.textSecondary}
          />
          <View style={styles.shapeText}>
            <ThemedText>{shape.title}</ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {shape.detail}
            </ThemedText>
          </View>
        </ThemedView>
      </PressableScale>
      {selected && children ? (
        <Animated.View entering={FadeIn.duration(200)} style={styles.shapeExtra}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

export default function BusinessPostScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: business } = useOwnBusiness();
  const businessId = business?.id ?? null;

  const livePosts = useQuery({
    queryKey: ['business-posts', businessId],
    queryFn: () => fetchLivePosts(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [shape, setShape] = useState<Shape | null>(null);
  const [happensAt, setHappensAt] = useState(defaultHappensAt);
  const [endsAt, setEndsAt] = useState(defaultEndsAt);
  const [pickingDate, setPickingDate] = useState(false);

  const post = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-posts', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      // A live post earns the place a brighter ring on the map.
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
    },
  });

  const cap = business?.verified ? CAP_VERIFIED : CAP_UNVERIFIED;
  const live = livePosts.data?.length ?? 0;
  const atCap = livePosts.data != null && live >= cap;

  const trimmedTitle = title.trim();
  const titleError =
    trimmedTitle.length > 0 && trimmedTitle.length < TITLE_MIN
      ? 'Give it a couple of words at least.'
      : trimmedTitle.length > TITLE_MAX
        ? `That is ${trimmedTitle.length - TITLE_MAX} characters too long.`
        : null;
  const bodyError =
    body.length > BODY_MAX ? `That is ${body.length - BODY_MAX} characters too long.` : null;
  const ready =
    trimmedTitle.length >= TITLE_MIN && titleError == null && bodyError == null && shape != null;

  const note = atCap
    ? 'You have as many posts up as you can have at once. Take one down to put another up.'
    : (titleError ??
      bodyError ??
      (trimmedTitle.length < TITLE_MIN
        ? 'Give it a title.'
        : shape == null
          ? 'Say how long it stays up.'
          : null));

  const submit = async () => {
    if (!ready || businessId == null) {
      return;
    }
    try {
      await post.mutateAsync({
        businessId,
        title: trimmedTitle,
        body: body.trim() || null,
        happensAt: shape === 'happens' ? happensAt.toISOString() : null,
        endsAt: shape === 'ends' ? endOfDay(endsAt).toISOString() : null,
      });
      haptics.success();
      analytics.capture('business_post_created', { shape });
      router.back();
    } catch {
      // Surfaced by the global mutation error alert, which is where the
      // database's own "you have as many posts up as you can have at once"
      // comes through when this screen's count is a few seconds behind.
    }
  };

  return (
    <StepScreen
      title="Post something"
      subtitle="It shows on your page and in your chat."
      continueLabel="Put it up"
      // Disabled at the cap because a button that fires a refusal we already
      // know about is a button that lies. The database still has the last
      // word: another device can fill the last slot while this is open, and
      // that refusal arrives as an alert rather than a surprise.
      continueDisabled={!ready || atCap}
      continueLoading={post.isPending}
      note={note}
      onContinue={submit}
      onClose={() => router.back()}>
      <FormTextField
        label="Title"
        placeholder="Live music, no cover"
        value={title}
        onChangeText={setTitle}
        error={titleError}
        maxLength={TITLE_MAX + 20}
      />
      <FormTextField
        label="Details"
        placeholder="Two bands, doors at nine. Come early if you want a seat."
        multiline
        numberOfLines={4}
        style={styles.multiline}
        value={body}
        onChangeText={setBody}
        error={bodyError}
        hint={
          body.length > BODY_MAX - 100 ? `${BODY_MAX - body.length} characters left` : 'Optional.'
        }
        {...keyboardDoneProps}
      />

      <ThemedText type="smallBold">How long it stays up</ThemedText>
      {SHAPES.map((option) => (
        <ShapeRow
          key={option.value}
          shape={option}
          selected={shape === option.value}
          onPress={() => setShape(option.value)}>
          {option.value === 'happens' ? (
            <DateTimeField
              label="When"
              value={happensAt}
              mode="datetime"
              accessibilityLabel="The day and time it happens"
              picking={pickingDate}
              onOpen={() => setPickingDate(true)}
              onClose={() => setPickingDate(false)}
              onChange={setHappensAt}
            />
          ) : option.value === 'ends' ? (
            <DateTimeField
              label="Last day up"
              value={endsAt}
              mode="date"
              accessibilityLabel="The last day it stays up"
              picking={pickingDate}
              onOpen={() => setPickingDate(true)}
              onClose={() => setPickingDate(false)}
              onChange={setEndsAt}
            />
          ) : null}
        </ShapeRow>
      ))}

      {/* Said before they write, not after the database refuses. */}
      <View style={[styles.count, { backgroundColor: theme.surfaceSunken }]}>
        <ThemedText type="footnote">
          {livePosts.data == null
            ? 'Checking what you have up.'
            : live === 0
              ? `Nothing up right now. You can have ${cap} at once.`
              : `${live} of ${cap} up right now.`}
        </ThemedText>
        {business != null && !business.verified ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            Get the check on your place and you can keep ten up at once.
          </ThemedText>
        ) : null}
      </View>
    </StepScreen>
  );
}

/**
 * A day, or a day and a time.
 *
 * `themeVariant` is not optional: the native picker chooses its own colours
 * and drew near-black text on this near-black ground the one time it was left
 * off. Off iOS there is no compact style and no 'datetime' mode at all, so
 * the value becomes a button that opens the platform's own dialog, and a
 * datetime falls back to the day, which is the half that decides expiry.
 */
function DateTimeField({
  label,
  value,
  mode,
  accessibilityLabel,
  picking,
  onOpen,
  onClose,
  onChange,
}: {
  label: string;
  value: Date;
  mode: 'date' | 'datetime';
  accessibilityLabel: string;
  picking: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (date: Date) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.dateField}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {label}
      </ThemedText>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={value}
          mode={mode}
          display="compact"
          minimumDate={new Date()}
          minuteInterval={5}
          themeVariant={NativeAppearance}
          accessibilityLabel={accessibilityLabel}
          onChange={(_, date) => {
            if (date) {
              onChange(date);
            }
          }}
        />
      ) : (
        <>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{ text: formatDate(toISO(value)) }}
            haptic="selection"
            scaleTo={0.97}
            onPress={onOpen}
            style={[styles.dateButton, { backgroundColor: theme.surface }]}>
            <ThemedText>{formatDate(toISO(value))}</ThemedText>
          </PressableScale>
          {picking ? (
            <DateTimePicker
              value={value}
              mode="date"
              minimumDate={new Date()}
              onChange={(_, date) => {
                onClose();
                if (date) {
                  onChange(date);
                }
              }}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

/** Local calendar day, never UTC: a timestamp shifts the day either side of
 * midnight and this label is the whole promise the row makes. */
function toISO(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const styles = StyleSheet.create({
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  shapeRow: {
    minHeight: HitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  shapeText: {
    flex: 1,
    gap: 2,
  },
  shapeExtra: {
    paddingTop: Space.sm,
    paddingLeft: Space.lg,
  },
  dateField: {
    gap: Space.xs,
    alignItems: 'flex-start',
  },
  dateButton: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
  },
  count: {
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
});
