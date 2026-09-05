import { createTrip, updateTrip } from '@/features/trips/api';

/**
 * Posting and editing a trip against a project whose migration has not landed.
 *
 * supabase-deploy and testflight are independent workflow_dispatch jobs with
 * no `needs:` between them, so the JavaScript can be on a phone before
 * 20260902230000 is on the database. PostgREST answers a payload key it has no
 * column for with PGRST204 and refuses the WHOLE statement - so an unguarded
 * `approximate` on the write path takes ORDINARY trips down with it, on the
 * screen the Travelers tab sends people to first when they have no plans.
 *
 * The reads in this same change were all written for that window
 * (FeaturedTravelerRow.approximate is optional, useFeaturedPhoto accepts both
 * shapes, useMeetPromptDue carries retry: false). This is the write half.
 */

type Payload = Record<string, unknown>;

const mockSent: Payload[] = [];
let mockAnswers: ({ code: string } | null)[] = [];

/**
 * Enough of the query builder for one insert or one update, answering with the
 * next queued error. `.eq()` ends an update and is awaited directly; an insert
 * ends at `.single()`.
 */
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      insert: (payload: Payload) => {
        mockSent.push(payload);
        const error = mockAnswers.shift() ?? null;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: error ? null : { id: 'trip-1' }, error }),
          }),
        };
      },
      update: (payload: Payload) => {
        mockSent.push(payload);
        const error = mockAnswers.shift() ?? null;
        return { eq: () => Promise.resolve({ error }) };
      },
    }),
  },
}));

const UNKNOWN_COLUMN = { code: 'PGRST204' };

beforeEach(() => {
  mockSent.length = 0;
  mockAnswers = [];
});

describe('posting a trip', () => {
  it('does not name the new column at all when the trip is an ordinary one', async () => {
    await createTrip('me', 7, '2026-09-03', '2026-09-08');
    expect(mockSent).toHaveLength(1);
    // Not `approximate: false`. False is the column's own default, so the row
    // written is identical either way - and the key is the difference between
    // an ordinary trip posting and PGRST204.
    expect(mockSent[0]).not.toHaveProperty('approximate');
    expect(mockSent[0]).toMatchObject({ city_id: 7, start_date: '2026-09-03' });
  });

  it('still sends it for a rough one, and lets that fail rather than lying', async () => {
    mockAnswers = [UNKNOWN_COLUMN];
    await expect(createTrip('me', 7, '2026-09-01', '2026-09-30', true)).rejects.toMatchObject({
      code: 'PGRST204',
    });
    expect(mockSent[0]).toMatchObject({ approximate: true });
    // One attempt. A window the database cannot mark as a guess must not be
    // quietly stored as a claim about somebody's dates.
    expect(mockSent).toHaveLength(1);
  });
});

describe('editing a trip', () => {
  it('moves the dates even when the database has never heard of the column', async () => {
    mockAnswers = [UNKNOWN_COLUMN, null];
    await updateTrip('trip-1', {
      startDate: '2026-10-01',
      endDate: '2026-10-09',
      approximate: false,
    });
    expect(mockSent).toHaveLength(2);
    expect(mockSent[0]).toMatchObject({ approximate: false });
    // The retry keeps the dates and drops only the flag. A project with no
    // column has no rough trips in it, so false is what a re-read would say.
    expect(mockSent[1]).toEqual({ start_date: '2026-10-01', end_date: '2026-10-09' });
  });

  it('does not retry a rough save, because there is no honest way to store it', async () => {
    mockAnswers = [UNKNOWN_COLUMN];
    await expect(
      updateTrip('trip-1', { startDate: '2026-09-01', endDate: '2026-09-30', approximate: true })
    ).rejects.toMatchObject({ code: 'PGRST204' });
    expect(mockSent).toHaveLength(1);
  });

  it('keeps turning a rough trip back into an exact one where the column exists', async () => {
    // The reason `false` is sent at all rather than omitted the way the insert
    // omits it: without it, an editor could only ever make a trip rough.
    await updateTrip('trip-1', {
      startDate: '2026-09-08',
      endDate: '2026-09-15',
      approximate: false,
    });
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0]).toMatchObject({ approximate: false });
  });

  it('passes a real database error straight through', async () => {
    mockAnswers = [{ code: '23514' }];
    await expect(updateTrip('trip-1', { endDate: '2030-01-01' })).rejects.toMatchObject({
      code: '23514',
    });
    expect(mockSent).toHaveLength(1);
  });
});
