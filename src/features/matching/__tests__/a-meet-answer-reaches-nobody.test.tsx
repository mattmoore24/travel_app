import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

import { answerMeetPrompt, fetchMeetPromptDue } from '@/features/matching/api';
import { useAnswerMeetPrompt, useMeetPromptDue } from '@/features/matching/hooks';
import { after } from '@/lib/__tests__/source';
import { analytics } from '@/lib/analytics';

/**
 * "Did you two end up meeting" is asked once, and answered where the other
 * person can never reach it.
 *
 * The behaviour lives in the database and pgTAP owns it
 * (supabase/tests/database/61_did_you_two_actually_meet.test.sql attacks the
 * rule from both sides against a real cluster). Two things are guarded here
 * that pgTAP cannot see:
 *
 *   * that the CLIENT does not compute any part of when the question is due.
 *     A second implementation of that rule in JavaScript is how the "still
 *     asked" invariant gets quietly broken by somebody adding a "hide it once
 *     they have both answered" nicety.
 *   * that the analytics event carries the answer and nothing that could tie
 *     it to a chat or to the other traveler. PostHog is the one place this
 *     answer leaves the device, and a chat id in the properties would put
 *     both sides of a private answer in one queryable table.
 *
 * Plus the shape assertions at the bottom, which keep three lines of the
 * migration from being tidied away by somebody who does not know what they
 * are load-bearing for.
 */

jest.mock('@/features/matching/api');
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/features/profile/hooks', () => ({ useOwnUserId: () => 'me' }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
jest.mock('@/features/business/hooks', () => ({ useIsBusiness: () => false }));

const due = fetchMeetPromptDue as jest.MockedFunction<typeof fetchMeetPromptDue>;
const answer = answerMeetPrompt as jest.MockedFunction<typeof answerMeetPrompt>;
const capture = analytics.capture as jest.Mock;

// gcTime 0 so the client holds no timers past the test.
const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

describe('the meet question', () => {
  it('shows what the server says and derives nothing of its own', async () => {
    due.mockResolvedValue(true);
    const client = newClient();
    const hook = renderHook(() => useMeetPromptDue('c1'), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.result.current.data).toBe(true));
    // The chat, and only the chat. Nothing about dates, nothing about the
    // other traveler, and no second argument a client could get wrong.
    expect(due).toHaveBeenCalledWith('c1');
    hook.unmount();
    client.clear();
  });

  it('asks nothing at all without a chat', async () => {
    due.mockResolvedValue(true);
    const client = newClient();
    const hook = renderHook(() => useMeetPromptDue(null), { wrapper: wrapperFor(client) });
    await act(async () => {});
    expect(due).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });

  it('records the answer and tells PostHog nothing that names anybody', async () => {
    answer.mockResolvedValue(true);
    const client = newClient();
    const hook = renderHook(() => useAnswerMeetPrompt(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await hook.result.current.mutateAsync({ chatId: 'c1', answer: 'yes' });
    });
    expect(answer).toHaveBeenCalledWith('c1', 'yes');
    // The exact object, not a subset. A chat id added here later would put
    // both travelers' private answers in one table joinable on that id.
    expect(capture).toHaveBeenCalledWith('meet_answered', { answer: 'yes', first: true });
    hook.unmount();
    client.clear();
  });

  it('takes the card away the moment it is answered, without waiting on a refetch', async () => {
    due.mockResolvedValue(true);
    const client = newClient();
    const wrapper = wrapperFor(client);
    const shown = renderHook(() => useMeetPromptDue('c1'), { wrapper });
    await waitFor(() => expect(shown.result.current.data).toBe(true));

    answer.mockResolvedValue(true);
    const ask = renderHook(() => useAnswerMeetPrompt(), { wrapper });
    await act(async () => {
      await ask.result.current.mutateAsync({ chatId: 'c1', answer: 'no' });
    });
    await waitFor(() => expect(shown.result.current.data).toBe(false));

    ask.unmount();
    shown.unmount();
    client.clear();
  });

  it('counts a second tap as the same answer rather than a second one', async () => {
    // The server refuses to overwrite an answer and says so with `false`.
    // That is an ordinary outcome, not a failure, and the metric must not
    // count it twice.
    answer.mockResolvedValue(false);
    const client = newClient();
    const hook = renderHook(() => useAnswerMeetPrompt(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await hook.result.current.mutateAsync({ chatId: 'c1', answer: 'unsure' });
    });
    expect(capture).toHaveBeenCalledWith('meet_answered', { answer: 'unsure', first: false });
    hook.unmount();
    client.clear();
  });
});

const MIGRATION = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '20260902240000_did_you_two_actually_meet.sql'
);

const sql = fs.readFileSync(MIGRATION, 'utf8');
/** Comments blanked, so a rule is never satisfied by prose describing it. */
const code = sql.replace(/^\s*--.*$/gm, '');

describe('the shape that keeps an answer private', () => {
  it('never reads the other participant when deciding whether to ask', () => {
    // THE ONE THAT MATTERS. A prompt that stopped appearing once the other
    // person answered would publish their answer perfectly, in a boolean,
    // without ever naming it - and every behavioural test would still pass.
    // Both reads of the answers table inside the due check are pinned to the
    // caller.
    const dueFn = after(code, 'function public.meet_prompt_due');
    const body = dueFn.slice(0, dueFn.indexOf('revoke execute'));
    expect(body).toContain('where a.chat_id = c.id and a.user_id = auth.uid()');
    expect(body.match(/chat_meet_answers/g)).toHaveLength(1);
    expect(body).not.toContain('them.user_id\n        and a.user_id');
  });

  it('reads only the caller when a report silences the question', () => {
    // Scoped to the reporter. If the person who was REPORTED stopped being
    // asked as well, the missing card would tell them they had been reported.
    expect(code).toContain('where r.reporter_id = auth.uid()');
  });

  it('lets an answer be written once and never edited', () => {
    // "Asked once, dismissed permanently" is a fact about the grants, not a
    // promise made by the card.
    expect(code).toContain('grant select, insert on public.chat_meet_answers to authenticated');
    expect(code).not.toMatch(/for\s+update\s+to\s+authenticated/);
    expect(code).not.toMatch(/for\s+delete\s+to\s+authenticated/);
  });

  it('keeps the answers table to itself', () => {
    // 20260902220000 in one line: a write that touched nothing a client could
    // read still leaked a presence feed, through a trigger on the row it
    // touched. Nothing fires here, and nothing is broadcast to the channel
    // the other person's thread is subscribed to.
    expect(code).not.toMatch(/create\s+trigger\s+\w*chat_meet_answers/i);
    expect(code).not.toMatch(
      /publication\s+supabase_realtime\s+add\s+table\s+public\.chat_meet_answers/i
    );
  });

  it('never asks about a conversation that is not two travelers', () => {
    // Rule 8: a business is never asked, and never asked about.
    expect(code).toContain("and c.kind = 'direct'");
    expect(code).toContain("and c.status = 'active'");
  });

  it('keeps the founder read to counts', () => {
    // The metric is a rate. A per-chat view would be a log of who met whom,
    // and a view created without its revoke is readable by every signed-in
    // account.
    expect(code).toContain('revoke all on public.admin_meet_answers from anon, authenticated');
    expect(code).not.toMatch(/create view public\.admin_meet_answers[\s\S]*?chat_id/);
  });
});
