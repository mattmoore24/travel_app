import { render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { InputAccessoryView, TextInput } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { KeyboardDone } from '@/components/form/keyboard-done-bar';

// Founder, 2026-08-24: "every time the keyboard is up to type for any
// situation, there is always a button or clear way to dismiss the keyboard."
// Founder, 2026-08-28: "every keypad in the app should be able to be closed
// without pressing enter." Founder, 2026-09-04, screenshot attached, keyboard
// up, no bar: "I've said it many times but it still isn't there."
//
// The third time was the charm only because the cause was finally read out
// of React Native's source rather than guessed at (keyboard-done-bar.tsx has
// it): under Fabric an InputAccessoryView binds to ONE field, ONCE, when the
// bar enters the window. So the invariant this file guards is no longer "one
// bar is mounted somewhere" — it is that every field carries its own bar,
// mounted with it, AHEAD of it, under an id only that pair shares.

/** The rendered tree, flattened, so sibling order can be asserted on. */
function flatten(node: unknown, out: { type: string; props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out));
    return out;
  }
  const element = node as { type: string; props: Record<string, unknown>; children?: unknown };
  out.push({ type: element.type, props: element.props });
  flatten(element.children, out);
  return out;
}

const accessoryIndex = (nodes: ReturnType<typeof flatten>) =>
  nodes.findIndex((n) => n.type === 'RCTInputAccessoryView' || n.type === 'InputAccessoryView');
const inputIndex = (nodes: ReturnType<typeof flatten>) =>
  nodes.findIndex((n) => n.type === 'TextInput');

describe('KeyboardDone pairs a bar with its field', () => {
  it('renders the bar, then the field, under one id', () => {
    render(<KeyboardDone>{(done) => <TextInput testID="field" {...done} />}</KeyboardDone>);
    const bar = screen.UNSAFE_getByType(InputAccessoryView);
    const field = screen.getByTestId('field');
    expect(bar.props.nativeID).toEqual(expect.any(String));
    expect(field.props.inputAccessoryViewID).toBe(bar.props.nativeID);
    // Ahead of it. Fabric attaches a new subtree whole and runs
    // didMoveToWindow parent-first over it, so the bar's one-shot search
    // finds the field, and it binds before the field's own didMoveToWindow
    // fires autoFocus — put the bar second and an autofocused keyboard
    // comes up without it, and nothing reloads it afterwards.
    const nodes = flatten(screen.toJSON());
    expect(accessoryIndex(nodes)).toBeGreaterThan(-1);
    expect(accessoryIndex(nodes)).toBeLessThan(inputIndex(nodes));
  });

  it('gives two fields two ids, so the one-shot search cannot cross them', () => {
    render(
      <>
        <KeyboardDone>{(done) => <TextInput testID="a" {...done} />}</KeyboardDone>
        <KeyboardDone>{(done) => <TextInput testID="b" {...done} />}</KeyboardDone>
      </>
    );
    const a = screen.getByTestId('a').props.inputAccessoryViewID;
    const b = screen.getByTestId('b').props.inputAccessoryViewID;
    expect(a).toEqual(expect.any(String));
    expect(b).toEqual(expect.any(String));
    expect(a).not.toBe(b);
    const bars = screen.UNSAFE_getAllByType(InputAccessoryView).map((bar) => bar.props.nativeID);
    expect(bars.sort()).toEqual([a, b].sort());
  });

  // "Hide keyboard", not "Done": "Done" is the StepScreen commit vocabulary
  // (continueLabel's default), and the priorities editor had both on screen
  // at once, 68pt apart, doing different things.
  it('offers a labelled Hide keyboard, not a bare glyph and not "Done"', () => {
    render(<KeyboardDone>{(done) => <TextInput {...done} />}</KeyboardDone>);
    expect(screen.getByLabelText('Hide keyboard')).toBeTruthy();
    expect(screen.getByText('Hide keyboard')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
  });
});

describe("the app's own field carries its bar", () => {
  it('FormTextField renders a bar ahead of its input, under a shared id', () => {
    render(<FormTextField testID="field" label="Name" />);
    const bar = screen.UNSAFE_getByType(InputAccessoryView);
    const field = screen.getByTestId('field');
    expect(field.props.inputAccessoryViewID).toBe(bar.props.nativeID);
    const nodes = flatten(screen.toJSON());
    expect(accessoryIndex(nodes)).toBeLessThan(inputIndex(nodes));
  });

  it('keeps the bar on an autofocused field, which is the case the order exists for', () => {
    render(<FormTextField testID="field" autoFocus />);
    const field = screen.getByTestId('field');
    expect(field.props.autoFocus).toBe(true);
    expect(field.props.inputAccessoryViewID).toBe(
      screen.UNSAFE_getByType(InputAccessoryView).props.nativeID
    );
  });
});

// Source scans, deliberately. iOS hosts the bar in the keyboard's own window
// and binds it natively, so no render test can prove a field on a real phone
// reaches its bar — but the two shapes that lose the bar are both visible in
// source, and both have shipped: a raw TextInput that never asked, and (the
// one that cost three attempts) a bar mounted somewhere other than with its
// field.
describe('every raw TextInput is wrapped, and nothing goes around the wrapper', () => {
  const SRC = path.join(__dirname, '../../..');

  const sources = () => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
            walk(full);
          }
        } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          out.push({ file: path.relative(SRC, full), text: fs.readFileSync(full, 'utf8') });
        }
      }
    };
    walk(SRC);
    return out.filter(({ file }) => file !== 'components/form/keyboard-done-bar.tsx');
  };

  it('no raw TextInput sits outside a KeyboardDone', () => {
    const offenders: string[] = [];
    for (const { file, text } of sources()) {
      // Whitespace after the tag, so `useRef<TextInput>(null)` — a type
      // argument, not an element — is not mistaken for one.
      const tag = /<TextInput\s/g;
      let match: RegExpExecArray | null;
      while ((match = tag.exec(text)) !== null) {
        const before = text.slice(0, match.index);
        const opened = before.lastIndexOf('<KeyboardDone>');
        const closed = before.lastIndexOf('</KeyboardDone>');
        if (opened < 0 || closed > opened) {
          offenders.push(`${file}:${before.split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('nobody points a field at an id by hand, and nobody mounts a bare bar', () => {
    // A hand-written id is a field pointing at a bar that may not be mounted
    // with it, which is the whole bug. The wrapper is the only way in.
    const offenders = sources()
      .filter(
        ({ text }) =>
          /inputAccessoryViewID\s*=/.test(text) ||
          text.includes('keyboardDoneProps') ||
          text.includes('KEYBOARD_DONE_ID') ||
          text.includes('<KeyboardDoneBar')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('the wrapper hands the field the id, not the other way round', () => {
    // `{...done}` is how a wrapped field takes its id. A wrapper whose child
    // ignores `done` is a bar with nothing pointing at it.
    const offenders: string[] = [];
    for (const { file, text } of sources()) {
      const wrapper = /<KeyboardDone>\s*\{\(done\) =>([\s\S]*?)<\/KeyboardDone>/g;
      let match: RegExpExecArray | null;
      while ((match = wrapper.exec(text)) !== null) {
        if (!match[1].includes('{...done}')) {
          offenders.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
