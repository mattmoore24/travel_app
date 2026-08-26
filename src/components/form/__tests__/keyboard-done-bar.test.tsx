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
//
// The rule: a field whose keyboard has no usable return key needs the Done
// bar. `number-pad` and `phone-pad` draw no return key at all on iOS, and a
// `multiline` field's return key inserts a newline, so on all three the
// return key is not an exit.

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

// A source scan, deliberately. The bar is hosted by iOS in the keyboard's own
// window, so no render test can prove a field reaches it. But every field that
// NEEDS it is identifiable in the source, and one shipping without it is
// exactly how this went unnoticed the first time.
describe('every field with no usable return key asks for the bar', () => {
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
        } else if (entry.name.endsWith('.tsx')) {
          out.push({ file: path.relative(SRC, full), text: fs.readFileSync(full, 'utf8') });
        }
      }
    };
    walk(SRC);
    return out;
  };

  // The chat composers are the deliberate exception, listed so that adding
  // one is a decision rather than an oversight: a Send button sits beside the
  // field at all times, which is both the confirm and the reason the keyboard
  // should stay up between messages.
  const EXEMPT = ['app/chat/[id].tsx', 'app/room/[id].tsx'];

  const asksForBar = (text: string) =>
    text.includes('keyboardDoneProps') || text.includes('inputAccessoryViewID');

  it.each(['multiline', 'number-pad', 'phone-pad'])('no file uses %s without it', (needle) => {
    const offenders = sources()
      .filter(({ file }) => !EXEMPT.some((e) => file.endsWith(e)))
      .filter(({ text }) => text.includes(needle) && !asksForBar(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
