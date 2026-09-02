import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { photoRejection } from '@/constants/moderation';
import { Motion } from '@/constants/theme';
import { fetchBlocks } from '@/features/chat/api';
import { groupPhotoView, type GroupPhotoState } from '@/features/groups/photo';
import { useMyChats, useSentRequests } from '@/features/matching/hooks';
import { fetchPhotos } from '@/features/profile/api';
import { useAccountStanding, useOwnProfile, useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import type { ProfilePhotoRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

const KEY = 'samewhere.celebrated.requests.v1';

/**
 * The once-per-install flag for the App Store review ask.
 *
 * It lives INSIDE the seen-set under the key above, as one more entry, rather
 * than under a key of its own. The seen-set is already the thing that decides
 * what a fresh install treats as old news, so the ask's "have we ever?" belongs
 * in the same place — and an entry rather than a new shape keeps the stored
 * value readable in both directions across an over-the-air update: a bundle
 * that predates this reads a set with one id in it that never matches a hello,
 * and a bundle that has it reads the old plain array as "never asked". Request
 * ids are uuids, so the sentinel cannot collide with one.
 */
export const REVIEW_ASKED = 'store-review:asked';

/**
 * How long after the notice starts leaving before Apple's sheet may come up.
 * The card fades out over Motion.quick; this is comfortably after it has
 * gone, so the ask is never on top of the card.
 */
export const REVIEW_DELAY_MS = Motion.slow;

/** A refused hello, or a refused photo, this recent still counts as "just now". */
const BAD_MOMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A profile photo of theirs that moderation removed in the last day.
 *
 * The photo row carries no verdict time, only the upload's `created_at`, and
 * the verdict lands within the worker's tick of the upload, so the upload
 * time stands in for it the way a hello's `created_at` stands in for its
 * refusal. A failsafe hold (`moderation_engine = 'failsafe'`: the check gave
 * up, "try again") is nobody's fault and is not a bad moment; the grid draws
 * it on warning rather than danger for the same reason, and this reads the
 * same helper so the two cannot disagree about which is which.
 */
export function photoRemovedRecently(photos: ProfilePhotoRow[], now: number): boolean {
  return photos.some(
    (p) =>
      p.moderation_status === 'rejected' &&
      !photoRejection(p.moderation_category, p.moderation_engine).failsafe &&
      now - Date.parse(p.created_at) < BAD_MOMENT_WINDOW_MS
  );
}

/** What this hook asks of expo-store-review, and nothing else it exports. */
type StoreReviewModule = {
  isAvailableAsync(): Promise<boolean>;
  requestReview(): Promise<void>;
};

/**
 * Loads expo-store-review LATE, and survives its absence.
 *
 * The package's native entry is `requireNativeModule('ExpoStoreReview')`
 * (build/ExpoStoreReview.native.js in the installed 57.0.2), which THROWS on a
 * binary that was built before the module existed — not the
 * `requireOptionalNativeModule` this repo's own local module uses. A static
 * import at the top of this file would therefore take the whole tabs layout
 * down at module-evaluation time on any such binary: the e2e simulator build
 * that predates the dependency, or a phone whose JavaScript moved ahead of its
 * native half. So it is required at the moment it is needed, inside a catch,
 * and a binary without the module simply never asks.
 *
 * A `require` in a function body rather than an `import()`: Metro evaluates
 * either at the call, which is the point, but jest's Node cannot run a dynamic
 * import without a flag the suite does not carry, so the `import()` form was
 * a guard that could only ever be seen failing.
 */
function loadStoreReview(): StoreReviewModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the one place a late require is the point; see above
    return require('expo-store-review') as typeof import('expo-store-review');
  } catch {
    return null;
  }
}

export type AcceptedMatch = {
  requestId: string;
  chatId: string;
  name: string;
  photoPath: string | null;
};

/**
 * Finds a message request that has been accepted since the last time we
 * looked. The sender never sees a decline, so an accept is the one piece of
 * genuinely good news the app can deliver, and it deserves a moment.
 *
 * On the very first run every already-accepted request is marked as seen, so
 * an existing user does not get a burst of celebrations for old news.
 *
 * It is also where the App Store review ask lives, because this is the best
 * moment the app will ever have and it is already detected here. The ask
 * follows the notice being put away with its X — never on top of the card,
 * and never from "Go to chat", which is a departure into a task (opening a
 * thread, usually to type) that Apple's own guidance says not to interrupt.
 * The rules, in the order they matter: once per install, ever; never during
 * onboarding; never after a bad moment; no custom pre-prompt. See
 * docs/APP_STORE.md, "The App Store review prompt".
 */
export function useAcceptedCelebration() {
  const sentQuery = useSentRequests();
  const sent = sentQuery.data ?? [];
  const chatsQuery = useMyChats();
  const chats = chatsQuery.data ?? [];
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const seeded = useRef(false);

  const accepted = sent.filter((r) => r.state === 'accepted' && r.chat_id != null);

  useEffect(() => {
    // Wait for the requests to arrive before deciding what counts as old
    // news. This used to run once on mount, when `accepted` was still the
    // empty array every query starts as — so it wrote an empty seen-set, and
    // then every accept from the whole history of the account arrived a
    // moment later looking brand new. Reinstall, clear the app's data, or
    // just sign in on a second phone, and the first thing that happened was
    // a queue of full-screen takeovers with the success haptic, one per
    // person you had ever connected with.
    if (seeded.current || !sentQuery.isSuccess) {
      return;
    }
    seeded.current = true;
    let active = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!active) {
          return;
        }
        if (raw != null) {
          setSeen(new Set(JSON.parse(raw) as string[]));
          return;
        }
        // First run: everything already accepted counts as old news.
        const ids = accepted.map((r) => r.id);
        setSeen(new Set(ids));
        AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
      })
      .catch(() => {
        if (active) {
          setSeen(new Set());
        }
      });
    return () => {
      active = false;
    };
    // Runs once, on the transition to success: later accepts are compared
    // against the stored set. `accepted` is deliberately not a dependency —
    // the ref is what makes this once, and listing it would re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentQuery.isSuccess]);

  const pending = seen == null ? null : (accepted.find((r) => !seen.has(r.id)) ?? null);
  const chat = pending ? chats.find((c) => c.chat_id === pending.chat_id) : undefined;

  // ---- The review ask's gates: what this hook can see of a bad moment. ----

  // Never during onboarding, and never for an account moderation has acted
  // on. Both queries are already live at the root layout, so subscribing here
  // costs no request.
  const onboardedAt = useOwnProfile().data?.onboarding_completed_at ?? null;
  const standing = useAccountStanding().data?.status ?? null;

  // A block this session. `fetchBlocks` drops created_at, so the only thing
  // readable is the count: it is baselined at its first answer and any rise
  // afterwards is a block somebody made in this sitting. The block mutation
  // invalidates every query, so the rise is seen without anything else being
  // wired. Same cache entry as the Blocked screen's `useBlocks` — same key,
  // same fetch — but scoped to run only while the ask is still unspent, so an
  // install that has already asked never pays for this again.
  const userId = useOwnUserId();
  const askUnspent = seen != null && !seen.has(REVIEW_ASKED);
  const blocksQuery = useQuery({
    queryKey: ['blocks', userId],
    queryFn: fetchBlocks,
    enabled: isSupabaseConfigured && userId != null && askUnspent,
  });
  const blockCount = blocksQuery.data?.length ?? null;
  const blocksAtStart = useRef<number | null>(null);
  useEffect(() => {
    if (blocksAtStart.current == null && blockCount != null) {
      blocksAtStart.current = blockCount;
    }
  }, [blockCount]);

  // A chat that closed this session: a block in either direction severs the
  // chat, and somebody leaving closes it too. Baselined at the chat list's
  // first answer for the same reason as the blocks, so history is not read as
  // news.
  const closedAtStart = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (closedAtStart.current == null && chatsQuery.isSuccess) {
      closedAtStart.current = new Set(
        chats.filter((c) => c.chat_status === 'closed').map((c) => c.chat_id)
      );
    }
    // The baseline is taken once, on the transition to success — the ref is
    // what makes it once, and listing `chats` would re-baseline on every
    // refetch, which is the case the baseline exists to notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatsQuery.isSuccess]);

  // A photo of theirs refused. Two screens say it, and each is read through
  // the query that screen already holds.
  //
  // Their own profile photos: the grid's own cache entry (`useOwnPhotos`,
  // same key, same fetch), scoped like the blocks to run only while the ask
  // is unspent. Read at the X through `photoRemovedRecently`.
  const photosQuery = useQuery({
    queryKey: ['photos', userId],
    queryFn: () => fetchPhotos(userId!),
    enabled: isSupabaseConfigured && userId != null && askUnspent,
  });

  // A group's own photo: the group page's `['group', chatId]` entry, which
  // polls every five seconds while a photo is pending and is therefore the
  // query that is live when the verdict lands. `groups` carries no verdict
  // time, so this is a watch rather than a window: the cache is subscribed
  // while the ask is unspent, and a row seen to move INTO `rejected` in this
  // sitting is the admin having just read "That photo was not approved and
  // has been removed. Pick another." A group first seen already rejected is
  // history, the same reading a chat that was closed at launch gets. Nothing
  // here fetches: a group that is not open on some screen is not watched.
  const queryClient = useQueryClient();
  const groupPhotoRefused = useRef(false);
  useEffect(() => {
    if (!askUnspent) {
      return;
    }
    const cache = queryClient.getQueryCache();
    const lastSeen = new Map<string, GroupPhotoState>();
    const note = (query: Query) => {
      const [scope, chatId] = query.queryKey;
      if (scope !== 'group' || typeof chatId !== 'string') {
        return;
      }
      // The cache holds the raw row (useGroup's `select` shapes what a screen
      // is handed, not what is stored), and the one client reading of it is
      // groupPhotoView: 'blocked' here is the same computation that puts
      // "Pick another" on the group page, never a second opinion on the
      // columns. Nothing before the first answer counts, or a group first
      // seen already refused would read as a move from nothing.
      if (query.state.data == null) {
        return;
      }
      const { state } = groupPhotoView(
        query.state.data as Parameters<typeof groupPhotoView>[0],
        null
      );
      const before = lastSeen.get(chatId);
      lastSeen.set(chatId, state);
      if (before !== undefined && before !== 'blocked' && state === 'blocked') {
        groupPhotoRefused.current = true;
      }
    };
    cache.getAll().forEach(note);
    return cache.subscribe((event) => {
      if (event.type === 'updated') {
        note(event.query);
      }
    });
  }, [queryClient, askUnspent]);

  // Read at fire time rather than closed over: the ask is scheduled a beat
  // after the dismiss, and a card can arrive in that beat.
  const pendingRef = useRef<typeof pending>(null);
  const seenRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
    seenRef.current = seen;
  }, [pending, seen]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  const persist = useCallback((next: Set<string>) => {
    seenRef.current = next;
    setSeen(next);
    AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
  }, []);

  /** Marks the card on screen as seen; answers the set it leaves behind. */
  const markSeen = useCallback((): Set<string> | null => {
    if (!pending || seen == null) {
      return null;
    }
    const next = new Set(seen);
    next.add(pending.id);
    persist(next);
    return next;
  }, [pending, seen, persist]);

  const askForReview = useCallback(async () => {
    timer.current = null;
    // A card is up: never on top of it. Either the next of a queue of
    // accepts, which came up the moment the last one was put away, or one
    // that arrived in the beat since the dismiss. Not spent, so the last X
    // of the queue is the one the ask follows.
    if (pendingRef.current != null) {
      return;
    }
    const current = seenRef.current;
    if (current == null || current.has(REVIEW_ASKED)) {
      return;
    }
    const mod = loadStoreReview();
    // `=== true`, not truthiness: on a binary without the native half the
    // package is null here, and under jest its native functions answer
    // undefined. Neither is a yes. TestFlight answers false by Apple's design
    // (StoreReviewModule.swift, isRunningFromTestFlight), and that must not
    // spend the ask: the same install may become the App Store one.
    const available = mod != null && (await mod.isAvailableAsync().catch(() => false)) === true;
    // Apple never says whether the sheet was shown, so this is the only
    // record that the moment was earned and the wiring ran. On TestFlight it
    // arrives with `available: false` and nothing else happens.
    analytics.capture('review_prompt_requested', { available });
    if (!available || mod == null) {
      return;
    }
    // Spent BEFORE the request, so nothing that happens inside Apple's call
    // can lead to a second one. Once per install, ever.
    const next = new Set(current);
    next.add(REVIEW_ASKED);
    persist(next);
    await mod.requestReview().catch(() => {});
  }, [persist]);

  /**
   * The X. The notice goes away and nothing else is happening, which is the
   * one moment the review ask may follow.
   */
  const dismiss = useCallback(() => {
    const next = markSeen();
    if (next == null || next.has(REVIEW_ASKED)) {
      return;
    }
    // The query results themselves, not the `?? []` fallbacks above: those
    // are fresh arrays every render, and this callback's identity follows
    // its dependencies.
    const sentNow = sentQuery.data ?? [];
    const chatsNow = chatsQuery.data ?? [];
    // Never during onboarding. The tabs are not mounted for a traveler who
    // owes it, but the rule is the hook's to keep, not the router's.
    if (onboardedAt == null) {
      return;
    }
    // Never after a bad moment, as far as this hook can see one:
    // - moderation has acted on the account (suspended, banned, shadowbanned),
    // - a hello of theirs was refused by moderation in the last day,
    // - a block was made this session, from anywhere in the app,
    // - a chat closed this session (a block in either direction, or a leave),
    // - a photo of theirs was refused: a profile photo in the last day, or a
    //   group photo they watched get refused this session.
    // A report is the one it cannot see: nothing in the app reads reports
    // back, so there is no query to baseline. The "block them too" that
    // follows a report of a person is caught by the block signals.
    if (standing !== 'active') {
      return;
    }
    const now = Date.now();
    if (
      sentNow.some(
        (r) => r.state === 'blocked' && now - Date.parse(r.created_at) < BAD_MOMENT_WINDOW_MS
      )
    ) {
      return;
    }
    if (blocksAtStart.current != null && blockCount != null && blockCount > blocksAtStart.current) {
      return;
    }
    const baseline = closedAtStart.current;
    if (
      baseline != null &&
      chatsNow.some((c) => c.chat_status === 'closed' && !baseline.has(c.chat_id))
    ) {
      return;
    }
    if (photoRemovedRecently(photosQuery.data ?? [], now)) {
      return;
    }
    if (groupPhotoRefused.current) {
      return;
    }
    if (timer.current != null) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => void askForReview(), REVIEW_DELAY_MS);
  }, [
    markSeen,
    sentQuery.data,
    chatsQuery.data,
    photosQuery.data,
    onboardedAt,
    standing,
    blockCount,
    askForReview,
  ]);

  /**
   * "Go to chat". The notice goes away because the person is leaving for the
   * thread, and the review ask does not follow them there.
   */
  const goToChat = useCallback(() => {
    markSeen();
  }, [markSeen]);

  const match: AcceptedMatch | null =
    pending && pending.chat_id
      ? {
          requestId: pending.id,
          chatId: pending.chat_id,
          name: chat?.title ?? 'this traveler',
          photoPath: chat?.photo_path ?? null,
        }
      : null;

  return { match, dismiss, goToChat };
}
