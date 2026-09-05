import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { LocationPicker } from '@/features/pins/location-picker';

// A bare <Marker> is legal in react-native-maps, and MapKit answers it with
// its default red-coral balloon — the one colour §7 bans as a UI colour, on
// the screen that asks an owner to confirm the marker travelers will tap. So
// this is an assertion rather than a lint rule: the picker must put OUR
// artwork inside the Marker, centred the way business-marker anchors chips.

type MockProps = { children?: React.ReactNode; testID?: string };
let lastMarkerProps: Record<string, unknown> | null = null;

jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ children }: MockProps) => React.createElement(RN.View, null, children),
    Marker: (props: MockProps) => {
      lastMarkerProps = props;
      return React.createElement(RN.View, { testID: 'picker-marker' }, props.children);
    },
    Polygon: () => null,
    PROVIDER_DEFAULT: 'default',
  };
});

beforeEach(() => {
  lastMarkerProps = null;
});

const at = { centerLat: 38.71, centerLng: -9.14, lat: 38.71, lng: -9.14 };

describe('LocationPicker', () => {
  it('renders the supplied artwork inside the Marker, centred like the map chip', () => {
    render(<LocationPicker {...at} onChange={jest.fn()} marker={<View testID="the-chip" />} />);
    const marker = screen.getByTestId('picker-marker');
    expect(marker.props.children).toBeTruthy();
    expect(screen.getByTestId('the-chip')).toBeTruthy();
    // Centred: a chip has no tail, so the marker IS the point. The default
    // anchor would sit it half a chip off the door.
    expect(lastMarkerProps?.anchor).toEqual({ x: 0.5, y: 0.5 });
    // The drag path the owners rely on must survive the custom artwork.
    expect(lastMarkerProps?.draggable).toBe(true);
  });

  it('draws no marker at all before a spot is placed', () => {
    render(<LocationPicker {...at} onChange={jest.fn()} placed={false} />);
    expect(screen.queryByTestId('picker-marker')).toBeNull();
  });
});
