import fs from 'node:fs';
import path from 'node:path';

/**
 * The map, as a business account sees it.
 *
 * Founder, after testing as a business: "under no circumstances should a
 * business account ever have the option to join a chat of any other business
 * or other pin of any kind... The map page as a business isn't used for that
 * purpose."
 *
 * So the map for a business is three things and nothing else: the city it is
 * in, where it sits on that city, and that there is life around it. Every
 * test below pins one piece of that. They read source rather than render:
 * the map screen mounts react-native-maps, which cannot be mounted in jest,
 * and the point is to stop the next edit quietly putting a traveler control
 * back rather than to re-prove React works.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const MAP = 'src/features/pins/map-screen.tsx';
const SHEET = 'src/features/business/place-sheet.tsx';
const FILTERS = 'src/features/pins/map-filter-sheet.tsx';
const MARKER = 'src/features/business/business-marker.tsx';
const FEED = 'src/features/guest/hooks.ts';

/**
 * The guard stands in front of the control, in the same chain, not merely
 * somewhere in the file. The NEAREST guard before the control, because
 * several of these files carry the same branch more than once.
 */
function guards(code: string, guard: string, control: string, within = 3000) {
  const at = code.indexOf(control);
  expect(at).toBeGreaterThan(-1);
  guardsAt(code, guard, at, within);
}

function guardsAt(code: string, guard: string, at: number, within: number) {
  const g = code.lastIndexOf(guard, at);
  expect(g).toBeGreaterThan(-1);
  expect(at - g).toBeLessThan(within);
}

describe('a business is never offered a traveler on the map', () => {
  it('the pin card offers no way into a traveler profile', () => {
    const code = src(MAP);
    // Two doors led to /profile/[userId] — the photo hero and the pinner row
    // — and that route is inside `signedIn && onboarded`, which a business
    // account never satisfies. So both were taps that did nothing at all.
    expect(code.match(/pathname: '\/profile\/\[userId\]'/g)).toHaveLength(2);
    // The hero: no photograph to press in the first place.
    expect(code).toContain(
      'const hero = !pin.seeded && !isOwn && photoUrl != null && !viewerIsBusiness;'
    );
    // The pinner row, which is the second of the two.
    guardsAt(
      code,
      '{!isOwn && !hero && !viewerIsBusiness ? (',
      code.lastIndexOf("pathname: '/profile/[userId]'"),
      1500
    );
  });

  it('the faces of a plan are never fetched for a business, let alone drawn', () => {
    const code = src(MAP);
    // Not fetched-and-hidden: up to twenty travelers' names and photos never
    // reach the device.
    expect(code).toContain('usePinCrew(pin.id, openToJoin && !signedOut && !viewerIsBusiness)');
    expect(code).toContain('{openToJoin && !viewerIsBusiness && crew.length > 0 ? (');
  });

  it('the map header does not offer a business the traveler audience shortcut', () => {
    // Its only action is /visibility, which the database refuses a business
    // (set_visibility, 20260829190000) and the router does not mount.
    expect(src(MAP)).toContain('{isBusiness ? null : <AudienceChip audience={audience} />}');
  });

  it('the pins feed a business reads is the anonymous one', () => {
    const code = src(FEED);
    expect(code).toContain('const anonymous = isGuest || isBusiness;');
    expect(code).toContain("const rpc = anonymous ? 'public_city_pins' : 'city_pins';");
    // Two doors, two cache entries. Keyed on `isGuest` alone, one account
    // kind's rows could be served to the other on the same device.
    expect(code).toContain("anonymous ? 'anonymous' : 'identified'");
  });
});

describe("a business tapping a business chip is not offered a traveler's controls", () => {
  it('join and message are behind the account-kind branch', () => {
    const code = src(SHEET);
    guards(
      code,
      ') : viewerIsBusiness ? (',
      "label={inTheChat ? 'Open the chat' : 'Join the chat'}"
    );
    guards(code, ') : viewerIsBusiness ? (', 'label="Message"');
  });

  it('its own listing leads to My business instead of refusing it', () => {
    const code = src(SHEET);
    expect(code).toContain('const isMine = ownBusiness != null && ownBusiness.id === place.id;');
    expect(code).toContain("router.navigate('/my-business')");
  });

  it("the traveler's whole page is not a door on a business's map", () => {
    // /place/[id] is joining, messaging and rating, none of which a business
    // may do.
    guards(src(SHEET), '{viewerIsBusiness ? null : (', 'See the whole page');
  });
});

describe('the map is tailored to a business rather than trimmed', () => {
  it('the owner can tell which chip is theirs', () => {
    const marker = src(MARKER);
    expect(marker).toContain('own = false');
    expect(marker).toContain('styles.ownRing');
    expect(marker).toContain('own ? `Your business, ${business.name}` : business.name');
    // The account-kind query settles after the first paint, so the marker
    // bitmap has to be re-rasterised when the answer lands.
    expect(marker).toContain('`${business.id}:${business.has_live_post}:${own}`');
    expect(src(MAP)).toContain('own={place.id === ownBusinessId}');
  });

  it('the filters are the ones an owner has a use for', () => {
    const code = src(FILTERS);
    expect(code).toContain('const BUSINESS_KINDS:');
    expect(code).toContain('(viewerIsBusiness ? BUSINESS_KINDS : TRAVELER_KINDS)');
    // The two traveler-discovery groups are not shown at all. Both, not one:
    // "When" and "Kind of plan" each get their own guard.
    guards(code, '{viewerIsBusiness ? null : (', 'title="When"', 400);
    guards(code, '{viewerIsBusiness ? null : (', 'title="Kind of plan"', 400);
    expect(code.match(/\{viewerIsBusiness \? null : \(/g)).toHaveLength(2);
  });

  it('an empty city says so to a business too', () => {
    // The traveler card invites you to be the first, which a business cannot
    // be, so it is hidden from them — and hiding it left a blank map that
    // read as a failed load.
    expect(src(MAP)).toContain('Plans travelers make here show up on this map.');
  });
});
