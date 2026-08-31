import fs from 'node:fs';
import path from 'node:path';

import { useAuthStore } from '@/features/auth/store';

/**
 * What a guest was doing, carried across the account wall. The invite token
 * proved the pattern; these pin the generalisation: the store round-trips an
 * intent, every origin writes it only on the tap through, and every replay
 * clears BEFORE it navigates — the ordering inviteHandled documents, without
 * which backing out of the replayed screen pushes it straight back on.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

afterEach(() => {
  useAuthStore.getState().intentHandled();
});

describe('the pendingIntent store', () => {
  it('remembers an intent and hands it back once', () => {
    const store = useAuthStore.getState();
    expect(useAuthStore.getState().pendingIntent).toBeNull();
    store.intentRemembered({ kind: 'pin', cityId: 7, pinId: 'p1' });
    expect(useAuthStore.getState().pendingIntent).toEqual({
      kind: 'pin',
      cityId: 7,
      pinId: 'p1',
    });
    store.intentHandled();
    expect(useAuthStore.getState().pendingIntent).toBeNull();
  });

  it('carries each of the three origins', () => {
    const store = useAuthStore.getState();
    store.intentRemembered({ kind: 'drop-pin', cityId: 1, region: null });
    expect(useAuthStore.getState().pendingIntent?.kind).toBe('drop-pin');
    store.intentRemembered({ kind: 'traveler', cityId: 2, userId: 'u9' });
    expect(useAuthStore.getState().pendingIntent?.kind).toBe('traveler');
  });

  it('is never persisted: an intent must not survive a cold start', () => {
    const store = src('src/features/auth/store.ts');
    expect(store).not.toContain('AsyncStorage');
    expect(store).not.toContain('persist(');
  });
});

describe('every origin writes, every replay clears first', () => {
  it('the map records the pin card, the join gate and the drop gate', () => {
    const map = src('src/features/pins/map-screen.tsx');
    expect(map).toContain("kind: 'pin',");
    expect(map).toContain("{ kind: 'drop-pin', cityId: activeCityId, region: lastRegion.current }");
    // The join gate cannot read the closed card, so the id is parked for it.
    expect(map).toContain('joinGatePinId.current = selectedPin.id;');
  });

  it('the travelers tab records the third origin, or the store has a branch nothing writes', () => {
    const travelers = src('src/app/(tabs)/travelers.tsx');
    expect(travelers).toContain("kind: 'traveler',");
    expect(travelers).toContain('intentRemembered({');
  });

  it('the map replay clears the intent before it acts', () => {
    const map = src('src/features/pins/map-screen.tsx');
    const handled = map.indexOf('intentHandled();');
    expect(handled).toBeGreaterThan(-1);
    const applied = map.indexOf('applyCity(intent.cityId);');
    expect(applied).toBeGreaterThan(handled);
  });

  it('the tabs handoff waits for a REAL sign-in: an anonymous session is not one', () => {
    // The blocker this pins: a guest ACCOUNT is an anonymous Supabase
    // session, so `session != null` was true for the very person who just
    // tapped "Make a profile" — the handoff fired mid-signup and spent the
    // intent on the still-anonymous session. The handoff must use the same
    // guard the map's replay effect uses (useIsGuest: no session OR
    // is_anonymous), which also keeps the intent in the store until the
    // real sign-in flips it false.
    const layout = src('src/app/(tabs)/_layout.tsx');
    const start = layout.indexOf('function PendingIntentHandoff');
    const end = layout.indexOf('function NotificationRouting');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handoff = layout.slice(start, end);
    expect(handoff).toContain('useIsGuest()');
    expect(handoff).toContain('if (isGuest || intent == null || listingIntent)');
    expect(handoff).not.toContain('session != null');
  });

  it('the tabs layout replays the traveler origin, clearing first', () => {
    const layout = src('src/app/(tabs)/_layout.tsx');
    const at = layout.indexOf("if (intent.kind !== 'traveler')");
    expect(at).toBeGreaterThan(-1);
    const handled = layout.indexOf('intentHandled();', at);
    const navigated = layout.indexOf("router.navigate('/(tabs)/travelers')", at);
    expect(handled).toBeGreaterThan(-1);
    expect(navigated).toBeGreaterThan(handled);
  });

  it('the intent is spent before the invite, so two navigations cannot race', () => {
    // A guest can hold both: open an invite link, then take the Travelers
    // gate, then sign up. Both handoffs fire in the same commit on a freshly
    // mounted stack, and React runs sibling effects in order. The intent goes
    // first because it only selects a TAB; the invite then pushes on top of
    // it. Reversed, the push landed first and the tab navigate popped it.
    const layout = src('src/app/(tabs)/_layout.tsx');
    const intent = layout.indexOf('<PendingIntentHandoff />');
    const invite = layout.indexOf('<PendingInviteHandoff />');
    expect(intent).toBeGreaterThan(-1);
    expect(invite).toBeGreaterThan(intent);
  });

  it('a replayed pin that has expired degrades silently to the city', () => {
    const map = src('src/features/pins/map-screen.tsx');
    // The pin half waits for the rows, consumes itself either way, and shows
    // nothing when the pin is gone - no error at the end of thirteen screens.
    expect(map).toContain('replayPin.current = null;');
    const consumed = map.indexOf('replayPin.current = null;');
    const found = map.indexOf('const pin = allPins.find((p) => p.id === target.pinId);');
    expect(found).toBeGreaterThan(consumed);
  });
});
