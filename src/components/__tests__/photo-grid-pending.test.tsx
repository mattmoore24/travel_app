import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { PhotoGrid } from '@/components/photo-grid';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProfilePhotoRow } from '@/lib/database.types';

/**
 * The photo grid before its photos.
 *
 * `photos` defaulted to `[]`, so every slot drew as a dashed "Add a photo"
 * box while the list was pending and then filled: an invitation to add what
 * was already there, on the one step of signup that cannot be skipped.
 * Shapes until the list lands; and inside a filled tile, a shape until the
 * bytes land, because the URL landing is not the photo landing.
 */

const mockPhotos = {
  data: undefined as ProfilePhotoRow[] | undefined,
  isPending: true,
  fetchStatus: 'fetching' as 'fetching' | 'idle',
};
// What the signer answers: undefined is "still signing", a string the URL.
let mockUrl: string | undefined = undefined;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// The suite's shared Reanimated stub (jest.setup.js) stops at the surface
// the app had before the grid's tiles carried a layout transition; a filled
// tile reads `LinearTransition.springify()` at render. Widened HERE rather
// than there, per the setup file's own rule, so every other test keeps the
// smaller lie.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View, Text, ScrollView } = require('react-native');
  const passthrough = (Component: unknown) => {
    const Wrapped = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      const { entering, exiting, layout, ...rest } = props;
      void entering;
      void exiting;
      void layout;
      return React.createElement(Component, { ...rest, ref });
    });
    Wrapped.displayName = 'Animated(View)';
    return Wrapped;
  };
  const descriptor = (): Record<string, () => unknown> => {
    const chain: Record<string, () => unknown> = {};
    for (const key of ['duration', 'delay', 'springify', 'mass', 'stiffness', 'damping']) {
      chain[key] = () => chain;
    }
    return chain;
  };
  const Animated = passthrough(View) as unknown as Record<string, unknown>;
  Animated.View = passthrough(View);
  Animated.Text = passthrough(Text);
  Animated.ScrollView = passthrough(ScrollView);
  Animated.createAnimatedComponent = passthrough;
  return {
    __esModule: true,
    default: Animated,
    FadeIn: descriptor(),
    FadeOut: descriptor(),
    FadeInDown: descriptor(),
    FadeOutDown: descriptor(),
    SlideInDown: descriptor(),
    SlideOutDown: descriptor(),
    LinearTransition: descriptor(),
    Easing: { inOut: () => () => 0, quad: () => 0 },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => object) => factory(),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
    withSpring: (to: unknown) => to,
    withTiming: (to: unknown) => to,
    withRepeat: (to: unknown) => to,
    withSequence: (to: unknown) => to,
    interpolate: (value: unknown) => value,
    runOnJS: (fn: unknown) => fn,
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useReducedMotion: () => false,
  };
});

jest.mock('@/features/profile/hooks', () => ({
  useOwnPhotos: () => mockPhotos,
  useUploadPhoto: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useReorderPhotos: () => ({ mutate: jest.fn(), isPending: false }),
  useDeletePhoto: () => ({ mutate: jest.fn(), isPending: false }),
  useOwnProfile: () => ({ data: { verified: false } }),
  usePhotoUrl: () => ({ data: mockUrl, isError: false }),
}));

jest.mock('@/lib/pick-image', () => ({
  pickImage: jest.fn(),
}));

const photo = (over: Partial<ProfilePhotoRow> = {}): ProfilePhotoRow =>
  ({
    id: 'p1',
    user_id: 'u1',
    storage_path: 'u1/0.jpg',
    position: 0,
    moderation_status: 'approved',
    ...over,
  }) as ProfilePhotoRow;

/** Mount and give the grid a width, which it measures rather than assumes. */
function show() {
  render(<PhotoGrid />);
  fireEvent(screen.UNSAFE_root.findAllByType(View)[0], 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 0 } },
  });
}

beforeEach(() => {
  mockPhotos.data = undefined;
  mockPhotos.isPending = true;
  mockPhotos.fetchStatus = 'fetching';
  mockUrl = undefined;
});

describe('while the list is on its way', () => {
  it('draws shapes in the slots, never "Add a photo"', () => {
    show();
    // The main tile, three extras, and the count line.
    expect(screen.UNSAFE_getAllByType(Skeleton).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByLabelText('Add your profile photo')).toBeNull();
    expect(screen.queryByLabelText('Add a photo')).toBeNull();
    expect(screen.queryByText(/of \d+$/)).toBeNull();
  });

  it('treats a query that will never ask as answered, so the slots are not shapes forever', () => {
    // Disabled (no session): idle and pending for the life of the screen.
    mockPhotos.fetchStatus = 'idle';
    show();
    expect(screen.getByLabelText('Add your profile photo')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });
});

describe('once the list has landed', () => {
  it('invites the owner to add a photo only when there genuinely is none', () => {
    mockPhotos.isPending = false;
    mockPhotos.data = [];
    show();
    expect(screen.getByLabelText('Add your profile photo')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });

  it('pulses a filled tile until its bytes land, and draws one Image keyed on the path', () => {
    mockPhotos.isPending = false;
    mockPhotos.data = [photo()];
    show();
    // Signing: the tile's own pulse, no Image, and no dashed main slot.
    expect(screen.UNSAFE_getAllByType(Skeleton)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    expect(screen.queryByLabelText('Add your profile photo')).toBeNull();

    mockUrl = 'https://signed.example/u1/0.jpg?token=1';
    screen.unmount();
    show();
    const images = screen.UNSAFE_getAllByType(Image);
    expect(images).toHaveLength(1);
    expect(images[0].props.source.cacheKey).toBe('u1/0.jpg');
    expect(images[0].props.accessibilityLabel).toBe('Your profile photo');
  });
});
