import { fireEvent, render, screen } from '@testing-library/react-native';

import { formatMonth, rangeForRoughDates, toISODate, validateTripRange } from '../dates';
import {
  RoughDatesPicker,
  defaultRoughDates,
  roughDatesFor,
  roughLengthFor,
  roughMonthOptions,
} from '../rough-dates';

/**
 * A rough window is stored as two real dates, so the editor has to rebuild
 * "which month, roughly how long" out of them every time somebody opens it.
 * Getting that wrong does not fail loudly: it moves the trip a little on each
 * save.
 */
describe('reopening a rough trip', () => {
  const months = ['2027-01', '2027-02', '2027-04', '2027-09', '2028-02'];

  it('re-derives the exact window it was posted with, every month of the year', () => {
    for (const monthISO of months) {
      for (const length of [4, 7, 14, 30, 60, 90]) {
        const stored = rangeForRoughDates(monthISO, length);
        const reopened = roughDatesFor(stored.start, stored.end);
        expect(rangeForRoughDates(reopened.monthISO, reopened.lengthDays)).toEqual(stored);
      }
    }
  });

  it('fits the length downwards, never to the nearest one', () => {
    // February is 28 days. Snapping that to "about a month" would re-derive
    // Feb 1 to Mar 2 and quietly add two days to somebody's trip every time
    // they opened the editor and saved it.
    expect(roughLengthFor('2027-02-01', '2027-02-28')).toBe(14);
    expect(rangeForRoughDates('2027-02', 14)).toEqual({
      start: '2027-02-01',
      end: '2027-02-28',
    });
  });
});

describe('the months on offer', () => {
  it('starts with the one we are in, because that is who the tab is for', () => {
    // The year comes from the clock, not from a literal. formatMonth appends
    // the year to any month outside the current one, so a hardcoded 2026 here
    // would have started reading "Sep 2026" - and failing - on 2027-01-01.
    // The sibling below already avoided that; this one had not.
    const year = new Date().getFullYear();
    const from = new Date(year, 8, 14);
    const options = roughMonthOptions(from);
    expect(options[0]).toEqual({ value: `${year}-09`, label: 'Sep' });
    expect(options).toHaveLength(12);
  });

  it('says which year once it is not this one', () => {
    const from = new Date(new Date().getFullYear(), 8, 14);
    const labels = roughMonthOptions(from).map((option) => option.label);
    expect(labels[0]).toBe('Sep');
    // Four months on from September is January, which is a different year.
    expect(labels[4]).toBe(`Jan ${from.getFullYear() + 1}`);
  });
});

describe('the rough dates picker', () => {
  const month = roughMonthOptions()[3];
  const value = { monthISO: month.value, lengthDays: 7 };

  it('shows the window it is about to store, in the wording the profile uses', () => {
    const range = rangeForRoughDates(value.monthISO, value.lengthDays);
    render(<RoughDatesPicker value={value} onChange={jest.fn()} />);
    // The same "Around ..." sentence a stranger reads on the profile, said
    // here before it is posted rather than discovered afterwards.
    expect(screen.getByText(/^Around /)).toBeTruthy();
    expect(range.start.slice(0, 7)).toBe(month.value);
  });

  it('hands back a month and a length rather than two dates', () => {
    const onChange = jest.fn();
    render(<RoughDatesPicker value={value} onChange={onChange} />);
    fireEvent.press(screen.getByText('About two weeks'));
    expect(onChange).toHaveBeenCalledWith({ monthISO: month.value, lengthDays: 14 });

    onChange.mockClear();
    fireEvent.press(screen.getByText(roughMonthOptions()[5].label));
    expect(onChange).toHaveBeenCalledWith({
      monthISO: roughMonthOptions()[5].value,
      lengthDays: 7,
    });
  });
});

/**
 * The trip somebody is already on.
 *
 * A trip that started last month is the one most likely to be edited - it is
 * the one happening - and the rough tab could not hold it. `defaultRoughDates`
 * answered with the month the trip STARTED in, `roughMonthOptions` lists
 * twelve months beginning with this one, and nothing reconciled the two: the
 * rail highlighted the current month, the sentence above it and the dates
 * about to be saved came from the month before, and Save sat disabled under
 * "This trip is entirely in the past" naming a month nobody had picked.
 */
describe('a trip that began before this month', () => {
  const dayLastMonth = (): string => {
    const now = new Date();
    return toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 10));
  };
  const lastMonthISO = (): string => dayLastMonth().slice(0, 7);

  it('opens the rough tab on a month a traveler can actually be offered', () => {
    // TripEditor seeds the tab from the trip's own start date. A month the
    // rail does not list cannot be confirmed, changed, or seen.
    const seeded = defaultRoughDates(dayLastMonth());
    expect(roughMonthOptions().some((option) => option.value === seeded.monthISO)).toBe(true);
  });

  it('seeds a window that can be saved rather than one the date rules refuse', () => {
    const seeded = defaultRoughDates(dayLastMonth());
    const range = rangeForRoughDates(seeded.monthISO, seeded.lengthDays);
    expect(validateTripRange(range.start, range.end)).toBeNull();
  });

  it('offers the month a rough trip was posted with, and highlights that one', () => {
    // The month must NOT be clamped on this path: a stored window is
    // reproduced, never reassigned. "About two months from last month" is a
    // trip running right now, and its owner opening the editor to change the
    // city must not have their month silently moved.
    const stored = { monthISO: lastMonthISO(), lengthDays: 60 };
    render(<RoughDatesPicker value={stored} onChange={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: formatMonth(stored.monthISO), selected: true })
    ).toBeTruthy();
    // And the current month, which the rail used to light up in its place
    // while the sentence above it and the dates about to be saved said
    // otherwise, is not the one selected.
    expect(
      screen.queryByRole('button', {
        name: roughMonthOptions()[0].label,
        selected: true,
      })
    ).toBeNull();
  });
});
