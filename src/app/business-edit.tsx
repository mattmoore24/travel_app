import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { SelectField } from '@/components/form/select-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, NativeAppearance, Radius, Space } from '@/constants/theme';
import { BUSINESS_PHOTO_BUCKET } from '@/features/business/api';
import { useOwnBusiness, useUpdateOwnBusiness } from '@/features/business/hooks';
import { LINK_LABEL, shortTime, weekdayLabel } from '@/features/business/vocabulary';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useOwnUserId } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessLinkKind, Database, MyBusinessRow } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type HourRow = Database['public']['Tables']['business_hours']['Row'];
type LinkRow = Database['public']['Tables']['business_links']['Row'];
type PhotoRow = Database['public']['Tables']['business_photos']['Row'];

/** Which block the caller's Edit affordance was pointing at. */
type Section = 'details' | 'hours' | 'links' | 'photos';

const NAME_MIN = 2;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 600;
const PLACE_LABEL_MAX = 120;
const HOURS_NOTE_MAX = 200;
const WEBSITE_MAX = 300;
/** Both caps are the database's; these only keep the UI honest about them. */
const LINKS_MAX = 10;
const PHOTOS_MAX = 10;

const PHOTO_COLUMNS = 3;
const PHOTO_GAP = Space.sm;

const LINK_OPTIONS = (Object.keys(LINK_LABEL) as BusinessLinkKind[]).map((kind) => ({
  value: kind,
  label: LINK_LABEL[kind],
}));

// -- Round trips ---------------------------------------------------------------
//
// Straight table reads rather than business_detail(): that RPC answers for a
// place a TRAVELER can see, and an owner editing a listing that is waiting on
// its email confirmation is exactly the case it returns nothing for. Every
// table below has an owns_business() select policy for this.

async function fetchHours(businessId: string) {
  const { data, error } = await supabase
    .from('business_hours')
    .select('*')
    .eq('business_id', businessId)
    .order('weekday')
    .order('position');
  if (error) {
    throw error;
  }
  return (data ?? []) as HourRow[];
}

async function fetchLinks(businessId: string) {
  const { data, error } = await supabase
    .from('business_links')
    .select('*')
    .eq('business_id', businessId)
    .order('position')
    .order('created_at');
  if (error) {
    throw error;
  }
  return (data ?? []) as LinkRow[];
}

async function fetchBusinessPhotos(businessId: string) {
  const { data, error } = await supabase
    .from('business_photos')
    .select('*')
    .eq('business_id', businessId)
    .order('position')
    .order('created_at');
  if (error) {
    throw error;
  }
  return (data ?? []) as PhotoRow[];
}

/**
 * Replace the whole week in one go.
 *
 * Insert first, delete second, and not the other way round: a failed insert
 * after a delete leaves a place with no hours at all, which is the one
 * outcome worse than a duplicated row. Duplicates read as a split shift and
 * can be fixed here; wiped hours cannot be recovered from the screen.
 */
async function replaceHours(businessId: string, rules: HourRule[], existing: HourRow[]) {
  const rows = rules.flatMap((rule, index) =>
    rule.days.map((weekday) => ({
      business_id: businessId,
      weekday,
      opens: rule.opens,
      closes: rule.closes,
      position: index,
    }))
  );
  if (rows.length > 0) {
    const { error } = await supabase.from('business_hours').insert(rows);
    if (error) {
      throw error;
    }
  }
  if (existing.length > 0) {
    const { error } = await supabase
      .from('business_hours')
      .delete()
      .in(
        'id',
        existing.map((row) => row.id)
      );
    if (error) {
      throw error;
    }
  }
}

async function addLink(input: {
  businessId: string;
  kind: BusinessLinkKind;
  label: string;
  value: string;
  position: number;
}) {
  const { error } = await supabase.from('business_links').insert({
    business_id: input.businessId,
    kind: input.kind,
    label: input.label,
    value: input.value,
    position: input.position,
  });
  if (error) {
    throw error;
  }
}

async function removeLink(linkId: string) {
  const { error } = await supabase.from('business_links').delete().eq('id', linkId);
  if (error) {
    throw error;
  }
}

/** Upload, then register the row, which is what opens the moderation check. */
async function uploadBusinessPhoto(input: {
  businessId: string;
  userId: string;
  localUri: string;
  position: number;
}) {
  const storagePath = await processAndUploadImage(
    BUSINESS_PHOTO_BUCKET,
    input.userId,
    input.localUri
  );
  const { error } = await supabase.from('business_photos').insert({
    business_id: input.businessId,
    storage_path: storagePath,
    position: input.position,
  });
  if (error) {
    await removeUploadedImage(BUSINESS_PHOTO_BUCKET, storagePath);
    throw error;
  }
}

async function deleteBusinessPhoto(photo: PhotoRow) {
  const { error } = await supabase.from('business_photos').delete().eq('id', photo.id);
  if (error) {
    throw error;
  }
  // storage-js reports failures in the result rather than by throwing. An
  // orphan is invisible to everyone (reads resolve through the photo row),
  // so log it rather than failing a delete that has already happened.
  const { error: removeError } = await supabase.storage
    .from(BUSINESS_PHOTO_BUCKET)
    .remove([photo.storage_path]);
  if (removeError) {
    console.warn(`orphaned storage object ${photo.storage_path}: ${removeError.message}`);
  }
}

function useBusinessHours(businessId: string | null) {
  return useQuery({
    queryKey: ['business-hours', businessId],
    queryFn: () => fetchHours(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });
}

function useBusinessLinks(businessId: string | null) {
  return useQuery({
    queryKey: ['business-links', businessId],
    queryFn: () => fetchLinks(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });
}

function useBusinessPhotos(businessId: string | null) {
  return useQuery({
    queryKey: ['business-photos', businessId],
    queryFn: () => fetchBusinessPhotos(businessId!),
    enabled: isSupabaseConfigured && businessId != null,
  });
}

// -- Hours, as rules -----------------------------------------------------------

/** One line of the editor: some days, one opening, one closing. */
type HourRule = { id: string; days: number[]; opens: string; closes: string };

const DEFAULT_OPENS = '09:00';
const DEFAULT_CLOSES = '17:00';

/**
 * Rows collapse back into rules by their window, which is the inverse of what
 * the editor writes: seven identical rows are one rule a person typed once,
 * and showing them as seven lines would be showing them the database's
 * bookkeeping instead of their own decision.
 */
function rulesFromRows(rows: HourRow[]): HourRule[] {
  const byWindow = new Map<string, HourRule>();
  for (const row of rows) {
    const opens = shortTime(row.opens);
    const closes = shortTime(row.closes);
    const key = `${opens}-${closes}`;
    const existing = byWindow.get(key);
    if (existing) {
      if (!existing.days.includes(row.weekday)) {
        existing.days.push(row.weekday);
      }
    } else {
      byWindow.set(key, { id: key, days: [row.weekday], opens, closes });
    }
  }
  return Array.from(byWindow.values()).map((rule) => ({
    ...rule,
    days: [...rule.days].sort((a, b) => a - b),
  }));
}

/** A comparable fingerprint of a whole week, for the dirty check. */
function serializeRules(rules: HourRule[]): string {
  return rules
    .filter((rule) => rule.days.length > 0)
    .map((rule) => `${[...rule.days].sort((a, b) => a - b).join('')}:${rule.opens}-${rule.closes}`)
    .sort()
    .join('|');
}

function daysSummary(days: number[]): string {
  if (days.length === 0) {
    return 'No days picked';
  }
  if (days.length === 7) {
    return 'Every day';
  }
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => weekdayLabel(day))
    .join(', ');
}

function timeToDate(time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function dateToTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * One clock, themed.
 *
 * `themeVariant` is not optional here: the native picker chooses its own
 * colours and drew near-black text on this near-black ground the one time it
 * was left off (Add a trip). On anything but iOS the compact style does not
 * exist, so the value is a button that opens the spinner.
 */
function TimeField({
  label,
  value,
  onChange,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);

  return (
    <View style={styles.timeField}>
      <ThemedText type="footnote" themeColor="textSecondary">
        {label}
      </ThemedText>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={timeToDate(value)}
          mode="time"
          display="compact"
          minuteInterval={5}
          themeVariant={NativeAppearance}
          accessibilityLabel={accessibilityLabel}
          onChange={(_, date) => {
            if (date) {
              onChange(dateToTime(date));
            }
          }}
        />
      ) : (
        <>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{ text: value }}
            haptic="selection"
            scaleTo={0.96}
            onPress={() => setPicking(true)}
            style={[styles.timeButton, { backgroundColor: theme.surfaceSunken }]}>
            <ThemedText>{value}</ThemedText>
          </PressableScale>
          {picking ? (
            <DateTimePicker
              value={timeToDate(value)}
              mode="time"
              minuteInterval={5}
              onChange={(_, date) => {
                setPicking(false);
                if (date) {
                  onChange(dateToTime(date));
                }
              }}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * The weekday chips.
 *
 * Deliberately not ChipRow, which labels each chip for VoiceOver with its own
 * visible text: two rule lines would then both announce seven chips called
 * "Mon", "Tue"..., and a screen reader would have no way to tell which set of
 * hours it was about to change.
 */
function WeekdayChips({
  days,
  onToggle,
  ruleName,
}: {
  days: number[];
  onToggle: (weekday: number) => void;
  ruleName: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chipRow}>
      {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
        const on = days.includes(weekday);
        return (
          <PressableScale
            key={weekday}
            accessibilityRole="button"
            accessibilityLabel={`${weekdayLabel(weekday)}, ${ruleName}`}
            accessibilityState={{ selected: on }}
            haptic="selection"
            scaleTo={0.92}
            // 36pt of chip plus 6 either side clears the 44pt floor without
            // making a row of seven days look like a row of seven buttons.
            hitSlop={6}
            onPress={() => onToggle(weekday)}
            style={[styles.chip, { backgroundColor: on ? theme.accent : theme.surfaceSunken }]}>
            <ThemedText type="footnote" style={{ color: on ? theme.onAccent : theme.text }}>
              {weekdayLabel(weekday)}
            </ThemedText>
          </PressableScale>
        );
      })}
    </View>
  );
}

// -- Photos --------------------------------------------------------------------

function PhotoTile({
  photo,
  size,
  cover,
  onRemove,
}: {
  photo: PhotoRow;
  size: number;
  cover: boolean;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { data: url } = useBusinessPhotoUrl(photo.storage_path);
  const rejected = photo.moderation_status === 'rejected';

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(150)}
      layout={LinearTransition.springify()}
      style={[styles.tile, { width: size, height: size, backgroundColor: theme.surfaceSunken }]}>
      {url ? <Image source={{ uri: url }} style={styles.fill} contentFit="cover" /> : null}
      {photo.moderation_status !== 'approved' ? (
        <View
          style={[styles.tileChip, { backgroundColor: rejected ? theme.warning : theme.surface }]}>
          <ThemedText type="caption" style={rejected ? { color: theme.onAccent } : undefined}>
            {rejected ? 'Taken down' : 'In review'}
          </ThemedText>
        </View>
      ) : cover ? (
        <View style={[styles.tileChip, { backgroundColor: theme.surface }]}>
          <ThemedText type="caption">Cover</ThemedText>
        </View>
      ) : null}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={cover ? 'Remove the cover photo' : `Remove photo ${photo.position + 1}`}
        haptic="light"
        scaleTo={0.88}
        // 10 + 24 + 10 = 44. hitSlop is honoured by the Pressable itself, so
        // the tile's overflow: hidden cannot clip the target.
        hitSlop={10}
        onPress={onRemove}
        containerStyle={styles.removeAnchor}
        style={[styles.removeDot, { backgroundColor: theme.surface }]}>
        <SymbolView
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={11}
          tintColor={theme.text}
        />
      </PressableScale>
    </Animated.View>
  );
}

function BusinessPhotos({ businessId, userId }: { businessId: string; userId: string | null }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: photos = [] } = useBusinessPhotos(businessId);
  const [width, setWidth] = useState(0);

  const upload = useMutation({
    mutationFn: (input: { localUri: string; position: number }) =>
      uploadBusinessPhoto({ businessId, userId: userId!, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-photos', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
    },
  });
  const remove = useMutation({
    mutationFn: deleteBusinessPhoto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-photos', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
    },
  });

  const size =
    width > 0 ? Math.floor((width - PHOTO_GAP * (PHOTO_COLUMNS - 1)) / PHOTO_COLUMNS) : 0;
  const full = photos.length >= PHOTOS_MAX;

  /** Lowest free slot, so a delete leaves a hole the next upload fills. */
  const nextPosition = () => {
    const taken = new Set(photos.map((photo) => photo.position));
    for (let index = 0; index < PHOTOS_MAX; index += 1) {
      if (!taken.has(index)) {
        return index;
      }
    }
    return null;
  };

  const pick = async () => {
    if (userId == null) {
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      // `aspect` is Android-only and the iOS editor is always square, so the
      // grid below shows squares: what they cropped is what they get.
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 1,
    });
    if (picked.canceled || picked.assets.length === 0) {
      return;
    }
    // Recomputed after the picker await: the list can move while it is open,
    // and a stale slot would quietly make a second cover.
    const position = nextPosition();
    if (position == null) {
      return;
    }
    try {
      await upload.mutateAsync({ localUri: picked.assets[0].uri, position });
      haptics.success();
    } catch {
      // Surfaced by the global mutation error alert; nothing to undo here.
    }
  };

  const confirmRemove = (photo: PhotoRow) => {
    Alert.alert(
      photo.position === 0 ? 'Remove your cover photo?' : 'Remove this photo?',
      undefined,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(photo) },
      ]
    );
  };

  return (
    <View
      style={styles.block}
      onLayout={(event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width))}>
      <ThemedText type="footnote" themeColor="textSecondary">
        Photos of the place, not of a person. The first one is your cover.
      </ThemedText>
      {size > 0 ? (
        <View style={[styles.grid, { gap: PHOTO_GAP }]}>
          {photos.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              size={size}
              cover={photo.position === 0}
              onRemove={() => confirmRemove(photo)}
            />
          ))}
          {full ? null : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={photos.length === 0 ? 'Add your cover photo' : 'Add a photo'}
              haptic="soft"
              scaleTo={0.97}
              disabled={upload.isPending}
              onPress={pick}
              containerStyle={{ width: size, height: size }}
              style={[
                styles.tile,
                styles.emptyTile,
                { width: size, height: size, borderColor: theme.hairline },
              ]}>
              {upload.isPending ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <SymbolView
                  name={{ ios: 'plus', android: 'add', web: 'add' }}
                  size={22}
                  tintColor={theme.textSecondary}
                />
              )}
            </PressableScale>
          )}
        </View>
      ) : (
        <View style={[styles.gridPlaceholder, { backgroundColor: theme.surfaceSunken }]} />
      )}
      <ThemedText type="footnote" themeColor="textSecondary">
        {photos.length} of {PHOTOS_MAX}
      </ThemedText>
    </View>
  );
}

// -- Links ---------------------------------------------------------------------

function valuePlaceholder(kind: BusinessLinkKind): string {
  switch (kind) {
    case 'phone':
    case 'whatsapp':
      return '+34 600 123 456';
    case 'email':
      return 'hello@yourplace.com';
    case 'instagram':
    case 'tiktok':
    case 'facebook':
    case 'x':
      return '@yourplace, or the full link';
    default:
      return 'https://';
  }
}

function BusinessLinks({ businessId }: { businessId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: links = [] } = useBusinessLinks(businessId);
  const [kind, setKind] = useState<BusinessLinkKind | null>(null);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  const add = useMutation({
    mutationFn: addLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-links', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
    },
  });
  const remove = useMutation({
    mutationFn: removeLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-links', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
    },
  });

  const full = links.length >= LINKS_MAX;
  const ready = kind != null && label.trim().length > 0 && value.trim().length > 0;

  const save = async () => {
    if (kind == null || !ready) {
      return;
    }
    try {
      await add.mutateAsync({
        businessId,
        kind,
        label: label.trim(),
        value: value.trim(),
        position: links.length,
      });
      haptics.success();
      setKind(null);
      setLabel('');
      setValue('');
    } catch {
      // The database owns the rules here (https only, real domains, a phone
      // number that looks like one) and its words are better than ours, so
      // the global alert says them and what was typed stays put.
    }
  };

  return (
    <View style={styles.block}>
      <ThemedText type="footnote" themeColor="textSecondary">
        Your site, your menu, your socials, the number people ring. All in one list.
      </ThemedText>

      {links.length > 0 ? (
        <View style={styles.list}>
          {links.map((row) => (
            <Animated.View
              key={row.id}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              layout={LinearTransition.springify()}>
              <View style={[styles.row, { backgroundColor: theme.surfaceSunken }]}>
                <View style={styles.rowText}>
                  <ThemedText type="callout">{row.label}</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                    {LINK_LABEL[row.kind]} · {row.value}
                  </ThemedText>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${row.label}`}
                  haptic="light"
                  scaleTo={0.9}
                  hitSlop={8}
                  onPress={() => remove.mutate(row.id)}
                  style={styles.removeHit}>
                  <SymbolView
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={13}
                    tintColor={theme.textSecondary}
                  />
                </PressableScale>
              </View>
            </Animated.View>
          ))}
        </View>
      ) : null}

      {full ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          That is ten, which is as many as you can have. Take one off to add another.
        </ThemedText>
      ) : (
        <View style={styles.addCard}>
          <SelectField
            label="What is it?"
            placeholder="Pick one"
            options={LINK_OPTIONS}
            value={kind}
            onChange={(next) => {
              // The label follows the kind until somebody types over it, so
              // the common case (a Menu button that says "Menu") is free.
              setKind(next);
              if (label.trim() === '' || LINK_OPTIONS.some((o) => o.label === label)) {
                setLabel(LINK_LABEL[next]);
              }
            }}
          />
          {kind ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.addFields}>
              <FormTextField
                label="What the button says"
                placeholder="Book a table"
                value={label}
                onChangeText={setLabel}
                maxLength={40}
              />
              <FormTextField
                label="Where it goes"
                placeholder={valuePlaceholder(kind)}
                value={value}
                onChangeText={setValue}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={
                  kind === 'phone' || kind === 'whatsapp'
                    ? 'phone-pad'
                    : kind === 'email'
                      ? 'email-address'
                      : 'url'
                }
                {...keyboardDoneProps}
                maxLength={300}
              />
              <PrimaryButton
                label="Add it"
                variant="tonal"
                disabled={!ready}
                loading={add.isPending}
                accessibilityLabel="Add it"
                onPress={save}
              />
            </Animated.View>
          ) : null}
        </View>
      )}

      <ThemedText type="footnote" themeColor="textSecondary">
        {links.length} of {LINKS_MAX}
      </ThemedText>
    </View>
  );
}

// -- The screen ----------------------------------------------------------------

export default function BusinessEditScreen() {
  const theme = useTheme();
  const { data: business } = useOwnBusiness();
  const hours = useBusinessHours(business?.id ?? null);

  // Only reachable from the owner's own dashboard, so the listing is always
  // there by the time this renders, the same way edit-profile can count on a
  // profile row.
  if (!business) {
    return null;
  }
  // The hours editor seeds its rules from the rows, so it cannot mount before
  // they land without a state-syncing effect to keep the two in step.
  if (hours.data == null) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator color={theme.accent} />
      </ThemedView>
    );
  }
  return <BusinessEditForm business={business} hourRows={hours.data} />;
}

function BusinessEditForm({
  business,
  hourRows,
}: {
  business: MyBusinessRow;
  hourRows: HourRow[];
}) {
  const theme = useTheme();
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  const updateBusiness = useUpdateOwnBusiness(business.id);
  const { section } = useLocalSearchParams<{ section?: Section }>();

  const scroller = useRef<ScrollView>(null);
  const [targetY, setTargetY] = useState<number | null>(null);

  // Only the block that was asked for reports its position, and the scroll
  // happens in an effect: a handler created during render may not touch a
  // ref, and the scroller has its content height by the time this runs.
  const measure = (key: Section) => (event: LayoutChangeEvent) => {
    if (section === key) {
      setTargetY(event.nativeEvent.layout.y);
    }
  };

  useEffect(() => {
    if (targetY == null) {
      return;
    }
    scroller.current?.scrollTo({ y: Math.max(targetY - Space.md, 0), animated: false });
  }, [targetY]);

  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description ?? '');
  const [placeLabel, setPlaceLabel] = useState(business.place_label ?? '');
  const [hoursNote, setHoursNote] = useState(business.hours_note ?? '');
  const [website, setWebsite] = useState(business.website_url ?? '');

  // A place with no hours yet still gets a line to fill in, so the block is
  // never an empty heading. No days picked means nothing is written.
  const [rules, setRules] = useState<HourRule[]>(() => {
    const parsed = rulesFromRows(hourRows);
    return parsed.length > 0
      ? parsed
      : [{ id: 'first', days: [], opens: DEFAULT_OPENS, closes: DEFAULT_CLOSES }];
  });
  const ruleSeq = useRef(0);

  const saveHours = useMutation({
    mutationFn: () => replaceHours(business.id, rules, hourRows),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-hours', business.id] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', business.id] });
      queryClient.invalidateQueries({ queryKey: ['city-businesses'] });
    },
  });

  const nameChanged = name.trim() !== business.name;
  const hoursChanged = serializeRules(rules) !== serializeRules(rulesFromRows(hourRows));
  const detailsChanged =
    nameChanged ||
    description.trim() !== (business.description ?? '') ||
    placeLabel.trim() !== (business.place_label ?? '') ||
    hoursNote.trim() !== (business.hours_note ?? '') ||
    website.trim() !== (business.website_url ?? '');
  const dirty = detailsChanged || hoursChanged;

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length < NAME_MIN
      ? 'A place needs a name, even a short one.'
      : trimmedName.length > NAME_MAX
        ? `That is longer than ${NAME_MAX} characters. Use the name on the sign.`
        : null;
  const descriptionError =
    description.length > DESCRIPTION_MAX
      ? `That is ${description.length - DESCRIPTION_MAX} characters too long.`
      : null;
  const brokenRule = rules.find((rule) => rule.days.length > 0 && rule.opens === rule.closes);
  const valid = nameError == null && descriptionError == null && brokenRule == null;

  const close = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Drop your changes?', "You'll lose what you just typed.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Drop them', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const save = async () => {
    if (!valid) {
      return;
    }
    try {
      if (detailsChanged) {
        await updateBusiness.mutateAsync({
          name: trimmedName,
          description: description.trim() || null,
          place_label: placeLabel.trim() || null,
          hours_note: hoursNote.trim() || null,
          website_url: website.trim() || null,
        });
      }
      if (hoursChanged) {
        await saveHours.mutateAsync();
      }
      haptics.success();
      router.back();
    } catch {
      // Surfaced by the global mutation error alert; stay on the form so
      // nothing typed is lost.
    }
  };

  const toggleDay = (ruleId: string, weekday: number) => {
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              days: rule.days.includes(weekday)
                ? rule.days.filter((day) => day !== weekday)
                : [...rule.days, weekday].sort((a, b) => a - b),
            }
          : rule
      )
    );
  };

  const setRuleTime = (ruleId: string, field: 'opens' | 'closes', time: string) => {
    setRules((current) =>
      current.map((rule) => (rule.id === ruleId ? { ...rule, [field]: time } : rule))
    );
  };

  return (
    <StepScreen
      title="Edit your place"
      continueLabel="Save"
      continueDisabled={!valid}
      note={
        brokenRule
          ? 'One of your hour lines opens and closes at the same time.'
          : (descriptionError ?? nameError)
      }
      continueLoading={updateBusiness.isPending || saveHours.isPending}
      onContinue={save}
      onClose={close}
      scrollRef={scroller}>
      <View onLayout={measure('details')} />
      <FormTextField
        label="Name"
        value={name}
        onChangeText={setName}
        error={nameError}
        maxLength={NAME_MAX + 20}
      />
      {/* Said here rather than in an alert afterwards, because by then the
          place is already off the map: the rename trigger clears verified_at
          and drops a listed place back to unconfirmed. */}
      <ThemedText type="footnote" themeColor={nameChanged ? 'warning' : 'textSecondary'}>
        {nameChanged
          ? 'You changed the name. Saving takes the place off the map until you confirm your email again, and the check goes with it.'
          : 'Change the name and the place comes off the map until you confirm your email again. The check goes with it.'}
      </ThemedText>

      <FormTextField
        label="About the place"
        placeholder="What it's like, who turns up, what to order."
        multiline
        numberOfLines={4}
        style={styles.multiline}
        value={description}
        onChangeText={setDescription}
        error={descriptionError}
        hint={
          description.length > DESCRIPTION_MAX - 100
            ? `${DESCRIPTION_MAX - description.length} characters left`
            : undefined
        }
        {...keyboardDoneProps}
      />
      <FormTextField
        label="Finding the door"
        placeholder="Two minutes from the station, blue door"
        value={placeLabel}
        onChangeText={setPlaceLabel}
        maxLength={PLACE_LABEL_MAX}
        hint="The bit a map pin cannot tell anyone."
      />
      <FormTextField
        label="Anything the hours miss"
        placeholder="Kitchen shuts at 22:00. Closed on public holidays."
        value={hoursNote}
        onChangeText={setHoursNote}
        maxLength={HOURS_NOTE_MAX}
      />
      <FormTextField
        label="Website"
        placeholder="https://"
        value={website}
        onChangeText={setWebsite}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={WEBSITE_MAX}
      />

      <ThemedText type="smallBold" onLayout={measure('hours')}>
        Hours
      </ThemedText>
      <View style={styles.block}>
        {rules.map((rule, index) => {
          const ruleName = index === 0 ? 'first set of hours' : `set of hours ${index + 1}`;
          return (
            <Animated.View
              key={rule.id}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(150)}
              layout={LinearTransition.springify()}
              style={[styles.ruleCard, { backgroundColor: theme.surfaceSunken }]}>
              <View style={styles.ruleHeader}>
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.flex}>
                  {daysSummary(rule.days)}
                </ThemedText>
                {rules.length > 1 ? (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`Remove the ${ruleName}`}
                    haptic="light"
                    scaleTo={0.9}
                    hitSlop={8}
                    onPress={() =>
                      setRules((current) => current.filter((other) => other.id !== rule.id))
                    }
                    style={styles.removeHit}>
                    <SymbolView
                      name={{ ios: 'xmark', android: 'close', web: 'close' }}
                      size={13}
                      tintColor={theme.textSecondary}
                    />
                  </PressableScale>
                ) : null}
              </View>
              <WeekdayChips
                days={rule.days}
                ruleName={ruleName}
                onToggle={(weekday) => toggleDay(rule.id, weekday)}
              />
              <View style={styles.times}>
                <TimeField
                  label="Opens"
                  value={rule.opens}
                  accessibilityLabel={`Opening time, ${ruleName}`}
                  onChange={(time) => setRuleTime(rule.id, 'opens', time)}
                />
                <TimeField
                  label="Closes"
                  value={rule.closes}
                  accessibilityLabel={`Closing time, ${ruleName}`}
                  onChange={(time) => setRuleTime(rule.id, 'closes', time)}
                />
              </View>
            </Animated.View>
          );
        })}
        <PrimaryButton
          label="Add different hours for some days"
          variant="tonal"
          accessibilityLabel="Add different hours for some days"
          onPress={() => {
            ruleSeq.current += 1;
            setRules((current) => [
              ...current,
              {
                id: `rule-${ruleSeq.current}`,
                days: [],
                opens: DEFAULT_OPENS,
                closes: DEFAULT_CLOSES,
              },
            ]);
          }}
        />
        <ThemedText type="footnote" themeColor="textSecondary">
          Past midnight is fine. 20:00 to 2:00 reads as one night.
        </ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          A day you leave out reads as closed.
        </ThemedText>
      </View>

      <ThemedText type="smallBold" onLayout={measure('links')}>
        Links and contact
      </ThemedText>
      <BusinessLinks businessId={business.id} />

      <ThemedText type="smallBold" onLayout={measure('photos')}>
        Photos
      </ThemedText>
      <BusinessPhotos businessId={business.id} userId={userId} />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
  block: {
    alignSelf: 'stretch',
    gap: Space.md,
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  ruleCard: {
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    minWidth: HitTarget,
    minHeight: HitTarget - 8,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  times: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space.lg,
  },
  timeField: {
    gap: Space.xs,
  },
  timeButton: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
  },
  list: {
    gap: Space.sm,
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
  removeHit: {
    width: HitTarget - 10,
    height: HitTarget - 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    gap: Space.md,
  },
  addFields: {
    gap: Space.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridPlaceholder: {
    height: 120,
    borderRadius: Radius.lg,
  },
  tile: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTile: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  tileChip: {
    position: 'absolute',
    left: Space.sm,
    bottom: Space.sm,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
  },
  removeAnchor: {
    position: 'absolute',
    right: Space.xs,
    top: Space.xs,
  },
  removeDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
