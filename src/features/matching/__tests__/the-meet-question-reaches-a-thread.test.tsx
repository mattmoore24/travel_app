import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

import { answerMeetPrompt } from '@/features/matching/api';
import { MeetPrompt } from '@/features/chat/meet-prompt';

/**
 * The meet question is a card a person can actually tap.
 *
 * a-meet-answer-reaches-nobody.test.tsx proves the hooks behave and
 * 61_did_you_two_actually_meet.test.sql proves the database does. Neither of
 * them could tell that the whole package had no user interface: two hooks, a
 * table, two functions, an admin view and thirty-four pgTAP assertions
 * shipped with exactly one caller in the tree, which was their own unit test.
 * admin_meet_answers - the view that exists to produce the one number the
 * package says decides whether the product works - returned zero rows in
 * perpetuity, under a fully green suite.
 *
 * So this file is about the entry point. It renders the real card, taps the
 * real answers, and holds the thread to mounting it.
 */

jest.mock('@/features/matching/api');
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/lib/haptics', () => ({ haptics: { selection: jest.fn() } }));
jest.mock('@/features/profile/hooks', () => ({ useOwnUserId: () => 'me' }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

const answer = answerMeetPrompt as jest.MockedFunction<typeof answerMeetPrompt>;

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

const show = () => {
  const client = newClient();
  const view = render(<MeetPrompt chatId="c1" />, { wrapper: wrapperFor(client) });
  return { view, client };
};

describe('the card in the thread', () => {
  it('asks the question and offers exactly three answers', () => {
    const { view, client } = show();
    expect(screen.getByText('Did you two end up meeting?')).toBeTruthy();
    // Spoken names, because each visible word is one syllable with no subject.
    // Every one contains its own visible label, which is WCAG 2.5.3.
    expect(screen.getByLabelText('Yes, we met')).toBeTruthy();
    expect(screen.getByLabelText('No, we did not')).toBeTruthy();
    expect(screen.getByLabelText('Not sure')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('Not sure')).toBeTruthy();
    view.unmount();
    client.clear();
  });

  it('says the answer goes nowhere, and says nothing about the other traveler', () => {
    const { view, client } = show();
    expect(
      screen.getByText(
        'Nobody else sees your answer. It is the only way we know whether Samewhere works.'
      )
    ).toBeTruthy();
    // THE RULE THIS CARD IS MOST LIKELY TO BREAK LATER. The other person's
    // answer is unreadable by policy; a sentence mentioning them at all -
    // that they were asked, that they answered, what they said - would put
    // back in words what chat_meet_answers_select_own refuses in rows. So no
    // string on this card refers to them.
    for (const word of ['they', 'They', 'them', 'their', 'both', 'too']) {
      expect(screen.queryByText(new RegExp(`\\b${word}\\b`))).toBeNull();
    }
    view.unmount();
    client.clear();
  });

  it('records the answer the person tapped', async () => {
    answer.mockResolvedValue(true);
    const { view, client } = show();
    fireEvent.press(screen.getByLabelText('No, we did not'));
    await waitFor(() => expect(answer).toHaveBeenCalledWith('c1', 'no'));
    view.unmount();
    client.clear();
  });

  it('offers no way to answer without answering', () => {
    // Asked once, and the dismissal is the answer. A close button that wrote
    // nothing would be back on the next launch, because "have they answered"
    // is the server's memory and the server would still be waiting; one that
    // wrote something would be a fourth answer nobody chose. "Not sure" is
    // the way out.
    const { view, client } = show();
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.queryByText('Skip')).toBeNull();
    expect(screen.queryByText('Later')).toBeNull();
    view.unmount();
    client.clear();
  });
});

const REPO = path.join(__dirname, '..', '..', '..', '..');
const thread = fs.readFileSync(path.join(REPO, 'src', 'app', 'chat', '[id].tsx'), 'utf8');

/**
 * The thread mounts it.
 *
 * Source-reading, and for the reason business-chat.test.ts already states
 * about this exact file: the screen needs a session, a router and a live
 * query client before it renders a single row. What has to stay true is
 * smaller than a rendered state and is precisely what was missing - that
 * something in the tree calls the hook and puts the card on screen.
 */
describe('the thread that shows it', () => {
  it("renders the card above the thread on the server's own true", () => {
    expect(thread).toContain("import { MeetPrompt } from '@/features/chat/meet-prompt';");
    expect(thread).toContain(
      '{meetPromptDue.data === true ? <MeetPrompt chatId={chat.chat_id} /> : null}'
    );
  });

  it('derives no part of when to ask', () => {
    // The date arithmetic, the thirty day tail, the block, the report and the
    // caller's own previous answer all live in meet_prompt_due(). A second
    // implementation here is how "the other traveler is still asked" gets
    // quietly broken by somebody adding a nicety.
    //
    // The one thing the client is allowed to decide is whether to ask at all,
    // and it decides it on the same fact the function's first condition reads:
    // THIS thread's kind. It used to gate on the viewer's own account kind
    // instead, which is a different question - a traveler writing to a
    // business is not a business - so the comment above the line said "not
    // asked at all on a business thread" while the round trip was made on
    // every one of them.
    const call = thread.slice(thread.indexOf('useMeetPromptDue('));
    expect(call.slice(0, call.indexOf(';') + 1)).toBe(
      "useMeetPromptDue(chat?.kind === 'direct' ? chat.chat_id : null);"
    );
  });
});
