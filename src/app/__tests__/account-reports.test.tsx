import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MyReportsScreen from '@/app/my-reports';
import { after, between } from '@/lib/__tests__/source';

/**
 * What a reporter is allowed to learn, and the entry point that lets them.
 *
 * A report ended in a thank-you and vanished. fetchSupportMessageStatus had
 * been in features/support/api since August with no caller anywhere in src,
 * so the half of this that was built was also dead. It is gone now, replaced
 * by the question asked the other way round - which of these are mine -
 * because the id it needed was one the client threw away.
 *
 * THE LINE THIS FILE POLICES: the screen may say what became of YOUR report
 * and nothing about the account you reported - not the outcome, not an
 * implication of one. The database is what enforces it (my_report_status
 * collapses every resolved report to one word; 62_what_became_of_what_you_
 * sent.test.sql proves a ban and a dismissal come back identical), and these
 * assert the client cannot reintroduce a third state on top of it.
 */

const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const mockRpc = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@/features/profile/hooks', () => ({
  useOwnUserId: () => 'u1',
}));

// StepScreen docks its Done button above the keyboard, which reads the safe
// area, so the screen needs a provider with real metrics under it.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <MyReportsScreen />
      </SafeAreaProvider>
    </QueryClientProvider>
  );

function answer(reports: unknown[], messages: unknown[]) {
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve({
      data: name === 'my_report_status' ? reports : messages,
      error: null,
    })
  );
}

describe('what a reporter can see', () => {
  it('shows their own reports, in their own words, with a coarse state', async () => {
    answer(
      [
        {
          id: 'r1',
          created_at: '2026-08-30T10:00:00.000Z',
          reason: 'harassment',
          state: 'reviewed',
        },
        {
          id: 'r2',
          created_at: '2026-09-01T10:00:00.000Z',
          reason: 'immediate_danger',
          state: 'received',
        },
      ],
      []
    );
    show();

    // The label the form offered them, not the raw enum value.
    expect(await screen.findByText('Harassment')).toBeTruthy();
    expect(screen.getByText('Somebody here is in danger')).toBeTruthy();
    expect(screen.getByText('Reviewed')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
  });

  it('says out loud that it will never tell them what happened to anybody else', async () => {
    answer(
      [{ id: 'r1', created_at: '2026-08-30T10:00:00.000Z', reason: 'spam', state: 'reviewed' }],
      []
    );
    show();
    // Somebody who reported a stranger WILL wonder. The honest answer is
    // that we are never going to say, not that the answer is one tap
    // further in.
    expect(
      await screen.findByText(/We never say what happened to somebody else's account, either way/)
    ).toBeTruthy();
  });

  it('shows messages to support as sent and then delivered', async () => {
    answer(
      [],
      [
        {
          id: 'm1',
          created_at: '2026-08-30T10:00:00.000Z',
          category: 'safety',
          delivered: true,
        },
        { id: 'm2', created_at: '2026-09-01T10:00:00.000Z', category: 'account', delivered: false },
      ]
    );
    show();

    expect(await screen.findByText('Safety')).toBeTruthy();
    expect(screen.getByText('Account')).toBeTruthy();
    expect(screen.getByText('Delivered')).toBeTruthy();
    // Not "Not delivered". The row is the record from the moment it is
    // written; delivery is only our notification catching up with it.
    expect(screen.getByText('Sent')).toBeTruthy();
  });

  it('has an empty state for somebody who has never sent anything', async () => {
    answer([], []);
    show();
    expect(await screen.findByText('Nothing sent yet')).toBeTruthy();
  });

  it('does not call a dropped connection an empty history', async () => {
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'network' } })
    );
    show();
    // "You have never reported anybody" is a bad thing to tell somebody
    // whose report is sitting in the queue behind a dropped connection.
    expect(await screen.findByText('Your reports could not load.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Nothing sent yet')).toBeNull());
  });
});

describe('there is no third state to render', () => {
  const screenSource = src('src/app/my-reports.tsx');
  const apiSource = src('src/features/support/api.ts');
  const migration = src(
    'supabase/migrations/20260902250000_what_became_of_what_you_sent.sql'
  ).replace(/^--.*$/gm, '');

  it('maps every resolved report to one word in the database', () => {
    // The case expression, whole. A third branch here is a moderation
    // outcome about another person published to whoever filed the report.
    expect(migration).toContain("case when r.status = 'open' then 'received' else 'reviewed' end");
    expect(migration).not.toContain('action taken');
    // And nothing that could carry the raw verdict out.
    expect(migration).not.toContain('r.status,');
  });

  it('and the client has nowhere to put one', () => {
    expect(apiSource).toContain("export type ReportState = 'received' | 'reviewed';");
    // The screen renders exactly what the function returns, so a column
    // naming the other account cannot appear by accident. Comments stripped:
    // the file deliberately explains what it must never show.
    const code = screenSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['reported_user_id', 'reported_chat_id', "'resolved"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('answers for a report about a business under the same collapse', () => {
    // report_business writes to a different table, so a screen reading
    // public.reports alone told somebody who reported a bar for a safety
    // concern that they had never sent anything.
    expect(migration).toContain('from public.business_reports b');
    expect(migration).toContain(
      "case when b.resolved_at is null then 'received' else 'reviewed' end"
    );
    // Their own rows only, and never a row whose reporter has been deleted.
    expect(migration).toContain('where b.reporter_user_id is not null');
    expect(migration).toContain('and b.reporter_user_id = auth.uid()');
    // And nothing that could carry the listing's verdict out.
    expect(migration).not.toContain('b.resolution');
  });

  it('gives a business report its own words back', () => {
    // Both forms' lists feed one lookup. Without the business half, every
    // report about a business would render as the neutral 'A report'.
    expect(screenSource).toContain(
      '[...REASON_OPTIONS, ...REPORT_REASONS].map((option) => [option.value, option.label])'
    );
  });

  it('is granted to a signed-in caller and to nobody else', () => {
    expect(migration).toContain(
      'revoke execute on function public.my_report_status() from public, anon;'
    );
    expect(migration).toContain(
      'grant execute on function public.my_report_status() to authenticated;'
    );
    expect(migration).toContain(
      'revoke execute on function public.my_support_messages() from public, anon;'
    );
  });
});

/**
 * The failure this repo pays for over and over: a capability with nothing on
 * the other end. A screen file existing is not a screen anybody can reach.
 */
describe('the way in', () => {
  const account = src('src/app/profile-me.tsx');

  it('is a row on the traveler settings spine', () => {
    // SCOPED TO THE TRAVELER PAGE, and that is the whole test. profile-me.tsx
    // holds both accounts, BusinessAccount is the one declared first, and an
    // unscoped indexOf found ITS row - so deleting the traveler row outright
    // left this green under the name of the half it had stopped covering.
    const spine = after(account, 'export default function ProfileScreen(');
    const row = spine.indexOf('label="Your reports and messages"');
    expect(row).toBeGreaterThan(-1);
    expect(spine.slice(row, row + 400)).toContain("router.push('/my-reports')");
  });

  it('is on the business account page too', () => {
    // A business writes in about a listing that will not confirm and then
    // has nothing at all to look at, which is the same silence.
    const branch = between(account, 'function BusinessAccount(', 'function SettingsRow(');
    const row = branch.indexOf('label="Your reports and messages"');
    expect(row).toBeGreaterThan(-1);
    expect(branch.slice(row, row + 200)).toContain("router.push('/my-reports')");
  });

  it('leads to a route the navigator has, presented like its siblings', () => {
    expect(fs.existsSync(path.join(REPO, 'src', 'app', 'my-reports.tsx'))).toBe(true);
    // An undeclared file route still renders - expo-router appends it - but
    // it inherits the root's headerShown false and a card presentation, which
    // is a full-bleed page under the Dynamic Island with no Close on it.
    // Declaring it is what gives it the modal chrome every sibling has.
    const layout = src('src/app/_layout.tsx');
    expect(layout).toContain(
      '<Stack.Screen name="my-reports" options={{ presentation: \'modal\' }} />'
    );
    // And inside a guard, beside report: the queries are keyed on an account.
    const guarded = between(
      layout,
      '<Stack.Screen name="report" options',
      '<Stack.Screen name="guest-name"'
    );
    expect(guarded).toContain('name="my-reports"');
    expect(guarded).toContain('</Stack.Protected>');
  });
});
