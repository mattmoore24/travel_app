import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Elevation, Motion, Radius, Space } from '@/constants/theme';
import { useTabDockBottom } from '@/hooks/use-tab-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { usePhotoUrl } from '@/features/profile/hooks';
import type { AcceptedMatch } from '@/features/matching/use-accepted-celebration';
import { haptics } from '@/lib/haptics';

/**
 * Somebody you messaged said yes.
 *
 * This used to be a full-screen takeover: the brand field over every tab, a
 * 168pt photo springing in behind an amber ring, and a glow breathing on an
 * infinite repeat. The words were right - "Connected with {name}", "Go to
 * chat" - and the presentation was the thing the brief bans by name. The
 * research is explicit about it, on three separate do-not-copy lists: the
 * match ceremony is the most recognisable dating moment in existence, and
 * Samewhere's version of it stays quiet, spending one budgeted success haptic
 * and nothing else.
 *
 * So: a card at the bottom of whatever screen you are on. It does not cover
 * the app, it does not take the keyboard, and it goes away.
 *
 * The verification nudge that used to ride along has gone with it. "Nothing
 * more" excludes an upsell, and the badge is asked for on the profile.
 */
export function ConnectedNotice({
  match,
  onDismiss,
}: {
  match: AcceptedMatch;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const dockBottom = useTabDockBottom();
  const { data: photoUrl } = usePhotoUrl(match.photoPath);

  useEffect(() => {
    const timer = setTimeout(() => haptics.success(), 120);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View
      entering={FadeInDown.duration(Motion.standard)}
      exiting={FadeOutDown.duration(Motion.quick)}
      style={[styles.dock, { bottom: dockBottom }]}
      pointerEvents="box-none">
      <ThemedView type="surface" style={[styles.card, Elevation.floating]}>
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
            ) : (
              <SymbolView
                name={{ ios: 'person.fill', android: 'person', web: 'person' }}
                size={20}
                tintColor={theme.textSecondary}
              />
            )}
          </View>
          <ThemedText type="callout" style={styles.name} numberOfLines={1}>
            Connected with {match.name}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={10}
            onPress={onDismiss}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={14}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        </View>
        <PrimaryButton
          label="Go to chat"
          onPress={() => {
            onDismiss();
            router.push(`/chat/${match.chatId}`);
          }}
        />
      </ThemedView>
    </Animated.View>
  );
}

const AVATAR = 40;

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    // Above the tab bar, below a sheet. It is a notice, not a screen.
    zIndex: 40,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Space.lg,
    gap: Space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  name: {
    flex: 1,
    fontWeight: '600',
  },
});
