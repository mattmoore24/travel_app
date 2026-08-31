import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';

/**
 * The one empty state renders title, body and action in that order, and
 * omits the action when none is given. The order matters because the
 * component exists to stop screens composing the same moment differently —
 * a stray sentence with no title, a card jammed under a control, a wall of
 * buttons above their explanation.
 */

/** Every text node, depth-first, so order on screen can be asserted. */
function texts(node: unknown): string[] {
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  const children = (node as { children?: unknown }).children;
  return texts(children);
}

describe('EmptyState', () => {
  it('renders title, body and action in that order', () => {
    render(
      <EmptyState
        title="No chats yet"
        body="Say hi to someone going your way."
        action={{ label: 'Find travelers', onPress: () => {} }}
      />
    );
    const order = texts(screen.toJSON());
    expect(order).toEqual(['No chats yet', 'Say hi to someone going your way.', 'Find travelers']);
  });

  it('omits the action when none is given', () => {
    render(<EmptyState title="Nothing archived yet" body="Archive a chat and it lands here." />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('omits the body when none is given, and keeps extra actions after the primary', () => {
    render(
      <EmptyState title="Just a title" action={{ label: 'Primary', onPress: () => {} }}>
        <Text>Secondary</Text>
      </EmptyState>
    );
    expect(texts(screen.toJSON())).toEqual(['Just a title', 'Primary', 'Secondary']);
  });
});
