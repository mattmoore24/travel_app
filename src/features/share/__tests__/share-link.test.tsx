import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

import { InviteQr } from '@/features/groups/invite-qr';
import { ShareLink } from '@/features/share/share-link';

/**
 * One builder, two callers.
 *
 * The QR and the share sheet were the group invite's alone, which is why a
 * business with a hundred travelers a week through reception had nothing to
 * hand anybody. These pin the seam: the group's own square still says what it
 * always said, and whatever mounts ShareLink next sends the same one string
 * the share sheet has always taken.
 */

const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });

beforeEach(() => {
  shareSpy.mockClear();
});

describe('ShareLink', () => {
  it('draws a square and offers the sheet, under the words the caller chose', () => {
    render(
      <ShareLink
        url="https://link.samewhere.io/i/abc"
        message="Join us: https://link.samewhere.io/i/abc"
        caption="Point a camera at this to join."
        shareLabel="Share an invite"
      />
    );
    expect(screen.getByLabelText('QR code for this link')).toBeTruthy();
    expect(screen.getByText('Point a camera at this to join.')).toBeTruthy();
    expect(screen.getByText('Share an invite')).toBeTruthy();
  });

  it('sends exactly one string, so it lands intact wherever it is pasted', () => {
    render(
      <ShareLink
        url="https://link.samewhere.io/i/abc"
        message="Join us: https://link.samewhere.io/i/abc"
        caption="Point a camera at this to join."
        shareLabel="Share an invite"
      />
    );
    fireEvent.press(screen.getByText('Share an invite'));
    expect(shareSpy).toHaveBeenCalledWith({ message: 'Join us: https://link.samewhere.io/i/abc' });
  });
});

describe('the group invite', () => {
  it('is that same component, so the two cannot drift', () => {
    render(<InviteQr url="https://link.samewhere.io/i/abc" message="Join Hostel crew: …" />);
    expect(screen.getByText('Point a camera at this to join.')).toBeTruthy();
    fireEvent.press(screen.getByText('Share an invite'));
    expect(shareSpy).toHaveBeenCalledWith({ message: 'Join Hostel crew: …' });
  });
});
