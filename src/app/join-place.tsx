import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useBusinessDetail, useIsBusiness } from '@/features/business/hooks';
import { useJoinRoom } from '@/features/rooms/hooks';
import { formatDate } from '@/features/trips/dates';
import { TripCalendar } from '@/features/trips/trip-calendar';
import { useTheme } from '@/hooks/use-theme';

/**
 * Joining the chat at a place. One question, and the answer sets the expiry.
 *
 * The calendar is the trips one, in single-date mode, and not the native
 * picker: @react-native-community/datetimepicker chooses its own colours and
 * has to be TOLD the appearance, which is how Add a trip once shipped
 * near-black text on this near-black ground.
 */
export default function JoinPlaceScreen() {
  const theme = useTheme();
  // Two callers, two shapes: the place page sends only the business id, the
  // map's place sheet sends the chat and the name it already has in hand.
  const params = useLocalSearchParams<{
    id?: string;
    businessId?: string;
    chatId?: string;
    name?: string;
  }>();
  const businessId = params.id ?? params.businessId ?? null;
  // Asked only when the caller did not bring the chat id, so the common path
  // costs no round trip.
  const { data: place } = useBusinessDetail(params.chatId ? null : businessId);
  const chatId = params.chatId ?? place?.chat_id ?? null;
  const placeName = params.name ?? place?.name ?? null;

  // Nothing is picked for them. A pre-filled date is a guess about somebody
  // else's trip, and it makes "I'm not sure yet" look like the odd answer.
  const [departure, setDeparture] = useState<string | null>(null);
  const [notSure, setNotSure] = useState(false);
  const answered = notSure || departure != null;

  const join = useJoinRoom(chatId ?? '');
  // A business is never asked when it is leaving, because a business never
  // joins a room. The founder's words: "it also doesn't make sense for the
  // business account to ever have to set a date for when it is leaving."
  // Reached only by a stale deep link now, so it turns round rather than
  // asking a question that cannot apply.
  const viewerIsBusiness = useIsBusiness();

  const submit = async () => {
    if (!chatId || !answered) {
      return;
    }
    try {
      // join_room takes a null date for "not sure" (90 days from joining);
      // the JS signature still types it `string`, so the cast is the gap
      // between the two and not a claim that this is never null.
      await join.mutateAsync((notSure ? null : departure) as string);
      router.replace(`/room/${chatId}`);
    } catch {
      // Surfaced by the global mutation error alert; stay on the question.
    }
  };

  if (viewerIsBusiness) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <StepScreen
      title="When do you leave?"
      // The screen never said which place it was about. Somebody taps Join
      // the chat at a bar and lands on a bare date question.
      subtitle={
        placeName ? `So we know when to drop you out of the chat at ${placeName}.` : undefined
      }
      continueLabel="Join the chat"
      continueDisabled={!chatId || !answered}
      continueLoading={join.isPending}
      // The chat id half was silent: arriving from the place page, the detail
      // query is still in flight, so somebody picked a date, watched the note
      // disappear, and sat looking at a greyed-out button with no sentence
      // anywhere saying why.
      note={
        !answered
          ? "Pick a day, or tap I'm not sure yet."
          : !chatId
            ? 'Getting the chat ready.'
            : null
      }
      onClose={() => router.back()}
      onContinue={submit}>
      <ThemedText type="smallBold">
        {notSure
          ? 'No date set'
          : departure
            ? `You leave ${formatDate(departure)}`
            : 'Tap the day you go'}
      </ThemedText>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="I'm not sure when I leave"
        accessibilityState={{ selected: notSure }}
        haptic="selection"
        scaleTo={0.98}
        onPress={() => {
          setNotSure(true);
          setDeparture(null);
        }}>
        <ThemedView
          type={notSure ? 'accentSoft' : 'backgroundElement'}
          // The border is always drawn and only ever changes colour, so
          // choosing this row cannot shove the fine print below it.
          style={[styles.notSure, { borderColor: notSure ? theme.accent : 'transparent' }]}>
          <SymbolView
            name={
              notSure
                ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                : {
                    ios: 'circle',
                    android: 'radio_button_unchecked',
                    web: 'radio_button_unchecked',
                  }
            }
            size={20}
            tintColor={notSure ? theme.accent : theme.textSecondary}
          />
          <ThemedText>I&apos;m not sure yet</ThemedText>
        </ThemedView>
      </PressableScale>

      {/* A range picker asked for one date: whichever end the tap landed on
          is the day they meant, and holding `end` at null keeps the run of
          highlighted days from ever being drawn. Four months because the
          membership is capped at 90 days either way, so a departure further
          out than that buys exactly what "I'm not sure yet" buys. */}
      <TripCalendar
        start={notSure ? null : departure}
        end={null}
        months={4}
        onChange={(nextStart, nextEnd) => {
          setNotSure(false);
          setDeparture(nextEnd ?? nextStart);
        }}
      />

      <ThemedText type="footnote" themeColor="textSecondary">
        You&apos;ll drop out of the chat three days after you leave town. Come back or leave
        whenever you like.
      </ThemedText>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  notSure: {
    minHeight: HitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
});
