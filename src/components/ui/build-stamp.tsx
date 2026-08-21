import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';

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
 */
export function BuildStamp() {
  const version = Constants.expoConfig?.version ?? '0.0.0';
  const source =
    Updates.isEmbeddedLaunch || !Updates.updateId
      ? 'built-in bundle'
      : `update ${Updates.updateId.slice(0, 8)}`;
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
