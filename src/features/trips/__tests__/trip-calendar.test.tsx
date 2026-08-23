import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { TripCalendar, defaultEndFor } from '@/features/trips/trip-calendar';

/**
 * The gesture, not the pixels: one tap sets the start, the next closes the
 * range, and everything between is part of the trip. A component test cannot
 * see the highlight band, so it asserts the (start, end) the calendar reports
 * — which is what the band is drawn from.
 */
function Harness({ initial = null }: { initial?: [string, string | null] | null }) {
  const [range, setRange] = useState<[string, string | null] | null>(initial);
  return (
    <>
      <TripCalendar
        start={range?.[0] ?? null}
        end={range?.[1] ?? null}
        minISO="2026-08-01"
        months={2}
        onChange={(start, end) => setRange([start, end])}
      />
    </>
  );
}

/** The highlight band is drawn from this, so this is what the band IS. */
const selected = (label: string) =>
  screen.getByLabelText(label).props.accessibilityState?.selected === true;

const day = (n: number) =>
  new Date(2026, 7, n).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

describe('picking a trip', () => {
  it('takes the first tap as the start and the second as the end', () => {
    const onChange = jest.fn();
    render(
      <TripCalendar start={null} end={null} minISO="2026-08-01" months={1} onChange={onChange} />
    );
    fireEvent.press(screen.getByLabelText(day(10)));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-10', null);
  });

  it('closes the range on the second tap', () => {
    const onChange = jest.fn();
    render(
      <TripCalendar
        start="2026-08-10"
        end={null}
        minISO="2026-08-01"
        months={1}
        onChange={onChange}
      />
    );
    fireEvent.press(screen.getByLabelText(day(14)));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-10', '2026-08-14');
  });

  // Far likelier than wanting a backwards trip.
  it('treats an earlier second tap as changing your mind about the start', () => {
    const onChange = jest.fn();
    render(
      <TripCalendar
        start="2026-08-10"
        end={null}
        minISO="2026-08-01"
        months={1}
        onChange={onChange}
      />
    );
    fireEvent.press(screen.getByLabelText(day(4)));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-04', null);
  });

  it('starts a fresh range once one is finished', () => {
    const onChange = jest.fn();
    render(
      <TripCalendar
        start="2026-08-10"
        end="2026-08-14"
        minISO="2026-08-01"
        months={1}
        onChange={onChange}
      />
    );
    fireEvent.press(screen.getByLabelText(day(20)));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-20', null);
  });

  it('refuses a day before the minimum', () => {
    const onChange = jest.fn();
    render(
      <TripCalendar start={null} end={null} minISO="2026-08-15" months={1} onChange={onChange} />
    );
    fireEvent.press(screen.getByLabelText(day(3)));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a single day is a legal trip', () => {
    const onChange = jest.fn();
    render(
      <TripCalendar
        start="2026-08-10"
        end={null}
        minISO="2026-08-01"
        months={1}
        onChange={onChange}
      />
    );
    fireEvent.press(screen.getByLabelText(day(10)));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-10', '2026-08-10');
  });
});

// The tests above hand the calendar a fixed range and check what it reports
// back. This one is the founder's actual gesture: tap, then tap again, with
// the component wired to its own state the way both screens wire it. It is
// the only test that would catch a range that reports correctly but never
// paints, because a day between the two taps has to come back selected.
describe('two taps in a row', () => {
  it('fills in every day between the start and the end', () => {
    render(<Harness />);

    fireEvent.press(screen.getByLabelText(day(10)));
    expect(selected(day(10))).toBe(true);
    // Nothing in between yet: one tap is half a range.
    expect(selected(day(12))).toBe(false);

    fireEvent.press(screen.getByLabelText(day(14)));
    for (const d of [10, 11, 12, 13, 14]) {
      expect(selected(day(d))).toBe(true);
    }
    expect(selected(day(15))).toBe(false);
  });

  it('starts over rather than growing when you tap a third time', () => {
    render(<Harness initial={['2026-08-10', '2026-08-14']} />);

    fireEvent.press(screen.getByLabelText(day(20)));
    expect(selected(day(20))).toBe(true);
    expect(selected(day(12))).toBe(false);
  });
});

describe('defaultEndFor', () => {
  it('opens on a few nights rather than on nothing', () => {
    expect(defaultEndFor('2026-08-10')).toBe('2026-08-14');
  });
});
