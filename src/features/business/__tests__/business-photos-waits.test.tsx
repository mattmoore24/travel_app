import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { RemoteImage } from '@/components/ui/remote-image';
import { Skeleton } from '@/components/ui/skeleton';
import { BusinessPhotos, PHOTOS_MAX } from '@/features/business/business-photos';
import type { Database } from '@/lib/database.types';

/**
 * The business photo grid's three states, rendered.
 *
 * `photos` defaulted to [] while the list was in the air, so the footer said
 * "0 of 10" and the dashed tile invited a cover from an owner who already
 * had one, on every cold open of the editor. And each tile was a flat sunken
 * square until its URL arrived: the one grid in the app with no loading
 * graphic at all. Skeleton before words; the count only once the list is
 * known; LoadError, never "0 of 10", when the read fails.
 *
 * The fetch is settled by hand rather than the hook mocked, because the
 * grid's own `photosPending` reads fetchStatus as well as isPending and a
 * mocked hook would only prove the mock agrees with itself.
 */

type PhotoRow = Database['public']['Tables']['business_photos']['Row'];
type Answer = { data: PhotoRow[] | null; error: Error | null };

// The tile rides a `layout={LinearTransition.springify()}`, which the
// jest.setup.js stub does not carry (no rendered test had needed it), so this
// file brings the same stub with that one preset added. Same shape as the
// shared one: animated views are plain views, presets are inert chains,
// shared values are ordinary objects.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef(
    (props: { entering?: unknown; exiting?: unknown; layout?: unknown }, ref: unknown) => {
      const { entering, exiting, layout, ...rest } = props;
      void entering;
      void exiting;
      void layout;
      return React.createElement(View, { ...rest, ref });
    }
  );
  AnimatedView.displayName = 'Animated(View)';
  const preset = () => {
    const chain: Record<string, () => unknown> = {};
    for (const key of ['duration', 'delay', 'springify', 'damping', 'stiffness', 'mass']) {
      chain[key] = () => chain;
    }
    return chain;
  };
  return {
    __esModule: true,
    default: { View: AnimatedView },
    FadeIn: preset(),
    FadeOut: preset(),
    SlideOutDown: preset(),
    LinearTransition: preset(),
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => object) => factory(),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    useReducedMotion: () => false,
    withSpring: (to: unknown) => to,
    withTiming: (to: unknown) => to,
    withRepeat: (to: unknown) => to,
    runOnJS: (fn: unknown) => fn,
  };
});

// jest.mock factories are hoisted, so shared state is named mock*.
let mockSettle: (answer: Answer) => void = () => {};
const mockFetch = jest.fn(
  () =>
    new Promise<Answer>((resolve) => {
      mockSettle = resolve;
    })
);

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ order: () => mockFetch() }),
        }),
      }),
    }),
  },
}));
// The tiles sign their own URLs; nothing here has one yet.
jest.mock('@/features/business/photo-url', () => ({
  useBusinessPhotoUrl: () => ({ data: undefined, isError: false }),
}));
jest.mock('@/lib/haptics', () => ({
  haptics: { soft: jest.fn(), light: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const photo = (over: Partial<PhotoRow> = {}): PhotoRow => ({
  id: 'ph-1',
  business_id: 'biz-1',
  storage_path: 'u1/a.jpg',
  position: 0,
  moderation_status: 'pending',
  moderation_category: null,
  moderation_engine: null,
  created_at: '2026-09-01T12:00:00Z',
  ...over,
});

const show = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BusinessPhotos businessId="biz-1" userId="u1" />
    </QueryClientProvider>
  );
  // The grid sizes its tiles from its own measured width.
  fireEvent(screen.getByTestId('business-photos'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 0 } },
  });
};

const settle = (answer: Answer) =>
  act(async () => {
    mockSettle(answer);
    await Promise.resolve();
  });

const skeletons = () => screen.UNSAFE_queryAllByType(Skeleton);
const count = (n: number) => `${n} of ${PHOTOS_MAX}`;

describe('while the list is on its way', () => {
  it('draws three placeholder tiles and neither the count nor the add tile', () => {
    show();
    const tiles = skeletons();
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      // Square, sized from the measured width like the real tiles.
      expect(tile.props.width).toBe(tile.props.height);
      expect(tile.props.width).toBeGreaterThan(0);
    }
    expect(screen.queryByText(count(0))).toBeNull();
    expect(screen.queryByLabelText('Add your cover photo')).toBeNull();
  });
});

describe('once the list has landed', () => {
  it('says "0 of N" and offers the cover tile only for a grid that is really empty', async () => {
    show();
    await settle({ data: [], error: null });
    expect(await screen.findByText(count(0))).toBeTruthy();
    expect(skeletons()).toHaveLength(0);
    expect(screen.getByLabelText('Add your cover photo')).toBeTruthy();
  });

  it('draws each photo as a frame that pulses until its URL arrives', async () => {
    show();
    await settle({ data: [photo()], error: null });
    expect(await screen.findByText(count(1))).toBeTruthy();
    const frames = screen.UNSAFE_getAllByType(RemoteImage);
    expect(frames).toHaveLength(1);
    expect(frames[0].props).toMatchObject({ source: null, pending: true });
    // The tile's own pulse: the frame's, not the grid's.
    expect(skeletons()).toHaveLength(1);
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByText('Nobody sees a cover until one of these clears.')).toBeTruthy();
  });
});

describe('when the read fails', () => {
  it('says so with a retry, and never prints a count', async () => {
    show();
    await settle({ data: null, error: new Error('permission denied') });
    expect(await screen.findByText('Try again')).toBeTruthy();
    expect(screen.queryByText(count(0))).toBeNull();
    expect(skeletons()).toHaveLength(0);
  });
});
