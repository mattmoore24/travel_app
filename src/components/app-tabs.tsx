import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useOwnBusiness } from '@/features/business/hooks';
import { useWantsBusiness } from '@/features/guest/hooks';
import { useSettledWaitingCount, useWaitingCount } from '@/features/matching/hooks';
import { useIconBadge } from '@/features/notifications/badge';

// Three tabs, in the order people use them (docs/DESIGN.md). Profile lives
// behind the avatar in the Map/Travelers headers, which buys the third slot
// for Chat — now carrying direct chats, hellos and business rooms.
//
// A business account gets the same three slots with the middle one swapped:
// Travelers becomes My business. That is not a cosmetic choice. Travelers is
// the discovery queue, and §7 rule 8 says a business never reads a traveler
// discovery surface, so the tab is not merely useless to a business, it is a
// door that must not exist for them. The DB refuses the reads underneath it
// too; this is the door, not the lock.
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
  const settledWaiting = useSettledWaitingCount();
  // The same number on the home-screen icon. One source of truth, so the icon
  // and the tab badge cannot disagree - and useWaitingCount already refetches
  // on focus and on every invalidation useMarkChatRead fires, so reading a
  // thread clears the icon without anybody doing anything else.
  // The SETTLED count: see useIconBadge on why null is not zero here.
  useIconBadge(settledWaiting);
  const isBusiness = useOwnBusiness().data != null;
  // An account part way through listing is not a business YET, but Travelers
  // is the wrong room for it either way: the tab's empty state asks a bar
  // owner to add a trip, which is a step towards the traveler stamp that
  // register_business refuses forever. The map feed was already closed to
  // them; this is the other half the same package meant to close.
  const wantsBusiness = useWantsBusiness();

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

      {/* BOTH triggers are always declared, with `hidden` deciding which one
          shows. expo-router builds its screen list from the triggers, so
          conditionally omitting one changes the shape of that list between
          renders — and the account-kind query settles AFTER the first paint.
          `hidden` also means the route cannot be navigated to at all, which is
          the stronger guarantee here: a business must not reach Travelers by
          any route, deep link included. */}
      <NativeTabs.Trigger name="travelers" hidden={isBusiness || wantsBusiness}>
        <NativeTabs.Trigger.Label>Travelers</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="my-business" hidden={!isBusiness}>
        <NativeTabs.Trigger.Label>My business</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'storefront', selected: 'storefront.fill' }} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="chat"
        // The badge is the app's only unread signal, and iOS 26's Liquid
        // Glass tab bar no longer derives an accessibilityValue from
        // badgeValue — so VoiceOver said "Chat, tab" whether five people
        // were waiting or nobody. The label carries the count instead
        // (SDK 57's NativeTabs forwards this to the UITabBarItem as
        // tabBarItemAccessibilityLabel). "Waiting" is the word the chat
        // code already uses; never "request".
        accessibilityLabel={waiting > 0 ? `Chat, ${waiting} waiting` : 'Chat'}>
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
