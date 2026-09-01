import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

import { withdrawMessageRequest } from '@/features/matching/api';
import { useWithdrawHello } from '@/features/matching/hooks';
import { SentRequestCard } from '@/features/matching/sent-request-card';
import { analytics } from '@/lib/analytics';

/**
 * A first message you have just sent can be taken back, and somebody can
 * actually reach the control that does it.
 *
 * The second half is the half this project keeps paying for: a component that
 * renders correctly in a test it was written beside proves the component
 * works, not that anybody can get to it. So the source assertions at the
 * bottom name the call site.
 */

jest.mock('@/features/matching/api');
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/features/profile/hooks', () => ({ useOwnUserId: () => 'me' }));
jest.mock('@/features/business/hooks', () => ({ useIsBusiness: () => false }));

const withdraw = withdrawMessageRequest as jest.MockedFunction<typeof withdrawMessageRequest>;
const capture = analytics.capture as jest.Mock;

// gcTime 0 so the client holds no timers past the test; the leak otherwise
// keeps the jest worker alive after the suite is done.
const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

describe('taking a first message back', () => {
  it('asks the server to stamp the row, and says which surface asked', async () => {
    withdraw.mockResolvedValue(true);
    const client = newClient();
    const hook = renderHook(() => useWithdrawHello(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await hook.result.current.mutateAsync({ requestId: 'r1', surface: 'said_hi_strip' });
    });
    expect(withdraw).toHaveBeenCalledWith('r1');
    expect(capture).toHaveBeenCalledWith('first_message_withdrawn', {
      withdrawn: true,
      surface: 'said_hi_strip',
    });
    hook.unmount();
    client.clear();
  });

  it('treats a false answer as an ordinary outcome, not a failure', async () => {
    // The server answers `false` for a row already taken back AND for one
    // already accepted, deliberately the same either way: a refusal that said
    // which would tell a sender what the recipient did, which is the one
    // thing sent_requests() exists never to say (invariant 4). So the client
    // must not turn it into an error either.
    withdraw.mockResolvedValue(false);
    const client = newClient();
    const hook = renderHook(() => useWithdrawHello(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await hook.result.current.mutateAsync({ requestId: 'r1', surface: 'said_hi_strip' });
    });
    expect(hook.result.current.isError).toBe(false);
    expect(capture).toHaveBeenCalledWith(
      'first_message_withdrawn',
      expect.objectContaining({ withdrawn: false })
    );
    hook.unmount();
    client.clear();
  });

  it('tells the bar it landed, so the sentence can change to the past tense', async () => {
    withdraw.mockResolvedValue(true);
    const client = newClient();
    const onTakenBack = jest.fn();
    const Wrapper = wrapperFor(client);
    render(
      <Wrapper>
        <SentRequestCard requestId="r1" onTakenBack={onTakenBack} />
      </Wrapper>
    );
    // The spoken label, not the words on screen: a Pressable carrying its own
    // accessibilityLabel becomes one element on iOS and its children stop
    // being elements at all.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Take it back'));
    });
    expect(withdraw).toHaveBeenCalledWith('r1');
    expect(onTakenBack).toHaveBeenCalledTimes(1);
    client.clear();
  });
});

const read = (...parts: string[]) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8');

describe('and somebody can reach it', () => {
  const travelers = read('app', '(tabs)', 'travelers.tsx');
  const hooks = read('features', 'matching', 'hooks.ts');

  it('is mounted on the beat after a hello leaves Travelers', () => {
    // THE CALL SITE. The strip that floats after a first message is sent is
    // the moment somebody realises they wrote to the wrong person, and it is
    // the only surface in the app that offers the withdraw today.
    expect(travelers).toContain(
      "import { SentRequestCard } from '@/features/matching/sent-request-card';"
    );
    expect(travelers).toContain(
      '<SentRequestCard requestId={requestId} onTakenBack={() => setTakenBack(true)} />'
    );
    // And it is inside SaidHiStrip, which is what both branches of the screen
    // render - including the empty wall, which is the branch saying hi to the
    // last traveler lands on.
    const strip = travelers.indexOf('function SaidHiStrip(');
    const card = travelers.indexOf('<SentRequestCard ');
    expect(strip).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(strip);
    expect(travelers.match(/<SaidHiStrip /g)).toHaveLength(2);
  });

  it('is offered for the message that was just sent and no other', () => {
    // Matching the row by the recipient's NAME is the shortcut here and it is
    // a safety bug: two travelers can share a display name, and the
    // anti-pester unique constraint means withdrawing the wrong one can never
    // be undone. So the id rides beside the name, written in the same place.
    expect(hooks).toContain('useSaidHi.getState().note(input.recipientName, input.origin);');
    expect(hooks).toContain('useJustSentHello.getState().note(result.request_id ?? null);');
    expect(travelers).toContain('const requestId = useJustSentHello((s) => s.requestId);');
    // Null id, no action: a stamp from an older bundle has no id, and the bar
    // confirms the send without offering something it cannot aim.
    expect(travelers).toContain('{requestId ? (');
  });

  it('says only what the sender did', () => {
    // Rules 4 and 5: the bar may say the sender took their own words back and
    // may never imply anything about the person they were aimed at. Scoped to
    // the two pieces that draw it, with comments gone, so the check is about
    // words somebody reads rather than words somebody wrote about the code.
    const strip = travelers.slice(
      travelers.indexOf('function SaidHiStrip('),
      travelers.indexOf('export default function TravelersScreen(')
    );
    const withoutComments = (code: string) =>
      code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(strip).toContain('Taken back.');
    for (const claim of [/\bread it\b/i, /\bseen it\b/i, /\bdeclined\b/i, /\bno reply\b/i]) {
      expect(withoutComments(read('features', 'matching', 'sent-request-card.tsx'))).not.toMatch(
        claim
      );
      expect(withoutComments(strip)).not.toMatch(claim);
    }
  });
});
