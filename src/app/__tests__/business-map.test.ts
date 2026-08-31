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
    // Three kinds now, not two. An account part way through listing a
    // business has the tabs mounted for it - that is what gives somebody
    // backing out of the listing form somewhere to go - so it reaches this
    // feed, and there is no reason to hand it names while it waits.
    expect(code).toContain('const anonymous = isGuest || isBusiness || wantsBusiness;');
    expect(code).toContain("const rpc = anonymous ? 'public_city_pins' : 'city_pins';");
    // Two doors, two cache entries. Keyed on `isGuest` alone, one account
    // kind's rows could be served to the other on the same device.
    expect(code).toContain("anonymous ? 'anonymous' : 'identified'");
  });
});

describe("a business tapping a business chip is not offered a traveler's controls", () => {
  it('join and message are behind the account-kind branch', () => {
    const code = src(SHEET);
    // Exactly one business branch in this chain, and both controls after it,
    // which puts both in the traveler arm. Said this way rather than by
    // counting characters between them: the branch itself carries a
    // paragraph of copy, and growing that copy is not a regression.
    const branches = code.match(/\) : viewerIsBusiness \? \(/g) ?? [];
    expect(branches).toHaveLength(1);
    const guard = code.indexOf(') : viewerIsBusiness ? (');
    expect(guard).toBeGreaterThan(-1);
    for (const control of [
      "label={inTheChat ? 'Open the chat' : 'Join the chat'}",
      'label="Message"',
    ]) {
      const at = code.indexOf(control);
      expect(at).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(at);
    }
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

  it("the business's city is resolved from the LISTING, ahead of the store the chips write", () => {
    const code = src(MAP);
    // my_business.city_id (when it is a launch city) outranks
    // pickBrowsingCity. Seeding through applyCity → chooseCity instead used
    // to bail whenever the persisted store held ANY value — and the rail is
    // hidden for a business, so a pre-signin chip tap pinned the owner to
    // the wrong city with no way out.
    expect(code).toContain('const businessCityId =');
    expect(code).toContain('launchCities.some((c) => c.city_id === ownBusiness.city_id)');
    guards(code, 'businessCityId ??', 'pickBrowsingCity(', 200);
    // What is left for the effect is the CAMERA only (activeCityId flips
    // after the MapView mounted on initialRegion): one shot, and never a
    // write into the shared store.
    const flown = code.indexOf('flownToBusinessCity.current = true;');
    expect(flown).toBeGreaterThan(-1);
    const flight = code.indexOf('mapRef.current?.animateToRegion', flown);
    expect(flight).toBeGreaterThan(-1);
    expect(flight - flown).toBeLessThan(700);
    const effectStart = code.indexOf('const flownToBusinessCity');
    expect(effectStart).toBeGreaterThan(-1);
    const effect = code.slice(effectStart, code.indexOf('}, [businessCity,', effectStart));
    // Calls, not the words — the effect's own comments are allowed to name
    // the functions it deliberately does not use.
    expect(effect).not.toContain('chooseCity(');
    expect(effect).not.toContain('applyCity(');
  });

  it('map_viewed reports explicit only for a real chip tap, never the listing resolution', () => {
    const code = src(MAP);
    // A business owner CANNOT tap a chip (no rail), so a business city on
    // screen must count as explicit: false — while a traveler's persisted
    // chip choice (chosenCityId) still reports true. The old seed wrote the
    // listing's city into the same store the chips write, so every business
    // reported explicit: true forever.
    expect(code).toContain('explicit: businessCityId == null && chosenCityId != null,');
    // The traveler chip path is untouched: a tap still persists the choice
    // that makes explicit true.
    guards(code, 'const applyCity = (id: number) => {', 'chooseCity(id);', 300);
  });

  it('the city rail is not drawn for a business', () => {
    // One city, seeded from the listing. Four chips including two continents
    // away is a navigation task where a fact should be.
    guards(src(MAP), '{isBusiness ? null : (', 'style={styles.cityScroll}', 700);
  });

  it("the dock button is a business action, gated on 'listed', never the pin path", () => {
    const code = src(MAP);
    // The gate: no live listing, no button — the own-listing card stands in
    // its place, or the button posts into a listing nobody can see.
    expect(code).toContain(
      "const businessDockShown = isBusiness && ownBusiness?.state === 'listed';"
    );
    const dock = code.indexOf('&& businessDockShown && !selectedPin ? (');
    expect(dock).toBeGreaterThan(-1);
    const block = code.slice(dock, dock + 2200);
    // Explicitly routed, never enterPlaceMode (which silently no-ops for a
    // business) and never the traveler's label.
    expect(block).toContain("router.push('/business-post')");
    expect(block).toContain('"Post what\'s on"');
    expect(block).toContain("'Update tonight'");
    expect(block).not.toContain('Drop a pin');
    expect(block).not.toContain('enterPlaceMode');
  });

  it('a missing listing is explained in the message slot, one state at a time', () => {
    const code = src(MAP);
    expect(code).toContain(
      "isBusiness && ownBusiness != null && ownBusiness.state !== 'listed' && !ownChipOnMap"
    );
    expect(code).toContain("'own-listing': listingMissing,");
    // Only the fixable state is a tap, and it goes to the email step.
    guards(
      code,
      "slot === 'own-listing' && ownListingNotice ? (",
      "router.push('/business-email')",
      700
    );
  });

  it('a business account lands on My business, one shot, beside the invite handoff', () => {
    const layout = src('src/app/(tabs)/_layout.tsx');
    // D8: a one-shot navigation, never a reorder of the NativeTabs triggers
    // (app-tabs.tsx records why the trigger list must not change shape).
    expect(layout).toContain('function BusinessLanding()');
    expect(layout).toContain("router.navigate('/(tabs)/my-business')");
    expect(layout).toContain('landed.current = true;');
    expect(layout).toContain('<BusinessLanding />');
    expect(src('src/components/app-tabs.tsx')).toContain('hidden={!isBusiness}');
  });
});
