import Constants from 'expo-constants';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { release } from '@/lib/analytics';

/**
 * Which code is actually running, printed where a person can read it.
 *
 * Exists because "am I on the new version?" was unanswerable from inside the
 * app. Updates arrive over the air and apply on the SECOND launch — the first
 * one after an install runs the binary's built-in bundle while the download
 * happens behind it — so a fresh install genuinely shows old code once, and
 * without this line there is no way to tell that state apart from an update
 * that never arrived.
 *
 * The id is the update's own, so it can be read over the phone and compared
 * against what the publish log reported.
 *
 * It comes from `release` in src/lib/analytics.ts rather than from
 * expo-updates directly, and that is the whole point of the indirection:
 * every event now carries `update_id` and `is_embedded` from that same
 * object, so the eight characters read off this line and the eight
 * characters a chart is broken down by cannot drift apart.
 */
export function BuildStamp() {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const source = release.isEmbedded ? 'built-in bundle' : `update ${release.updateId}`;
  return (
    <ThemedText type="footnote" themeColor="textSecondary" style={styles.stamp}>
      Samewhere {version} · {source}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  stamp: {
    textAlign: 'center',
    paddingTop: Space.md,
  },
});
