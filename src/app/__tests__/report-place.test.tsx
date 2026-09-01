import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ReportPlaceScreen from '@/app/report-place';
import { REPORT_ROW } from '@/app/chat/[id]';
import { REPORT_REASONS } from '@/features/business/vocabulary';
import { travelerMenuItems } from '@/features/profile/actions-menu';

/**
 * Reporting a business for how it behaved, not only for being the wrong pin.
 *
 * The businesses on this map are hostels and bars: rooms the app encourages
 * strangers to walk into. Four of the five reasons this form used to offer
 * were map corrections and the fifth was "Spam or something offensive", so
 * somebody harassed by whoever is behind a hostel's account had no honest
 * option here at all - and no better one on the chat thread, whose Report row
 * filed against `other_user_id`, the owner as a private person.
 *
 * What this file holds to: the two conduct reasons exist and lead the list,
 * the screen asks a different question for them, and the thread's Report row
 * can still be found by the label this screen's sibling swaps it by.
 */

// jest.mock factories are hoisted, so shared state is named mock*.
const mockMutateAsync = jest.fn();
const mockParams: Record<string, string> = { id: 'b1', name: 'Casa Azul' };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/business/hooks', () => ({
  useReportBusiness: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ReportPlaceScreen />
    </SafeAreaProvider>
  );

beforeEach(() => {
  mockMutateAsync.mockResolvedValue(undefined);
});

describe('the reasons a business can be reported for', () => {
  it('offers the two about people as well as the four about the pin', () => {
    show();
    for (const option of REPORT_REASONS) {
      expect(screen.getByLabelText(option.label)).toBeTruthy();
    }
    expect(REPORT_REASONS).toHaveLength(7);
  });

  it('leads with conduct, because the order is the triage order', () => {
    // A form listing "It's in the wrong spot" above "It felt unsafe" has said
    // something about which of the two it takes seriously. app/report.tsx
    // settled the same argument the same way for travelers.
    expect(REPORT_REASONS[0]).toEqual({
      value: 'harassment_or_conduct',
      label: 'Somebody here treated me badly',
    });
    expect(REPORT_REASONS[1]).toEqual({ value: 'unsafe', label: 'It felt unsafe' });
  });

  it('asks what happened once the reason is about a person', () => {
    show();
    expect(screen.getByPlaceholderText('Anything else worth knowing?')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Somebody here treated me badly'));
    expect(screen.getByPlaceholderText('What happened?')).toBeTruthy();
    // And back again, because the reason can be changed before sending.
    fireEvent.press(screen.getByLabelText("It's in the wrong spot"));
    expect(screen.getByPlaceholderText('Anything else worth knowing?')).toBeTruthy();
  });

  it('sends the reason that was picked', async () => {
    show();
    fireEvent.press(screen.getByLabelText('It felt unsafe'));
    fireEvent.press(screen.getByText('Send report'));
    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        businessId: 'b1',
        reason: 'unsafe',
        note: undefined,
      })
    );
  });
});

describe('what the confirmation promises', () => {
  const alertBody = async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(screen.getByText('Send report'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const body = String(alert.mock.calls[0][1]);
    alert.mockRestore();
    return body;
  };

  it('says a business can come off the map over conduct', async () => {
    show();
    fireEvent.press(screen.getByLabelText('Somebody here treated me badly'));
    const body = await alertBody();
    expect(body).toContain('a business can come off the map over this');
    // Anonymity is still promised. It was the only thing the old sentence
    // promised, which is why it was too small an answer to harassment.
    expect(body).toContain('Casa Azul never finds out who reported it.');
  });

  it('does not say it about a map correction', async () => {
    show();
    fireEvent.press(screen.getByLabelText("It's closed for good"));
    const body = await alertBody();
    expect(body).not.toContain('off the map');
    expect(body).toContain('Casa Azul never finds out who reported it.');
  });

  it('says the same thing whether or not this report is the first one', async () => {
    // The database takes one report per account and silently ignores the
    // second (on conflict do nothing), so a different sentence the second
    // time would be the app telling whoever is holding the phone what this
    // account did before.
    show();
    fireEvent.press(screen.getByLabelText('It felt unsafe'));
    const first = await alertBody();
    const second = await alertBody();
    expect(second).toEqual(first);
  });
});

describe('the Report row on a business thread', () => {
  const REPO = path.join(__dirname, '..', '..', '..');
  const thread = (): string => fs.readFileSync(path.join(REPO, 'src/app/chat/[id].tsx'), 'utf8');

  it('is still findable by the label the thread swaps it by', () => {
    // chat/[id].tsx re-points exactly one row of the shared action sheet and
    // has nothing but its label to find it by. If somebody renames it in
    // actions-menu.ts, the swap silently stops happening and every report
    // about a hostel goes back to naming its owner. This is the assertion
    // that fails instead.
    const items = travelerMenuItems({
      userId: 'u1',
      context: 'chat:c1',
      onBlock: () => {},
    });
    expect(items.filter((item) => item.label === REPORT_ROW)).toHaveLength(1);
    expect(REPORT_ROW).toBe('Report');
  });

  it('sends a traveler to the business form, with the business id on it', () => {
    const code = thread();
    // The swap is guarded on the listing actually being known: placeId is
    // null until useBusinessForChat lands, and a Report row that opens a form
    // whose Send button cannot fire is worse than the older queue.
    expect(code).toContain('const business = isPlace && placeId != null ? placeId : null;');
    const swap = code.indexOf("pathname: '/report-place'");
    expect(swap).toBeGreaterThan(-1);
    expect(code.slice(swap, swap + 200)).toContain('params: { id: business, name: chat.title');
  });

  it('leaves the business reader reporting a person, because that is who wrote in', () => {
    // useIsPlaceChat is false when the READER is the business, so `isPlace`
    // gates the swap in both directions: the owner reading its own inbox
    // keeps /report with other_user_id, which on that side is a real
    // traveler.
    const code = thread();
    expect(code).toContain('const isPlace = useIsPlaceChat(chat.kind);');
    expect(code).toContain('userId: chat.other_user_id,');
  });
});
