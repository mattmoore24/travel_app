import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { LANGUAGES } from '@/constants/languages';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { usePhotoUrl } from '@/features/profile/hooks';
import { SocialLogo } from '@/features/profile/social-logo';
import { formatDateRange } from '@/features/trips/dates';
import { TripEditor, type EditableTrip } from '@/features/trips/trip-editor';
import { useTheme } from '@/hooks/use-theme';
import type { ProfilePhotoRow, ProfileRow, SocialHandleRow } from '@/lib/database.types';

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.value, l.label])
);

export type ProfileTrip = {
  id: string;
  cityId: number;
  cityLabel: string;
  startDate: string;
  endDate: string;
  /** Set when the viewer's own trip overlaps this one. */
  overlap?: { start: string; end: string } | null;
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

function SectionHeader({
  title,
  icon,
  onEdit,
}: {
  title: string;
  icon: SymbolViewProps['name'];
  onEdit?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <SymbolView name={icon} size={15} tintColor={theme.textSecondary} />
      <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {onEdit ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Edit ${title.toLowerCase()}`}
          haptic="light"
          scaleTo={0.9}
          onPress={onEdit}
          style={styles.editButton}>
          <ThemedText type="footnote" themeColor="accent">
            Edit
          </ThemedText>
        </PressableScale>
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
}: {
  trips: ProfileTrip[];
  owner: boolean;
  onEditTrip: (trip: ProfileTrip) => void;
  onAddTrip: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <SectionHeader
        title="Travel plans"
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
                        BOTH THERE {formatDateRange(trip.overlap.start, trip.overlap.end)}
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
          style={[styles.addTrip, { borderColor: theme.accent }]}>
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
              style={[styles.socialRow, { backgroundColor: theme.surfaceSunken }]}>
              <SocialLogo platform={handle.platform} size={30} />
              <ThemedText selectable style={styles.flex}>
                {handle.platform === 'whatsapp' || handle.platform === 'facebook' ? '' : '@'}
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
  owner,
  connected = false,
  actions,
  onEditSection,
}: {
  profile: ProfileRow;
  photos: ProfilePhotoRow[];
  trips: ProfileTrip[];
  handles: SocialHandleRow[];
  owner: boolean;
  /** Viewer mode: true once a chat with this person is open. */
  connected?: boolean;
  /** Screen-supplied buttons (say hi, report, sign out…). */
  actions?: ReactNode;
  onEditSection?: (section: 'photos' | 'about' | 'details' | 'socials') => void;
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
        {/* Photo first, name over it — the shape every profile people
            already use has settled on. */}
        <View style={[styles.hero, { width: heroWidth, height: heroWidth * 1.15 }]}>
          {main ? (
            <Photo path={main.storage_path} style={styles.fill} />
          ) : (
            <View style={[styles.fill, { backgroundColor: theme.surfaceSunken }]} />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(14,16,32,0.05)', 'rgba(14,16,32,0.82)']}
            locations={[0, 0.55, 1]}
            style={styles.heroScrim}
            pointerEvents="none"
          />
          <View style={styles.heroText} pointerEvents="none">
            <View style={styles.nameRow}>
              <ThemedText type="display" style={styles.onPhoto}>
                {profile.display_name ?? 'Traveler'}
                {profile.age != null ? (
                  <ThemedText type="title" style={styles.onPhoto}>
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
                  tintColor="#FFFFFF"
                />
              ) : null}
            </View>
            {profile.occupation ? (
              <ThemedText style={styles.onPhotoSoft}>{profile.occupation}</ThemedText>
            ) : null}
            {home ? <ThemedText style={styles.onPhotoSoft}>From {home}</ThemedText> : null}
          </View>
          {owner && onEditSection ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Edit photos"
              haptic="light"
              scaleTo={0.92}
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
        </View>

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
          />

          {profile.bio || owner ? (
            <View style={styles.section}>
              <SectionHeader
                title="About"
                icon={{ ios: 'text.quote', android: 'format_quote', web: 'format_quote' }}
                onEdit={edit('about')}
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

          {gallery.length > 0 ? (
            <Animated.View entering={FadeIn.duration(240)} style={styles.gallery}>
              {gallery.slice(0, 2).map((photo) => (
                <Photo key={photo.id} path={photo.storage_path} style={styles.galleryPhoto} />
              ))}
            </Animated.View>
          ) : null}

          {profile.languages.length > 0 || owner ? (
            <View style={styles.section}>
              <SectionHeader
                title="Details"
                icon={{ ios: 'globe', android: 'language', web: 'language' }}
                onEdit={edit('details')}
              />
              <View style={styles.chipWrap}>
                {profile.languages.map((code) => (
                  <View key={code} style={[styles.chip, { backgroundColor: theme.surfaceSunken }]}>
                    <ThemedText type="footnote">{LANGUAGE_LABELS[code] ?? code}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {gallery.length > 2 ? (
            <View style={styles.gallery}>
              {gallery.slice(2).map((photo) => (
                <Photo key={photo.id} path={photo.storage_path} style={styles.galleryPhoto} />
              ))}
            </View>
          ) : null}

          <SocialsSection
            handles={handles}
            owner={owner}
            connected={connected}
            onEdit={edit('socials')}
          />

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
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
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
  addTrip: {
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  galleryPhoto: {
    flexGrow: 1,
    flexBasis: '46%',
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
