import { Image } from 'expo-image';
// Renamed on import: the package's default export shares a name with a
// named one, which the lint rule reads as a likely mistake.
import makeQr from 'qrcode-generator';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * An invite as a square somebody can point a phone at.
 *
 * The hostel lobby is literally the QR use case: you are standing in front
 * of four people, and "let me get your number so I can send you a link" is
 * three steps where holding up a screen is none.
 *
 * Rendered as an inline SVG data URI through expo-image, the same way the
 * social marks are — no native module, so this ships over the air.
 *
 * Fixed black on white, deliberately. A QR code is read by a camera, not by
 * a person: theming it to the app's dark surface would drop the contrast
 * ratio scanners rely on, and a pretty code nobody can scan is not a code.
 */
export function InviteQr({ url, size = 200 }: { url: string; size?: number }) {
  const theme = useTheme();

  const uri = useMemo(() => {
    // Version 0 = "pick the smallest that fits"; M = 15% error correction,
    // which survives a thumb over one corner and a bit of screen glare.
    const code = makeQr(0, 'M');
    code.addData(url);
    code.make();
    const svg = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [url]);

  return (
    <View style={styles.wrap}>
      <View style={[styles.frame, { width: size, height: size }]}>
        <Image
          source={{ uri }}
          style={styles.code}
          contentFit="contain"
          accessibilityLabel="Invite QR code"
        />
      </View>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.caption}>
        Point a camera at this to join.
      </ThemedText>
      <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: Space.sm,
  },
  frame: {
    // White, always: the quiet zone around a QR code is part of the code.
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    padding: Space.sm,
  },
  code: {
    width: '100%',
    height: '100%',
  },
  caption: {
    textAlign: 'center',
  },
  divider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    marginTop: Space.sm,
  },
});
