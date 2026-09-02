import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

import type { SentRequest } from '@/features/matching/api';
import {
  REVIEW_ASKED,
  REVIEW_DELAY_MS,
  useAcceptedCelebration,
} from '@/features/matching/use-accepted-celebration';
import { analytics } from '@/lib/analytics';
import { between, source } from '@/lib/__tests__/source';
import type { ChatListRow, GroupRow, ProfilePhotoRow } from '@/lib/database.types';

/**
 * The App Store review ask, and every rule that keeps it from firing.
 *
 * Apple owns the dialog and throttles it, so nothing here can prove a sheet
 * appeared. What can be proved is the wiring and the gates: that the ask
 * follows the X once per install and never again, waits for the last of a
 * queue of cards, does not follow "Go to chat", and stays silent during
 * onboarding, on a binary or a channel where the module cannot show it, and
 * after any bad moment the hook can see. Each guard was removed in turn
 * while this file was written and the test that names it went red; the list
 * is in the commit that added it.
 *
 * Everything the hook reads is mocked at its seam. The blocks and photos
 * queries are the exception: they run through a real QueryClient so the test
 * can do what the block mutation and the photo verdict do — change the
 * answer and invalidate everything — and see the hook notice. The group
 * photo is read off the same client's cache, the way the hook reads the
 * group page's query, so the test writes to that entry directly.
 */

// What the world looks like, changed per test and re-read on every render.
const world = {
  sent: [] as SentRequest[],
  sentSuccess: true,
  chats: [] as ChatListRow[],
  chatsSuccess: true,
  onboardedAt: '2026-08-01T00:00:00Z' as string | null,
  standing: 'active' as string,
  blocks: [] as { userId: string; name: string | null }[],
  photos: [] as ProfilePhotoRow[],
  // `unknown` on purpose: jest-expo's own native mock answers undefined, and
  // that shape must read as "no".
  available: true as unknown,
  /** The binary predates the native module: importing the package throws. */
  moduleMissing: false,
};

jest.mock('@/features/matching/hooks', () => ({
  useSentRequests: () => ({ data: world.sent, isSuccess: world.sentSuccess }),
  useMyChats: () => ({ data: world.chats, isSuccess: world.chatsSuccess }),
}));
jest.mock('@/features/profile/hooks', () => ({
  useOwnUserId: () => 'me',
  useOwnProfile: () => ({ data: { onboarding_completed_at: world.onboardedAt } }),
  useAccountStanding: () => ({ data: { status: world.standing, suspended_until: null } }),
}));
jest.mock('@/features/chat/api', () => ({
  fetchBlocks: jest.fn(() => Promise.resolve(world.blocks)),
}));
jest.mock('@/features/profile/api', () => ({
  fetchPhotos: jest.fn(() => Promise.resolve(world.photos)),
}));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true }));
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));

const mockRequestReview = jest.fn(() => Promise.resolve());
jest.mock('expo-store-review', () => {
  if (world.moduleMissing) {
    // What `requireNativeModule('ExpoStoreReview')` does on a binary without
    // the module: build/ExpoStoreReview.native.js throws at evaluation.
    throw new Error("Cannot find native module 'ExpoStoreReview'");
  }
  return {
    isAvailableAsync: () => Promise.resolve(world.available),
    requestReview: () => mockRequestReview(),
  };
});

const capture = analytics.capture as jest.Mock;

const hello = (id: string, overrides: Partial<SentRequest> = {}): SentRequest =>
  ({
    id,
    recipient_id: `them-${id}`,
    source: 'trip_match',
    profile_element: null,
    first_message: 'Both in Lisbon on the 12th, up for a market run?',
    state: 'accepted',
    chat_id: `chat-${id}`,
    created_at: '2026-08-20T10:00:00Z',
    expired_at: null,
    withdrawn_at: null,
    ...overrides,
  }) as SentRequest;

const chatRow = (chat_id: string, chat_status: 'active' | 'closed' = 'active'): ChatListRow =>
  ({
    chat_id,
    kind: 'direct',
    chat_status,
    title: 'Ana',
    other_user_id: 'them',
    photo_path: null,
  }) as unknown as ChatListRow;

/** A profile photo of theirs, and what moderation made of it. */
const photoRow = (
  id: string,
  overrides: Partial<ProfilePhotoRow> & { ago?: number } = {}
): ProfilePhotoRow => {
  const { ago = 60 * 60 * 1000, ...rest } = overrides;
  return {
    id,
    user_id: 'me',
    storage_path: `me/${id}.jpg`,
    position: 0,
    moderation_status: 'approved',
    moderation_attempts: 0,
    moderation_category: null,
    moderation_engine: null,
    created_at: new Date(Date.now() - ago).toISOString(),
    ...rest,
  };
};

/** What the group page's query holds for one group, as far as its photo goes. */
const groupRow = (
  photo_status: GroupRow['photo_status'],
  photo_path: string | null
): Pick<GroupRow, 'chat_id' | 'photo_status' | 'photo_path'> => ({
  chat_id: 'g1',
  photo_status,
  photo_path,
});

jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });

/**
 * Let every pending promise in the hook settle: storage, the require, Apple.
 * react-query hands its results to observers through a setTimeout(0), which
 * the fake clock holds; running what is due without moving the clock is what
 * keeps a query's first answer from arriving after the test has changed it.
 */
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      jest.advanceTimersByTime(0);
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
};

/** The beat after the X: the card has gone, the ask may run. */
const afterTheCard = async () => {
  act(() => {
    jest.advanceTimersByTime(REVIEW_DELAY_MS);
  });
  await settle();
};

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useAcceptedCelebration(), { wrapper });
  return { client, hook };
}

/** A fresh session that has already seeded, so the next accept is news. */
async function open() {
  const mounted = mount();
  await settle();
  return mounted;
}

const stored = async (): Promise<string[]> =>
  JSON.parse((await AsyncStorage.getItem('samewhere.celebrated.requests.v1')) ?? '[]');

beforeEach(async () => {
  // The package is imported at the moment it is needed, through the module
  // registry, so a reset lets each test decide whether it is there at all.
  jest.resetModules();
  await AsyncStorage.clear();
  world.sent = [];
  world.sentSuccess = true;
  world.chats = [];
  world.chatsSuccess = true;
  world.onboardedAt = '2026-08-01T00:00:00Z';
  world.standing = 'active';
  world.blocks = [];
  world.photos = [];
  world.available = true;
  world.moduleMissing = false;
});

describe('the ask follows the X', () => {
  it('once, and never again on the same install', async () => {
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    expect(hook.result.current.match?.requestId).toBe('r1');

    act(() => hook.result.current.dismiss());
    expect(mockRequestReview).not.toHaveBeenCalled();
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('review_prompt_requested', { available: true });
    // One flag, in the seen-set, under the same key.
    expect(await stored()).toEqual(expect.arrayContaining(['r1', REVIEW_ASKED]));

    // A second accept in the same session: the card, but not the ask.
    world.sent = [hello('r1'), hello('r2')];
    hook.rerender(undefined);
    expect(hook.result.current.match?.requestId).toBe('r2');
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
    hook.unmount();

    // A later launch of the same install reads the flag back.
    world.sent = [hello('r1'), hello('r2'), hello('r3')];
    const next = await open();
    expect(next.hook.result.current.match?.requestId).toBe('r3');
    act(() => next.hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('is on a beat after the dismiss, never on top of the card', async () => {
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await settle();
    // The card is leaving; Apple has not been asked yet.
    expect(mockRequestReview).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(REVIEW_DELAY_MS - 1);
    });
    await settle();
    expect(mockRequestReview).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    await settle();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('waits for the last card when accepts are queued', async () => {
    const { hook } = await open();
    world.sent = [hello('r1'), hello('r2')];
    hook.rerender(undefined);
    expect(hook.result.current.match?.requestId).toBe('r1');
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    // r2's card is up now, so nothing may come up over it.
    expect(hook.result.current.match?.requestId).toBe('r2');
    expect(mockRequestReview).not.toHaveBeenCalled();
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(hook.result.current.match).toBeNull();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('does not follow Go to chat, and the ask is kept for a later X', async () => {
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.goToChat());
    await afterTheCard();
    expect(hook.result.current.match).toBeNull();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);

    world.sent = [hello('r1'), hello('r2')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });
});

describe('the ask stays silent', () => {
  it('while onboarding is incomplete, without spending the one ask', async () => {
    world.onboardedAt = null;
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);

    world.onboardedAt = '2026-09-01T09:00:00Z';
    world.sent = [hello('r1'), hello('r2')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('when the module reports unavailable, and keeps the ask for when it is', async () => {
    // TestFlight answers false by Apple's design; the same install may be
    // the App Store one tomorrow.
    world.available = false;
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('review_prompt_requested', { available: false });
    expect(await stored()).not.toContain(REVIEW_ASKED);

    world.available = true;
    world.sent = [hello('r1'), hello('r2')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('when the module answers nothing at all, the way a mocked native does', async () => {
    world.available = undefined;
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it('on a binary without the native module, and the layout survives it', async () => {
    world.moduleMissing = true;
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith('review_prompt_requested', { available: false });
    expect(await stored()).not.toContain(REVIEW_ASKED);
    // The hook is still alive and the card is gone: the throw was contained.
    expect(hook.result.current.match).toBeNull();
    expect(await stored()).toContain('r1');
  });
});

describe('never after a bad moment', () => {
  it('a hello of theirs refused by moderation in the last day', async () => {
    const { hook } = await open();
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    world.sent = [
      hello('r1'),
      hello('b1', { state: 'blocked', chat_id: null, created_at: anHourAgo }),
    ];
    hook.rerender(undefined);
    expect(hook.result.current.match?.requestId).toBe('r1');
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it('but a refusal two days ago is not this moment', async () => {
    const { hook } = await open();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    world.sent = [
      hello('r1'),
      hello('b1', { state: 'blocked', chat_id: null, created_at: twoDaysAgo }),
    ];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('the account is not in good standing', async () => {
    world.standing = 'suspended';
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it('a chat closed this session, in either direction', async () => {
    world.chats = [chatRow('c-old')];
    const { hook } = await open();
    // sever_on_block, or somebody leaving: the row flips to closed.
    world.chats = [chatRow('c-old', 'closed')];
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it('but a chat that was already closed when the app opened is history', async () => {
    world.chats = [chatRow('c-old', 'closed')];
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('a block made this session, from anywhere in the app', async () => {
    const { hook, client } = await open();
    // What useBlockUser does on success: the row exists, and every query is
    // invalidated.
    world.blocks = [{ userId: 'them', name: 'Dev' }];
    await act(async () => {
      await client.invalidateQueries();
    });
    await settle();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it('but a block from a previous sitting is history', async () => {
    world.blocks = [{ userId: 'them', name: 'Dev' }];
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('a profile photo of theirs removed by moderation in the last day', async () => {
    // What apply_photo_verdict leaves behind: the row stays, rejected, with
    // the category and the engine that decided. The grid draws "Removed".
    world.photos = [
      photoRow('p1'),
      photoRow('p2', {
        moderation_status: 'rejected',
        moderation_category: 'nudity',
        moderation_engine: 'llm',
      }),
    ];
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it("but a hold the check gave up on is nobody's fault", async () => {
    // engine 'failsafe' is "could not be checked, try again", drawn on
    // warning rather than danger, and not a bad moment.
    world.photos = [
      photoRow('p2', {
        moderation_status: 'rejected',
        moderation_category: 'failsafe',
        moderation_engine: 'failsafe',
      }),
    ];
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('and a removal from two days ago is not this moment', async () => {
    world.photos = [
      photoRow('p2', {
        moderation_status: 'rejected',
        moderation_category: 'nudity',
        moderation_engine: 'llm',
        ago: 48 * 60 * 60 * 1000,
      }),
    ];
    const { hook } = await open();
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it('a group photo they watched get refused', async () => {
    const { hook, client } = await open();
    // The group page is open on a photo the admin just picked: its query
    // holds the row pending, and polls. Then the verdict lands in the same
    // cache entry, the way the poll's refetch would land it.
    act(() => {
      client.setQueryData(['group', 'g1'], groupRow('pending', 'me/photo.jpg'));
    });
    act(() => {
      client.setQueryData(['group', 'g1'], groupRow('rejected', null));
    });
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(await stored()).not.toContain(REVIEW_ASKED);
  });

  it('but a group whose photo was already refused when its page opened is history', async () => {
    const { hook, client } = await open();
    act(() => {
      client.setQueryData(['group', 'g1'], groupRow('rejected', null));
    });
    world.sent = [hello('r1')];
    hook.rerender(undefined);
    act(() => hook.result.current.dismiss());
    await afterTheCard();
    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });
});

describe('the four things land together', () => {
  // docs/APP_STORE.md, "The App Store review prompt": the dependency, the
  // version bump that moves runtimeVersion with it, the call after the
  // dismiss, and the hand-run. The first two are in files, so they are held
  // together here: a module in package.json with the version still at the
  // last build's would let an update built against the module reach a binary
  // that cannot load it.
  const REPO = path.join(__dirname, '..', '..', '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
    version: string;
    dependencies: Record<string, string>;
  };
  const app = JSON.parse(fs.readFileSync(path.join(REPO, 'app.json'), 'utf8')) as {
    expo: { version: string; plugins: unknown[] };
  };

  it('ships the module at the SDK 57 line', () => {
    expect(pkg.dependencies['expo-store-review']).toMatch(/^~57\./);
  });

  it('moves the version, and app.json and package.json agree on it', () => {
    // 0.1.0 is what every build before the module carried.
    expect(app.expo.version).not.toBe('0.1.0');
    expect(app.expo.version).toBe(pkg.version);
  });

  it('adds nothing under plugins for it, because it has no config plugin', () => {
    expect(JSON.stringify(app.expo.plugins)).not.toContain('expo-store-review');
  });
});

describe('the wiring, read off the source', () => {
  it('imports the package late, never at the top of the hook', () => {
    // A static import evaluates requireNativeModule('ExpoStoreReview') when
    // the tabs layout loads, and that throws on a binary without the module.
    const hook = source('src/features/matching/use-accepted-celebration.ts');
    const imports = between(hook, 'import AsyncStorage', 'const KEY =');
    expect(imports).not.toContain('expo-store-review');
    const loader = between(hook, 'function loadStoreReview(', 'export type AcceptedMatch');
    expect(loader).toContain("require('expo-store-review')");
    expect(loader).toContain('try {');
  });

  it('is told apart from Go to chat by the card, and by the mount', () => {
    const notice = source('src/features/matching/connected-notice.tsx');
    const goToChat = between(notice, 'label="Go to chat"', '/>');
    expect(goToChat).toContain('onGoToChat()');
    expect(goToChat).not.toContain('onDismiss()');
    const layout = source('src/app/(tabs)/_layout.tsx');
    const mountLine = between(layout, '<ConnectedNotice', '/>');
    expect(mountLine).toContain('onDismiss={dismiss}');
    expect(mountLine).toContain('onGoToChat={goToChat}');
  });
});
