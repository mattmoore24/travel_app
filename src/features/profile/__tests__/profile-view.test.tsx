import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProfileView } from '@/features/profile/profile-view';
import type { TripWithCity } from '@/features/trips/api';
import { profileTripFromOwnTrip, profileTripFromTravelerRow } from '@/features/trips/profile-trips';
import type { CityRow, ProfilePhotoRow, ProfileRow, TravelerTripRow } from '@/lib/database.types';

// The photo hooks reach for a signed URL. Null for most of this file, because
// nothing here has a photo to sign; the viewer's own describe block below
// hands one back, because a photo you cannot get a URL for is not a photo you
// can open.
let mockSignedUrl: string | null = null;
jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: mockSignedUrl }),
}));

// The viewer builds a pinch and an exclusive composition, which the suite's
// shared gesture stub does not carry (jest.setup.js). It only mounts when a
// photo is actually opened, so only the block below needs this.
jest.mock('react-native-gesture-handler', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const builder = () => {
    const chain: Record<string, () => unknown> = {};
    for (const key of ['onUpdate', 'onEnd', 'onBegin', 'onStart', 'onFinalize', 'numberOfTaps']) {
      chain[key] = () => chain;
    }
    return chain;
  };
  return {
    __esModule: true,
    Gesture: {
      Pan: builder,
      Pinch: builder,
      Tap: builder,
      LongPress: builder,
      Simultaneous: builder,
      Exclusive: builder,
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: ({ children, ...rest }: { children: React.ReactNode }) =>
      React.createElement(View, rest, children),
    State: {},
    Directions: {},
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

// ProfileView now mounts the "Been and loved" shelf, which asks React Query
// for the viewer's ratings. Nothing here has a QueryClient, and nothing here
// is testing the shelf, so it answers empty and renders nothing.
jest.mock('@/features/business/hooks', () => ({
  useTopRated: () => ({ data: [] }),
}));

// What run 33 photographed was a profile with its name pushed off the screen.
// A component test cannot see that — it has no layout at all — so these pin
// only what is in the tree: the name is rendered in BOTH hero branches, and
// the owner is the only one asked to add a photo. The picture is the proof
// that it is on the screen (e2e 18-profile-me.png).

const profile: ProfileRow = {
  user_id: 'u1',
  display_name: 'Maestro Test',
  age: 29,
  home_city: 'Lisbon',
  home_country: 'Portugal',
  languages: [],
  bio: null,
  occupation: 'Sound engineer',
  gender: 'unspecified',
  verified: false,
  travelers_radius_km: 32,
  onboarding_completed_at: null,
  created_at: '',
  updated_at: '',
};

function renderProfile(props: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  return render(
    <ProfileView profile={profile} photos={[]} trips={[]} handles={[]} owner={false} {...props} />
  );
}

describe('ProfileView with no photo', () => {
  it('still says who this is', () => {
    renderProfile();
    expect(screen.getByText(/Maestro Test/)).toBeTruthy();
    expect(screen.getByText('Sound engineer')).toBeTruthy();
    expect(screen.getByText('From Lisbon, Portugal')).toBeTruthy();
  });

  it('asks the owner for a photo, and only the owner', () => {
    renderProfile({ owner: true, onEditSection: jest.fn() });
    expect(screen.getByLabelText('Add a photo')).toBeTruthy();
    // The camera button belongs to a photo that exists.
    expect(screen.queryByLabelText('Edit photos')).toBeNull();

    screen.unmount();
    renderProfile({ owner: false });
    expect(screen.queryByLabelText('Add a photo')).toBeNull();
  });

  it('offers nothing to reply to when there is no photo', () => {
    renderProfile({ onRespondTo: jest.fn() });
    expect(screen.queryByLabelText('Say hi about this photo')).toBeNull();
  });
});

describe('ProfileView with a photo', () => {
  const photo: ProfilePhotoRow = {
    id: 'p1',
    user_id: 'u1',
    storage_path: 'u1/0.jpg',
    position: 0,
    moderation_status: 'approved',
    moderation_attempts: 0,
    moderation_category: null,
    moderation_engine: null,
    created_at: '',
  };

  it('keeps the same name block over the image, with its own affordances', () => {
    renderProfile({ photos: [photo], owner: true, onEditSection: jest.fn() });
    expect(screen.getByText(/Maestro Test/)).toBeTruthy();
    expect(screen.getByText('From Lisbon, Portugal')).toBeTruthy();
    expect(screen.getByLabelText('Edit photos')).toBeTruthy();
    expect(screen.queryByLabelText('Add a photo')).toBeNull();
  });

  it('lets a visitor say hi about the photo', () => {
    renderProfile({ photos: [photo], onRespondTo: jest.fn() });
    expect(screen.getByLabelText('Say hi about this photo')).toBeTruthy();
  });

  it('prints the word on the photo chip, not just a glyph', () => {
    // Travelers offers three routes to the same composer, and this one was
    // an unlabelled bubble on the photo while the other two read "About
    // this" and "Say hi" - so nobody could tell whether it did something
    // different. A spoken label is not enough: it is invisible to the eye
    // and to Maestro alike.
    renderProfile({ photos: [photo], onRespondTo: jest.fn() });
    const chip = screen.getByLabelText('Say hi about this photo');
    expect(chip).toHaveTextContent('About this');
  });
});

describe('the language you both speak', () => {
  it('sits under the name as a second, quieter pill', () => {
    renderProfile({ alsoSpeaks: 'Also speaks Portuguese' });
    expect(screen.getByText('Also speaks Portuguese')).toBeTruthy();
  });

  it('is absent when there is nothing to say', () => {
    renderProfile();
    expect(screen.queryByText(/Also speaks/)).toBeNull();
  });
});

describe('the overlap window', () => {
  const trip = {
    id: 't1',
    cityId: 1,
    cityLabel: 'Bangkok, Thailand',
    startDate: '2026-08-17',
    endDate: '2026-09-13',
    overlap: { start: '2026-08-23', end: '2026-08-28' },
  };

  // Run 44 photographed "Both there Aug 23 - 28" half-dissolved into the
  // gradient under the Say hi bar: the fact that explains why this person is
  // on your screen, unreadable at rest. It moved to the hero, where nothing
  // floats over it, and the trip card stops repeating it.
  it('is said next to the name instead of on the trip card', () => {
    renderProfile({ trips: [trip] });
    expect(screen.getByText(/^Both in Bangkok/)).toBeTruthy();
    expect(screen.queryByText(/^Both there/)).toBeNull();
  });

  // The hero can only name one. A second overlapping city still has to say
  // which window belongs to it.
  it('still marks a second overlapping trip on its own card', () => {
    const second = {
      ...trip,
      id: 't2',
      cityLabel: 'Chiang Mai, Thailand',
      overlap: { start: '2026-09-01', end: '2026-09-03' },
    };
    renderProfile({ trips: [trip, second] });
    expect(screen.getByText(/^Both in Bangkok/)).toBeTruthy();
    expect(screen.getByText(/^Both there Sep 1/)).toBeTruthy();
    expect(screen.queryByText(/^Both there Aug/)).toBeNull();
  });

  it('says nothing when the trips do not overlap', () => {
    renderProfile({ trips: [{ ...trip, overlap: null }] });
    expect(screen.queryByText(/^Both in/)).toBeNull();
  });

  // Your own profile has no viewer to overlap with.
  it('is not shown to the owner', () => {
    renderProfile({ trips: [trip], owner: true });
    expect(screen.queryByText(/^Both in/)).toBeNull();
  });
});

describe('opening a photo full screen', () => {
  const photo: ProfilePhotoRow = {
    id: 'p1',
    user_id: 'u1',
    storage_path: 'u1/0.jpg',
    position: 0,
    moderation_status: 'approved',
    moderation_attempts: 0,
    moderation_category: null,
    moderation_engine: null,
    created_at: '',
  };
  const second: ProfilePhotoRow = { ...photo, id: 'p2', storage_path: 'u1/1.jpg', position: 1 };

  beforeEach(() => {
    mockSignedUrl = 'https://signed.example/u1-0.jpg';
  });
  afterEach(() => {
    mockSignedUrl = null;
  });

  // The whole point of these four. A test that renders PhotoViewer directly
  // proves the viewer works; it proves nothing about whether a person holding
  // the phone can reach it. THESE are the call sites: the hero photo and every
  // gallery photo, on the one component that draws both your own profile and
  // everybody else's.
  it('opens from the hero photo', () => {
    renderProfile({ photos: [photo] });
    expect(screen.queryByLabelText('Close photo')).toBeNull();
    fireEvent.press(screen.getByLabelText('Profile photo of Maestro Test'));
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
  });

  it('opens from a gallery photo', () => {
    renderProfile({ photos: [photo, second] });
    fireEvent.press(screen.getByLabelText('Maestro Test, photo 2 of 2'));
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
  });

  it('opens on your own profile too, where the camera button lives', () => {
    // Owner mode stacks an Edit photos button on the same frame. It is drawn
    // above the photo, so it keeps its own target and the photo keeps the
    // rest of the frame.
    renderProfile({ photos: [photo], owner: true, onEditSection: jest.fn() });
    expect(screen.getByLabelText('Edit photos')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Your profile photo'));
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
  });

  it('does not swallow the reply chip sitting on the same photo', () => {
    // The hero carries three targets on one frame: the photo, the "About
    // this" chip and (for an owner) the camera. Making the frame itself the
    // button is what would eat the other two, so the press lands on the
    // image layer underneath them instead.
    const onRespondTo = jest.fn();
    renderProfile({ photos: [photo], onRespondTo });
    fireEvent.press(screen.getByLabelText('Say hi about this photo'));
    expect(onRespondTo).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'photo:0', photoPath: 'u1/0.jpg' })
    );
    expect(screen.queryByLabelText('Close photo')).toBeNull();
  });

  it('offers nothing to open while the URL is still being signed', () => {
    // A tap that opens a black screen is worse than a tap that does nothing,
    // so the frame is a skeleton with no target on it at all until the signed
    // URL lands.
    mockSignedUrl = null;
    renderProfile({ photos: [photo] });
    expect(screen.queryByLabelText('Profile photo of Maestro Test')).toBeNull();
    expect(screen.queryByLabelText('Close photo')).toBeNull();
  });
});

/** An ISO date n days from today, negative for a trip already under way. */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

describe('a trip that is roughly when', () => {
  // In the current year on purpose: formatDateRange prints the year only when
  // the trip is not in it, so a hardcoded 2026 would silently start reading
  // "Sep 1 – 30, 2026" on the first run of 2027 and the assertions below
  // would have to be loosened to survive it. They must not be.
  const year = new Date().getFullYear();
  const rough = {
    id: 't1',
    cityId: 1,
    cityLabel: 'Bangkok, Thailand',
    startDate: `${year}-09-01`,
    endDate: `${year}-09-30`,
    approximate: true,
  };

  it('says the window is a guess in the line the dates are on', () => {
    // Not a range plus a chip qualifying it. Somebody deciding whether to
    // book flights around these dates should not have to notice a second
    // element to learn the first one is approximate.
    renderProfile({ trips: [rough] });
    expect(screen.getByText('Around Sep 1 – 30')).toBeTruthy();
  });

  it('leaves an exact trip reading exactly as it did', () => {
    renderProfile({ trips: [{ ...rough, approximate: false }] });
    expect(screen.getByText('Sep 1 – 30')).toBeTruthy();
    expect(screen.queryByText(/^Around/)).toBeNull();
  });

  it('spells it out to VoiceOver as well, not only on screen', () => {
    renderProfile({ trips: [rough], onRespondTo: jest.fn() });
    expect(
      screen.getByLabelText('Bangkok, Thailand, Around Sep 1 – 30. Say hi about this.')
    ).toBeTruthy();
  });

  it('asks the owner for real dates once the window is close', () => {
    const onEditTrip = jest.fn();
    renderProfile({
      owner: true,
      trips: [{ ...rough, startDate: inDays(3), endDate: inDays(3) }],
      onEditTrips: onEditTrip,
    });
    fireEvent.press(screen.getByTestId('rough-dates-nudge'));
    expect(onEditTrip).toHaveBeenCalled();
  });

  it('does not ask while the trip is still months away', () => {
    renderProfile({
      owner: true,
      trips: [{ ...rough, startDate: '2099-09-01', endDate: '2099-09-30' }],
    });
    expect(screen.queryByTestId('rough-dates-nudge')).toBeNull();
  });

  it("never asks a stranger about somebody else's dates", () => {
    renderProfile({ trips: [{ ...rough, startDate: inDays(3), endDate: inDays(3) }] });
    expect(screen.queryByTestId('rough-dates-nudge')).toBeNull();
  });

  // Both edges of the window the nudge lives in. It had only the upper one,
  // and daysUntil goes NEGATIVE the moment a trip starts while fetchMyTrips
  // keeps it on the profile until its end date passes - so on day five of a
  // rough Bangkok window the owner was asked to firm up dates for the trip
  // they were already on.
  describe('the window the nudge lives in', () => {
    const owned = (start: string, end: string) => ({
      owner: true,
      trips: [{ ...rough, startDate: start, endDate: end }],
    });

    it('asks on the last day it is still useful, and not the day after', () => {
      renderProfile(owned(inDays(14), inDays(20)));
      expect(screen.getByTestId('rough-dates-nudge')).toBeTruthy();

      screen.unmount();
      renderProfile(owned(inDays(15), inDays(20)));
      expect(screen.queryByTestId('rough-dates-nudge')).toBeNull();
    });

    it('asks on the morning the window opens, and never once it has', () => {
      renderProfile(owned(inDays(0), inDays(20)));
      expect(screen.getByTestId('rough-dates-nudge')).toBeTruthy();

      screen.unmount();
      // Day five of the trip. There is nothing left to firm up, and the one
      // screen it could appear on is the profile they are living out of.
      renderProfile(owned(inDays(-5), inDays(20)));
      expect(screen.queryByTestId('rough-dates-nudge')).toBeNull();
    });
  });

  /**
   * Through the mappers the screens actually use.
   *
   * Everything above hands `approximate` in as a prop, which proves the
   * component and nothing at all about the app. That gap is how a column
   * reaches the database, gets a renderer, and still never appears on a
   * screen: the mappers in between are hand-written copies of one shape, and
   * a copy that forgets a field fails silently and greenly. There is one
   * mapper now (features/trips/profile-trips.ts) and these tests start where
   * the database answer starts, so a field it drops is a red test rather than
   * a screen nobody notices is wrong.
   */
  describe('from a row the database actually returns', () => {
    const year = new Date().getFullYear();

    const travelerRow: TravelerTripRow = {
      trip_id: 't1',
      city_id: 1,
      city_name: 'Bangkok',
      city_country: 'Thailand',
      start_date: `${year}-09-01`,
      end_date: `${year}-09-30`,
      approximate: true,
    };

    const cities: CityRow = {
      id: 1,
      name: 'Bangkok',
      country_code: 'TH',
      country_name: 'Thailand',
      admin: null,
      lat: 13.75,
      lng: 100.5,
      population: 10_000_000,
      timezone: 'Asia/Bangkok',
    };

    const ownTrip: TripWithCity = {
      id: 't1',
      user_id: 'u1',
      city_id: 1,
      start_date: `${year}-09-01`,
      end_date: `${year}-09-30`,
      approximate: true,
      status: 'active',
      created_at: '',
      updated_at: '',
      cities,
    };

    it("carries the guess onto a stranger's profile", () => {
      // traveler_trips() -> the profile route and the Travelers queue.
      renderProfile({ trips: [travelerRow].map(profileTripFromTravelerRow) });
      expect(screen.getByText('Around Sep 1 – 30')).toBeTruthy();
    });

    it('carries it onto your own, where it can still be fixed', () => {
      // fetchMyTrips() -> your own profile and signup's review step.
      renderProfile({ owner: true, trips: [ownTrip].map(profileTripFromOwnTrip) });
      expect(screen.getByText('Around Sep 1 – 30')).toBeTruthy();
    });

    it('leaves an exact row reading exactly as it did, from both sources', () => {
      renderProfile({
        trips: [{ ...travelerRow, approximate: false }].map(profileTripFromTravelerRow),
      });
      expect(screen.getByText('Sep 1 – 30')).toBeTruthy();
      expect(screen.queryByText(/^Around/)).toBeNull();

      screen.unmount();
      renderProfile({ trips: [{ ...ownTrip, approximate: false }].map(profileTripFromOwnTrip) });
      expect(screen.getByText('Sep 1 – 30')).toBeTruthy();
      expect(screen.queryByText(/^Around/)).toBeNull();
    });

    it('reaches the nudge as well as the wording', () => {
      renderProfile({
        owner: true,
        trips: [{ ...ownTrip, start_date: inDays(3), end_date: inDays(9) }].map(
          profileTripFromOwnTrip
        ),
      });
      expect(screen.getByTestId('rough-dates-nudge')).toBeTruthy();
    });
  });
});
