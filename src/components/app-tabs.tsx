import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useWaitingCount } from '@/features/matching/hooks';

// Three tabs, in the order people use them (docs/DESIGN.md). Profile lives
// behind the avatar in the Map/Travelers headers, which buys the third slot
// for Chat — now carrying direct chats, hellos and business rooms.
//
// iOS-first: icons are SF Symbols, and NativeTabs renders the real iOS 26
// Liquid Glass tab bar. Android drawables come with the Android release.
export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  // Conversations with something new plus hellos waiting on an answer. It
  // never counts anything else: no profile-completion nudges, no marketing,
  // nothing the app wants. A red dot that has cried wolf once is a red dot
  // people learn to ignore, and then real messages go unanswered.
  const waiting = useWaitingCount();

  // Untinted system glass — HIG: never paint the tab bar's background; the
  // accent lives only on the selected item.
  return (
    <NativeTabs
      tintColor={colors.accent}
      indicatorColor={colors.accentSoft}
      labelStyle={{ selected: { color: colors.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="travelers">
        <NativeTabs.Trigger.Label>Travelers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
        />
        {/* Rendered only when there is something to say, NOT hidden with
            the `hidden` prop. expo-router reads `children` first and only
            consults `hidden` when there are none, so a Badge with the text
            "0" is a badge — which is how a red 0 sat on the Chat tab of an
            app with no chats in it. See NativeTabTrigger.appendBadgeOptions. */}
        {waiting > 0 ? (
          <NativeTabs.Trigger.Badge>
            {waiting > 99 ? '99+' : String(waiting)}
          </NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
