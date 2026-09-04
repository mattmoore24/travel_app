import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { LoadError } from '@/components/ui/load-error';
import { SelectField } from '@/components/form/select-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, NativeAppearance, Radius, Space } from '@/constants/theme';
import { BusinessAddressField, addressFrom } from '@/features/business/address-field';
import { PlaceGlyph } from '@/features/business/business-marker';
import { BusinessPhotos } from '@/features/business/business-photos';
import {
  useOwnBusiness,
  useUpdateBusinessLocation,
  useUpdateOwnBusiness,
} from '@/features/business/hooks';
import { LINK_LABEL, shortTime, weekdayLabel } from '@/features/business/vocabulary';
import { useLaunchCities } from '@/features/pins/hooks';
import { LocationPicker } from '@/features/pins/location-picker';
import { useOwnUserId } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessLinkKind, Database, MyBusinessRow } from '@/lib/database.types';
import { haptics } from '@/lib/haptics';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type HourRow = Database['public']['Tables']['business_hours']['Row'];
type LinkRow = Database['public']['Tables']['business_links']['Row'];

/** Which block the caller's Edit affordance was pointing at. */
/**
 * Exported so the dashboard's rows are typed against it. They were `string`,
 * and a row asking for `"description"` — a member that has never existed —
 * compiled, shipped, and opened the editor at the top instead of at the
 * field the row named.
 */
export type Section = 'details' | 'location' | 'hours' | 'links' | 'photos';

/**
 * The screen's own name, per section, and the list of sections there are.
 *
 * A caller that names a section gets ONLY that block, titled for it. It used
 * to get the whole 1,430-line form scrolled to a heading, which is how three
 * signup steps in a row promised a step and delivered somebody else's
 * settings screen: run 49 photographed what an owner saw after asking for
 * photos, which was 'Add different hours for some days', a links list, an
 * orphaned 'What is it? / Pick one' showing no selection, '2 of 10', a dashed
 * square, '0 of 10' and Save. A Save button that writes nine other fields is
 * also the wrong control to put under a one-question step.
 *
 * Every field belongs to exactly one section, so nothing becomes unreachable:
 * 'Finding the door' is location's (it is what a map cannot say) and
 * 'Anything the hours miss' is hours'. The spec for this change named only
 * name/description/website and address/city/marker, and those two would have
 * had no home at all.
 */
const SECTION_TITLE: Record<Section, string> = {
  details: 'Your name and description',
  location: 'Where you are',
  hours: 'Your hours',
  links: 'Links and contact',
  photos: 'Your photos',
};

const NAME_MIN = 2;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 600;
const PLACE_LABEL_MAX = 120;
const ADDRESS_MAX = 160;
const HOURS_NOTE_MAX = 200;
const WEBSITE_MAX = 300;
/** The database's cap; this only keeps the UI honest about it. */
const LINKS_MAX = 10;

const LINK_OPTIONS = (Object.keys(LINK_LABEL) as BusinessLinkKind[]).map((kind) => ({
  value: kind,
  label: LINK_LABEL[kind],
}));

// -- What actually costs the check ---------------------------------------------
//
// `business_rename_resets` used to compare name, city_id, lat and lng with `is
// distinct from`, so "Cafe Janis" becoming "Café Janis", or the marker moving
// onto the actual door, nulled verified_at and dropped a listed business back
// to 'unconfirmed'. The badge was earned by somebody standing outside taking
// two photos and it was destroyed by a typo fix, which meant the app was
// honestly telling owners that the safest thing they could do was leave a
// wrong name and a wrong marker alone. Those are exactly the corrections that
// make the map better.
//
// 20260902100000_a_typo_is_not_a_hijack.sql narrowed the trigger to a
// NORMALISED rename, a city change, or a move over seventy-five metres. The
// two helpers below are the client's copy of the same two thresholds, and
// they exist so the warnings on this screen say what the database will
// actually do rather than the worst case.

/** Seventy-five metres: wider than a doorway, narrower than a building. */
export const MOVE_RESETS_KM = 0.075;

/** The same great-circle distance `public.haversine_km` computes, in km. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Whether this marker move is far enough to cost the listing and the check.
 *
 * A ten-metre nudge onto the real door is not a move; it is an owner making
 * the map right. Exported for its own unit test, because the threshold IS the
 * argument and an off-by-a-factor here either re-punishes accuracy or lets a
 * surf shack walk to the Marriott's address.
 */
export function movedFar(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): boolean {
  return haversineKm(from.lat, from.lng, to.lat, to.lng) > MOVE_RESETS_KM;
}

/**
 * A name as the trigger compares it: case-folded, whitespace-collapsed and
 * stripped of accents.
 *
 * Deliberately a SUBSET of what Postgres `unaccent` folds away — this strips
 * combining marks and nothing else, where unaccent also maps ß to ss and Æ to
 * AE. That direction is the safe one: this can only decide two names differ
 * when the database would call them the same, so the screen can over-warn but
 * never promise a check that the trigger is about to take.
 */
export function normalizedName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

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
 * Deliberately not ChipRail, which labels each chip for VoiceOver with its own
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

// -- Links ---------------------------------------------------------------------

function valuePlaceholder(kind: BusinessLinkKind): string {
  switch (kind) {
    case 'phone':
    case 'whatsapp':
      return '+34 600 123 456';
    case 'email':
      return 'hello@yourbusiness.com';
    case 'instagram':
    case 'tiktok':
    case 'facebook':
    case 'x':
      return '@yourbusiness, or the full link';
    default:
      return 'https://';
  }
}

function BusinessLinks({
  businessId,
  onCommitted,
}: {
  businessId: string;
  /** Fired once a link has actually been written, or actually removed. */
  onCommitted?: () => void;
}) {
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
      onCommitted?.();
    },
  });
  const remove = useMutation({
    mutationFn: removeLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-links', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business-detail', businessId] });
      onCommitted?.();
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
  // A spinner is the right answer while the rows are on their way, and the
  // wrong one after the retries have run out: `data` stays undefined either
  // way, so this screen span forever on hostel wifi with no message and no
  // way out but killing the app. Every other screen in this feature uses
  // LoadError; this one has to as well.
  if (hours.isError) {
    return (
      <ThemedView style={styles.loading}>
        <LoadError what="your hours" error={hours.error} onRetry={hours.refetch} />
      </ThemedView>
    );
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
  // Checked against the union rather than trusted: this is a route param, so
  // anything at all can arrive in it, and an unrecognised value under a
  // section gate would render a form with no fields in it and a Save button.
  // Unknown means "the whole thing", which is what it used to mean.
  const params = useLocalSearchParams<{ section?: string }>();
  const section: Section | null =
    params.section != null && params.section in SECTION_TITLE ? (params.section as Section) : null;
  /** Whether this block is on screen at all. No section means all of them. */
  const shows = (key: Section) => section == null || section === key;

  /**
   * Whether anything on this screen has ALREADY been written.
   *
   * Photos and links own their own mutations and commit on the tap; the name,
   * the description, the hours and the marker are held until Save. Tracked
   * separately from `dirty` on purpose: `dirty` is what decides whether Save
   * has work to do, and folding a committed photo into it would make Save
   * start saving photos, which it has never owned and must not begin owning.
   */
  const [committed, setCommitted] = useState(false);
  const noteCommitted = () => setCommitted(true);

  // No measure-and-scroll any more, and deliberately none: the named block is
  // the only thing mounted, so it is already at the top. The old version
  // waited on an onLayout from a block that would now never mount, and a
  // targetY that never arrives is a scroll that never happens on a screen
  // that has quietly stopped saying why.

  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description ?? '');
  const [address, setAddress] = useState(business.address ?? '');
  const [placeLabel, setPlaceLabel] = useState(business.place_label ?? '');
  const [hoursNote, setHoursNote] = useState(business.hours_note ?? '');
  const [website, setWebsite] = useState(business.website_url ?? '');
  // The marker, which the update grant refuses and a function owns instead
  // (update_business_location: a business that could move its own marker
  // could verify a surf shack and then become the Marriott). The editor used
  // to say so in a comment and leave the owner no way to do it at all, so a
  // business that moved premises had a listing on the wrong door forever.
  const [coords, setCoords] = useState({ lat: business.lat, lng: business.lng });
  const [cityId, setCityId] = useState(business.city_id);
  // Same reason as signup: with the keyboard up there is one field's worth of
  // room left, and the suggestion list was landing in it.
  const [addressFocused, setAddressFocused] = useState(false);
  const moveBusiness = useUpdateBusinessLocation();
  const { data: launchCities = [] } = useLaunchCities();
  const city = launchCities.find((row) => row.city_id === cityId) ?? null;

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
  // Any move at all is still a save — update_business_location owns lat, lng
  // and city_id, and an owner who nudges the marker onto their real door
  // means it. What changed is what a move COSTS: only a city change or a jump
  // over seventy-five metres resets the check now, so those two are what the
  // warnings are allowed to talk about.
  const cityChanged = cityId !== business.city_id;
  const markerMoved = coords.lat !== business.lat || coords.lng !== business.lng || cityChanged;
  const markerMovedFar = cityChanged || movedFar({ lat: business.lat, lng: business.lng }, coords);
  // The literal name change is what gets written; the normalised one is what
  // the trigger reacts to. "Cafe Janis" becoming "Café Janis" saves and costs
  // nothing, and this screen has to be able to say both halves of that.
  const nameResets = normalizedName(name) !== normalizedName(business.name);
  const hoursChanged = serializeRules(rules) !== serializeRules(rulesFromRows(hourRows));
  const detailsChanged =
    nameChanged ||
    description.trim() !== (business.description ?? '') ||
    address.trim() !== (business.address ?? '') ||
    placeLabel.trim() !== (business.place_label ?? '') ||
    hoursNote.trim() !== (business.hours_note ?? '') ||
    website.trim() !== (business.website_url ?? '');
  const dirty = detailsChanged || hoursChanged || markerMoved;

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length < NAME_MIN
      ? 'A business needs a name, even a short one.'
      : trimmedName.length > NAME_MAX
        ? `That is longer than ${NAME_MAX} characters. Use the name on the sign.`
        : null;
  const descriptionError =
    description.length > DESCRIPTION_MAX
      ? `That is ${description.length - DESCRIPTION_MAX} characters too long.`
      : null;
  const brokenRule = rules.find((rule) => rule.days.length > 0 && rule.opens === rule.closes);
  // The same two rules validate_business_link applies to a link row, said
  // here so somebody finds out while typing rather than through a database
  // refusal after Save. The server enforces them either way.
  const trimmedWebsite = website.trim();
  const websiteError =
    trimmedWebsite === ''
      ? null
      : !/^https:\/\//i.test(trimmedWebsite)
        ? 'Your website has to start with https://'
        : /^https:\/\/[0-9]{1,3}(\.[0-9]{1,3}){3}/.test(trimmedWebsite)
          ? 'That needs a real domain, not a string of numbers.'
          : null;
  const valid =
    nameError == null && descriptionError == null && websiteError == null && brokenRule == null;

  /**
   * A real rename still costs the listing and the badge, so it gets asked
   * about. A spelling of an accent, and a nudge onto the door, no longer do.
   *
   * `business_rename_resets` drops a listed business back to `unconfirmed`
   * and clears `verified_at`, so it comes off the map until a new email code
   * is typed and the check earned by standing outside with a phone is gone.
   * Since 20260902100000 that fires on a NORMALISED name change, a city
   * change, or a move over seventy-five metres — so 'Cafe Janis' becoming
   * 'Café Janis' saves and costs nothing, and this alert stays quiet for it.
   * The badge itself is deliberately NOT preserved through a genuine rename:
   * the re-confirmation mail goes to the same inbox the surf shack
   * registered, so it would survive the exact attack the reset exists for.
   */
  const save = async () => {
    if (!valid) {
      return;
    }
    if (!nameResets && !markerMovedFar) {
      await commit();
      return;
    }
    const what = nameResets
      ? markerMovedFar
        ? 'Change the name and the marker'
        : 'Change the name'
      : 'Move the marker';
    Alert.alert(
      `${what} and come off the map?`,
      `Travelers stop seeing ${business.name} until you type a new email code, and the check goes with it.`,
      [
        { text: 'Keep it as it is', style: 'cancel' },
        { text: 'Go ahead', style: 'destructive', onPress: () => void commit() },
      ]
    );
  };

  const close = () => {
    if (!dirty) {
      router.back();
      return;
    }
    // "Discard", matching edit-profile: "drop" is the create-a-pin verb
    // everywhere else in the product.
    //
    // Photos and links commit the moment they are tapped, while everything
    // else here waits for Save. "You'll lose what you just typed" was true of
    // the text and false of the photo already destroyed, so an owner who
    // tidied their page, changed their mind and discarded found the photos
    // gone and the description restored, with no way to tell which was which.
    Alert.alert(
      'Discard your changes?',
      committed
        ? 'Photos and links are already saved. The rest goes back to how it was.'
        : 'Nothing you changed here has been saved yet.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  const commit = async () => {
    try {
      if (detailsChanged) {
        await updateBusiness.mutateAsync({
          name: trimmedName,
          description: description.trim() || null,
          address: address.trim() || null,
          place_label: placeLabel.trim() || null,
          hours_note: hoursNote.trim() || null,
          website_url: website.trim() || null,
        });
      }
      if (hoursChanged) {
        await saveHours.mutateAsync();
      }
      // Last, and on its own: the address above is an ordinary column and
      // this is a geofenced function. Passing the address here as well would
      // write it twice, and the marker is deliberately allowed to disagree
      // with the words.
      if (markerMoved) {
        await moveBusiness.mutateAsync({ lat: coords.lat, lng: coords.lng, cityId });
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
      title={section ? SECTION_TITLE[section] : 'Edit your business'}
      // Photos and links commit the moment they are tapped, so on those two
      // sections there is nothing left for Save to save and the button is a
      // way out. Everywhere else it still writes the fields above it.
      continueLabel={section === 'photos' || section === 'links' ? 'Done' : 'Save'}
      continueDisabled={!valid}
      note={
        brokenRule
          ? 'One of your hour lines opens and closes at the same time.'
          : (descriptionError ?? nameError ?? websiteError)
      }
      continueLoading={updateBusiness.isPending || saveHours.isPending || moveBusiness.isPending}
      onContinue={save}
      onClose={close}>
      {shows('details') ? (
        <>
          <FormTextField
            label="Name"
            value={name}
            onChangeText={setName}
            error={nameError}
            maxLength={NAME_MAX + 20}
          />
          {/* Said here rather than in an alert afterwards, because by then the
              place is already off the map: the rename trigger clears
              verified_at and drops a listed place back to unconfirmed. */}
          <ThemedText type="footnote" themeColor={nameResets ? 'warning' : 'textSecondary'}>
            {nameResets
              ? 'You changed the name. Saving takes your business off the map until you confirm your email again, and the check goes with it.'
              : 'Accents and capitals are free to fix. A different name takes your business off the map until you confirm your email again, and the check goes with it.'}
          </ThemedText>

          <FormTextField
            label="About the business"
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
          />
          {/* Moved up out of the middle of the location block, where it sat
              between 'Finding the door' and the hours note for no reason but
              column order. It is one of the words a traveler reads, so it
              belongs with the other two. */}
          <FormTextField
            label="Website"
            placeholder="https://"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={WEBSITE_MAX}
            error={websiteError ?? undefined}
          />
        </>
      ) : null}
      {/* The address, the marker, and the bit a map cannot tell anyone. Three
          answers to three different questions, which is why moving one leaves
          the others alone. */}
      {shows('location') ? (
        <>
          {city ? (
            <BusinessAddressField
              value={address}
              cityName={city.cities.name}
              cityLat={city.cities.lat}
              cityLng={city.cities.lng}
              onFocusChange={setAddressFocused}
              onChangeText={(next) => setAddress(next.slice(0, ADDRESS_MAX))}
              // Picking a result moves both, because somebody who searched for
              // their own address meant the door and not the words.
              onPick={(place) => {
                setAddress(addressFrom(place));
                setCoords({ lat: place.latitude, lng: place.longitude });
              }}
            />
          ) : (
            <FormTextField
              label="Address"
              placeholder="Rua da Rosa 12"
              value={address}
              onChangeText={setAddress}
              maxLength={ADDRESS_MAX}
              hint="What a traveler pastes into a taxi app."
            />
          )}
          {city && !addressFocused ? (
            <>
              {launchCities.length > 1 ? (
                <SelectField
                  label="City"
                  options={launchCities.map((row) => ({
                    value: String(row.city_id),
                    label: row.cities.name,
                  }))}
                  value={String(cityId)}
                  onChange={(next) => {
                    const picked = launchCities.find((row) => String(row.city_id) === next);
                    if (!picked) {
                      return;
                    }
                    setCityId(picked.city_id);
                    // The old marker is in the old city, and the geofence would
                    // refuse it. Start at the new centre and let them place it.
                    setCoords({ lat: picked.cities.lat, lng: picked.cities.lng });
                  }}
                  hint="Where you are, not where you deliver."
                />
              ) : null}
              <LocationPicker
                // Remounted per city for the same reason signup does it: the
                // picker reads its centre once, through initialRegion.
                key={`edit-${cityId}`}
                centerLat={coords.lat}
                centerLng={coords.lng}
                lat={coords.lat}
                lng={coords.lng}
                // Street level. The question is whether the marker is on the door,
                // and a city-wide view cannot answer it.
                delta={0.004}
                // The chip travelers tap, not MapKit's red balloon — the one
                // colour the palette bans outside destructive actions.
                marker={<PlaceGlyph category={business.category} />}
                onChange={(lat, lng) => setCoords({ lat, lng })}
              />
              {/* A ten-metre nudge onto the real door produces no warning at
              all now, which is the whole point: the corrections that make the
              map better used to be the ones that cost the most. */}
              <ThemedText type="footnote" themeColor={markerMovedFar ? 'warning' : 'textSecondary'}>
                {markerMovedFar
                  ? 'You moved the marker a long way. Saving takes your business off the map until you confirm your email again, and the check goes with it.'
                  : 'Tap the map to put the marker on your door. Nudging it is free. Moving it to another street takes you off the map until you confirm your email again.'}
              </ThemedText>
            </>
          ) : null}
          <FormTextField
            label="Finding the door"
            placeholder="Two minutes from the station, blue door"
            value={placeLabel}
            onChangeText={setPlaceLabel}
            maxLength={PLACE_LABEL_MAX}
            hint="The bit the map can't tell anyone."
          />
        </>
      ) : null}

      {shows('hours') ? (
        <>
          {section == null ? <ThemedText type="smallBold">Hours</ThemedText> : null}
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
          {/* The note lives with the hours it is about, not four fields
              further down between the door and the website. */}
          <FormTextField
            label="Anything the hours miss"
            placeholder="Kitchen shuts at 22:00. Closed on public holidays."
            value={hoursNote}
            onChangeText={setHoursNote}
            maxLength={HOURS_NOTE_MAX}
          />
        </>
      ) : null}

      {shows('links') ? (
        <>
          {section == null ? <ThemedText type="smallBold">Links and contact</ThemedText> : null}
          <BusinessLinks businessId={business.id} onCommitted={noteCommitted} />
        </>
      ) : null}

      {shows('photos') ? (
        <>
          {section == null ? <ThemedText type="smallBold">Photos</ThemedText> : null}
          <BusinessPhotos businessId={business.id} userId={userId} onCommitted={noteCommitted} />
        </>
      ) : null}
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
});
