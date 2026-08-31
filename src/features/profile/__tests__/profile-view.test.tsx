import { render, screen } from '@testing-library/react-native';

import { ProfileView } from '@/features/profile/profile-view';
import type { ProfilePhotoRow, ProfileRow } from '@/lib/database.types';

// The photo hooks reach for a signed URL; nothing here has a photo to sign.
jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: null }),
}));

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
