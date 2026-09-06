import { parseTypedTime } from '@/features/pins/typed-time';

/**
 * The grid, because a time parser is a table and nothing else.
 *
 * The behaviour worth defending is the REFUSAL: on a 12-hour phone a bare '7'
 * is not read as 07:00. Every naive parser does read it that way, and being
 * wrong by twelve hours puts a pin on the map for breakfast when the person
 * meant drinks. Asking two extra keystrokes for it is the deliberate trade.
 */

const twelve = { hour12: true };
const twentyFour = { hour12: false };

describe('parseTypedTime', () => {
  it('reads nothing as nothing, not as an error', () => {
    // An empty field is a person who has not answered yet. The time is
    // optional, so this must not paint an error under an untouched box.
    expect(parseTypedTime('', twelve)).toBeNull();
    expect(parseTypedTime('   ', twelve)).toBeNull();
  });

  it.each([
    ['7:30 pm', '19:30'],
    ['7:30pm', '19:30'],
    ['7:30 PM', '19:30'],
    ['7 pm', '19:00'],
    ['7pm', '19:00'],
    ['7p', '19:00'],
    ['7 p.m.', '19:00'],
    ['7:05 am', '07:05'],
    ['12 am', '00:00'],
    ['12:30 am', '00:30'],
    ['12 pm', '12:00'],
    ['12:30 pm', '12:30'],
  ])('reads %s as %s whatever the phone is set to', (typed, expected) => {
    expect(parseTypedTime(typed, twelve)).toEqual({ value: expected });
    expect(parseTypedTime(typed, twentyFour)).toEqual({ value: expected });
  });

  it.each([
    ['19:30', '19:30'],
    ['1930', '19:30'],
    ['930', '09:30'],
    ['09:05', '09:05'],
    ['0', '00:00'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
    ['13', '13:00'],
    ['19', '19:00'],
  ])('reads %s as %s, because it can only be one time', (typed, expected) => {
    expect(parseTypedTime(typed, twelve)).toEqual({ value: expected });
    expect(parseTypedTime(typed, twentyFour)).toEqual({ value: expected });
  });

  it('reads 930 from the right, so the minutes survive', () => {
    // '930' is 9:30. A parser that reads from the left makes it 93:0 and then
    // has to decide what to do about it; reading the last two digits as
    // minutes is the only reading a person ever means.
    expect(parseTypedTime('930', twentyFour)).toEqual({ value: '09:30' });
    expect(parseTypedTime('1930', twentyFour)).toEqual({ value: '19:30' });
  });

  it.each(['1', '7', '11', '12'])(
    'refuses a bare %s on a 12-hour phone rather than guessing',
    (typed) => {
      expect(parseTypedTime(typed, twelve)).toEqual({ error: 'ambiguous' });
    }
  );

  it.each([
    ['1', '01:00'],
    ['7', '07:00'],
    ['11', '11:00'],
    ['12', '12:00'],
  ])(
    'but reads a bare %s as %s on a 24-hour phone, which is what it means there',
    (typed, expected) => {
      expect(parseTypedTime(typed, twentyFour)).toEqual({ value: expected });
    }
  );

  it('resolves a bare hour in the END field against the start', () => {
    // The end knows the start, so the coin flip is decided rather than
    // refused: a plan that starts at 19:00 and ends at '11' is 11 pm, and one
    // that starts at 09:00 and ends at '11' is 11 am.
    expect(parseTypedTime('11', { hour12: true, afterHHMM: '19:00' })).toEqual({ value: '23:00' });
    expect(parseTypedTime('11', { hour12: true, afterHHMM: '09:00' })).toEqual({ value: '11:00' });
    expect(parseTypedTime('8', { hour12: true, afterHHMM: '19:00' })).toEqual({ value: '20:00' });
  });

  it('takes the earliest reading after the start, not merely a later one', () => {
    // The bug this caught: 09:00 to '11' has TWO readings after it, 11:00 and
    // 23:00, and a rule that picks any later one picked eleven at night. Every
    // morning plan ran fourteen hours.
    expect(parseTypedTime('11', { hour12: true, afterHHMM: '09:00' })).toEqual({ value: '11:00' });
    expect(parseTypedTime('2', { hour12: true, afterHHMM: '01:00' })).toEqual({ value: '02:00' });
  });

  it('crosses midnight by taking the earliest reading when none follows the start', () => {
    // A club at 19:00 that ends at '2' means two in the morning. Neither
    // reading is after 19:00, and the server already reads an end at or before
    // the start as tomorrow, so the earliest is the honest one. Choosing the
    // later would say the plan runs till two in the afternoon.
    expect(parseTypedTime('2', { hour12: true, afterHHMM: '19:00' })).toEqual({ value: '02:00' });
    expect(parseTypedTime('12', { hour12: true, afterHHMM: '19:00' })).toEqual({ value: '00:00' });
  });

  it.each(['half seven', 'seven', '7:5', '7:99', '25:00', '24', '13 pm', '0 am', 'pm', '::', '-7'])(
    'refuses %s as unreadable',
    (typed) => {
      const twelveHour = parseTypedTime(typed, twelve);
      expect(twelveHour).not.toBeNull();
      expect(twelveHour).toHaveProperty('error');
    }
  );

  it('tells the two errors apart, because they need different sentences', () => {
    // 'ambiguous' can be fixed by adding am or pm; 'unreadable' cannot be
    // fixed by anything but retyping. A single error message for both would
    // give the wrong instruction to half the people who see it.
    expect(parseTypedTime('7', twelve)).toEqual({ error: 'ambiguous' });
    expect(parseTypedTime('seven', twelve)).toEqual({ error: 'unreadable' });
  });
});
