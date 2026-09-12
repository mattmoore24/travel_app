import { act, render, renderHook, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { PinMark, useMarkerTracking } from '@/features/pins/pin-marker';

/**
 * The marker's face badge arrives after its URL, and the marker notices.
 *
 * The rasterisation window closes 500 ms after the tracking key changes,
 * and the key carried the signed URL, which resolves BEFORE the bytes
 * download. On a cold cache every marker whose face took longer than that
 * froze with an empty badge and never redrew until a selection or the dim
 * flipped. Now the face's onLoad bumps a counter that is in the key, so the
 * window re-opens when there is actually a face to draw. The map's half of
 * the wiring is pinned in map-large-text.test.ts; this is the marker's.
 */

describe('the face badge', () => {
  it('reports when its bytes land', () => {
    const onFaceLoad = jest.fn();
    render(
      <PinMark
        kind="plan"
        category="bar"
        photoUri="https://cdn.test/a.jpg"
        photoPath="u1/a.jpg"
        onFaceLoad={onFaceLoad}
      />
    );
    const face = screen.UNSAFE_getByType(Image);
    expect(onFaceLoad).not.toHaveBeenCalled();
    act(() => face.props.onLoad());
    expect(onFaceLoad).toHaveBeenCalledTimes(1);
  });

  it('is keyed on the storage path, so a relaunch draws it from disk', () => {
    render(
      <PinMark kind="plan" category="bar" photoUri="https://cdn.test/a.jpg" photoPath="u1/a.jpg" />
    );
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({
      uri: 'https://cdn.test/a.jpg',
      cacheKey: 'u1/a.jpg',
    });
  });

  it('still keys on the URL alone when there is no path to key on', () => {
    render(<PinMark kind="plan" category="bar" photoUri="https://cdn.test/a.jpg" />);
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({ uri: 'https://cdn.test/a.jpg' });
  });

  it('is still a plain Image, one per face and none on a count pin', () => {
    // Not RemoteImage: a pulse inside a rasterised marker is frozen or keeps
    // every marker tracking, and pin-mark.test counts Images by type.
    render(<PinMark kind="plan" category="bar" count={3} photoUri="https://cdn.test/a.jpg" />);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });
});

describe('useMarkerTracking', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes the window half a second after the key settles', () => {
    const { result } = renderHook((props: { key: string }) => useMarkerTracking(props.key), {
      initialProps: { key: 'a:https://cdn.test/a.jpg:0' },
    });
    expect(result.current).toBe(true);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });

  it('re-opens it when the face count in the key moves, and closes it again', () => {
    const { result, rerender } = renderHook(
      (props: { key: string }) => useMarkerTracking(props.key),
      {
        initialProps: { key: 'a:https://cdn.test/a.jpg:0' },
      }
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
    // The bytes land: the map bumps the counter and the key changes.
    rerender({ key: 'a:https://cdn.test/a.jpg:1' });
    expect(result.current).toBe(true);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });
});
