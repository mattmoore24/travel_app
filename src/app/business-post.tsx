import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, NativeAppearance, Radius, Space } from '@/constants/theme';
import {
  discardPostPhoto,
  fetchOwnBusinessPost,
  updateBusinessPost,
  uploadPostPhoto,
} from '@/features/business/api';
import { useOwnBusiness } from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useOwnUserId } from '@/features/profile/hooks';
import { formatDate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { ModerationStatus } from '@/lib/database.types';
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
  {
    value: 'ends',
    title: 'Keep it up until a date',
    detail: 'It stays up through that whole day.',
  },
  {
    value: 'open',
    title: 'Keep it up until I take it down',
    detail: 'No end date. It sits on your page until you take it off.',
  },
];

/** Which of the three shapes a stored row has, read back off its two dates. */
export function shapeOfPost(row: { happens_at: string | null; ends_at: string | null }): Shape {
  if (row.happens_at != null) {
    return 'happens';
  }
  if (row.ends_at != null) {
    return 'ends';
  }
  return 'open';
}

/**
 * The shape this business picked last time, remembered per listing.
 *
 * The founder was asked whether the composer should DEFAULT to a dated event
 * at eight tonight and said no: the comment above SHAPES records the reason
 * in as many words, and a default is the app choosing on somebody's behalf.
 * Remembering is a different thing. A bar that has posted "it's happening on
 * a date" four times running is not being told what it wants; it is being
 * handed back its own last answer, which it made itself, and which it can
 * change with one tap. A business that has never posted still gets nothing
 * preselected, which is the case the founder was protecting.
 *
 * Per listing rather than per device: two accounts on one phone do not
 * inherit each other's habits.
 */
export const LAST_SHAPE_KEY = 'samewhere.business.post.shape.v1';

export function lastShapeKey(businessId: string | null): string {
  return `${LAST_SHAPE_KEY}.${businessId ?? 'none'}`;
}

/** A stored value only counts if it is still one of the three shapes. */
export function parseShape(value: string | null): Shape | null {
  return SHAPES.some((option) => option.value === value) ? (value as Shape) : null;
}

/**
 * How many posts are up, not counting the one being edited.
 *
 * Without the exclusion, opening your third live post to fix a typo told you
 * you were at the cap and disabled the button that saves it. The database
 * never thought so: `screen_business_post` counts an INSERT, and an UPDATE
 * only when it un-archives (20260827110000), so an edit was always free.
 */
export function liveCountExcluding(
  rows: { id: string }[] | undefined,
  editingId: string | null
): number {
  return (rows ?? []).filter((row) => row.id !== editingId).length;
}

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
  photoPath: string | null;
  happensAt: string | null;
  endsAt: string | null;
}) {
  const { error } = await supabase.from('business_posts').insert({
    business_id: input.businessId,
    title: input.title,
    body: input.body,
    photo_path: input.photoPath,
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
  // The uploader keys objects by the caller's uid, because the storage write
  // policy checks the first path segment against auth.uid().
  const userId = useOwnUserId();
  /**
   * Three screens in one route, told apart by two params.
   *
   * Nothing        a new post.
   * postId         that post, opened to be fixed. Saves over the same row.
   * postId + again that post's words on a NEW row, with a date somebody has
   *                to look at. This is how a weekly quiz night goes back up,
   *                and it goes through the composer rather than flipping
   *                archived_at, because un-archiving by hand would put last
   *                week's date back on the map.
   */
  const params = useLocalSearchParams<{ postId?: string; again?: string }>();
  const postId = params.postId?.trim() || null;
  // `again` only means anything with a post to copy: a stray param on its own
  // must not leave a blank form headed "Put this up again".
  const again = postId != null && params.again === '1';
  const editing = postId != null && !again;

  const livePosts = useQuery({
    queryKey: ['business-posts', businessId],
    queryFn: () => fetchLivePosts(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });

  // A straight table read under business_posts_select_own, which is the
  // policy that also covers archived rows - the one "post this again" needs.
  const seed = useQuery({
    queryKey: ['business-post', postId],
    queryFn: () => fetchOwnBusinessPost(postId!),
    enabled: isSupabaseConfigured && postId != null,
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  /**
   * The verdict on the photo that came WITH the row, and null for one just
   * picked here.
   *
   * Null is not "approved": a photo this composer has only uploaded has no row
   * yet, so nothing has judged it, and the chip must say nothing rather than
   * guess. What it will be is said in the footnote below the frame instead,
   * which is true before the post exists.
   */
  const [photoStatus, setPhotoStatus] = useState<ModerationStatus | null>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  const [happensAt, setHappensAt] = useState(defaultHappensAt);
  const [endsAt, setEndsAt] = useState(defaultEndsAt);
  const [pickingDate, setPickingDate] = useState(false);
  // The clock, read once when the screen opened. Seeding happens during
  // render (below) and `Date.now()` there is impure: two renders could
  // disagree about whether a date has passed, and react-hooks/purity refuses
  // it outright. One reading is also the more honest question, because it is
  // the one the person in front of the form is answering.
  const [openedAt] = useState(() => Date.now());

  // Fill the form from the row the moment it lands, DURING render (the
  // sanctioned adjust-state-in-render pattern) rather than from an effect, so
  // the fields never paint empty for a frame and then fill themselves in.
  // Keyed on the row's own id, so it happens once and typing survives every
  // refetch after it.
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  if (seed.data != null && seededFrom !== seed.data.id) {
    setSeededFrom(seed.data.id);
    setTitle(seed.data.title);
    setBody(seed.data.body ?? '');
    // The photo comes across for a repeat as well as for an edit, unlike the
    // dates: a quiz night's picture is still the picture of that quiz night,
    // and the reason the dates are dropped is that they have been and gone.
    // Two rows naming one object is fine — every read resolves through a row,
    // so the archived original simply stops being readable when it is
    // archived, and the new row keeps the object alive on its own terms.
    setPhotoPath(seed.data.photo_path);
    setPhotoStatus(seed.data.photo_path != null ? seed.data.photo_status : null);
    setShape(shapeOfPost(seed.data));
    // The dates are seeded only when they are still ahead of us, and never
    // for a repeat. A picker whose value sits below its own minimumDate is a
    // control that argues with itself, and "post this again" exists precisely
    // because the old date has been and gone.
    const was = seed.data.happens_at ? new Date(seed.data.happens_at) : null;
    if (!again && was != null && was.getTime() > openedAt) {
      setHappensAt(was);
    }
    const until = seed.data.ends_at ? new Date(seed.data.ends_at) : null;
    if (!again && until != null && until.getTime() > openedAt) {
      setEndsAt(until);
    }
  }

  // The last shape this listing used, for a NEW post only: a post being
  // opened has a shape of its own and memory must not argue with it. The
  // updater form never overwrites a choice made while storage was reading.
  useEffect(() => {
    if (businessId == null || postId != null) {
      return;
    }
    let live = true;
    AsyncStorage.getItem(lastShapeKey(businessId))
      .then((value) => {
        const remembered = parseShape(value);
        if (live && remembered != null) {
          setShape((current) => current ?? remembered);
        }
      })
      .catch(() => {
        // No memory is the first-post case, which is a form with nothing
        // preselected. That is the founder's answer, not a failure.
      });
    return () => {
      live = false;
    };
  }, [businessId, postId]);

  const post = useMutation({
    mutationFn: (input: {
      title: string;
      body: string | null;
      photoPath: string | null;
      happensAt: string | null;
      endsAt: string | null;
    }) =>
      editing && postId != null
        ? updateBusinessPost({ postId, ...input })
        : createPost({ businessId: businessId!, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-posts', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      // A live post earns the place a brighter ring on the map.
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
      if (postId != null) {
        queryClient.invalidateQueries({ queryKey: ['business-post', postId] });
      }
    },
  });

  /**
   * Objects this composer has put in the bucket that no row names yet.
   *
   * Only these are deleted when the photo is replaced or taken off. A path
   * that came from the database is left alone: another row may name it (a
   * repeat carries the original's picture across), and an object nothing names
   * is already invisible, because every read resolves through a post row.
   */
  const strays = useRef<string[]>([]);
  const dropStray = (path: string | null) => {
    if (path == null || !strays.current.includes(path)) {
      return;
    }
    strays.current = strays.current.filter((one) => one !== path);
    void discardPostPhoto(path);
  };

  const photoUpload = useMutation({
    mutationFn: (localUri: string) => uploadPostPhoto(userId!, localUri),
  });

  // A synchronous latch, for the reason the photo grid records beside its own:
  // two taps in one frame must not both open a picker, and state read in the
  // same frame would answer false to both.
  const picking = useRef(false);

  const pickPhoto = async () => {
    if (userId == null || picking.current) {
      return;
    }
    picking.current = true;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        // `aspect` is Android-only and the iOS editor is always square. The
        // frame below is 3:2, which is the shape the place page draws, so what
        // is cropped here is shown with the same trim either side.
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      });
      if (picked.canceled || picked.assets.length === 0) {
        return;
      }
      const previous = photoPath;
      const path = await photoUpload.mutateAsync(picked.assets[0].uri);
      strays.current = [...strays.current, path];
      setPhotoPath(path);
      setPhotoStatus(null);
      dropStray(previous);
      haptics.success();
    } catch {
      // Surfaced by the global mutation error alert, which is where "that one
      // is a bit small to fill the frame" comes through.
    } finally {
      picking.current = false;
    }
  };

  const removePhoto = () => {
    const previous = photoPath;
    setPhotoPath(null);
    setPhotoStatus(null);
    dropStray(previous);
    haptics.light();
  };

  const cap = business?.verified ? CAP_VERIFIED : CAP_UNVERIFIED;
  const live = liveCountExcluding(livePosts.data, editing ? postId : null);
  // An edit puts nothing new up, so no cap sentence, no disabled button and
  // no counter: every one of them is about adding, and this is not adding.
  const atCap = !editing && livePosts.data != null && live >= cap;
  // More up than the cap allows, which is not a broken count: renaming a
  // verified business clears the check (business_rename_resets), so the cap
  // drops from ten to three with ten posts already live. The counter read
  // "10 of 3 up right now", which is the app telling an owner a number that
  // cannot be true. Nothing goes down on its own, so this holds until they
  // take some off.
  const overCap = livePosts.data != null && live > cap;
  // The row is gone: taken down and cleaned up, or opened from a stale list.
  // Saying so beats a blank form headed "Edit your post".
  const missing = postId != null && !seed.isPending && seed.data == null;
  // Whether anybody but the owner can see a new post. A listing waiting on
  // its email code, or one moderation has taken down, is dark: the subtitle
  // promised a marker lighting up on the map either way.
  const onTheMap = business != null && business.state === 'listed' && business.active;

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

  const note = missing
    ? "That post isn't there any more."
    : !editing && overCap
      ? `You have ${live} up and ${cap} is the most at once. Take some down on My business first.`
      : atCap
        ? `That's ${cap} up, which is the most at once. Tap one on My business to take it down.`
        : (titleError ??
          bodyError ??
          (trimmedTitle.length < TITLE_MIN
            ? 'Give it a title.'
            : shape == null
              ? 'Say how long it stays up.'
              : null));

  const submit = async () => {
    if (!ready || businessId == null || missing) {
      return;
    }
    try {
      await post.mutateAsync({
        title: trimmedTitle,
        body: body.trim() || null,
        photoPath,
        happensAt: shape === 'happens' ? happensAt.toISOString() : null,
        endsAt: shape === 'ends' ? endOfDay(endsAt).toISOString() : null,
      });
      // Saved: the object now belongs to a row, so it is nobody's stray.
      strays.current = [];
      haptics.success();
      analytics.capture(editing ? 'business_post_edited' : 'business_post_created', { shape });
      // Remembered only once it has actually been used, so a shape somebody
      // tapped and then thought better of is not what greets them next time.
      if (shape != null) {
        void AsyncStorage.setItem(lastShapeKey(businessId), shape).catch(() => {});
      }
      router.back();
    } catch {
      // Surfaced by the global mutation error alert, which is where the
      // database's own "you have as many posts up as you can have at once"
      // comes through when this screen's count is a few seconds behind.
    }
  };

  return (
    <StepScreen
      title={editing ? 'Edit your post' : again ? 'Put this up again' : 'Post something'}
      subtitle={
        onTheMap
          ? 'It shows on your page, and your marker lights up on the map.'
          : 'It goes on your page. Only you can see it while your listing is off the map.'
      }
      // "Save it" rather than "Put it up", because it is already up: the
      // button has to say what it does to the thing in front of you.
      continueLabel={editing ? 'Save it' : 'Put it up'}
      // Disabled at the cap because a button that fires a refusal we already
      // know about is a button that lies. The database still has the last
      // word: another device can fill the last slot while this is open, and
      // that refusal arrives as an alert rather than a surprise.
      continueDisabled={!ready || atCap || missing}
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
      />

      <PostPhotoField
        path={photoPath}
        status={photoStatus}
        busy={photoUpload.isPending}
        disabled={userId == null}
        onPick={() => void pickPhoto()}
        onRemove={removePhoto}
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

      {/* Said before they write, not after the database refuses. Not said at
          all while editing: the cap counts what is up, an edit changes what
          is already up, and a number about the wrong question is noise. */}
      {editing ? null : (
        <View style={[styles.count, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText type="footnote">
            {livePosts.data == null
              ? 'Checking what you have up.'
              : overCap
                ? `${live} up right now, which is over the ${cap} you can have at once.`
                : live === 0
                  ? `Nothing up right now. You can have ${cap} at once.`
                  : `${live} of ${cap} up right now.`}
          </ThemedText>
          {business != null && !business.verified ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              Get the check on your business and you can keep ten up at once.
            </ThemedText>
          ) : null}
        </View>
      )}
    </StepScreen>
  );
}

/**
 * The one picture a post can carry.
 *
 * `business_posts.photo_path` and the traveler page's PostCard have both been
 * ready since the table shipped; there was simply no way to write it, so
 * "Live music, no cover" could never show the band. Optional in the strongest
 * sense: nothing about `ready` mentions it, so a post is still one title away
 * from being up.
 *
 * The picture is CHECKED before a traveler sees it, and the footnote says so
 * before anybody spends a minute picking one. That check is a trigger on this
 * post's own row, not on the bucket: sharing `business-photos` with the photo
 * grid buys a post photo neither the moderation nor the readability, because
 * both resolve through the row a photo creates.
 *
 * One frame rather than the photo grid's tiles: a post has one photo, drawn at
 * the 3:2 the place page draws it at, so what is cropped here is what lands
 * there.
 */
function PostPhotoField({
  path,
  status,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  path: string | null;
  /** The stored verdict, or null for a photo picked in this session. */
  status: ModerationStatus | null;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  // Signed even while it is being checked: the storage policy lets an owner
  // read their own upload by the uid in its first path segment, so the person
  // who took the photo is never shown an empty frame.
  const { data: url } = useBusinessPhotoUrl(path);
  const rejected = status === 'rejected';
  const waiting = status === 'pending';

  return (
    <View style={styles.photoBlock}>
      <ThemedText type="smallBold">Photo</ThemedText>
      {path ? (
        <View style={[styles.photoFrame, { backgroundColor: theme.surfaceSunken }]}>
          {url ? <Image source={{ uri: url }} style={styles.photoFill} contentFit="cover" /> : null}
          {rejected || waiting ? (
            <View
              style={[
                styles.photoChip,
                { backgroundColor: rejected ? theme.danger : theme.surface },
              ]}>
              <ThemedText
                type="caption"
                style={rejected ? { color: theme.onHighlight } : undefined}>
                {rejected ? 'Removed' : 'In review'}
              </ThemedText>
            </View>
          ) : null}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Take the photo off this post"
            haptic="light"
            scaleTo={0.88}
            // 10 + 24 + 10 = 44. hitSlop is honoured by the Pressable itself,
            // so the frame's overflow: hidden cannot clip the target.
            hitSlop={10}
            onPress={onRemove}
            containerStyle={styles.photoRemoveAnchor}
            style={[styles.photoRemoveDot, { backgroundColor: theme.surface }]}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={11}
              tintColor={theme.text}
            />
          </PressableScale>
        </View>
      ) : (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add a photo to this post"
          haptic="soft"
          scaleTo={0.97}
          disabled={busy || disabled}
          onPress={onPick}
          containerStyle={styles.photoAddAnchor}
          style={[
            styles.photoFrame,
            styles.photoAdd,
            // Colour, never alpha: a faded control dims its label and its
            // ground in the same proportion and stops being readable.
            {
              backgroundColor: theme.surfaceSunken,
              borderColor: busy || disabled ? theme.hairline : theme.border,
            },
          ]}>
          {busy ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <SymbolView
              name={{ ios: 'photo', android: 'image', web: 'image' }}
              size={22}
              tintColor={theme.textSecondary}
            />
          )}
        </PressableScale>
      )}
      <ThemedText type="footnote" themeColor="textSecondary">
        {rejected
          ? "That one didn't pass the check. Pick another and it goes back in."
          : 'Optional. Photos are checked before travelers see them.'}
      </ThemedText>
    </View>
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
  photoBlock: {
    alignSelf: 'stretch',
    gap: Space.sm,
  },
  // The shape a business photo is drawn at everywhere a traveler meets one.
  photoFrame: {
    alignSelf: 'stretch',
    aspectRatio: 3 / 2,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddAnchor: {
    alignSelf: 'stretch',
  },
  photoAdd: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  photoFill: {
    width: '100%',
    height: '100%',
  },
  photoChip: {
    position: 'absolute',
    start: Space.sm,
    bottom: Space.sm,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    minHeight: 24,
    justifyContent: 'center',
  },
  photoRemoveAnchor: {
    position: 'absolute',
    end: Space.xs,
    top: Space.xs,
  },
  photoRemoveDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
});
