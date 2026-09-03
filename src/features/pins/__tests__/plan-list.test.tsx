import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { clusterPins } from '@/features/pins/cluster';
import {
  PLAN_LIST_PEEK,
  PlanList,
  listableBusinesses,
  planListSummary,
  planSections,
  todayCount,
  type PlanListDetent,
} from '@/features/pins/plan-list';
import { toISODate } from '@/features/trips/dates';
import type { CityBusinessRow, CityPinRow } from '@/lib/database.types';

// PlanList draws PlaceGlyph, whose module (business-marker) imports
// react-native-maps for the Marker half — and the maps native module does
// not exist under jest. The glyphs are not what these tests assert on.
// (jest.mock is hoisted above the imports, so the order here is safe.)
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Marker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Polygon: () => null,
    Circle: () => null,
    PROVIDER_DEFAULT: 'default',
  };
});

// The list is the map's own bottom sheet (founder decision D4) and its rows
// are the same for every viewer: no display_name, no face. A guest's and a
// business's pin feed are identity-stripped server-side, so a row that
// assumed a name would degrade to nothing for two of three account kinds.

let seq = 0;
function pin(over: Partial<CityPinRow> = {}): CityPinRow {
  seq += 1;
  return {
    id: `pin-${String(seq).padStart(3, '0')}`,
    user_id: 'u1',
    display_name: 'Ana',
    age: 27,
    verified: false,
    photo_path: 'photos/ana.jpg',
    venue_name: 'Sky Bar',
    note: 'Sunset drinks',
    plan: null,
    place_label: null,
    category: 'bar',
    lat: 13.7563 + seq * 0.01,
    lng: 100.5018,
    intent_date: toISODate(new Date()),
    seeded: false,
    seed_note: null,
    expires_at: new Date(Date.now() + 20 * 3_600_000).toISOString(),
    chat_id: null,
    crew: 0,
    ...over,
  };
}

function business(over: Partial<CityBusinessRow> = {}): CityBusinessRow {
  seq += 1;
  return {
    id: `biz-${seq}`,
    chat_id: null,
    name: 'Mad Monkey Hostel',
    category: 'hostel',
    lat: 13.75,
    lng: 100.5,
    verified: true,
    cover_path: null,
    has_live_post: true,
    member_count: 4,
    ...over,
  };
}

// The detent is controlled by the map screen now (it needs to know when the
// expanded list covers the map), and so is the peek strip's measured height
// (the message slot anchors on it, and the list remounts on every mode
// change). The test hosts the same two pieces of state the map screen holds.
function Host(props: Partial<Parameters<typeof PlanList>[0]> & { pins: CityPinRow[] }) {
  const [detent, setDetent] = useState<PlanListDetent>('peek');
  const [peekHeight, setPeekHeight] = useState(PLAN_LIST_PEEK);
  return (
    <PlanList
      cityName="Bangkok"
      clusters={clusterPins(props.pins)}
      places={[]}
      isBusinessViewer={false}
      ownBusinessId={null}
      centre={null}
      collapsed={false}
      detent={detent}
      onDetentChange={setDetent}
      footing={92}
      peekHeight={peekHeight}
      onPeekHeight={setPeekHeight}
      onSelectPin={jest.fn()}
      onSelectVenue={jest.fn()}
      onSelectBusiness={jest.fn()}
      {...props}
    />
  );
}

function renderList(over: Partial<Parameters<typeof PlanList>[0]> = {}) {
  const pins = over.pins ?? [pin(), pin(), pin()];
  const result = render(<Host {...over} pins={pins} />);
  // At the peek the rows are hidden from the accessibility tree on purpose;
  // open the list the way a person would before reading it.
  fireEvent.press(screen.getByTestId('plan-list-peek'));
  return result;
}

describe('the rows are faceless for every viewer', () => {
  it('never prints a display name', () => {
    renderList();
    expect(screen.queryByText(/Ana/)).toBeNull();
  });

  it('shows a business viewer no traveler-identity fields either', () => {
    renderList({ isBusinessViewer: true });
    expect(screen.queryByText(/Ana/)).toBeNull();
    // The row content itself is unchanged: the plan and the venue stay.
    expect(screen.getAllByText('Sunset drinks').length).toBeGreaterThan(0);
  });

  it('shows a business viewer only its own live post, never a directory', () => {
    const own = business({ id: 'biz-own', name: 'Own Bar' });
    const rival = business({ id: 'biz-rival', name: 'Rival Bar' });
    renderList({
      isBusinessViewer: true,
      ownBusinessId: 'biz-own',
      places: [own, rival],
    });
    expect(screen.getByText('Own Bar')).toBeTruthy();
    expect(screen.queryByText('Rival Bar')).toBeNull();
  });
});

describe('the peek line', () => {
  it('counts exactly the filtered pins it was handed', () => {
    renderList({ pins: [pin(), pin(), pin(), pin()] });
    expect(screen.getByText(/4 plans in Bangkok/)).toBeTruthy();
  });

  it('says today only when something is on today', () => {
    expect(planListSummary('Bangkok', 11, 4)).toBe('11 plans in Bangkok · 4 today');
    expect(planListSummary('Bangkok', 2, 0)).toBe('2 plans in Bangkok');
    expect(planListSummary('Lisbon', 1, 1)).toBe('1 plan in Lisbon · 1 today');
  });

  it('counts today on either clock that writes intent_date', () => {
    const now = new Date();
    expect(
      todayCount([pin({ intent_date: toISODate(now) }), pin({ intent_date: '2001-01-01' })], now)
    ).toBe(1);
  });

  it('leads with the city day and KEEPS the device day matched (widen, never swap)', () => {
    // A device at 20:00 on Jul 30 browsing a city already at 03:00 on Jul 31.
    // Passing the city clock as `now` used to drop the device-local and UTC
    // candidates the map's own Today filter still accepts, so a pin the
    // device clock wrote vanished from the peek's count.
    const device = new Date(2026, 6, 30, 20, 0);
    const city = new Date(2026, 6, 31, 3, 0);
    expect(
      todayCount(
        [
          pin({ intent_date: '2026-07-31' }), // the city's today
          pin({ intent_date: '2026-07-30' }), // the device's today, still matched
          pin({ intent_date: '2026-07-28' }),
        ],
        device,
        city
      )
    ).toBe(2);
  });
});

describe('day grouping', () => {
  it('puts a plan for today under Today', () => {
    renderList({ pins: [pin({ intent_date: toISODate(new Date()) })] });
    expect(screen.getByText('TODAY')).toBeTruthy();
  });

  it('orders sections soonest first', () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const sections = planSections(
      clusterPins([
        pin({ intent_date: toISODate(tomorrow) }),
        pin({ intent_date: toISODate(now) }),
      ]),
      null,
      now
    );
    expect(sections.map((s) => s.title)).toEqual(['Today', 'Tomorrow']);
  });

  it('sorts rows within a day by distance from the map centre', () => {
    const near = pin({ lat: 10.0, lng: 100 });
    const far = pin({ lat: 11.0, lng: 100 });
    const sections = planSections(clusterPins([far, near]), { lat: 10.0, lng: 100 });
    expect(sections[0].rows[0].pins[0].id).toBe(near.id);
  });
});

describe('which businesses may appear', () => {
  it('lists only businesses with something on', () => {
    const live = business({ id: 'b1', has_live_post: true });
    const quiet = business({ id: 'b2', has_live_post: false });
    expect(listableBusinesses([live, quiet], false, null).map((b) => b.id)).toEqual(['b1']);
  });

  it('narrows a business viewer to its own listing', () => {
    const own = business({ id: 'own' });
    const rival = business({ id: 'rival' });
    expect(listableBusinesses([own, rival], true, 'own').map((b) => b.id)).toEqual(['own']);
  });
});
