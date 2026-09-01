import { fireEvent, render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { SignUpGate } from '@/components/ui/sign-up-gate';
import { analytics } from '@/lib/analytics';

/**
 * The gate inside a sheet renders FLAT — no second frame — and the funnel
 * survives the refactor.
 *
 * Two separate promises, and the second is the expensive one. The gate is the
 * only conversion step in the app, `where` is the only thing analytics ever
 * sees of it, and a variant that quietly dropped a `capture` would blind the
 * one number the founder has while looking completely correct on screen.
 */
jest.mock('@/lib/analytics', () => ({ analytics: { capture: jest.fn() } }));

// Stood in for so "did a card get drawn" is a question with a yes/no answer.
// The real one branches on `isLiquidGlassAvailable()`, which is an OS fact,
// and its non-glass branch paints `theme.surface` — the sheet's own colour —
// so on the fallback the card the audit photographed is invisible to a
// snapshot even when it is still there.
jest.mock('@/components/ui/glass-surface', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    GlassSurface: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, { testID: 'glass-surface' }, children),
  };
});

const capture = analytics.capture as jest.Mock;

const SRC = path.join(__dirname, '..', '..', '..');

describe('SignUpGate flat variant', () => {
  it('renders no GlassSurface, and the card variant still does', () => {
    render(<SignUpGate reason="Put your plan on the map" where="drop-pin" flat />);
    expect(screen.queryByTestId('glass-surface')).toBeNull();
    // The copy is all still there — flat removes the frame, not the gate.
    expect(screen.getByText('Put your plan on the map')).toBeTruthy();
    expect(screen.getByText('Make a profile')).toBeTruthy();
    expect(screen.getByText('I already have an account')).toBeTruthy();

    screen.unmount();
    render(<SignUpGate reason="Join this room to post" where="room" />);
    expect(screen.getByTestId('glass-surface')).toBeTruthy();
  });

  it('still fires gate_shown, with `where` and nothing else', () => {
    render(<SignUpGate reason="Put your plan on the map" where="drop-pin" flat />);
    expect(capture).toHaveBeenCalledWith('gate_shown', { where: 'drop-pin' });
    // Never `reason`: one of them interpolates another traveler's display
    // name, and this fires from a signed-out screen.
    for (const [, payload] of capture.mock.calls) {
      expect(Object.keys(payload)).toEqual(['where']);
    }
  });

  it('still fires gate_tapped when the flat variant is taken', () => {
    render(<SignUpGate reason="Put your plan on the map" where="drop-pin" flat />);
    capture.mockClear();
    fireEvent.press(screen.getByText('Make a profile'));
    expect(capture).toHaveBeenCalledWith('gate_tapped', { where: 'drop-pin' });
  });

  it('still fires gate_signin_tapped on the second door', () => {
    render(<SignUpGate reason="Put your plan on the map" where="drop-pin" flat />);
    capture.mockClear();
    fireEvent.press(screen.getByText('I already have an account'));
    expect(capture).toHaveBeenCalledWith('gate_signin_tapped', { where: 'drop-pin' });
  });

  it('routes the flat variant’s navigation through onNavigate', () => {
    // The traps entry, and it did not stop applying because the frame went:
    // a push from inside a Sheet leaves its scrim over the map, so a caller
    // inside one passes `leavingSheet(close)` and the gate must honour it
    // rather than reaching for the router itself.
    const onNavigate = jest.fn();
    render(
      <SignUpGate reason="Send your report" where="room-report" flat onNavigate={onNavigate} />
    );
    fireEvent.press(screen.getByText('Make a profile'));
    fireEvent.press(screen.getByText('I already have an account'));
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('every gate that renders inside a Sheet asks for flat, and no other one does', () => {
    // The title of this test is a UNIVERSAL, so it is answered by walking
    // src/ rather than by naming three files. The version that named files
    // said "every" and checked four call sites out of ten, and the one it
    // missed was the worst of them: features/business/place-sheet.tsx, whose
    // gate sits inside a `<Sheet inline>` one component up and so matched no
    // pattern anybody thought to write.
    const gates = findGates();
    // A walk that silently finds nothing passes every assertion below it.
    // Cross-check the AST against a plain text count of the same files: if
    // the two ever disagree, the walk has stopped seeing call sites and the
    // universal is worthless again.
    expect(gates.length).toBe(countInSource());
    expect(gates.length).toBeGreaterThan(5);

    // The whole assertion, in the words of the title. Compared as one object
    // so a failure prints every call site and what it should have said,
    // rather than dying on the first one.
    const asked = Object.fromEntries(gates.map((g) => [g.at, g.flat]));
    const owed = Object.fromEntries(gates.map((g) => [g.at, g.insideSheet]));
    expect(asked).toEqual(owed);

    // `compact` only ever selected between two GlassSurface styles, so a
    // flat gate still carrying it is a prop with nothing on the other end.
    expect(gates.filter((g) => g.flat && g.compact).map((g) => g.at)).toEqual([]);
  });
});

/**
 * Every `<SignUpGate>` in src/, and whether it renders inside a `<Sheet>`.
 *
 * Two ways of being inside one, and the second is why this is a parse rather
 * than a regex. A gate can sit under a `<Sheet>` in the same JSX tree
 * (map-screen, room), or it can sit in a component that is itself rendered
 * inside a `<Sheet>` — which is place-sheet.tsx, where `PlaceSheet` wraps
 * `PlaceCard` in a `<Sheet inline>` and the gate is three hundred lines
 * further down inside `PlaceCard`. Resolving the second case is the whole
 * point: it is the one a reader of the file cannot see either.
 *
 * And it is resolved across the WHOLE of src/, not within each file. The
 * first version of this built "what is rendered under a Sheet" and "what
 * renders what" per source file, and then only ever looked at files that
 * already contained `<SignUpGate` — so a gate in a component whose `<Sheet>`
 * lives in a different file was classified as not-inside-a-sheet and passed
 * while still carrying the card. That is the same false universal the
 * file-naming version had, one indirection further out. Both maps are
 * accumulated over every `.tsx` in src/ first, and the reachability walk runs
 * once at the end.
 *
 * Component identity is the TAG NAME, which is what a JSX tree gives you
 * without resolving imports. Two components with the same name in different
 * files are therefore treated as one, which can only ever make `insideSheet`
 * MORE true — the safe direction for a rule that says "ask for flat".
 *
 * TypeScript's own parser rather than a hand-rolled scanner, because
 * `typescript` is a declared dependency of this repo and a scanner that gets
 * JSX nesting subtly wrong would be a false universal all over again.
 */
type Gate = { at: string; flat: boolean; compact: boolean; insideSheet: boolean };

/** Every `.tsx` under src/, tests excluded. */
function allFiles(): string[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : walk(full);
      }
      return full.endsWith('.tsx') ? [full] : [];
    });
  return walk(SRC);
}

function sourceFiles(): string[] {
  return allFiles().filter((file) => fs.readFileSync(file, 'utf8').includes('<SignUpGate'));
}

function countInSource(): number {
  return sourceFiles().reduce(
    (total, file) => total + (fs.readFileSync(file, 'utf8').match(/<SignUpGate\b/g) ?? []).length,
    0
  );
}

function findGates(): Gate[] {
  // Accumulated across every file before anything is resolved.
  const underSheet = new Set<string>();
  const renders = new Map<string, Set<string>>();
  const found: {
    at: string;
    flat: boolean;
    compact: boolean;
    sheetAbove: boolean;
    owner: string | null;
  }[] = [];

  for (const file of allFiles()) {
    const code = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const isElement = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
      ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
    const opening = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      ts.isJsxElement(node) ? node.openingElement : node;
    const tagOf = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
      opening(node).tagName.getText();
    // The component this JSX is returned from, so a gate can be traced to
    // the thing that renders it.
    const ownerOf = (node: ts.Node): string | null => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isFunctionDeclaration(parent)) {
          return parent.name?.text ?? null;
        }
        if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
          const declaration = parent.parent;
          return ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
            ? declaration.name.text
            : null;
        }
      }
      return null;
    };

    const visit = (node: ts.Node): void => {
      if (isElement(node)) {
        const tag = tagOf(node);
        let sheetAbove = false;
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (isElement(parent) && tagOf(parent) === 'Sheet') {
            sheetAbove = true;
            break;
          }
        }
        const owner = ownerOf(node);
        if (/^[A-Z]/.test(tag)) {
          if (sheetAbove) {
            underSheet.add(tag);
          }
          if (owner) {
            const children = renders.get(owner) ?? new Set<string>();
            children.add(tag);
            renders.set(owner, children);
          }
        }
        if (tag === 'SignUpGate') {
          const props = opening(node)
            .attributes.properties.filter(ts.isJsxAttribute)
            .map((attribute) => attribute.name.getText());
          const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
          found.push({
            at: `${path.relative(SRC, file)}:${line}`,
            flat: props.includes('flat'),
            compact: props.includes('compact'),
            sheetAbove,
            owner,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }

  // Everything a Sheet can reach, however many components deep and however
  // many files away.
  const reached = new Set(underSheet);
  const queue = [...underSheet];
  while (queue.length > 0) {
    for (const child of renders.get(queue.pop() as string) ?? []) {
      if (!reached.has(child)) {
        reached.add(child);
        queue.push(child);
      }
    }
  }
  return found.map((gate) => ({
    at: gate.at,
    flat: gate.flat,
    compact: gate.compact,
    insideSheet: gate.sheetAbove || (gate.owner != null && reached.has(gate.owner)),
  }));
}
