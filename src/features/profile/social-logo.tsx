import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { SocialPlatform } from '@/lib/database.types';

/**
 * The real platform marks, drawn as inline SVG and rendered through
 * expo-image (which ships an SVG coder on both platforms). Data URIs rather
 * than asset files so nothing depends on Metro's asset config, and glyph
 * shapes rather than downloaded brand kits so the bundle carries no
 * third-party image files.
 */
const GLYPHS: Record<SocialPlatform, { color: string; ink: string; path: string; extra?: string }> =
  {
    instagram: {
      color: '#E1306C',
      ink: '#FFFFFF',
      path: 'M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2z',
      extra:
        '<circle cx="12" cy="12" r="4.2" fill="none" stroke="#FFFFFF" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#FFFFFF"/>',
    },
    tiktok: {
      color: '#111111',
      ink: '#FFFFFF',
      path: 'M16.5 3c.3 2 1.6 3.4 3.5 3.6v2.6c-1.2.1-2.4-.2-3.5-.9v5.6c0 3.4-2.6 5.6-5.6 5.6a5.5 5.5 0 0 1 0-11c.3 0 .6 0 .9.1v2.8a2.7 2.7 0 1 0 1.9 2.6V3h2.8z',
    },
    snapchat: {
      color: '#FFFC00',
      ink: '#111111',
      path: 'M12 2c3 0 5 2.2 5 5.2 0 1-.1 1.9-.1 2.2.4.2.9.1 1.4-.1.4-.2.9.1.9.5s-.4.8-1.3 1.1c-.6.2-.9.4-.8.8.3 1.1 2 2.4 3.3 2.8.4.1.5.5.3.8-.3.5-1.6.9-2.6 1-.2.5-.3 1.2-.7 1.3-.5.2-1.4-.2-2.4-.2-1.2 0-1.9 1.1-3 1.1s-1.8-1.1-3-1.1c-1 0-1.9.4-2.4.2-.4-.1-.5-.8-.7-1.3-1-.1-2.3-.5-2.6-1-.2-.3-.1-.7.3-.8 1.3-.4 3-1.7 3.3-2.8.1-.4-.2-.6-.8-.8-.9-.3-1.3-.7-1.3-1.1s.5-.7.9-.5c.5.2 1 .3 1.4.1 0-.3-.1-1.2-.1-2.2C7 4.2 9 2 12 2z',
    },
    x: {
      color: '#111111',
      ink: '#FFFFFF',
      path: 'M17.5 3h3.1l-6.8 7.8L21.8 21h-6.2l-4.9-6.4L5 21H1.9l7.3-8.3L1.6 3h6.4l4.4 5.8L17.5 3z',
    },
    whatsapp: {
      color: '#25D366',
      ink: '#FFFFFF',
      path: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2z',
      extra:
        '<path fill="#25D366" d="M8.6 7.6c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.8.4s-1 1-1 2.4 1 2.8 1.2 3 2 3.2 4.9 4.4c2.4 1 2.9.8 3.4.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.5-.3l-1.8-.9c-.3-.1-.5-.2-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.4-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5 0-.2 0-.3 0-.5l-.6-1.4z"/>',
    },
    telegram: {
      color: '#229ED9',
      ink: '#FFFFFF',
      path: 'M9.6 15.3 9.4 19c.4 0 .6-.2.8-.4l1.9-1.8 3.9 2.9c.7.4 1.2.2 1.4-.7l2.6-12.1c.3-1.1-.4-1.6-1.1-1.3L3.4 10.3c-1.1.4-1.1 1-.2 1.3l4.2 1.3 9.7-6.1c.5-.3.9-.1.5.2z',
    },
    facebook: {
      color: '#1877F2',
      ink: '#FFFFFF',
      path: 'M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.6c-.3 0-1.3-.1-2.4-.1-2.3 0-3.9 1.4-3.9 4v2.3H7.6V13h2.8v8h3.1z',
    },
    other: {
      color: '#585F6B',
      ink: '#FFFFFF',
      path: 'M10.6 13.4a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7l-1.4 1.4 1.4 1.4 1.4-1.4a2 2 0 1 1 2.9 2.9l-2.9 2.8a2 2 0 0 1-2.8 0l-1.4 1.4zm2.8-2.8a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.4-1.4-1.4-1.4-1.4 1.4a2 2 0 1 1-2.9-2.9l2.9-2.8a2 2 0 0 1 2.8 0l1.4-1.4z',
    },
  };

function dataUri(platform: SocialPlatform) {
  const g = GLYPHS[platform];
  const inner =
    platform === 'instagram'
      ? `<path d="${g.path}" fill="none" stroke="${g.ink}" stroke-width="2"/>${g.extra ?? ''}`
      : `<path d="${g.path}" fill="${g.ink}"/>${g.extra ?? ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function socialBrandColor(platform: SocialPlatform) {
  return GLYPHS[platform].color;
}

export function SocialLogo({ platform, size = 36 }: { platform: SocialPlatform; size?: number }) {
  const glyph = GLYPHS[platform];
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size / 3.2, backgroundColor: glyph.color },
      ]}>
      <Image
        source={{ uri: dataUri(platform) }}
        style={{ width: size * 0.62, height: size * 0.62 }}
        contentFit="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderCurve: 'continuous',
  },
});
