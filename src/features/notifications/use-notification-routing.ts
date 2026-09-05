import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { pushPermissionState } from '@/features/notifications/push';
import { analytics } from '@/lib/analytics';
import type { PushPayload } from '@/lib/database.types';

/**
 * Make a tapped notification open the thing it is about.
 *
 * Every push the database sends carries a routing payload; until this hook
 * nothing on the phone read it, so "Ana: see you at 8" launched the app onto
 * whatever tab was last open. Mounted under (tabs) beside
 * PendingInviteHandoff, and for the same reasons: it needs a mounted stack
 * and a live session, and a notification tapped while signed out correctly
 * routes nowhere.
 *
 * Old builds enqueued payloads with no `type` (and message pushes with no
 * `kind`), so every branch tolerates missing keys. Nothing here presents a
 * modal — a router.push cannot lose the modal race the traps skill
 * documents.
 */

/** Where a payload should land, or null for a payload that names no screen. */
export function routeForPayload(
  data: Partial<PushPayload> & Record<string, unknown>
): string | null {
  const chatId = typeof data.chat_id === 'string' && data.chat_id.length > 0 ? data.chat_id : null;
  switch (data.type) {
    case 'message':
      if (chatId == null) {
        return '/(tabs)/chat';
      }
      // Mirrors the chat tab's own switch: kind 'room' opens /room/[id],
      // everything else (including a payload from an old build with no
      // kind) opens the one-to-one screen.
      return data.kind === 'room' ? `/room/${chatId}` : `/chat/${chatId}`;
    case 'accepted':
      // Always a direct chat: respond_to_message_request only creates those.
      return chatId == null ? '/(tabs)/chat' : `/chat/${chatId}`;
    case 'request':
      return '/(tabs)/chat';
    case 'trip':
      // "Bangkok tomorrow. 14 travelers are there on your dates." The screen
      // that answers that sentence is Travelers, not the map: the number in
      // the body is people, and a tap that opened a map of pins would be
      // answering a different question. A clock that opens the wrong screen
      // is worse than no clock.
      return '/(tabs)/travelers';
    case 'moderation':
      return '/guidelines';
    case 'verification':
      // /verification exists and holds the verification flow; /profile-me
      // (the original proposal) has no verification content.
      return '/verification';
    case 'support':
      return '/contact';
    case 'report':
      // Deliberately nowhere. An urgent report wakes whoever is on support
      // duty, and there is no in-app review queue for them to open: the
      // reviewer works in the dashboard (docs/DASHBOARD.md). Opening the app
      // is the honest answer; a screen that cannot act on the report is not.
      return null;
    default:
      return null;
  }
}

/** `Notification.date` is seconds on some paths and millis on others. */
const ageSeconds = (date: number, now: number): number => {
  const millis = date > 1e12 ? date : date * 1000;
  return Math.max(0, Math.round((now - millis) / 1000));
};

// The cold-start read runs once for the LIFE OF THE APP, not once per mount:
// (tabs) remounts on sign-out/sign-in, and getLastNotificationResponseAsync
// would hand the remount the same already-spent tap.
let coldStartConsumed = false;

/** Tests only: forget that a cold start was consumed. */
export function resetColdStartForTests() {
  coldStartConsumed = false;
}

export function useNotificationRouting() {
  // Belt and braces for re-renders within one mount; the module flag above
  // is what survives a remount.
  const consumedColdStart = useRef(false);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse) => {
      const data = (response.notification.request.content.data ?? {}) as Partial<PushPayload> &
        Record<string, unknown>;
      const route = routeForPayload(data);
      // The response listener is the one place a push open can be counted,
      // so the only mechanism the app has for causing a return is measured
      // here (§6: the retention lever).
      analytics.capture('push_opened', {
        type: typeof data.type === 'string' ? data.type : null,
        age_seconds: ageSeconds(response.notification.date, Date.now()),
      });
      if (route != null) {
        router.push(route);
      }
    };

    if (!coldStartConsumed && !consumedColdStart.current) {
      coldStartConsumed = true;
      consumedColdStart.current = true;
      // The tap that launched the app, delivered before any listener could
      // exist. By the time (tabs) mounts the session has resolved, so the
      // response is spent on a stack that can actually show the screen.
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response != null) {
            open(response);
          }
        })
        .catch(() => {
          // A read that fails is a launch with nothing to open.
        });
      pushPermissionState()
        .then((state) => analytics.capture('push_permission_state', { state }))
        .catch(() => {
          // Permission introspection can throw where push cannot work at
          // all; there is nothing to report there.
        });
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}
