import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MutedWordsScreen from '@/app/muted-words';

/**
 * The edge between the screen and the mutation, which nothing asserted.
 *
 * `muted-words-write.test.tsx` drives the hook directly and proves the
 * statements that leave the device; `muted-words-reach.test.ts` reads the
 * screen as source and proves the route and the guard. Between them sat the
 * one thing neither could see: whether pressing Add calls the mutation at all.
 * Both `save.mutate(...)` calls could be commented out and the whole suite
 * stayed green - a safety setting with a working hook, a reachable screen, and
 * no wire between them.
 *
 * So this renders the real screen and watches the mutation. It also pins the
 * ARGUMENT shape, because that is what the bug was: the mutation has to be
 * handed the list as it was BEFORE the edit, since reading it back out of the
 * query cache gets the optimistic value that onMutate has already written.
 */
const mockMutate = jest.fn();
const mockWords: string[] = [];

jest.mock('@/features/profile/muted-words', () => {
  const actual = jest.requireActual('@/features/profile/muted-words');
  return {
    ...actual,
    useMutedWords: () => ({
      data: mockWords,
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    }),
    useSetMutedWords: () => ({ mutate: mockMutate, isPending: false }),
  };
});

jest.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

// StepScreen docks its Done button above the keyboard, which reads the safe
// area, so the screen needs a provider with real metrics under it.
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <MutedWordsScreen />
    </SafeAreaProvider>
  );

describe('the editor is wired to the thing that saves', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockWords.length = 0;
    mockWords.push('hookup', 'gorgeous');
  });

  it('hands Add the list as it was before the edit, and the new one after', () => {
    show();
    fireEvent.changeText(screen.getByTestId('muted-word-input'), 'sweetheart');
    fireEvent.press(screen.getByText('Add'));

    // `previous` is the point. The mutation used to look this up in the query
    // cache, which onMutate had already overwritten with `next`, so the diff
    // was empty and nothing was written to the table.
    expect(mockMutate).toHaveBeenCalledWith({
      previous: ['hookup', 'gorgeous'],
      next: ['hookup', 'gorgeous', 'sweetheart'],
    });
  });

  it('and hands Take off the word that left', () => {
    show();
    fireEvent.press(screen.getAllByLabelText(/Take .* off your list/i)[0]);

    expect(mockMutate).toHaveBeenCalledWith({
      previous: ['hookup', 'gorgeous'],
      next: ['gorgeous'],
    });
  });

  it('saves nothing when the word is already on the list', () => {
    show();
    fireEvent.changeText(screen.getByTestId('muted-word-input'), 'hookup');
    fireEvent.press(screen.getByText('Add'));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByText('That one is already on your list.')).toBeTruthy();
  });
});
