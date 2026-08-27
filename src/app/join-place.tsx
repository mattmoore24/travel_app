import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useBusinessDetail } from '@/features/business/hooks';
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
  const params = useLocalSearchParams<{ id?: string; businessId?: string; chatId?: string }>();
  const businessId = params.id ?? params.businessId ?? null;
  // Asked only when the caller did not bring the chat id, so the common path
  // costs no round trip.
  const { data: place } = useBusinessDetail(params.chatId ? null : businessId);
  const chatId = params.chatId ?? place?.chat_id ?? null;

  // Nothing is picked for them. A pre-filled date is a guess about somebody
  // else's trip, and it makes "I'm not sure yet" look like the odd answer.
  const [departure, setDeparture] = useState<string | null>(null);
  const [notSure, setNotSure] = useState(false);
  const answered = notSure || departure != null;

  const join = useJoinRoom(chatId ?? '');

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

  return (
    <StepScreen
      title="When do you leave?"
      continueLabel="Join the chat"
      continueDisabled={!chatId || !answered}
      continueLoading={join.isPending}
      note={answered ? null : "Pick a day, or tap I'm not sure yet."}
      onClose={() => router.back()}
      onContinue={submit}>
      <ThemedText type="smallBold">
        {notSure
          ? 'No date set'
          : departure
            ? `You leave ${formatDate(departure)}`
            : 'Tap the day you go'}
      </ThemedText>

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

      <ThemedText type="footnote" themeColor="textSecondary">
        You&apos;ll drop out of the chat three days after you go, or after 90 days, whichever comes
        first. Leave or come back whenever you like.
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
