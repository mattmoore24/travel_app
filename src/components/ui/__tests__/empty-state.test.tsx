import { render, screen } from '@testing-library/react-native';
import { SymbolView } from 'expo-symbols';
import { Text } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { AccessibilitySizesFrom, FontCap } from '@/constants/theme';

/**
 * The one empty state renders title, body and action in that order, and
 * omits the action when none is given. The order matters because the
 * component exists to stop screens composing the same moment differently:
 * a stray sentence with no title, a card jammed under a control, a wall of
 * buttons above their explanation.
 *
 * At the accessibility sizes the order is a different one on purpose:
 * title, action, secondary actions, explanation, and no glyph. At AX5 the
 * signed-in Chats tab's two-sentence body wrapped to seven lines and put
 * "Find travelers" under the tab bar until the reader scrolled (E2E run
 * 142). The line it changes at is the theme's category line, imported
 * rather than typed, so the test cannot drift from the component.
 */

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

beforeEach(() => {
  mockFontScale = 1;
});

/** Every text node, depth-first, so order on screen can be asserted. */
function texts(node: unknown): string[] {
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  const children = (node as { children?: unknown }).children;
  return texts(children);
}

const chatsTab = (
  <EmptyState
    glyph="bubble.left.and.bubble.right.fill"
    title="No chats yet"
    body="Say hi to someone going your way."
    action={{ label: 'Find travelers', onPress: () => {} }}
  />
);

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

describe('EmptyState at the accessibility text sizes', () => {
  it('moves the action above the explanation from exactly the category line', () => {
    // Inclusive edge: AX1 is 1.647, and the constant sits under it so that
    // every accessibility size, the first included, selects the reorder.
    mockFontScale = AccessibilitySizesFrom;
    render(chatsTab);
    expect(texts(screen.toJSON())).toEqual([
      'No chats yet',
      'Find travelers',
      'Say hi to someone going your way.',
    ]);
  });

  it.each([AccessibilitySizesFrom - 0.01, 1.35])('keeps the standard order at %s', (scale) => {
    // 1.35 is xxxLarge, the largest STANDARD size, where the body still
    // fits above the button and the explanation-first order reads best.
    mockFontScale = scale;
    render(chatsTab);
    expect(texts(screen.toJSON())).toEqual([
      'No chats yet',
      'Say hi to someone going your way.',
      'Find travelers',
    ]);
  });

  it('keeps the secondary actions with the primary through the reorder', () => {
    // The Travelers wall passes a primary plus ghost buttons. A paragraph
    // between the two would read as two unrelated blocks.
    mockFontScale = 1.65;
    render(
      <EmptyState
        title="Travelers opens once you add a trip"
        body="Add where you are going and the people going there appear."
        action={{ label: 'Add a trip', onPress: () => {} }}>
        <Text>Sign in</Text>
      </EmptyState>
    );
    expect(texts(screen.toJSON())).toEqual([
      'Travelers opens once you add a trip',
      'Add a trip',
      'Sign in',
      'Add where you are going and the people going there appear.',
    ]);
  });

  it('changes nothing without an action, even at the largest size', () => {
    mockFontScale = 3.12;
    render(<EmptyState title="Nothing archived yet" body="Archive a chat and it lands here." />);
    expect(texts(screen.toJSON())).toEqual([
      'Nothing archived yet',
      'Archive a chat and it lands here.',
    ]);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws the glyph below the line and drops it from the first accessibility size', () => {
    // A 56pt decorative mark spends a tenth of the viewport at AX5 and
    // carries no information; Apple's own guidance is to drop purely
    // decorative views at the largest sizes.
    render(chatsTab);
    expect(screen.UNSAFE_getAllByType(SymbolView)).toHaveLength(1);
    screen.unmount();

    mockFontScale = 1.65;
    render(chatsTab);
    expect(screen.UNSAFE_queryAllByType(SymbolView)).toHaveLength(0);
  });

  it.each([1, 3.12])('caps the button label at the control cap at fontScale %s', (scale) => {
    // The theme's rule for labels on tappable chrome, at every size: an
    // uncapped two-line 47pt button was eating the room the reorder
    // reclaims.
    mockFontScale = scale;
    render(chatsTab);
    expect(screen.getByText('Find travelers').props.maxFontSizeMultiplier).toBe(FontCap.control);
  });
});
