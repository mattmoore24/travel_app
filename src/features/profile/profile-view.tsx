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
import { PressableScale } from '@/components/ui/pressable-scale';
import { languageLabel } from '@/constants/languages';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { usePhotoUrl } from '@/features/profile/hooks';
import { platformLabel, usesAt } from '@/features/profile/social-handles-editor';
import { SocialLogo } from '@/features/profile/social-logo';
import { formatDateRange } from '@/features/trips/dates';
import { TripEditor, type EditableTrip } from '@/features/trips/trip-editor';
import { useTheme } from '@/hooks/use-theme';
import type { ProfilePhotoRow, ProfileRow, SocialHandleRow } from '@/lib/database.types';

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
      {url ? <Image source={{ uri: url }} style={styles.fill} contentFit="cover" /> : null}
    </View>
  );
}

/** The affordance itself: a bubble you tap to answer one specific thing. */
function ReplyButton({
  label,
  onPress,
  onPhoto = false,
}: {
  label: string;
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
      {onPhoto ? null : (
        <ThemedText type="footnote" themeColor="accent">
          Reply
        </ThemedText>
      )}
    </PressableScale>
  );
}

/** What "reply to this section" is called out loud, per section. */
const REPLY_LABELS: Record<string, string> = {
  About: 'Reply to their bio',
  Details: 'Reply to their details',
  'Travel plans': 'Reply to their travel plans',
};

function SectionHeader({
  title,
  icon,
  onEdit,
  onReply,
}: {
  title: string;
  icon: SymbolViewProps['name'];
  onEdit?: () => void;
  /** Visitors get this where the owner gets Edit; never both. */
  onReply?: () => void;
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
          // Not `Reply to their ${title.toLowerCase()}`: that produced "Reply
          // to their about", which is not a sentence. The section names read
          // as things in some cases and not others, so they are mapped.
          label={REPLY_LABELS[title] ?? `Reply to ${title.toLowerCase()}`}
          onPress={onReply}
        />
      ) : null}
    </View>
  );
}

/** The block everything else is arranged around: where this person will be. */
function TripsSection({
  trips,
  owner,
  onEditTrip,
  onAddTrip,
  onReply,
}: {
  trips: ProfileTrip[];
  owner: boolean;
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
      {trips.length === 0 ? (
        <View style={[styles.emptyTrips, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText themeColor="textSecondary">
            {owner
              ? 'Add where you are going and you will start seeing people who will be there too.'
              : 'Nothing planned right now.'}
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
                  {trip.overlap ? (
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
          Shared once you two are chatting.
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
          Only people you are chatting with can see these.
        </ThemedText>
      ) : null}
      {handles.length === 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          You have not added any yet.
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
  onPhoto,
  style,
}: {
  profile: ProfileRow;
  home: string;
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
          <SymbolView
            name={{
              ios: 'checkmark.seal.fill',
              android: 'verified',
              web: 'verified',
            }}
            size={20}
            tintColor={onPhoto ? '#FFFFFF' : theme.accent}
          />
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
  trips,
  handles,
  photosPending = false,
  owner,
  connected = false,
  actions,
  onEditSection,
  onRespondTo,
}: {
  profile: ProfileRow;
  photos: ProfilePhotoRow[];
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
  trips: ProfileTrip[];
  handles: SocialHandleRow[];
  owner: boolean;
  /** Viewer mode: true once a chat with this person is open. */
  connected?: boolean;
  /** Screen-supplied buttons (say hi, report, sign out…). */
  actions?: ReactNode;
  onEditSection?: (section: 'photos' | 'about' | 'details' | 'socials') => void;
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
  const home = [profile.home_city, profile.home_country].filter(Boolean).join(', ');
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
             the separate branch below instead. */
          <View style={[styles.hero, { width: heroWidth, height: heroWidth * 1.15 }]}>
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
            <View style={styles.heroText} pointerEvents="none">
              <Identity profile={profile} home={home} onPhoto />
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
                label="Reply to this photo"
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
              <Identity profile={profile} home={home} onPhoto={false} style={styles.flex} />
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

          {profile.bio || owner ? (
            <View style={styles.section}>
              <SectionHeader
                title="About"
                icon={{ ios: 'text.quote', android: 'format_quote', web: 'format_quote' }}
                onEdit={edit('about')}
                onReply={
                  onRespondTo && profile.bio
                    ? () => onRespondTo({ key: 'bio', label: 'their bio', quote: profile.bio })
                    : undefined
                }
              />
              {profile.bio ? (
                <ThemedText>{profile.bio}</ThemedText>
              ) : (
                <ThemedText themeColor="textSecondary">
                  Say what you are up for and people will have something to open with.
                </ThemedText>
              )}
            </View>
          ) : null}

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
          {gallery.length > 0 ? (
            <Animated.View entering={FadeIn.duration(240)} style={styles.gallery}>
              {gallery.map((photo, index) => (
                <View key={photo.id}>
                  <Photo path={photo.storage_path} style={styles.galleryPhoto} />
                  {onRespondTo ? (
                    <ReplyButton
                      onPhoto
                      label={`Reply to photo ${index + 2}`}
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
    aspectRatio: 4 / 5,
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
