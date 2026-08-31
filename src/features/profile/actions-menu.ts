import { router } from 'expo-router';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

/** One row of an action sheet: what it says, what it does, how it looks. */
export type MenuItem = {
  label: string;
  /** iOS paints exactly one row red. Only ever the block. */
  destructive?: boolean;
  run: () => void;
};

/**
 * The three things you can do about a stranger, in one place.
 *
 * Report and Block used to be written out three times: once in the chat
 * header's own sheet, once at the bottom of a stranger's profile as two
 * full-width ghost buttons, and nowhere at all on Travelers — which is the
 * screen where a creepy bio is actually first read, one stranger at a time.
 * Three copies is three chances to drift, and the one that mattered was the
 * copy that did not exist.
 *
 * The block CONFIRMATION stays with the caller. What a block does differs by
 * surface (a chat freezes, a profile pops back to where you came from) and a
 * business reader is promised less than a traveler is, because it has no map
 * pin and no Travelers tab to disappear from. One sentence for all three
 * would have to be the vaguest of them.
 */
export function travelerMenuItems({
  userId,
  context,
  canViewProfile = true,
  onBlock,
  extra = [],
}: {
  userId: string | null;
  /** Where the report is filed from: 'profile', `chat:<id>`, `travelers`. */
  context: string;
  /**
   * False on the two surfaces where the profile page is not somewhere to go:
   * a business reader (/profile/[userId] sits behind `signedIn && onboarded`,
   * which a business account never satisfies, so the tap silently did
   * nothing) and the profile page itself.
   */
  canViewProfile?: boolean;
  onBlock: () => void;
  /** Anything this surface adds after Block: Leave chat, Archive. */
  extra?: MenuItem[];
}): MenuItem[] {
  return [
    ...(canViewProfile && userId
      ? [{ label: 'View profile', run: () => router.push(`/profile/${userId}`) }]
      : []),
    {
      label: 'Report',
      run: () => router.push({ pathname: '/report', params: { userId: userId ?? '', context } }),
    },
    { label: 'Block', destructive: true, run: onBlock },
    ...extra,
  ];
}

/** Which row iOS paints red. -1 when nothing in the sheet is destructive. */
export function destructiveIndex(items: MenuItem[]): number {
  return items.findIndex((item) => item.destructive);
}

/** The iOS sheet, with a plain Alert for the non-iOS dev targets. */
export function presentMenu(items: MenuItem[]) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...items.map((item) => item.label), 'Cancel'],
        destructiveButtonIndex: destructiveIndex(items),
        cancelButtonIndex: items.length,
      },
      (index) => items[index]?.run()
    );
    return;
  }
  Alert.alert('Options', undefined, [
    ...items.map((item) => ({
      text: item.label,
      style: item.destructive ? ('destructive' as const) : undefined,
      onPress: item.run,
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

/** Build the sheet and show it. What every caller actually wants. */
export function openTravelerMenu(input: Parameters<typeof travelerMenuItems>[0]) {
  presentMenu(travelerMenuItems(input));
}
