import { render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { FontCap } from '@/constants/theme';
import {
  Avatar,
  ChatRow,
  SWIPE_ACTION_WIDTH,
  SwipeAction,
  rowStyles,
} from '@/features/chat/chat-row';
import type { ChatListRow } from '@/lib/database.types';

/**
 * The conversation row at the accessibility text sizes, and the face in it.
 *
 * Two fixed boxes around scaling text (the swipe action, the unread pill)
 * and one uncapped piece of row metadata (the stamp) were what clipped at
 * AX5: "Archive" cut to its middle inside a 74pt button, digits cut inside
 * a 20pt pill, "Yesterday" taking half the row from the name. A component
 * test cannot see the clip; it can pin the rule that removes it, which is
 * that a control's width and its label's cap come from the same number.
 *
 * The face is the other half: the disc used to show a person glyph while
 * the URL was signing, so every cold paint of the list said "no photo"
 * about a dozen people who had one, and a recycled cell wore the previous
 * conversation's face for a frame.
 */

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

// What the signer answers: undefined is "still signing", null is "no photo",
// a string is the URL. The row pairs it with the path itself.
let mockUrl: string | null | undefined = null;
jest.mock('@/features/profile/hooks', () => ({
  usePhotoUrl: () => ({ data: mockUrl, isError: false }),
}));
jest.mock('@/features/business/photo-url', () => ({
  useBusinessPhotoUrl: () => ({ data: null, isError: false }),
}));
jest.mock('@/features/chat/hooks', () => ({
  useChatPhotoUrl: () => ({ data: null, isError: false }),
}));
jest.mock('@/features/business/hooks', () => ({
  useIsPlaceChat: () => false,
}));

const row = (over: Partial<ChatListRow> = {}): ChatListRow => ({
  chat_id: 'chat-1',
  kind: 'direct',
  chat_status: 'active',
  title: 'Maya',
  other_user_id: 'user-2',
  photo_path: 'user-2/0.jpg',
  first_message: 'Hey, Lisbon next week?',
  first_message_sender_id: 'user-2',
  last_message: 'See you at the miradouro',
  last_message_at: '2026-08-20T18:00:00Z',
  member_count: null,
  pinned: false,
  muted: false,
  archived: false,
  expires_at: null,
  created_at: '2026-08-01T12:00:00Z',
  my_role: null,
  unread_count: 3,
  first_message_element: null,
  plan_date: null,
  public_preview: null,
  ...over,
});

beforeEach(() => {
  mockFontScale = 1;
  mockUrl = null;
});

describe('a swipe action at large type', () => {
  const action = () =>
    render(
      <SwipeAction
        label="Archive"
        icon={{ ios: 'archivebox.fill', android: 'archive', web: 'archive' }}
        tint="#2A4C9B"
        onTint="#F1F0F7"
        onPress={jest.fn()}
      />
    );

  it('grows with the text, and stops where its label stops', () => {
    mockFontScale = 3;
    action();
    const button = screen.getByLabelText('Archive');
    // The label caps at FontCap.control, so the box does too: a box that
    // kept growing past the label would carry dead space.
    expect(StyleSheet.flatten(button.props.style).width).toBe(
      Math.round(SWIPE_ACTION_WIDTH * FontCap.control)
    );
    const label = screen.getByText('Archive');
    expect(label.props.maxFontSizeMultiplier).toBe(FontCap.control);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
  });

  it('never shrinks below its resting width for a smaller text size', () => {
    mockFontScale = 0.8;
    action();
    expect(StyleSheet.flatten(screen.getByLabelText('Archive').props.style).width).toBe(
      SWIPE_ACTION_WIDTH
    );
  });
});

describe('the trailing column', () => {
  it('caps the stamp and the count at the chrome cap, and bounds its own width', () => {
    render(<ChatRow chat={row()} />);
    // The stamp is metadata in a fixed-height row, not reading text.
    expect(screen.getByText(/2026|Aug|20/).props.maxFontSizeMultiplier).toBe(FontCap.chrome);
    expect(screen.getByText('3').props.maxFontSizeMultiplier).toBe(FontCap.chrome);
    expect(rowStyles.rowTrailing.maxWidth).toBe('40%');
  });

  it('gives the pill a minimum, never a fixed height', () => {
    expect(rowStyles.unreadPill.minHeight).toBe(20);
    expect(rowStyles.unreadPill.paddingVertical).toBe(2);
    expect((rowStyles.unreadPill as { height?: number }).height).toBeUndefined();
  });
});

describe('the face in a row', () => {
  it('shows nothing, not the glyph, while the URL is still being signed', () => {
    mockUrl = undefined;
    render(<Avatar path="user-2/0.jpg" size={52} />);
    expect(screen.UNSAFE_queryAllByType(SymbolView)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    // 'flat': the sunken disc is the placeholder, no pulse at row size.
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });

  it('shows the glyph only for a conversation with no photo at all', () => {
    mockUrl = null;
    render(<Avatar path={null} size={52} />);
    expect(screen.UNSAFE_getAllByType(SymbolView)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('draws one Image keyed on the storage path and recycled by the row', () => {
    mockUrl = 'https://signed.example/user-2/0.jpg?token=1';
    render(<ChatRow chat={row()} />);
    const images = screen.UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    // The path is the half of a photo's identity that outlives a re-sign
    // (lib/photo-source); the row is the recycled unit in the inbox list.
    expect(images[0].props.source.cacheKey).toBe('user-2/0.jpg');
    expect(images[0].props.recyclingKey).toBe('chat-1');
  });
});
