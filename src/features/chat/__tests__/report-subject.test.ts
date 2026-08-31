import { reportUser } from '@/features/chat/api';

/**
 * What a report is ABOUT, on the wire.
 *
 * The database is the enforcement layer here — `reports_has_a_subject` refuses
 * a report with neither subject, and the insert policy refuses a chat report
 * from somebody outside that chat (42_report_a_group.test.sql) — so what is
 * worth pinning in jest is the shape this function sends, because a column
 * quietly omitted would land as a report about nobody.
 */

// jest.mock factories are hoisted above every other binding, so the spy they
// close over has to be named mock* to be allowed through.
const mockInsert = jest.fn((_row: unknown) => ({ error: null }));
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => ({ insert: (row: unknown) => mockInsert(row) }) },
}));

beforeEach(() => {
  mockInsert.mockClear();
});

describe('reportUser', () => {
  it('sends a person and no chat for an ordinary report', async () => {
    await reportUser({
      reporterId: 'me',
      reportedUserId: 'them',
      reason: 'harassment',
      details: null,
      context: 'profile',
    });
    expect(mockInsert).toHaveBeenCalledWith({
      reporter_id: 'me',
      reported_user_id: 'them',
      reported_chat_id: null,
      reason: 'harassment',
      details: null,
      context: 'profile',
    });
  });

  it('sends a chat and no person when the subject is the room itself', async () => {
    await reportUser({
      reporterId: 'me',
      reportedChatId: 'c1',
      reason: 'safety_concern',
      details: 'it has turned nasty',
      context: 'group:c1',
    });
    expect(mockInsert).toHaveBeenCalledWith({
      reporter_id: 'me',
      reported_user_id: null,
      reported_chat_id: 'c1',
      reason: 'safety_concern',
      details: 'it has turned nasty',
      context: 'group:c1',
    });
  });

  it('always names both columns, so an omitted one cannot mean "unchanged"', async () => {
    await reportUser({
      reporterId: 'me',
      reason: 'spam',
      details: null,
      context: null,
    });
    const row = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(row)).toContain('reported_user_id');
    expect(Object.keys(row)).toContain('reported_chat_id');
  });
});
