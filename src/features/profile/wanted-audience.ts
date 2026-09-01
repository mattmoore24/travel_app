import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

import { useSetVisibility } from '@/features/profile/hooks';
import type { ProfileAudience } from '@/lib/database.types';

const KEY = 'samewhere.wanted.audience.v1';

/**
 * The audience somebody reached for before they had the badge for it.
 *
 * Signup step 12 shows the locked rows and lets an unverified account take
 * the selfie there and then, and it promises: "Once the badge lands we will
 * set you to verified women." That promise could not be kept. The wanted row
 * was component state on the signup step, and the check takes MINUTES while
 * the rest of signup takes seconds — so the step was always unmounted long
 * before the badge arrived, and the woman who asked to be seen only by
 * verified women finished signup set to Everyone, with nothing to tell her.
 *
 * On the device rather than the server, deliberately: it is a half-finished
 * intention, not a setting, and set_visibility is the only thing allowed to
 * decide what the audience actually is. Cleared the moment it is spent, so a
 * later deliberate change to Everyone is never undone by a stale wish.
 */
export async function rememberWantedAudience(audience: ProfileAudience) {
  await AsyncStorage.setItem(KEY, audience).catch(() => {});
}

export async function forgetWantedAudience() {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

export async function readWantedAudience(): Promise<ProfileAudience | null> {
  try {
    return (await AsyncStorage.getItem(KEY)) as ProfileAudience | null;
  } catch {
    return null;
  }
}

/**
 * Spend it, wherever the badge is actually observed.
 *
 * Mounted on the profile, which is the screen a person lands on after signup
 * and the one that already reads `profile.verified`. Runs once per arrival of
 * the badge: reads the wish, applies it, and clears it before the mutation so
 * a failure cannot loop.
 */
export function useApplyWantedAudience(verified: boolean, current: ProfileAudience | null) {
  const setVisibility = useSetVisibility();
  useEffect(() => {
    if (!verified) {
      return;
    }
    let active = true;
    void readWantedAudience().then((wanted) => {
      if (!active || wanted == null) {
        return;
      }
      // Clear FIRST. A wish that fails to apply is not worth retrying for
      // ever against a setting the person can change by hand in two taps.
      void forgetWantedAudience();
      if (wanted !== current) {
        setVisibility.mutate(wanted);
      }
    });
    return () => {
      active = false;
    };
    // setProfileAudience is a mutation object and is not stable across renders;
    // depending on it would re-run this every commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, current]);
}
