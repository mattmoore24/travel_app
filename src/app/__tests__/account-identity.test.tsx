import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { DeleteAccountSheet } from '@/app/profile-me';
import { confirmIdentity, identityProofFor } from '@/features/auth/api';
import { deleteAccount } from '@/features/profile/api';

/**
 * The one irreversible act in the app, and the check in front of it.
 *
 * Deleting used to be a single Alert with a Delete button on it, and
 * supabase/functions/delete-account hard-deletes every chat the account
 * belongs to for BOTH members. So an unlocked phone left on a hostel table
 * was enough to destroy an account permanently and take with it every
 * conversation on the other side of it, belonging to people who are not
 * present and never agreed to lose them.
 *
 * The test that matters is the NEGATIVE: deleteAccount must not be reached
 * when the identity check says no. A source scan cannot see that - the call
 * is there either way - so this one renders the sheet and presses the button.
 * The assertions that ARE about shape (both account pages offering it, the
 * ordering behind it) live in business-home.test.ts beside the rest of the
 * account page.
 */

jest.mock('@/features/auth/api', () => ({
  confirmIdentity: jest.fn(),
  identityProofFor: jest.fn(() => 'password'),
  signOut: jest.fn(() => Promise.resolve()),
  signOutEverywhere: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/features/profile/api', () => ({
  deleteAccount: jest.fn(() => Promise.resolve({ deleted: true })),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const check = confirmIdentity as jest.MockedFunction<typeof confirmIdentity>;
const proofFor = identityProofFor as jest.MockedFunction<typeof identityProofFor>;
const remove = deleteAccount as jest.MockedFunction<typeof deleteAccount>;

function open() {
  render(
    <DeleteAccountSheet
      title="Delete your account?"
      body="Deletes your profile, photos, trips, pins and chats, for both sides."
      onClose={jest.fn()}
    />
  );
}

/** Type a password, so the button is not sitting there disabled. */
function typePassword(value = 'a real password') {
  fireEvent.changeText(screen.getByTestId('confirm-password-input'), value);
}

describe('deleting an account asks who is holding the phone', () => {
  beforeEach(() => {
    proofFor.mockReturnValue('password');
    remove.mockResolvedValue({ deleted: true });
  });

  it('does not delete anything when the password is wrong', async () => {
    check.mockResolvedValue({ outcome: 'failed', problem: 'That did not check out. Try again.' });
    open();
    typePassword('not the password');
    fireEvent.press(screen.getByText('Delete forever'));

    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(remove).not.toHaveBeenCalled();
    // And it says so where the person is looking, rather than closing.
    expect(await screen.findByText('That did not check out. Try again.')).toBeTruthy();
  });

  it('does not delete anything when somebody backs out of the Apple sheet', async () => {
    // The account kind with no password of ours at all, which is the case
    // that decides the whole design.
    proofFor.mockReturnValue('apple');
    check.mockResolvedValue({ outcome: 'canceled' });
    open();
    expect(screen.queryByTestId('confirm-password-input')).toBeNull();
    fireEvent.press(screen.getByText('Delete forever'));

    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(remove).not.toHaveBeenCalled();
    // Changing your mind is not a failed check, so nothing accuses anybody.
    expect(screen.queryByText('That did not check out. Try again.')).toBeNull();
  });

  it('deletes once the check comes back confirmed', async () => {
    check.mockResolvedValue({ outcome: 'confirmed' });
    open();
    typePassword();
    fireEvent.press(screen.getByText('Delete forever'));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });

  it('never sends a password nobody typed', async () => {
    // The button is disabled until there is one, so an empty submit cannot
    // reach a check that would answer "wrong" for an empty string.
    check.mockResolvedValue({ outcome: 'confirmed' });
    open();
    fireEvent.press(screen.getByText('Delete forever'));

    await waitFor(() => expect(remove).not.toHaveBeenCalled());
    expect(check).not.toHaveBeenCalled();
  });

  it('offers a way out that is not deleting', () => {
    check.mockResolvedValue({ outcome: 'confirmed' });
    const onClose = jest.fn();
    render(<DeleteAccountSheet title="Delete your account?" body="Gone." onClose={onClose} />);
    fireEvent.press(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
