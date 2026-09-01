import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';

import {
  fetchIncomingRequests,
  fetchMatches,
  fetchDailySpotlight,
  fetchFirstMessageBudget,
  fetchMyChats,
  fetchSentRequests,
  fetchSocialHandles,
  markChatRead,
  previewFirstMessage,
  respondToRequest,
  sendMessageRequest,
  touchLastSeen,
  withdrawMessageRequest,
} from '@/features/matching/api';
import { useIsBusiness } from '@/features/business/hooks';
import { waitingTotal } from '@/features/chat/unread';
import { useSaidHi, type SaidHiOrigin } from '@/features/matching/said-hi';
import { usePushPrimer } from '@/features/notifications/primer-store';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import type { RequestSource } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useMatches() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['matches', userId],
    queryFn: fetchMatches,
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSentRequests() {
  const userId = useOwnUserId();
  // Never for a business. A hello is a traveler asking a traveler, and
  // message_requests_refuse_business refuses one from this account either
  // way, so this was two round trips per focus that could not come back with
  // a row. While the account kind is still settling the answer is "not a
  // business", so a traveler's list is never held up waiting for it.
  const isBusiness = useIsBusiness();
  return useQuery({
    queryKey: ['sent-requests', userId],
    queryFn: fetchSentRequests,
    enabled: isSupabaseConfigured && userId != null && !isBusiness,
  });
}

/**
 * Today's spotlight. One fetch per day per device is plenty: the pairing
 * cannot change once it is written, so a long staleTime keeps a tab switch
 * from re-asking a volatile RPC.
 */
export function useDailySpotlight() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['daily-spotlight', userId],
    queryFn: fetchDailySpotlight,
    enabled: isSupabaseConfigured && userId != null,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
}

/**
 * Today's hello budget. Read by the composer so a person can see the limit
 * coming rather than discovering it by being refused.
 */
export function useFirstMessageBudget() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['first-message-budget', userId],
    queryFn: fetchFirstMessageBudget,
    enabled: isSupabaseConfigured && userId != null,
    staleTime: 0,
  });
}

/**
 * Which composer asked. Kept out of the analytics property as a free string
 * so the two surfaces cannot drift into three spellings of the same one.
 */
export type DraftSurface = 'first_message' | 'business';

/**
 * Ask, quietly, whether a draft is going to be stopped.
 *
 * Debounced and fire-and-forget: this is a nudge, not a gate. The send path
 * still runs the same check server-side, and this only exists so most
 * would-be rejections turn into a reword before anybody presses send.
 *
 * AND IT COUNTS ITSELF, which is the other half of why it exists. The
 * brief's creep early-warning (§6) is "% of first messages blocked by
 * moderation", and every warning this hook shows removes an event from that
 * numerator on purpose: the whole point is to turn a would-be block into a
 * reword before anybody presses send. Left uncounted, blocked_pct falls over
 * time for a reason that has nothing to do with how many people are trying
 * to send creepy first messages, and the founder reads a safety improvement
 * that is a measurement artefact. `draft_flagged` is the missing term. See
 * docs/DASHBOARD.md for the combined number.
 *
 * The category only, never the draft and never the matched pattern: the
 * blocklist is a table of regexes and naming the trigger hands out the
 * evasion rule, which is why previewFirstMessage does not return it either.
 */
export function useDraftWarning(
  draft: string,
  enabled: boolean,
  surface: DraftSurface
): { risky: boolean; category: string | null; everFlagged: boolean } {
  // What was FLAGGED, not whether something is. Storing the text itself
  // (with the category the preview named) is what lets the warning be
  // derived during render: editing a character clears it immediately, and
  // nothing has to be reset in an effect.
  const [flagged, setFlagged] = useState<{ text: string; category: string | null } | null>(null);
  // Whether a warning was EVER shown in this composer, which outlives the
  // rewrite that clears `flagged`. It is what tells a sender who rewrote
  // after a warning apart from one who never saw one.
  const [everFlagged, setEverFlagged] = useState(false);
  // The last draft counted, keyed on the TEXT and not on the boolean: the
  // effect re-runs on every keystroke, and a guard on "is it risky" would
  // let somebody editing a blocked sentence character by character flood
  // the metric and make the creep number worse than useless.
  const counted = useRef<string | null>(null);
  const text = draft.trim();
  const checkable = enabled && isSupabaseConfigured && text.length >= DRAFT_CHECK_MIN;

  useEffect(() => {
    if (!checkable) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      previewFirstMessage(text).then(({ wouldBlock, category }) => {
        if (active && wouldBlock) {
          setFlagged({ text, category });
          setEverFlagged(true);
          if (counted.current !== text) {
            counted.current = text;
            analytics.capture('draft_flagged', { category, surface });
          }
        }
      });
    }, DRAFT_CHECK_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [text, checkable, surface]);

  const risky = checkable && flagged?.text === text;
  return { risky, category: risky ? (flagged?.category ?? null) : null, everFlagged };
}

/** Short enough that nobody is warned about "hi". */
const DRAFT_CHECK_MIN = 12;
const DRAFT_CHECK_DEBOUNCE_MS = 700;

export function useSendRequest() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      recipientId: string;
      /**
       * Who it went to, carried purely so Travelers can say so afterwards.
       * The composer is a modal on its own route and `router.back()` carries
       * nothing, so without this the tab has no way to know a hello just
       * left it. Never sent to the server.
       */
      recipientName: string;
      /**
       * Which surface the hello left from. This mutation is the ONLY send
       * path in the app — the map's pin card and a stranger's profile use
       * it as well as Travelers — and only Travelers clears the said-hi
       * store, so without this a hello sent from the map painted a strip on
       * a tab that had nothing to do with it. Never sent to the server.
       */
      origin: SaidHiOrigin;
      source: RequestSource;
      firstMessage: string;
      profileElement: string | null;
      /**
       * Whether the composer ever showed the draft warning before this send.
       * The other half of the creep metric: a sender who rewrote after being
       * warned is a success of the warning, not a miss by the classifier.
       * Never sent to the server.
       */
      everFlagged: boolean;
    }) =>
      sendMessageRequest(input.recipientId, input.source, input.firstMessage, input.profileElement),
    meta: { failureTitle: "Couldn't send that" },
    onSuccess: (result, input) => {
      analytics.capture('request_sent', {
        source: input.source,
        delivered: result.delivered,
        // Without this the §6 funnel goes blind the moment moderation holds
        // a hello: queued is the delivered of the moderated path.
        queued: result.queued,
        blocked: result.blocked,
        rewrote_after_warning: input.everFlagged,
      });
      queryClient.invalidateQueries({ queryKey: ['sent-requests', userId] });
      queryClient.invalidateQueries({ queryKey: ['first-message-budget', userId] });
      // The first moment there is an answer worth waiting for. The primer
      // decides for itself whether there is anything left to ask. `queued`
      // counts: with require_llm_moderation on, EVERY hello is queued rather
      // than delivered, and gating on delivered alone silently switched the
      // ask off on the one flow it was built for.
      if (result.delivered || result.queued) {
        // The beat Travelers shows over the next traveler's card. Set before
        // the primer, so the strip is already there when the sheet (if there
        // is one) comes down.
        useSaidHi.getState().note(input.recipientName, input.origin);
        // And the ID of what was just sent, which is what lets that beat
        // offer to take it back. It is a second store beside useSaidHi only
        // because said-hi.ts belongs to another implementer this session; the
        // right shape is one `requestId` field on the said-hi stamp, and the
        // report names the line. Matching on the NAME instead was the
        // tempting shortcut and is a safety bug: two travelers can share a
        // display name, and withdrawing the wrong hello is unrecoverable
        // because the anti-pester constraint refuses a second one.
        useJustSentHello.getState().note(result.request_id ?? null);
        usePushPrimer.getState().ask('hello-sent');
      }
    },
  });
}

/**
 * The hello whose beat is still running, by id.
 *
 * Travelers shows a strip for a few seconds after a first message leaves, and
 * that strip is the one moment somebody realises they have written to the
 * wrong person or written the wrong thing. Offering "Take it back" there
 * needs the request's ID and nothing else will do - see the note in
 * useSendRequest above for why a name will not.
 *
 * In memory, not on disk, and deliberately tiny: it is the beat's other half,
 * not a record. The record is the row in Chat under "You said hi".
 */
type JustSentHelloState = {
  requestId: string | null;
  note: (requestId: string | null) => void;
  clear: () => void;
};

export const useJustSentHello = create<JustSentHelloState>((set) => ({
  requestId: null,
  note: (requestId) => set({ requestId }),
  clear: () => set({ requestId: null }),
}));

/**
 * Take a hello back.
 *
 * Nothing about this reaches the recipient beyond the message leaving their
 * inbox: no tombstone, no notification, and the server pulls the hello's own
 * unsent push out of the queue. And nothing about the RECIPIENT reaches back:
 * withdraw_message_request answers the same for a pending, a declined and an
 * expired row, so a sender can never read a decline out of whether this
 * worked (invariant 4).
 *
 * `false` is an ordinary outcome - already taken back, or already accepted -
 * so it is not surfaced as a failure. The refetch below is what tells the
 * truth either way.
 */
export function useWithdrawHello() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      requestId: string;
      /** Which surface offered it, for the funnel. Never sent to the server. */
      surface: 'said_hi_strip' | 'sent_row';
    }) => withdrawMessageRequest(input.requestId),
    meta: { failureTitle: "Couldn't take that back" },
    onSuccess: (withdrawn, input) => {
      analytics.capture('first_message_withdrawn', { withdrawn, surface: input.surface });
      // The list this row lives in, and the budget: a withdrawn hello still
      // spent one of today's, so nothing about the count changes and the
      // refetch is only here to keep the two in step if the server ever
      // decides otherwise.
      queryClient.invalidateQueries({ queryKey: ['sent-requests', userId] });
      useJustSentHello.getState().clear();
    },
  });
}

/**
 * Say that this account opened the app today, once per launch.
 *
 * WHY IT HANGS OFF useMyChats. `liquidity_reachable` is null for everybody
 * until something calls touch_last_seen(), and a metric that reads zero for
 * every city is worse than no metric - it is a wrong one the founder would
 * act on. So it needs a call site on every launch, and the tab navigator
 * mounts useMyChats for the icon badge (src/components/app-tabs.tsx:30)
 * before any tab is chosen. That is the app's one reliable "we are open"
 * moment reachable from this file. A root-layout call would read better and
 * belongs there the day somebody owns that file; this hook is exported so it
 * can move without a second implementation.
 *
 * Keyed on the user rather than a plain boolean, so a sign-out and a sign-in
 * inside one process do not leave the second account uncounted. Silent on
 * failure: this is bookkeeping, and nobody opening the app should be shown an
 * error about it.
 */
let touchedFor: string | null = null;

export function useTouchLastSeen() {
  const userId = useOwnUserId();
  useEffect(() => {
    if (!isSupabaseConfigured || userId == null || touchedFor === userId) {
      return;
    }
    touchedFor = userId;
    touchLastSeen().catch(() => {});
  }, [userId]);
}

export function useIncomingRequests() {
  const userId = useOwnUserId();
  // Same reason as the sent side: nobody says hi to a business. A traveler
  // who wants one writes through message_business, which opens a
  // conversation rather than a request.
  const isBusiness = useIsBusiness();
  return useQuery({
    queryKey: ['incoming-requests', userId],
    queryFn: fetchIncomingRequests,
    enabled: isSupabaseConfigured && userId != null && !isBusiness,
  });
}

/** What the Chat tab's badge counts (see features/chat/unread.ts). */
/**
 * The waiting total, or null while it is genuinely unknown.
 *
 * Null matters for the icon badge. Both queries default to [] while pending
 * and there is no persister, so on every cold launch the count is 0 before
 * any data arrives — and a badge written from that 0 wipes the number off the
 * home screen of somebody with three unread conversations who opened the app
 * with no signal. Nothing puts it back until the fetch succeeds. The Chat
 * tab's own badge is happy with 0 (a tab with no number reads as "nothing
 * yet" and corrects itself in place), so only the caller that writes to the
 * SYSTEM needs the distinction.
 */
export function useWaitingCount(): number {
  return useSettledWaitingCount() ?? 0;
}

export function useSettledWaitingCount(): number | null {
  const chatsQuery = useMyChats();
  const requestsQuery = useIncomingRequests();
  if (!chatsQuery.isSuccess || !requestsQuery.isSuccess) {
    return null;
  }
  return waitingTotal(chatsQuery.data ?? [], (requestsQuery.data ?? []).length);
}

export function useRespondToRequest() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      requestId: string;
      accept: boolean;
      /**
       * NO `source` OR `cityId` HERE, DELIBERATELY.
       *
       * They were added as optional params and no caller could ever pass
       * them: incoming_requests() returns neither column, so every
       * request_responded carried `source: null, city_id: null` and the
       * breakdown they were added for was one "no value" bucket. An API that
       * advertises a capability it does not have is worse than one that says
       * nothing.
       *
       * Widening incoming_requests() would mean a drop-and-recreate on a live
       * function to feed an event that cannot use the answer: request_sent is
       * fired by the SENDER and request_responded by the RECIPIENT, two
       * different distinct_ids, so no PostHog funnel can ever join them
       * whatever the properties say. The authoritative split is
       * admin_request_funnel (20260902150000), which answers by city, by
       * source and by decided-versus-still-waiting, in SQL, where both sides
       * of the hello are visible at once.
       */
    }) => respondToRequest(input.requestId, input.accept),
    onSuccess: (result, input) => {
      // AND THIS IS NOT HALF A FUNNEL. request_sent is fired by the SENDER
      // and request_responded by the RECIPIENT — two different distinct_ids
      // — so no PostHog funnel can ever join them, whatever the properties
      // say. The accept rate comes from admin_request_funnel in SQL; these
      // properties exist only so the PostHog side can be broken down the
      // same way. docs/DASHBOARD.md insight 3 says the same thing at length.
      analytics.capture('request_responded', { accepted: result.accepted });
      queryClient.invalidateQueries({ queryKey: ['incoming-requests', userId] });
      if (result.accepted) {
        queryClient.invalidateQueries({ queryKey: ['chats', userId] });
        // Accepting is exactly what unlocks their handles and makes their
        // profile readable to us — refetch both instead of waiting out the
        // 30s staleTime with a profile that still says "shared once you
        // two are chatting".
        queryClient.invalidateQueries({ queryKey: ['unlocked-socials'] });
        queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      }
    },
  });
}

export function useMyChats(archived = false) {
  const userId = useOwnUserId();
  // The launch stamp rides here because this is the query the tab navigator
  // mounts on every launch (see useTouchLastSeen for the whole argument). It
  // is one no-op RPC per process, and it is the difference between
  // admin_liquidity's reachable column being a number and being zero.
  useTouchLastSeen();
  return useQuery({
    queryKey: ['chats', userId, String(archived)],
    queryFn: () => fetchMyChats(archived),
    enabled: isSupabaseConfigured && userId != null,
  });
}

/**
 * Mark a chat read, and refresh the list so the dot and the tab badge clear.
 *
 * Deliberately silent on failure: this is bookkeeping, and a person who has
 * just opened a conversation should never be shown an error about it. The
 * next mount tries again.
 */
export function useMarkChatRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => markChatRead(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: () => {},
  });
}

/** Another user's handles — RLS only returns rows once an accepted chat exists. */
export function useUnlockedSocialHandles(userId: string | null) {
  return useQuery({
    queryKey: ['unlocked-socials', userId],
    queryFn: () => fetchSocialHandles(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}
