import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useAnnounce } from '@/features/chat/use-announce';

/**
 * The announce hook speaks once per settle and does nothing at all when no
 * screen reader is running. An announcement that fires on every render is
 * worse than silence, and the isScreenReaderEnabled guard is what keeps the
 * hook free for the ninety-something percent of sessions with VoiceOver off.
 */

const flush = () => act(async () => {});

describe('useAnnounce', () => {
  let enabled: jest.SpyInstance;
  let announce: jest.SpyInstance;

  beforeEach(() => {
    enabled = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled');
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
  });

  it('does nothing when isScreenReaderEnabled resolves false', async () => {
    enabled.mockResolvedValue(false);
    renderHook(() => useAnnounce('6 chats'));
    await flush();
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces the settle once, not on every render of the same settle', async () => {
    enabled.mockResolvedValue(true);
    const { rerender } = renderHook(
      ({ message }: { message: string | null }) => {
        useAnnounce(message);
      },
      {
        initialProps: { message: null as string | null },
      }
    );
    await flush();
    expect(announce).not.toHaveBeenCalled();

    rerender({ message: '6 chats' });
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('6 chats');

    // A refetch changing the data identity is not a new settle.
    rerender({ message: '7 chats' });
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces again after the message resets to null (a fresh load)', async () => {
    enabled.mockResolvedValue(true);
    const { rerender } = renderHook(
      ({ message }: { message: string | null }) => {
        useAnnounce(message);
      },
      {
        initialProps: { message: 'No chats yet' as string | null },
      }
    );
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);

    rerender({ message: null });
    rerender({ message: '2 chats' });
    await flush();
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('2 chats');
  });
});
