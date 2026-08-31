import { useSaidHi } from '@/features/matching/said-hi';

/**
 * The one-beat memory of who the composer just wrote to.
 *
 * It exists because nothing else carries that fact back to Travelers: the
 * composer is a modal on its own route, `router.back()` carries nothing, and
 * the recipient has already been filtered out of the queue by the time the
 * screen re-renders.
 */
describe('the said-hi store', () => {
  beforeEach(() => {
    useSaidHi.getState().clear();
  });

  it('starts with nothing to say', () => {
    expect(useSaidHi.getState().sentTo).toBeNull();
  });

  it('notes a name, and clear puts it back to nothing', () => {
    useSaidHi.getState().note('Ana', 'travelers');
    expect(useSaidHi.getState().sentTo?.name).toBe('Ana');
    useSaidHi.getState().clear();
    expect(useSaidHi.getState().sentTo).toBeNull();
  });

  it('replaces the first note rather than queueing behind it', () => {
    useSaidHi.getState().note('Ana', 'travelers');
    useSaidHi.getState().note('Bruno', 'travelers');
    expect(useSaidHi.getState().sentTo?.name).toBe('Bruno');
  });

  it('stamps each note, which is what settles the shared bar slot', () => {
    // Travelers floats this strip and the undo bar on the same number above
    // the action bar, and picks between them by comparing timestamps. A note
    // with no clock would let a pass from a minute ago win the slot — and it
    // is the same stamp the age guard reads, so a note nothing ever cleared
    // cannot paint an hour later either.
    const before = Date.now();
    useSaidHi.getState().note('Ana', 'travelers');
    const at = useSaidHi.getState().sentTo?.at ?? 0;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('records which surface the hello left from', () => {
    // useSendRequest is the app's ONLY send path and it serves the map's pin
    // card and a stranger's profile as well as Travelers, while nothing but
    // Travelers ever clears this store. Without the stamp, a hello sent from
    // the map painted a strip on a tab that had nothing to do with it.
    useSaidHi.getState().note('Ana', 'pin');
    expect(useSaidHi.getState().sentTo?.origin).toBe('pin');
    useSaidHi.getState().note('Bruno', 'profile');
    expect(useSaidHi.getState().sentTo?.origin).toBe('profile');
  });
});
