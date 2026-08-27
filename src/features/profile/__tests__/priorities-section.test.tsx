import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProfileView } from '@/features/profile/profile-view';
import type { ProfilePriorityRow, ProfileRow } from '@/lib/database.types';

jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: null }),
}));

const profile: ProfileRow = {
  user_id: 'u1',
  display_name: 'Maestro Test',
  age: 29,
  home_city: 'Lisbon',
  home_country: 'Portugal',
  languages: [],
  bio: null,
  occupation: null,
  gender: 'unspecified',
  verified: false,
  onboarding_completed_at: null,
  created_at: '',
  updated_at: '',
};

const priority = (slot: number, text: string): ProfilePriorityRow => ({
  user_id: 'u1',
  slot,
  text,
  updated_at: '',
});

const LIST = [priority(0, 'day trip to Sintra'), priority(1, 'learn to surf')];

function renderProfile(props: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  return render(
    <ProfileView profile={profile} photos={[]} trips={[]} handles={[]} owner={false} {...props} />
  );
}

describe('Top priorities on somebody else', () => {
  it('shows every entry', () => {
    renderProfile({ priorities: LIST });
    expect(screen.getByText('day trip to Sintra')).toBeTruthy();
    expect(screen.getByText('learn to surf')).toBeTruthy();
  });

  // The chip IS the feature: tapping one opens the composer anchored to that
  // plan, which is what turns "here is a person" into "I'm in for this".
  it('makes each chip open a reply anchored to that one plan', () => {
    const onRespondTo = jest.fn();
    renderProfile({ priorities: LIST, onRespondTo });
    fireEvent.press(screen.getByLabelText("learn to surf. Say you're in."));
    expect(onRespondTo).toHaveBeenCalledWith({
      key: 'priority:1',
      label: 'something on their list',
      quote: 'learn to surf',
    });
  });

  it('says nothing at all when the list is empty', () => {
    renderProfile({ priorities: [] });
    expect(screen.queryByText('Top priorities')).toBeNull();
  });

  // A visitor must never be shown an editing affordance, and the two modes
  // share one component, so this is the assertion that keeps them apart.
  it('offers a visitor no way to edit it', () => {
    renderProfile({ priorities: LIST, onEditPriorities: jest.fn() });
    expect(screen.queryByLabelText('Edit top priorities')).toBeNull();
    expect(screen.queryByTestId('add-priority')).toBeNull();
  });
});

describe('Top priorities on your own profile', () => {
  it('explains itself when the list is empty, because that is the only place it can', () => {
    renderProfile({ owner: true, priorities: [], onEditPriorities: jest.fn() });
    expect(screen.getByText('What do you want to do?')).toBeTruthy();
    expect(
      screen.getByText("Places, food, a night out, the one thing you'd hate to miss. Up to six.")
    ).toBeTruthy();
  });

  it('counts down the remaining room once there is something in it', () => {
    renderProfile({ owner: true, priorities: LIST, onEditPriorities: jest.fn() });
    expect(screen.getByText('4 left.')).toBeTruthy();
  });

  it('stops offering another at six', () => {
    const full = Array.from({ length: 6 }, (_, i) => priority(i, `plan ${i}`));
    renderProfile({ owner: true, priorities: full, onEditPriorities: jest.fn() });
    expect(screen.queryByTestId('add-priority')).toBeNull();
  });

  it('sends a chip tap to the editor rather than to the composer', () => {
    const onEditPriorities = jest.fn();
    renderProfile({ owner: true, priorities: LIST, onEditPriorities, onRespondTo: jest.fn() });
    fireEvent.press(screen.getByLabelText('learn to surf. Edit.'));
    expect(onEditPriorities).toHaveBeenCalledWith(1);
  });
});
