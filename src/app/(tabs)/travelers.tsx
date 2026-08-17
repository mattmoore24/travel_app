import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useMatches, useMyChats, useSentRequests } from '@/features/matching/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { formatDateRange } from '@/features/trips/dates';
import { useCancelTrip, useMyTrips } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import type { MatchRow, SentRequestRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

function TripChip({
  city,
  range,
  onCancel,
}: {
  city: string;
  range: string;
  onCancel: () => void;
}) {
  return (
    <Pressable
      onLongPress={() =>
        Alert.alert('Cancel this trip?', `${city} · ${range}`, [
          { text: 'Keep', style: 'cancel' },
          { text: 'Cancel trip', style: 'destructive', onPress: onCancel },
        ])
      }>
      <ThemedView type="backgroundElement" style={styles.tripChip}>
        <ThemedText type="smallBold">{city}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {range}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function MatchCard({
  match,
  sent,
  chatId,
}: {
  match: MatchRow;
  sent: SentRequestRow | undefined;
  chatId: string | undefined;
}) {
  const theme = useTheme();
  const { data: photoUrl } = usePhotoUrl(match.photo_path);

  // An existing chat (either direction's accept) always wins over composing.
  const openChatId =
    chatId ?? (sent?.state === 'accepted' ? (sent.chat_id ?? undefined) : undefined);
  const requested = openChatId == null && sent?.state === 'sent';

  const action = () => {
    if (openChatId) {
      router.push(`/chat/${openChatId}`);
      return;
    }
    router.push({
      pathname: '/compose-request',
      params: {
        userId: match.user_id,
        name: match.display_name ?? 'Traveler',
        photoPath: match.photo_path ?? '',
      },
    });
  };

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${match.display_name ?? 'traveler'}'s profile`}
        onPress={() => router.push(`/profile/${match.user_id}`)}
        style={[styles.cardPhoto, { backgroundColor: theme.backgroundSelected }]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.cardImage} contentFit="cover" />
        ) : (
          <SymbolView
            name={{ ios: 'person.fill', android: 'person', web: 'person' }}
            size={40}
            tintColor={theme.textSecondary}
          />
        )}
      </Pressable>
      <View style={styles.cardBody}>
        <Pressable onPress={() => router.push(`/profile/${match.user_id}`)}>
          <View style={styles.nameRow}>
            <ThemedText type="smallBold" style={styles.nameText}>
              {match.display_name ?? 'Traveler'}
              {match.age != null ? `, ${match.age}` : ''}
            </ThemedText>
            {match.verified ? (
              <SymbolView
                name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                size={14}
                tintColor={theme.tint}
              />
            ) : null}
          </View>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          {match.city_name} · {formatDateRange(match.overlap_start, match.overlap_end)} together
        </ThemedText>
        {match.bio ? (
          <ThemedText type="small" numberOfLines={2}>
            {match.bio}
          </ThemedText>
        ) : null}
        <PrimaryButton
          variant={requested ? 'ghost' : 'filled'}
          label={openChatId ? 'Open chat' : requested ? 'Requested' : 'Say hi'}
          disabled={requested}
          onPress={action}
        />
      </View>
    </ThemedView>
  );
}

export default function TravelersScreen() {
  const insets = useSafeAreaInsets();
  const tripsQuery = useMyTrips();
  const trips = tripsQuery.data ?? [];
  const { data: matches = [] } = useMatches();
  const { data: sentRequests = [] } = useSentRequests();
  const { data: chats = [] } = useMyChats();
  const cancelTrip = useCancelTrip();

  // §6: matching DAU (the comparison metric for the map-led thesis) and
  // browse depth.
  useEffect(() => {
    analytics.capture('travelers_viewed');
  }, []);
  useEffect(() => {
    if (matches.length > 0) {
      analytics.capture('matches_viewed', { count: matches.length });
    }
  }, [matches.length]);

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
        title="Travelers"
        phase="waiting on backend keys"
        description="Add Supabase keys to .env to post trips and browse travelers with overlapping dates."
      />
    );
  }

  const sentByRecipient = new Map(sentRequests.map((r) => [r.recipient_id, r]));
  const chatByUser = new Map(
    chats.filter((c) => c.chat_status === 'active').map((c) => [c.other_user_id, c.chat_id])
  );
  // One card per traveler; get_matches is ordered soonest-first, so first-wins
  // keeps the nearest shared window.
  const byUser = new Map<string, MatchRow>();
  for (const match of matches) {
    if (!byUser.has(match.user_id)) {
      byUser.set(match.user_id, match);
    }
  }
  const uniqueMatches = [...byUser.values()];

  const header = (
    <View style={styles.headerBlock}>
      <ThemedText type="subtitle">Travelers</ThemedText>
      <View style={styles.tripsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tripsScroll}>
          {trips.map((trip) => (
            <TripChip
              key={trip.id}
              city={trip.cities.name}
              range={formatDateRange(trip.start_date, trip.end_date)}
              onCancel={() => cancelTrip.mutate(trip.id)}
            />
          ))}
          <Pressable onPress={() => router.push('/add-trip')}>
            <ThemedView type="backgroundElement" style={[styles.tripChip, styles.addTrip]}>
              <ThemedText type="smallBold">＋ Add trip</ThemedText>
            </ThemedView>
          </Pressable>
        </ScrollView>
      </View>
      {trips.length > 0 && uniqueMatches.length === 0 ? (
        <ThemedText themeColor="textSecondary">
          No overlapping travelers yet — you&apos;ll see them here as more people post trips.
        </ThemedText>
      ) : null}
    </View>
  );

  // Don't flash the first-trip empty state while the cache is still cold.
  if (tripsQuery.isPending) {
    return <ThemedView style={styles.root} />;
  }

  if (trips.length === 0) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
        title="Travelers"
        phase="where are you headed?"
        description="Post a trip to see other travelers who'll be in the same city on your dates.">
        <PrimaryButton label="Add your first trip" onPress={() => router.push('/add-trip')} />
      </PlaceholderScreen>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <FlatList
        style={styles.list}
        data={uniqueMatches}
        keyExtractor={(m) => m.user_id}
        ListHeaderComponent={header}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
        ]}
        renderItem={({ item }) => (
          <MatchCard
            match={item}
            sent={sentByRecipient.get(item.user_id)}
            chatId={chatByUser.get(item.user_id)}
          />
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  headerBlock: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  tripsRow: {
    marginHorizontal: -Spacing.four,
  },
  tripsScroll: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  tripChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: 2,
  },
  addTrip: {
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  cardPhoto: {
    width: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  nameText: {
    fontSize: 16,
  },
});
