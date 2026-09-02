import { fireEvent, render, screen } from '@testing-library/react-native';

import VisibilityScreen from '@/app/visibility';
import { fetchOwnGuestPreview, setOwnGuestPreview } from '@/features/profile/api';

/**
 * The signed-out preview opt-out (D22), from the row to the RPC it calls.
 *
 * Two things a green suite could not otherwise see: that the row exists and
 * only while the audience is Everyone (under anything narrower a guest is
 * already nobody, and a control that changes nothing is a control that
 * lies), and that what the client calls is the function the migration
 * created, by name. The behaviour of that function is pgTAP's half
 * (70_a_face_can_stay_behind_the_door).
 */

const mockState = { audience: 'everyone', shown: true };
const mockSetPreview = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@/features/profile/hooks', () => ({
  useOwnProfile: () => ({ data: { verified: true } }),
  useOwnVisibility: () => ({ data: mockState.audience }),
  useSetVisibility: () => ({ mutate: jest.fn(), isPending: false }),
  useOwnGuestPreview: () => ({ data: mockState.shown }),
  useSetGuestPreview: () => ({ mutate: mockSetPreview, isPending: false }),
}));
jest.mock('@/features/groups/adds', () => ({
  GROUP_ADD_OPTIONS: [],
  useGroupAdds: () => ({ data: 'known' }),
  useSetGroupAdds: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/features/profile/audience-picker', () => ({ AudiencePicker: () => null }));
jest.mock('@/components/form/step-screen', () => ({
  StepScreen: ({ children }: { children: unknown }) => children,
}));

const mockRpc = jest.fn(
  async (
    _fn: string,
    _args?: Record<string, unknown>
  ): Promise<{ data: boolean | null; error: null }> => ({ data: null, error: null })
);
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => mockRpc(fn, args) },
}));

describe('the signed-out preview row', () => {
  beforeEach(() => {
    mockState.audience = 'everyone';
    mockState.shown = true;
    mockSetPreview.mockClear();
  });

  it('is there while the audience is Everyone, and turns the preview off', () => {
    render(<VisibilityScreen />);
    expect(screen.getByText('Before somebody has an account')).toBeTruthy();
    fireEvent.press(screen.getByText('Hide me from people without an account'));
    expect(mockSetPreview).toHaveBeenCalledWith(false);
  });

  it('says so when it is off, and turns it back on', () => {
    mockState.shown = false;
    render(<VisibilityScreen />);
    expect(screen.getByText(/Only people with an account can see you/)).toBeTruthy();
    fireEvent.press(screen.getByText('Show me to people without an account'));
    expect(mockSetPreview).toHaveBeenCalledWith(true);
  });

  it('is absent under a narrowed audience, where a guest is already nobody', () => {
    mockState.audience = 'verified';
    render(<VisibilityScreen />);
    expect(screen.queryByText('Before somebody has an account')).toBeNull();
    expect(screen.queryByText(/people without an account/)).toBeNull();
  });
});

describe('the functions the row calls', () => {
  beforeEach(() => {
    mockRpc.mockClear();
  });

  it('reads through my_shown_to_guests and treats no answer as shown', async () => {
    await expect(fetchOwnGuestPreview()).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('my_shown_to_guests', undefined);
  });

  it('writes through set_shown_to_guests with the value it was given', async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(setOwnGuestPreview(false)).resolves.toBe(false);
    expect(mockRpc).toHaveBeenCalledWith('set_shown_to_guests', { p_shown: false });
  });
});
