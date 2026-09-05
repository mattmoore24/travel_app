import { Image } from 'expo-image';
// Renamed on import: the package's default export shares a name with a named
// one, which the lint rule reads as a likely mistake.
import makeQr from 'qrcode-generator';
import { useMemo } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * One link, two ways to hand it over: a square somebody points a camera at,
 * and the system share sheet.
 *
 * Both halves were the group invite's alone, which is why a business with a
 * hundred travelers through reception every week had nothing to send anybody.
 * The QR and the share call live here now; the group flow is one caller of it
 * and any other surface with a link is the next.
 *
 * The share sheet IS the text/email/copy chooser, so there is no second menu
 * to build. One string, so the message lands intact wherever it is pasted.
 */
export function ShareLink({
  url,
  message,
  caption,
  shareLabel,
  disabled = false,
  size = 200,
}: {
  /** What the QR encodes. */
  url: string;
  /** What the share sheet sends. One string, and it should contain the url. */
  message: string;
  /** The line under the square, which differs by what is being shared. */
  caption: string;
  /**
   * The button under the square, or null to render the square alone.
   *
   * Null is for a surface that ALREADY offers the share sheet next to this
   * one: My business has a "Share this business" row above the QR toggle, so
   * rendering this button too put two controls with the identical accessible
   * name and the identical action on one screen, which is exactly the "one
   * name for one act" bug LISTING_SHARE_LABEL exists to prevent.
   */
  shareLabel: string | null;
  disabled?: boolean;
  size?: number;
}) {
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

  const share = async () => {
    try {
      await Share.share({ message });
    } catch {
      // Dismissing the share sheet is not an error.
    }
  };

  return (
    <View style={styles.wrap}>
      {/* Fixed black on white, deliberately. A QR code is read by a camera,
          not by a person: theming it to the app's dark surface would drop the
          contrast ratio scanners rely on, and a pretty code nobody can scan is
          not a code. */}
      <View style={[styles.frame, { width: size, height: size }]}>
        <Image
          source={{ uri }}
          style={styles.code}
          contentFit="contain"
          accessibilityLabel="QR code for this link"
        />
      </View>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.caption}>
        {caption}
      </ThemedText>
      <View style={[styles.divider, { backgroundColor: theme.hairline }]} />
      {/* Full width, like every other primary action: the centred column above
          it would otherwise shrink the button to its label. */}
      {shareLabel == null ? null : (
        <View style={styles.action}>
          <PrimaryButton label={shareLabel} disabled={disabled} onPress={share} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
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
  action: {
    alignSelf: 'stretch',
  },
  divider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    marginTop: Space.sm,
    marginBottom: Space.sm,
  },
});
