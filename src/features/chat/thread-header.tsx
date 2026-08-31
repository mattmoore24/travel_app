import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The avatar slot, at the size every messaging app draws it. */
const AVATAR = 32;

/**
 * One header row for a conversation: back, face, name, and whatever this
 * screen puts on the right.
 *
 * Every thread used to wear two storeys of chrome — an empty native nav bar
 * carrying only a back chevron, then the app's own identity band underneath,
 * starting at the left margin so nothing lined up with the chevron. That is
 * about 110pt above a mostly empty thread, and it breaks the association a
 * messaging header depends on: back button, face and name are one object in
 * every app people already use.
 *
 * The screens that mount this set `headerShown: false` for themselves and take
 * the top safe-area edge on their own SafeAreaView, so the inset is applied
 * once, by the container, rather than twice.
 */
export function ThreadHeader({
  photoUrl,
  glyph,
  title,
  subtitle,
  trailing,
  onPressIdentity,
  identityLabel,
}: {
  /** A signed URL for the face, or null while it signs and when there is none. */
  photoUrl?: string | null;
  /** What stands in for a missing photo. Omit for no avatar slot at all. */
  glyph?: SymbolViewProps['name'] | null;
  title: string;
  /** A second line under the name. A node, because a room's is a sentence
   * assembled from four facts. */
  subtitle?: ReactNode;
  /** This screen's own controls, on the right. */
  trailing?: ReactNode;
  /** Opening whoever or whatever the name belongs to. */
  onPressIdentity?: (() => void) | null;
  /** What VoiceOver says the identity block opens. */
  identityLabel?: string;
}) {
  const theme = useTheme();
  const identity = (
    <>
      {glyph !== undefined ? (
        <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
          ) : glyph ? (
            <SymbolView name={glyph} size={16} tintColor={theme.textSecondary} />
          ) : null}
        </View>
      ) : null}
      {/* The text column shrinks and the row grows: a 32pt avatar beside a
          title and a subtitle at 200% type is the classic clipped header, and
          a fixed height is what causes it. */}
      <View style={styles.names}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {title}
        </ThemedText>
        {typeof subtitle === 'string' ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : (
          subtitle
        )}
      </View>
    </>
  );

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        // One back control per screen, with a label nothing else on it shares:
        // two identical labels are ambiguous under VoiceOver.
        accessibilityLabel="Back"
        hitSlop={10}
        // Never a bare router.back(). A cold-start deep link builds a
        // navigation state containing only this route, and GO_BACK is then
        // dispatched into a navigator that does not handle it — silently, so
        // the chevron simply does nothing (traps).
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
        style={styles.back}>
        <SymbolView
          name={{ ios: 'chevron.backward', android: 'arrow_back', web: 'arrow_back' }}
          size={20}
          tintColor={theme.text}
        />
      </Pressable>
      {onPressIdentity ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={identityLabel}
          onPress={onPressIdentity}
          style={styles.identity}>
          {identity}
        </Pressable>
      ) : (
        <View accessibilityRole="header" style={styles.identity}>
          {identity}
        </View>
      )}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: Space.sm,
    paddingRight: Space.lg,
    paddingVertical: Space.sm,
  },
  back: {
    minWidth: HitTarget,
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  names: {
    flexShrink: 1,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
