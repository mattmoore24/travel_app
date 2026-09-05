import { ShareLink } from '@/features/share/share-link';

/**
 * A group invite as a square somebody can point a phone at, plus the share
 * sheet that sends the same link as words.
 *
 * The hostel lobby is literally the QR use case: you are standing in front of
 * four people, and "let me get your number so I can send you a link" is three
 * steps where holding up a screen is none.
 *
 * A thin caller of features/share/share-link, which owns both halves now. The
 * group was the only surface in the app with either, which is why a business
 * with a hundred travelers a week through reception had nothing to hand
 * anybody.
 */
export function InviteQr({
  url,
  message,
  disabled = false,
  size = 200,
}: {
  url: string;
  message: string;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <ShareLink
      url={url}
      message={message}
      caption="Point a camera at this to join."
      shareLabel="Share an invite"
      disabled={disabled}
      size={size}
    />
  );
}
