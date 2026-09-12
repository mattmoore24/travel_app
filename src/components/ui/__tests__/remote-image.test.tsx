import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Text } from 'react-native';

import { RemoteImage } from '@/components/ui/remote-image';
import { Skeleton } from '@/components/ui/skeleton';
import { Motion } from '@/constants/theme';

/**
 * A remote photo has four states and one frame draws all of them.
 *
 * Signing (no source yet), downloading, shown, failed. Every frame in the
 * app used to answer those with whatever its screen had to hand, and the
 * one that mattered on hostel wifi, "still coming" against "not coming",
 * was the one none of them could say. These pin the frame's answer to each.
 *
 * expo-image is a host View that keeps the Image's own props, so a test can
 * fire onLoad and onError the way the native view would, and count Images
 * by type. Reanimated is mocked per file because the global stub pins
 * useReducedMotion to false and one case here has to flip it.
 */

let mockReduced = false;

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef((props: object, ref: unknown) =>
    React.createElement(View, { ...props, ref })
  );
  AnimatedView.displayName = 'Animated(View)';
  return {
    __esModule: true,
    default: { View: AnimatedView },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: () => mockReduced,
    withTiming: (to: unknown) => to,
    withRepeat: (to: unknown) => to,
  };
});

jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  // The props land on the host View unchanged, so `props.source.uri`,
  // `props.transition`, `props.onLoad` and `props.onError` are all readable
  // off the rendered element.
  const MockImage = (props: object) =>
    React.createElement(View, { testID: 'expo-image', ...props });
  return { __esModule: true, Image: MockImage };
});

jest.mock('expo-symbols', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  return {
    SymbolView: (props: object) => React.createElement(View, { testID: 'symbol', ...props }),
  };
});

const SOURCE = { uri: 'https://x.supabase.co/sign/u1/abc.jpg?token=1', cacheKey: 'u1/abc.jpg' };
const FRAME = { width: 120, height: 120 };

const images = () => screen.UNSAFE_queryAllByType(Image);
const skeletons = () => screen.UNSAFE_queryAllByType(Skeleton);

const layout = (width: number, height: number) =>
  fireEvent(screen.getByTestId('frame'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height } },
  });

const load = () => act(() => screen.getByTestId('expo-image').props.onLoad({ source: SOURCE }));
const fail = () => act(() => screen.getByTestId('expo-image').props.onError({ error: 'no bytes' }));

beforeEach(() => {
  mockReduced = false;
});

describe('signing: a source that is not here yet', () => {
  it('draws the skeleton and no Image while the URL is pending', () => {
    render(<RemoteImage source={null} pending style={FRAME} testID="frame" />);
    expect(skeletons()).toHaveLength(1);
    expect(images()).toHaveLength(0);
  });

  it('draws the fallback, and nothing else, when there is no photo at all', () => {
    render(<RemoteImage source={null} style={FRAME} testID="frame" fallback={<Text>LM</Text>} />);
    expect(screen.getByText('LM')).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
    expect(images()).toHaveLength(0);
  });

  it('keeps the fallback off the frame while the photo is still being signed', () => {
    render(
      <RemoteImage source={null} pending style={FRAME} testID="frame" fallback={<Text>LM</Text>} />
    );
    expect(screen.queryByText('LM')).toBeNull();
  });
});

describe('downloading, then shown', () => {
  it('renders exactly one Image, with the source passed through unchanged', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    expect(images()).toHaveLength(1);
    // The cache key photoSource put on it must survive: it is the half of a
    // photo's identity that outlives a re-sign (lib/photo-source).
    expect(images()[0].props.source).toBe(SOURCE);
    expect(images()[0].props.source.uri).toBe(SOURCE.uri);
    expect(images()[0].props.source.cacheKey).toBe('u1/abc.jpg');
  });

  it('keeps the skeleton under the Image until the bytes land', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    expect(skeletons()).toHaveLength(1);
    load();
    expect(skeletons()).toHaveLength(0);
    expect(images()).toHaveLength(1);
  });

  it('forwards onLoad to the caller', () => {
    const onLoad = jest.fn();
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" onLoad={onLoad} />);
    load();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('asks expo-image for the disk cache, so a relaunch does not re-download', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    expect(images()[0].props.cachePolicy).toBe('memory-disk');
  });

  it("draws no skeleton at all for 'flat', where the sunken ground is the placeholder", () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" skeleton="flat" />);
    expect(skeletons()).toHaveLength(0);
    expect(images()).toHaveLength(1);
  });
});

describe('failed', () => {
  it('shows the glyph with a spoken reason, and drops the skeleton', () => {
    const onError = jest.fn();
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" onError={onError} />);
    fail();
    expect(screen.getByLabelText('Photo could not load')).toBeTruthy();
    expect(screen.getByTestId('symbol')).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
    expect(onError).toHaveBeenCalledTimes(1);
    // The Image stays mounted: it is the thing a retry remounts.
    expect(images()).toHaveLength(1);
  });

  it('names the photo the caller named', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" accessibilityLabel="Lena" />);
    fail();
    expect(screen.getByLabelText('Lena could not load')).toBeTruthy();
  });

  it('sizes the glyph from the frame, never past 24', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    layout(40, 40);
    fail();
    // 40% of the short side: an avatar gets a glyph that fits its circle.
    expect(screen.getByTestId('symbol').props.size).toBe(16);
  });

  it('is a retry target only when the frame is big enough to be one', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    layout(40, 40);
    fail();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByHintText('Try the photo again')).toBeNull();
  });

  it('retries in place from a frame at least 96pt on its short side', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    layout(200, 120);
    fail();
    const retry = screen.getByRole('button');
    expect(retry.props.accessibilityLabel).toBe('Photo could not load');
    expect(retry.props.accessibilityHint).toBe('Try the photo again');
    expect(screen.getByTestId('symbol').props.size).toBe(24);
    fireEvent.press(retry);
    // Back to loading: the skeleton returns, the glyph goes, the Image is
    // remounted under a new key so expo-image asks for the bytes again.
    expect(skeletons()).toHaveLength(1);
    expect(screen.queryByLabelText('Photo could not load')).toBeNull();
    expect(images()).toHaveLength(1);
  });
});

describe('a new photo starts over', () => {
  it('resets to loading when the recycling key changes', () => {
    const { rerender } = render(
      <RemoteImage source={SOURCE} style={FRAME} testID="frame" recyclingKey="row-1" />
    );
    load();
    expect(skeletons()).toHaveLength(0);
    rerender(<RemoteImage source={SOURCE} style={FRAME} testID="frame" recyclingKey="row-2" />);
    expect(skeletons()).toHaveLength(1);
  });

  it('resets to loading when the URI changes', () => {
    const { rerender } = render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    fail();
    expect(screen.getByLabelText('Photo could not load')).toBeTruthy();
    rerender(
      <RemoteImage source={{ ...SOURCE, uri: `${SOURCE.uri}1` }} style={FRAME} testID="frame" />
    );
    expect(screen.queryByLabelText('Photo could not load')).toBeNull();
    expect(skeletons()).toHaveLength(1);
  });
});

describe('the fade-in', () => {
  it('runs for Motion.quick by default', () => {
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" />);
    expect(images()[0].props.transition).toBe(Motion.quick);
  });

  it('is zero under Reduce Motion, whatever the caller asked for', () => {
    mockReduced = true;
    render(<RemoteImage source={SOURCE} style={FRAME} testID="frame" transition={400} />);
    expect(images()[0].props.transition).toBe(0);
  });
});
