import { render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';

import {
  KEYBOARD_DONE_ID,
  KeyboardDoneBar,
  keyboardDoneProps,
} from '@/components/form/keyboard-done-bar';

// Founder, 2026-08-24: "every time the keyboard is up to type for any
// situation, there is always a button or clear way to dismiss the keyboard."
// Founder, 2026-08-28, on a screen that still had none: "every keypad in the
// app should be able to be closed without pressing enter."
//
// The rule is now the simple one, because the judgement version of it shipped
// screens with no way out twice. EVERY field reaches the bar. Return is not an
// exit: it submits, or it moves to the next field, and somebody who has just
// finished typing wants neither.

describe('KeyboardDoneBar', () => {
  it('offers a labelled Done, not a bare glyph', () => {
    render(<KeyboardDoneBar />);
    expect(screen.getByLabelText('Done editing')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('hands fields the id it registers under, so the two cannot drift', () => {
    expect(keyboardDoneProps.inputAccessoryViewID).toBe(KEYBOARD_DONE_ID);
  });
});

// Source scans, deliberately. The bar is hosted by iOS in the keyboard's own
// window, so no render test can prove a field reaches it — but both halves of
// "every field reaches it" are visible in the source, and both have been
// broken before.
describe('every field reaches the bar', () => {
  const SRC = path.join(__dirname, '../../..');

  const read = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');

  const sources = () => {
    const out: { file: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
            walk(full);
          }
        } else if (entry.name.endsWith('.tsx')) {
          out.push({ file: path.relative(SRC, full), text: fs.readFileSync(full, 'utf8') });
        }
      }
    };
    walk(SRC);
    return out;
  };

  // Half one: the app's own field carries it, so a screen gets the behaviour
  // by using FormTextField rather than by remembering to opt in. This is what
  // covers the great majority of the app in one line.
  it('FormTextField points at the bar by default', () => {
    const field = read('components/form/form-text-field.tsx');
    expect(field).toContain('{...keyboardDoneProps}');
    // Before `...rest`, so a caller with its own accessory view can still win.
    expect(field.indexOf('{...keyboardDoneProps}')).toBeLessThan(field.indexOf('{...rest}'));
  });

  // Half two: a raw TextInput bypasses that, so it has to ask. No exemptions
  // any more — the chat composers used to be one, on the reasoning that a Send
  // button beside the field is exit enough, and a Send button sends rather
  // than dismisses.
  it('no raw TextInput ships without asking for it', () => {
    const offenders = sources()
      .filter(({ file }) => file !== 'components/form/form-text-field.tsx')
      // Whitespace after the tag, so `useRef<TextInput>(null)` — a type
      // argument, not an element — is not mistaken for one.
      .filter(({ text }) => /<TextInput\s/.test(text))
      .filter(
        ({ text }) => !text.includes('keyboardDoneProps') && !text.includes('inputAccessoryViewID')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  // And the bar has to be MOUNTED somewhere the focused field can see. A sheet
  // presented through a Modal is its own iOS window, so the screen underneath
  // does not count — which is why Sheet carries one of its own.
  it.each([
    'components/form/step-screen.tsx',
    'features/signup/step-shell.tsx',
    'components/ui/sheet.tsx',
    'features/pins/map-screen.tsx',
    'app/chat/[id].tsx',
    'app/room/[id].tsx',
    'app/group/[id].tsx',
  ])('%s mounts one', (file) => {
    expect(read(file)).toContain('<KeyboardDoneBar />');
  });
});
