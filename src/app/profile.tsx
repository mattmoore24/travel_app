import { StyleSheet } from 'react-native';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { isSupabaseConfigured } from '@/lib/supabase';

// Profile creation/editing arrives with auth in Phase 1. Until then this
// screen doubles as the Phase 0 smoke check: it shows whether the fresh
// clone's .env is wired to a Supabase project.
export default function ProfileScreen() {
  return (
    <PlaceholderScreen
      icon={{ ios: 'person.crop.circle', android: 'person', web: 'person' }}
      title="Profile"
      phase="coming in phase 1"
      description={
        'Sign in with Apple or email, add photos and languages, and get ' +
        'verified. Your social handles stay hidden until you accept a chat.'
      }>
      <ThemedView type="backgroundElement" style={styles.statusRow}>
        <ThemedText type="small" themeColor="textSecondary">
          Supabase:{' '}
        </ThemedText>
        <ThemedText type="smallBold">
          {isSupabaseConfigured ? 'connected via .env' : 'not configured (copy .env.example)'}
        </ThemedText>
      </ThemedView>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    marginTop: Spacing.four,
  },
});
