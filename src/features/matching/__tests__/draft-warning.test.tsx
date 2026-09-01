import { act, renderHook } from '@testing-library/react-native';

import { previewFirstMessage } from '@/features/matching/api';
import { useDraftWarning } from '@/features/matching/hooks';
import { analytics } from '@/lib/analytics';

/**
 * The draft warning counts what it deterred.
 *
 * "% of first messages blocked by moderation" is the brief's creep
 * early-warning (§6), and this warning exists to turn would-be blocks into
 * rewrites before anybody presses send - which removes events from exactly
 * that numerator. Uncounted, the number falls for a reason that has nothing
 * to do with how many people are trying to send creepy first messages, and
 * the founder reads a safety improvement that is a measurement artefact.
 *
 * The privacy assertion here is as load-bearing as the counting one: the
 * event may carry the category and the surface and NOTHING else. The
 * blocklist is a table of regexes, and a metric that shipped the draft or the
 * matched phrase would be handing out the evasion rule with the telemetry.
 */

jest.mock('@/features/matching/api');
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));

const preview = previewFirstMessage as jest.MockedFunction<typeof previewFirstMessage>;
const capture = analytics.capture as jest.Mock;

/** Past the debounce, and past the promise the timer starts. */
const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const flagged = () => Promise.resolve({ wouldBlock: true, category: 'flirtation' });
const clean = () => Promise.resolve({ wouldBlock: false, category: null });

describe('what the draft warning counts', () => {
  it('captures one draft_flagged for one flagged draft', async () => {
    preview.mockImplementation(flagged);
    const hook = renderHook(
      ({ draft }: { draft: string }) => useDraftWarning(draft, true, 'first_message'),
      { initialProps: { draft: 'Want to hook up at the night market?' } }
    );
    await settle();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(hook.result.current.risky).toBe(true);
    expect(hook.result.current.everFlagged).toBe(true);
  });

  it('captures the category and the surface, and nothing a person wrote', async () => {
    preview.mockImplementation(flagged);
    renderHook(() => useDraftWarning('Want to hook up at the night market?', true, 'business'));
    await settle();

    const [event, properties] = capture.mock.calls[0];
    expect(event).toBe('draft_flagged');
    expect(properties).toEqual({ category: 'flirtation', surface: 'business' });
    expect(JSON.stringify(properties)).not.toContain('hook up');
    expect(JSON.stringify(properties)).not.toContain('night market');
  });

  it('captures nothing for a draft that would go through', async () => {
    preview.mockImplementation(clean);
    const hook = renderHook(() =>
      useDraftWarning('Any market worth the walk this week?', true, 'first_message')
    );
    await settle();

    expect(capture).not.toHaveBeenCalled();
    expect(hook.result.current.everFlagged).toBe(false);
  });

  it('does not count again while the same text sits in the box', async () => {
    preview.mockImplementation(flagged);
    const hook = renderHook(
      ({ draft }: { draft: string }) => useDraftWarning(draft, true, 'first_message'),
      { initialProps: { draft: 'Want to hook up at the night market?' } }
    );
    await settle();
    // A re-render with the same draft: exactly what a parent re-render, or a
    // trailing space being typed and deleted, produces.
    hook.rerender({ draft: 'Want to hook up at the night market? ' });
    await settle();
    hook.rerender({ draft: 'Want to hook up at the night market?' });
    await settle();

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('counts again once the text changed and was flagged again', async () => {
    preview.mockImplementation(flagged);
    const hook = renderHook(
      ({ draft }: { draft: string }) => useDraftWarning(draft, true, 'first_message'),
      { initialProps: { draft: 'Want to hook up at the night market?' } }
    );
    await settle();
    hook.rerender({ draft: 'Want to hook up somewhere after the night market?' });
    await settle();

    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('keeps everFlagged true after the warning is rewritten away', async () => {
    preview.mockImplementation(flagged);
    const hook = renderHook(
      ({ draft }: { draft: string }) => useDraftWarning(draft, true, 'first_message'),
      { initialProps: { draft: 'Want to hook up at the night market?' } }
    );
    await settle();
    preview.mockImplementation(clean);
    hook.rerender({ draft: 'Any market worth the walk this week?' });
    await settle();

    expect(hook.result.current.risky).toBe(false);
    // The send that follows is a success of the warning, not a miss by the
    // classifier, and request_sent carries that as rewrote_after_warning.
    expect(hook.result.current.everFlagged).toBe(true);
  });
});
