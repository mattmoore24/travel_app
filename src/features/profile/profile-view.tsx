import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Skeleton } from '@/components/ui/skeleton';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { PressableScale } from '@/components/ui/pressable-scale';
import { languageLabel } from '@/constants/languages';
import { MaxContentWidth, Motion, Radius, Space } from '@/constants/theme';
import { overlapSentence } from '@/features/matching/overlap';
import { usePhotoUrl } from '@/features/profile/hooks';
import { platformLabel, usesAt } from '@/features/profile/social-handles-editor';
import { SocialLogo } from '@/features/profile/social-logo';
import { formatDateRange } from '@/features/trips/dates';
import { TripEditor, type EditableTrip } from '@/features/trips/trip-editor';
import { TopRatedShelf } from '@/features/business/top-rated-shelf';
import { MAX_PRIORITIES } from '@/features/profile/priorities';
import { MAX_PROMPTS, promptLabel, promptLabelInline } from '@/features/profile/prompts';
import { useTheme } from '@/hooks/use-theme';
import { splitDemoMarker } from '@/lib/demo-marker';
import type {
  ProfilePriorityRow,
  ProfilePromptRow,
  ProfilePhotoRow,
  ProfileRow,
  SocialHandleRow,
} from '@/lib/database.types';

export type ProfileTrip = {
  id: string;
  cityId: number;
  cityLabel: string;
  startDate: string;
  endDate: string;
  /** Set when the viewer's own trip overlaps this one. */
  overlap?: { start: string; end: string } | null;
};

/**
 * Something on a profile you can answer, the way Hinge lets you reply to one
 * photo or one prompt rather than to the person in general. `key` is what the
 * request stores; the rest is what the composer shows you are replying to.
 */
export type RespondTarget = {
  key: string;
  label: string;
  photoPath?: string | null;
  quote?: string | null;
};

function Photo({ path, style }: { path: string; style?: object }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(path);
  return (
    <View style={[styles.photoFrame, { backgroundColor: theme.surfaceSunken }, style]}>
      {/* A photo that still arrives late crossfades into the frame instead
          of snapping into it. The frame is surfaceSunken underneath, so the
          snap read as a glitch on the one screen whose whole pitch is the
          face. */}
      {url ? (
        <Image
          source={{ uri: url }}
          style={styles.fill}
          contentFit="cover"
          transition={Motion.quick}
        />
      ) : null}
    </View>
  );
}

/** The affordance itself: a bubble you tap to answer one specific thing. */
function ReplyButton({
  label,
  text = 'About this',
  onPress,
  onPhoto = false,
}: {
  label: string;
  /**
   * The visible chip text. Not 'Reply' — a stranger who has said nothing is
   * not being replied to — and not 'Say hi' either: the primary on the same
   * card already reads 'Say hi', and two differently-scoped controls must
   * not carry identical text.
   */
  text?: string;
  onPress: () => void;
  /** Sitting on an image, where it needs its own ground to stay legible. */
  onPhoto?: boolean;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      haptic="light"
      scaleTo={0.9}
      // The inline chip is 26pt tall and the one on a photo is 40. Both keep
      // their drawing; both now take a 44pt press.
      hitSlop={onPhoto ? 2 : { top: 9, bottom: 9, left: 6, right: 6 }}
      onPress={onPress}
      containerStyle={onPhoto ? styles.replyAnchor : undefined}
      style={[
        onPhoto ? styles.replyOnPhoto : styles.replyInline,
        { backgroundColor: onPhoto ? theme.surface : theme.accentSoft },
      ]}>
      <SymbolView
        name={{ ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' }}
        size={onPhoto ? 17 : 13}
        tintColor={theme.accent}
      />
      {/* The word, on the photo too. Travelers offered three routes to the
          same composer and one of them was an unlabelled glyph floating on a
          photo, so a first-time reader could not tell whether the bubble did
          something different from the two controls that read "About this"
          and "Say hi". It did not. */}
      <ThemedText type="footnote" themeColor="accent">
        {text}
      </ThemedText>
    </PressableScale>
  );
}

/** What "say hi about this section" is called out loud, per section. */
const REPLY_LABELS: Record<string, string> = {
  // The chip prints "About this", so the spoken name starts with it: Voice
  // Control matches commands against the accessible name, and a visible
  // label missing from it strands "tap About this" (WCAG 2.5.3) — the same
  // rule the priorities chip follows with "I'm in".
  About: 'About this. Say hi about their bio.',
  Details: 'About this. Say hi about their details.',
  'Travel plans': 'About this. Say hi about their travel plans.',
};

function SectionHeader({
  title,
  icon,
  onEdit,
  onReply,
  replyText,
  replyLabel,
}: {
  title: string;
  icon: SymbolViewProps['name'];
  onEdit?: () => void;
  /** Visitors get this where the owner gets Edit; never both. */
  onReply?: () => void;
  /** Overrides the chip's visible text (default 'About this'). */
  replyText?: string;
  /** Overrides the spoken label. Must contain the visible text (WCAG 2.5.3). */
  replyLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <SymbolView name={icon} size={15} tintColor={theme.textSecondary} />
      {/* Title Case, not shouted. The craft pass retired all-caps
          everywhere else in the app; these headers were the last holdouts,
          and uppercase costs word-shape — the thing a reader scans by. */}
      <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
        {title}
      </ThemedText>
      {onEdit ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Edit ${title.toLowerCase()}`}
          haptic="light"
          scaleTo={0.9}
          hitSlop={{ top: 9, bottom: 9, left: 6, right: 6 }}
          onPress={onEdit}
          style={styles.editButton}>
          <ThemedText type="footnote" themeColor="accent">
            Edit
          </ThemedText>
        </PressableScale>
      ) : onReply ? (
        <ReplyButton
          // Not `Say hi about their ${title.toLowerCase()}`: that produced
          // "about their about", which is not a sentence. The section names
          // read as things in some cases and not others, so they are mapped.
          label={
            replyLabel ?? REPLY_LABELS[title] ?? `About this. Say hi about ${title.toLowerCase()}.`
          }
          text={replyText}
          onPress={onReply}
        />
      ) : null}
    </View>
  );
}

/**
 * Top priorities: up to six very short plans, as a wrapping row of chips.
 *
 * Every chip is a button, and that is the whole feature. On somebody else's
 * profile it opens the composer anchored to that plan, so the opening message
 * is "I'm in for this" rather than an introduction. On your own it opens the
 * editor at that row.
 *
 * Chips rather than a bulleted list: six bullets push About and the first
 * prompt below the fold on a small phone, and the point of the cap is that
 * the whole set reads at a glance. They wrap to a second line at large
 * Dynamic Type and never truncate, because half a plan is worse than none —
 * which is also why the text is capped at forty characters.
 *
 * Deliberately not numbered. Slots are insertion order, not preference
 * order, so printing 1..6 beside them would claim a ranking nobody made.
 */
function PrioritiesSection({
  priorities,
  owner,
  onEdit,
  onRespondTo,
}: {
  priorities: ProfilePriorityRow[];
  owner: boolean;
  onEdit?: (slot: number | null) => void;
  onRespondTo?: (target: RespondTarget) => void;
}) {
  const theme = useTheme();
  if (priorities.length === 0 && !owner) {
    return null;
  }
  return (
    <View style={styles.section}>
      <SectionHeader
        title="Top priorities"
        icon={{ ios: 'list.star', android: 'checklist', web: 'checklist' }}
        onEdit={owner && onEdit ? () => onEdit(null) : undefined}
        // "I'm in", because joining a plan is what the tap does — and the
        // spoken label carries the same words, so what VoiceOver announces
        // is the name the chip displays (WCAG 2.5.3).
        replyText="I'm in"
        replyLabel={priorities.length > 0 ? `I'm in. ${priorities[0].text}.` : undefined}
        onReply={
          onRespondTo && priorities.length > 0
            ? () =>
                onRespondTo({
                  key: 'priority',
                  label: 'something on their list',
                  quote: priorities[0].text,
                })
            : undefined
        }
      />
      {priorities.length > 0 ? (
        <View style={styles.chipWrap}>
          {priorities.map((priority) => {
            const act = owner
              ? onEdit && (() => onEdit(priority.slot))
              : onRespondTo &&
                (() =>
                  onRespondTo({
                    key: `priority:${priority.slot}`,
                    label: 'something on their list',
                    quote: priority.text,
                  }));
            const chip = (
              <View style={[styles.chip, { backgroundColor: theme.surfaceSunken }]}>
                <ThemedText type="footnote">{priority.text}</ThemedText>
              </View>
            );
            return act ? (
              <PressableScale
                key={priority.slot}
                accessibilityRole="button"
                // Unique in context, and it names the action rather than
                // leaving a stranger to guess what tapping a plan does.
                accessibilityLabel={`${priority.text}. ${owner ? 'Edit.' : "Say you're in."}`}
                haptic="light"
                scaleTo={0.96}
                // Measured, not estimated: a footnote's lineHeight is 18 and
                // Space.xs a side makes 26, so 9 top and bottom is what
                // actually reaches 44. The old 7 left it at 40.
                hitSlop={{ top: 9, bottom: 9, left: 4, right: 4 }}
                onPress={act}>
                {chip}
              </PressableScale>
            ) : (
              <View key={priority.slot}>{chip}</View>
            );
          })}
        </View>
      ) : null}
      {/* The nudge. An empty list on your own profile is the one place this
          section can explain itself, and it is where most people will first
          understand what it is for. */}
      {owner && onEdit && priorities.length < MAX_PRIORITIES ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={priorities.length === 0 ? 'Add your list' : 'Add another priority'}
          testID="add-priority"
          haptic="light"
          scaleTo={0.98}
          onPress={() => onEdit(null)}>
          <View style={[styles.promptEmpty, { borderColor: theme.hairline }]}>
            <SymbolView
              name={{ ios: 'plus.circle', android: 'add_circle', web: 'add_circle' }}
              size={18}
              tintColor={theme.accent}
            />
            <View style={styles.promptEmptyText}>
              <ThemedText type="callout">
                {priorities.length === 0 ? 'What do you want to do?' : 'Add another'}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {priorities.length === 0
                  ? "Places, food, a night out, the one thing you'd hate to miss. Up to six."
                  : `${MAX_PRIORITIES - priorities.length} left.`}
              </ThemedText>
            </View>
          </View>
        </PressableScale>
      ) : null}
    </View>
  );
}

/**
 * One answered prompt: the question, the answer, and a way to reply to it.
 *
 * The reply chip is the point. A bio gives somebody one thing to open with
 * and a paragraph is hard to answer; a prompt is a question with a shape, so
 * the answer is a specific thing that can be replied TO — which is what turns
 * a profile somebody likes into a profile somebody messages.
 */
function PromptCard({
  prompt,
  owner,
  onEdit,
  onRespondTo,
}: {
  prompt: ProfilePromptRow;
  owner: boolean;
  onEdit?: () => void;
  onRespondTo?: (target: RespondTarget) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.promptCard, { backgroundColor: theme.surfaceSunken }]}>
      <View style={styles.sectionHeader}>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
          {promptLabel(prompt.prompt_key)}
        </ThemedText>
        {owner && onEdit ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Edit ${promptLabelInline(prompt.prompt_key)}`}
            haptic="light"
            scaleTo={0.9}
            hitSlop={{ top: 9, bottom: 9, left: 6, right: 6 }}
            onPress={onEdit}
            style={styles.editButton}>
            <ThemedText type="footnote" themeColor="accent">
              Edit
            </ThemedText>
          </PressableScale>
        ) : onRespondTo ? (
          <ReplyButton
            label={`Say hi about "${promptLabelInline(prompt.prompt_key)}"`}
            onPress={() =>
              onRespondTo({
                key: `prompt:${prompt.prompt_key}`,
                label: `"${promptLabelInline(prompt.prompt_key)}"`,
                quote: prompt.answer,
              })
            }
          />
        ) : null}
      </View>
      <ThemedText type="headline">{prompt.answer}</ThemedText>
    </View>
  );
}

/**
 * One gallery photo with its reply chip, wherever it lands on the page.
 *
 * `index` is only the label ("photo 2"), so a photo reads the same whether
 * it was woven between two sections or fell to the bottom.
 */
function WovenPhoto({
  photo,
  index,
  onRespondTo,
}: {
  photo: ProfilePhotoRow;
  index: number;
  onRespondTo?: (target: RespondTarget) => void;
}) {
  return (
    <View>
      <Photo path={photo.storage_path} style={styles.galleryPhoto} />
      {onRespondTo ? (
        <ReplyButton
          onPhoto
          label={`Say hi about photo ${index + 2}`}
          onPress={() =>
            onRespondTo({
              key: `photo:${photo.position}`,
              label: `photo ${index + 2}`,
              photoPath: photo.storage_path,
            })
          }
        />
      ) : null}
    </View>
  );
}

/** The block everything else is arranged around: where this person will be. */
function TripsSection({
  trips,
  owner,
  pending = false,
  heroOverlapTripId,
  onEditTrip,
  onAddTrip,
  onReply,
}: {
  trips: ProfileTrip[];
  owner: boolean;
  /** The trips query has not answered (still in flight, or failed). */
  pending?: boolean;
  /** The trip whose overlap window the hero already carries, if any. */
  heroOverlapTripId?: string;
  onEditTrip: (trip: ProfileTrip) => void;
  onAddTrip: () => void;
  onReply?: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <SectionHeader
        title="Travel plans"
        onReply={onReply}
        icon={{ ios: 'airplane', android: 'flight', web: 'flight' }}
      />
      {trips.length === 0 && pending ? (
        // A fetch that failed (or has not landed) must never be rendered as
        // an absence: "No trips yet." on a real person's page is the one
        // thing that makes them look like a fake one.
        <Skeleton height={72} radius={Radius.lg} />
      ) : trips.length === 0 ? (
        <View style={[styles.emptyTrips, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText themeColor="textSecondary">
            {owner ? "Add a trip and you'll see who else is there." : 'No trips yet.'}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.tripList}>
          {trips.map((trip, i) => {
            const row = (
              <View
                style={[
                  styles.tripCard,
                  { backgroundColor: trip.overlap ? theme.accentSoft : theme.surfaceSunken },
                ]}>
                <View style={styles.tripText}>
                  <ThemedText type="headline">{trip.cityLabel}</ThemedText>
                  <ThemedText themeColor="textSecondary">
                    {formatDateRange(trip.startDate, trip.endDate)}
                  </ThemedText>
                  {/* Not on the trip the hero is already showing: two
                      copies of one window is noise, and this is the copy the
                      floating Say hi bar fades. A second overlapping trip
                      still says its own, because the hero can only name
                      one. */}
                  {trip.overlap && trip.id !== heroOverlapTripId ? (
                    <View style={[styles.overlapPill, { backgroundColor: theme.accent }]}>
                      <ThemedText type="caption" style={{ color: theme.onAccent }}>
                        Both there {formatDateRange(trip.overlap.start, trip.overlap.end)}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                {owner ? (
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={14}
                    tintColor={theme.textSecondary}
                  />
                ) : null}
              </View>
            );
            return (
              <Animated.View key={trip.id} entering={FadeInDown.delay(i * 40).duration(260)}>
                {owner ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Edit trip to ${trip.cityLabel}`}
                    haptic="light"
                    scaleTo={0.985}
                    onPress={() => onEditTrip(trip)}>
                    {row}
                  </PressableScale>
                ) : (
                  row
                )}
              </Animated.View>
            );
          })}
        </View>
      )}
      {owner ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add a trip"
          testID="add-trip"
          haptic="soft"
          scaleTo={0.98}
          onPress={onAddTrip}
          style={[styles.dashedAction, { borderColor: theme.accent }]}>
          <SymbolView
            name={{ ios: 'plus', android: 'add', web: 'add' }}
            size={15}
            tintColor={theme.accent}
          />
          <ThemedText type="callout" themeColor="accent">
            Add a trip
          </ThemedText>
        </PressableScale>
      ) : null}
    </View>
  );
}

function SocialsSection({
  handles,
  owner,
  connected,
  onEdit,
}: {
  handles: SocialHandleRow[];
  owner: boolean;
  connected: boolean;
  onEdit?: () => void;
}) {
  const theme = useTheme();

  if (!owner && handles.length === 0 && !connected) {
    return (
      <View style={styles.section}>
        <SectionHeader
          title="Socials"
          icon={{ ios: 'at', android: 'alternate_email', web: 'alternate_email' }}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          Shared once you&apos;re chatting.
        </ThemedText>
      </View>
    );
  }
  if (!owner && handles.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <SectionHeader
        title="Socials"
        icon={{ ios: 'at', android: 'alternate_email', web: 'alternate_email' }}
        onEdit={onEdit}
      />
      {owner ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          Only people you&apos;re chatting with see these.
        </ThemedText>
      ) : null}
      {handles.length === 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          None yet.
        </ThemedText>
      ) : (
        <View style={styles.socialList}>
          {handles.map((handle) => (
            <View
              key={handle.id}
              // The logo is the only thing naming the platform, and an image
              // says nothing out loud. The row carries the name so it reads
              // as "Instagram, @alice" rather than just "@alice".
              accessible
              accessibilityLabel={`${platformLabel(handle.platform)}, ${handle.handle}`}
              style={[styles.socialRow, { backgroundColor: theme.surfaceSunken }]}>
              <SocialLogo platform={handle.platform} size={30} />
              <ThemedText selectable style={styles.flex}>
                {usesAt(handle.platform) ? '@' : ''}
                {handle.handle}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Who this is: name, age, verification, what they do, where they are from.
 * One component for both hero branches, so the photo-less profile can never
 * drift from the photographed one.
 *
 * `onPhoto` is the whole difference. Over an image the text is white and a
 * size up, because it is sitting on a scrim and has a photo to compete with.
 * On the app's own ground white is simply wrong — it is the theme's text and
 * textSecondary there, one step smaller, because nothing is competing.
 */
function Identity({
  profile,
  home,
  overlap,
  alsoSpeaks,
  onPhoto,
  style,
}: {
  profile: ProfileRow;
  home: string;
  /**
   * "Both in Bangkok Aug 23 - 28", when the viewer's own trip overlaps this
   * one. Said here rather than only on the trip card because it is the one
   * fact that explains why this person is on your screen, and the card is
   * far enough down the page to land under the floating Say hi bar at rest.
   */
  overlap?: string | null;
  /**
   * "Also speaks Portuguese", when the two of you share a language that is
   * not just English. Under the overlap chip and quieter than it: the shared
   * window is why this person is on the screen, and this is what would make
   * the first message easy to write.
   */
  alsoSpeaks?: string | null;
  onPhoto: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.identity, style]}>
      <View style={styles.nameRow}>
        <ThemedText
          type={onPhoto ? 'display' : 'title'}
          style={onPhoto ? [styles.nameText, styles.onPhoto] : styles.nameText}>
          {profile.display_name ?? 'Traveler'}
          {profile.age != null ? (
            <ThemedText
              type={onPhoto ? 'title' : 'headline'}
              style={onPhoto ? styles.onPhoto : undefined}>
              {'  '}
              {profile.age}
            </ThemedText>
          ) : null}
        </ThemedText>
        {profile.verified ? (
          <VerifiedSeal size={20} name={profile.display_name} age={profile.age} onPhoto={onPhoto} />
        ) : null}
      </View>
      {profile.occupation ? (
        <ThemedText
          themeColor={onPhoto ? undefined : 'textSecondary'}
          style={onPhoto ? styles.onPhotoSoft : undefined}>
          {profile.occupation}
        </ThemedText>
      ) : null}
      {home ? (
        <ThemedText
          themeColor={onPhoto ? undefined : 'textSecondary'}
          style={onPhoto ? styles.onPhotoSoft : undefined}>
          From {home}
        </ThemedText>
      ) : null}
      {overlap ? (
        <View
          style={[styles.overlapPill, styles.identityOverlap, { backgroundColor: theme.accent }]}>
          <ThemedText type="caption" style={{ color: theme.onAccent }}>
            {overlap}
          </ThemedText>
        </View>
      ) : null}
      {alsoSpeaks ? (
        // Supporting the overlap chip, not competing with it: the same pill
        // geometry in the soft fill, so the eye reads the window first and
        // this second.
        <View
          style={[
            styles.overlapPill,
            styles.identityOverlap,
            { backgroundColor: theme.accentSoft },
          ]}>
          <ThemedText type="caption" themeColor="accent">
            {alsoSpeaks}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The one profile in the app. A traveler looking at someone else and a
 * traveler looking at themselves see the same page in the same order — the
 * owner just gets edit affordances on top, which is the only honest way to
 * know what your profile actually looks like (founder review).
 */
export function ProfileView({
  profile,
  photos,
  prompts = [],
  priorities = [],
  trips,
  handles,
  photosPending = false,
  tripsPending = false,
  owner,
  connected = false,
  alsoSpeaks = null,
  actions,
  onEditSection,
  onEditPrompt,
  onEditPriorities,
  onRespondTo,
}: {
  profile: ProfileRow;
  photos: ProfilePhotoRow[];
  /** Answered travel prompts, lowest slot first. */
  prompts?: ProfilePromptRow[];
  /** Top priorities, lowest slot first. */
  priorities?: ProfilePriorityRow[];
  /**
   * The photo query has not answered yet.
   *
   * Without this the band below would flash on every profile that HAS a
   * photo: the two queries resolve independently, `photos` defaults to `[]`
   * while the second one is in flight, and the branch would read that as
   * "no photo", render the short band, and then jump ~280pt when the real
   * hero arrived — showing the owner an "Add a photo" button in the gap.
   * Pending renders the photo frame empty, which is byte-for-byte what this
   * screen already did before the band existed.
   */
  photosPending?: boolean;
  /**
   * The trips query has not answered yet, or failed. Same rule as photos: a
   * failed fetch must never render as "No trips yet." — an absence this page
   * cannot actually claim.
   */
  tripsPending?: boolean;
  trips: ProfileTrip[];
  handles: SocialHandleRow[];
  owner: boolean;
  /** Viewer mode: true once a chat with this person is open. */
  connected?: boolean;
  /**
   * "Also speaks Portuguese" — a language the viewer and this traveler share
   * that is not just English. The score already weights it (6 points each,
   * up to 18, second only to the date overlap) and used to spend all of it
   * on ordering; this is the same fact, said out loud.
   */
  alsoSpeaks?: string | null;
  /** Screen-supplied buttons (say hi, report, sign out…). */
  actions?: ReactNode;
  onEditSection?: (section: 'photos' | 'about' | 'details' | 'socials') => void;
  /** Owner only: open the editor for one prompt slot, or the next free one. */
  onEditPrompt?: (slot: number | null) => void;
  /**
   * Owner only: open the priorities editor, focused on one row or on the
   * empty field at the end.
   */
  onEditPriorities?: (slot: number | null) => void;
  /**
   * Supplied when the viewer could still open a conversation. Every photo
   * and every written block then carries a reply bubble, so the first
   * message is about one specific thing instead of about nothing.
   */
  onRespondTo?: (target: RespondTarget) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [editingTrip, setEditingTrip] = useState<EditableTrip | null>(null);
  const [addingTrip, setAddingTrip] = useState(false);

  const main = photos.find((p) => p.position === 0) ?? photos[0] ?? null;
  const gallery = photos.filter((p) => p.id !== main?.id);
  // The page reads as a story rather than a form followed by a contact
  // sheet: something to READ, then a face, then something to read. Photos
  // are handed out one at a time between the written blocks, and whatever is
  // left over falls to the bottom in the old order.
  const INTERLEAVED = 3;
  const woven = gallery.slice(0, INTERLEAVED);
  const remaining = gallery.slice(INTERLEAVED);
  const home = [profile.home_city, profile.home_country].filter(Boolean).join(', ');
  // The seeded "[demo]" suffix out of the prose, onto a chip (lib/demo-marker).
  const about = splitDemoMarker(profile.bio);
  // One builder for the whole app: the pill here, the anchor Travelers
  // quotes into a first message, and the chip on the card that hello is
  // answered on all come from features/matching/overlap, so the same pair of
  // people can never be told two different sentences about their own dates.
  const overlapTrip = owner ? undefined : trips.find((trip) => trip.overlap);
  const overlap = overlapSentence(
    overlapTrip?.cityLabel,
    overlapTrip?.overlap?.start,
    overlapTrip?.overlap?.end
  );
  const heroWidth = Math.min(width, MaxContentWidth);
  const edit = (section: 'photos' | 'about' | 'details' | 'socials') =>
    onEditSection ? () => onEditSection(section) : undefined;

  return (
    <>
      <View style={styles.page}>
        {main || photosPending ? (
          /* Photo first, name OVER it — the shape every profile people
             already use has settled on.

             The photo is absolutely positioned, which is load-bearing twice
             over. It makes heroText the only in-flow child, so the name
             lands on the gradient exactly as DESIGN.md specifies instead of
             on bare canvas below the image. And it stops the photo being
             SHRUNK by that text: two in-flow children in a fixed-height box
             means flexbox takes the difference out of the one that can give
             (height:'100%' still shrinks — flexShrink defaults to 1), which
             cost the image ~90pt of face and left the scrim darkening a
             region no text was sitting on.

             The height stays a fixed ratio and is NOT a tweakable detail.
             Every child of this frame is now absolutely positioned or
             intrinsically sized, so none of them can give the frame a
             height — and a percentage does not mean "as tall as my parent's
             content": Yoga resolves it against the available height handed
             down, which inside a ScrollView is about a screen. Dropping the
             height therefore does not collapse the frame to its text
             (edcd8d7 tried exactly that); it hands the fill a screen-tall
             box and pushes the name below the fold, which is what E2E run 33
             photographed and 612bb5c reverted. A profile with no photo gets
             the separate branch below instead.

             The ratio itself is 1:1 per decision D2(a): the iOS editor crops
             square, so the hero shows the square people approved, whole. */
          <View style={[styles.hero, { width: heroWidth, height: heroWidth }]}>
            {main ? (
              <Photo path={main.storage_path} style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surfaceSunken }]} />
            )}
            <LinearGradient
              colors={['transparent', 'rgba(14,16,32,0.05)', 'rgba(14,16,32,0.82)']}
              locations={[0, 0.55, 1]}
              style={styles.heroScrim}
              pointerEvents="none"
            />
            {/* box-none, not none. Identity carries the VerifiedSeal, which
                is a real button that opens "what verified means" — and a
                pointerEvents:none subtree returns nil from hitTest, so on
                every profile that HAS a photo the badge was dead to touch
                while working fine on the photo-less branch below and in the
                chat header. VoiceOver announced a button that could not be
                activated. The wrapper itself still takes no touches. */}
            <View style={styles.heroText} pointerEvents="box-none">
              <Identity
                profile={profile}
                home={home}
                overlap={overlap}
                alsoSpeaks={alsoSpeaks}
                onPhoto
              />
            </View>
            {owner && onEditSection ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Edit photos"
                haptic="light"
                scaleTo={0.92}
                hitSlop={3}
                onPress={() => onEditSection('photos')}
                containerStyle={styles.heroEditAnchor}
                style={[styles.heroEdit, { backgroundColor: theme.surface }]}>
                <SymbolView
                  name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                  size={15}
                  tintColor={theme.text}
                />
              </PressableScale>
            ) : null}
            {/* `main` is only nullable while photos are still loading (the
                photosPending branch above renders this frame early so the
                page does not jump ~280pt when they land). TypeScript reads
                `photos[0]` as non-optional and so cannot see it; there is
                nothing to reply TO until the photo exists. */}
            {onRespondTo && main ? (
              <ReplyButton
                onPhoto
                label="Say hi about this photo"
                onPress={() =>
                  onRespondTo({
                    key: 'photo:0',
                    label: 'their first photo',
                    photoPath: main.storage_path,
                  })
                }
              />
            ) : null}
          </View>
        ) : (
          /* No photo: a band, not an empty portrait frame. Its height is its
             own content — a fixed 64pt avatar well and the text next to it —
             so there is no percentage and no reserved height anywhere in
             here, and nothing for a scroll view's available height to leak
             into. The name is in the theme's own colours, because white
             belongs on a photo and there is none. */
          <View style={[styles.band, { backgroundColor: theme.surfaceSunken }]}>
            <View style={styles.bandRow}>
              <View
                style={[
                  styles.bandAvatar,
                  { backgroundColor: theme.surface, borderColor: theme.hairline },
                ]}>
                <SymbolView
                  name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                  size={28}
                  tintColor={theme.textSecondary}
                />
              </View>
              <Identity
                profile={profile}
                home={home}
                overlap={overlap}
                alsoSpeaks={alsoSpeaks}
                onPhoto={false}
                style={styles.flex}
              />
            </View>
            {owner && onEditSection ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Add a photo"
                testID="add-photo"
                haptic="soft"
                scaleTo={0.98}
                onPress={() => onEditSection('photos')}
                style={[styles.dashedAction, { borderColor: theme.accent }]}>
                <SymbolView
                  name={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }}
                  size={15}
                  tintColor={theme.accent}
                />
                <ThemedText type="callout" themeColor="accent">
                  Add a photo
                </ThemedText>
              </PressableScale>
            ) : null}
          </View>
        )}

        <View style={styles.body}>
          <TripsSection
            trips={trips}
            owner={owner}
            pending={tripsPending}
            heroOverlapTripId={overlapTrip?.id}
            onEditTrip={(trip) =>
              setEditingTrip({
                id: trip.id,
                cityId: trip.cityId,
                cityLabel: trip.cityLabel,
                startDate: trip.startDate,
                endDate: trip.endDate,
              })
            }
            onAddTrip={() => setAddingTrip(true)}
            onReply={
              onRespondTo
                ? () =>
                    onRespondTo({
                      key: 'trip',
                      label: 'their travel plans',
                      quote: trips[0]?.cityLabel ?? null,
                    })
                : undefined
            }
          />

          {/* Trips say where and when; this says what. The pair is the whole
              reason somebody messages a stranger, so it sits directly under
              the plans and above everything that describes the person. */}
          <PrioritiesSection
            priorities={priorities}
            owner={owner}
            onEdit={onEditPriorities}
            onRespondTo={onRespondTo}
          />

          {woven[0] ? <WovenPhoto photo={woven[0]} index={0} onRespondTo={onRespondTo} /> : null}

          {profile.bio || owner ? (
            <View style={styles.section}>
              <SectionHeader
                title="About"
                icon={{ ios: 'text.quote', android: 'format_quote', web: 'format_quote' }}
                onEdit={edit('about')}
                onReply={
                  onRespondTo && about.bio
                    ? // The STRIPPED text, never profile.bio: the reply chip
                      // quotes the bio into a first message, and the demo
                      // marker must not end up inside somebody's hello.
                      () => onRespondTo({ key: 'bio', label: 'their bio', quote: about.bio })
                    : undefined
                }
              />
              {/* The fixture's "[demo]" suffix renders as a chip, not as a
                  fourth line of prose — the disclosure survives, and the bio
                  reads as a person wrote it. See lib/demo-marker. */}
              {about.isDemo ? (
                <View style={[styles.demoChip, { backgroundColor: theme.surfaceSunken }]}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Sample profile
                  </ThemedText>
                </View>
              ) : null}
              {about.bio ? (
                <ThemedText>{about.bio}</ThemedText>
              ) : (
                <ThemedText themeColor="textSecondary">Say what you&apos;re up for.</ThemedText>
              )}
            </View>
          ) : null}

          {prompts[0] ? (
            <PromptCard
              prompt={prompts[0]}
              owner={owner}
              onEdit={onEditPrompt ? () => onEditPrompt(prompts[0].slot) : undefined}
              onRespondTo={onRespondTo}
            />
          ) : null}

          {woven[1] ? <WovenPhoto photo={woven[1]} index={1} onRespondTo={onRespondTo} /> : null}

          {profile.languages.length > 0 || owner ? (
            <View style={styles.section}>
              <SectionHeader
                title="Details"
                icon={{ ios: 'globe', android: 'language', web: 'language' }}
                onEdit={edit('details')}
                onReply={
                  onRespondTo && profile.languages.length > 0
                    ? () =>
                        onRespondTo({
                          key: 'languages',
                          label: 'the languages they speak',
                          quote: profile.languages.map(languageLabel).join(', '),
                        })
                    : undefined
                }
              />
              <View style={styles.chipWrap}>
                {profile.languages.map((code) => (
                  <View key={code} style={[styles.chip, { backgroundColor: theme.surfaceSunken }]}>
                    <ThemedText type="footnote">{languageLabel(code)}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {prompts[1] ? (
            <PromptCard
              prompt={prompts[1]}
              owner={owner}
              onEdit={onEditPrompt ? () => onEditPrompt(prompts[1].slot) : undefined}
              onRespondTo={onRespondTo}
            />
          ) : null}

          {/* Been, against want. The shelf sits below the plans deliberately:
              where somebody has been is context, and what they want to do is
              the thing another traveler can say yes to. It renders nothing at
              all when the list is empty. */}
          <TopRatedShelf
            userId={profile.user_id}
            cityId={overlapTrip?.cityId ?? trips[0]?.cityId ?? null}
          />

          {woven[2] ? <WovenPhoto photo={woven[2]} index={2} onRespondTo={onRespondTo} /> : null}

          {prompts[2] ? (
            <PromptCard
              prompt={prompts[2]}
              owner={owner}
              onEdit={onEditPrompt ? () => onEditPrompt(prompts[2].slot) : undefined}
              onRespondTo={onRespondTo}
            />
          ) : null}

          {/* The nudge, and the whole reason prompts exist: a profile with
              none of them gives a stranger nothing specific to answer. */}
          {owner && onEditPrompt && prompts.length < MAX_PROMPTS ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Answer a prompt"
              haptic="light"
              scaleTo={0.98}
              onPress={() => onEditPrompt(null)}>
              <View style={[styles.promptEmpty, { borderColor: theme.hairline }]}>
                <SymbolView
                  name={{ ios: 'plus.bubble', android: 'add_comment', web: 'add_comment' }}
                  size={18}
                  tintColor={theme.accent}
                />
                <View style={styles.promptEmptyText}>
                  <ThemedText type="callout">
                    {prompts.length === 0 ? 'Answer a prompt' : 'Answer another'}
                  </ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Gives people something to reply to.
                  </ThemedText>
                </View>
              </View>
            </PressableScale>
          ) : null}

          <SocialsSection
            handles={handles}
            owner={owner}
            connected={connected}
            onEdit={edit('socials')}
          />

          {/* Photo, then everything the profile says, then the rest of the
              photos — the founder's order. One per row rather than a grid:
              a thumbnail two fingers wide is a contact-sheet entry, and the
              point of these is to be looked at. */}
          {remaining.length > 0 ? (
            <Animated.View entering={FadeIn.duration(240)} style={styles.gallery}>
              {remaining.map((photo, index) => (
                <WovenPhoto
                  key={photo.id}
                  photo={photo}
                  index={INTERLEAVED + index}
                  onRespondTo={onRespondTo}
                />
              ))}
            </Animated.View>
          ) : null}

          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      </View>

      {addingTrip ? <TripEditor trip={null} onClose={() => setAddingTrip(false)} /> : null}
      {editingTrip ? <TripEditor trip={editingTrip} onClose={() => setEditingTrip(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  hero: {
    justifyContent: 'flex-end',
    // A rounded card, not a photo that happens to reach the screen edge.
    // Matters most on the travelers tab, which has no navigation header
    // above it to give the image a top edge.
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  photoFrame: {
    overflow: 'hidden',
  },
  heroScrim: {
    ...StyleSheet.absoluteFill,
  },
  heroText: {
    padding: Space.lg,
  },
  /* The name block itself, shared by both hero branches. */
  identity: {
    gap: 2,
  },
  /* The no-photo hero. Content-height by construction: every child has an
     intrinsic size, so this cannot inherit a screen's worth of height the
     way a percentage-sized child would. */
  band: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  bandAvatar: {
    /* theme.surface on theme.surfaceSunken is 1.13:1 — the well would not
       read as a shape at all, only the glyph inside it would. The hairline
       is what makes it a circle rather than a floating icon. */
    borderWidth: StyleSheet.hairlineWidth,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  /* A long display name must give way rather than push the verified badge
     off the row. Both hero branches share this, which is the point of
     Identity being one component. */
  nameText: {
    flexShrink: 1,
  },
  onPhoto: {
    color: '#FFFFFF',
  },
  onPhotoSoft: {
    color: 'rgba(255,255,255,0.86)',
  },
  heroEditAnchor: {
    position: 'absolute',
    right: Space.lg,
    top: Space.lg,
  },
  heroEdit: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyAnchor: {
    position: 'absolute',
    right: Space.md,
    bottom: Space.md,
  },
  replyOnPhoto: {
    // A pill with a word in it now, not a 40pt circle with a glyph. Height
    // is a minimum so the chip grows with Dynamic Type instead of clipping
    // its own label.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    minHeight: 40,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
  },
  replyInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  body: {
    padding: Space.lg,
    gap: Space.xl,
  },
  section: {
    gap: Space.sm,
  },
  demoChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  promptEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  promptEmptyText: {
    flex: 1,
    gap: 2,
  },
  promptCard: {
    gap: Space.sm,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  sectionTitle: {
    flex: 1,
  },
  editButton: {
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
  },
  tripList: {
    gap: Space.sm,
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  tripText: {
    flex: 1,
    gap: 2,
  },
  overlapPill: {
    alignSelf: 'flex-start',
    marginTop: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  /* On the hero it sits under two lines set with `gap: 2`, which is too
     tight for a pill against the line above it. */
  identityOverlap: {
    marginTop: Space.sm,
  },
  emptyTrips: {
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  /* "Add a trip" and "Add a photo": the same dashed outline for the same
     kind of ask, so a profile that is still being made says it once. */
  dashedAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: 48,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  gallery: {
    gap: Space.md,
  },
  galleryPhoto: {
    width: '100%',
    // Square, decision D2(a): the iOS editor crops square, and stretching
    // that square into 4:5 cut a further fifth off each side of the frame
    // people actually approved.
    aspectRatio: 1,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  socialList: {
    gap: Space.sm,
  },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  actions: {
    gap: Space.sm,
    paddingTop: Space.sm,
  },
});
