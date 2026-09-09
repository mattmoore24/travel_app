import fs from 'node:fs';
import path from 'node:path';

import { between, source } from '@/lib/__tests__/source';

/**
 * Nothing rides up on top of the keyboard except the Hide keyboard bar.
 *
 * Founder, 2026-09-05: "Buttons and text above keyboard are unneeded and
 * should not rise with the keyboard. Instead they should be covered by the
 * keyboard when typing so that less of the screen is taken up by the keyboard
 * and buttons." And, in the same round: "Every single time the keyboard is up,
 * there should be no other buttons or other things blocking the screen other
 * than a hide keyboard button."
 *
 * The mechanism is `KeyboardFloor`, and the whole question is WHAT IT WRAPS.
 * Round it goes up; outside and below it, the keyboard covers it. The signup
 * shell was cut to the wanted shape first and this scaffold — the one ~19
 * form screens are built from — still wrapped its own footer, so the note,
 * the Continue pill and every caller's footer slot lifted on all of them.
 *
 * This is a source scan because the thing being asserted is a TREE SHAPE, and
 * a render test sees a flat tree with no keyboard in it: `useAnimatedKeyboard`
 * reports zero height under jest, so the lifted and the covered arrangements
 * render identically and a render test passes against either one.
 */

/** Repo-relative, the way `source` wants it. */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const SRC = path.join(REPO, 'src');

describe('the keyboard covers the footer rather than lifting it', () => {
  it('StepScreen closes its floor before the footer, and pays the footer an allowance', () => {
    const code = source('src/components/form/step-screen.tsx');

    // The floor takes the footer's measured height, or the scroller shrinks
    // by that height twice — once for the footer laid out beneath it, and
    // again for the keyboard covering that same footer.
    expect(code).toContain('<KeyboardFloor allowance={footerHeight}>');

    // The shape itself: the floor CLOSES, and only then does the footer open.
    // A footer inside the floor is the bug this test exists for.
    const floor = between(code, '<KeyboardFloor allowance={footerHeight}>', '</KeyboardFloor>');
    expect(floor).toContain('<ScrollView');
    expect(floor).not.toContain('styles.footer');
    expect(floor).not.toContain('<PrimaryButton');

    // ...and the footer measures itself, or the allowance is always zero.
    const footer = between(code, '</KeyboardFloor>', '</SafeAreaView>');
    expect(footer).toContain('styles.footer');
    expect(footer).toContain('footerHeight.value = event.nativeEvent.layout.height');
    expect(footer).toContain('<PrimaryButton');
  });

  it('StepShell keeps the shape it was fixed to', () => {
    // The reference implementation, asserted so a later tidy cannot quietly
    // put the footer back inside the floor on the screen the founder saw the
    // fix on first.
    const code = source('src/features/signup/step-shell.tsx');
    expect(code).toContain('<KeyboardFloor allowance={footerHeight}>');
    const floor = between(code, '<KeyboardFloor allowance={footerHeight}>', '</KeyboardFloor>');
    expect(floor).toContain('<ScrollView');
    expect(floor).not.toContain('styles.footer');
  });

  it('a sheet lifts by the keyboard MINUS what the caller pins under it', () => {
    // The other half of ask 6. A sheet with avoidKeyboard lifted by the whole
    // keyboard, so its pinned button rode up on top of it and the scroller
    // above was starved to pay for the trip: the pin form ends up about two
    // rows tall with a keyboard up, which is recorded in its own source.
    const code = source('src/components/ui/sheet.tsx');
    expect(code).toContain('keyboardAllowance?: SharedValue<number>');
    const lift = between(code, 'const keyboardStyle = useAnimatedStyle', 'transform:');
    expect(lift).toContain('keyboardAllowance?.value ?? 0');
    // ...and the bar is added, because the keyboard's reported frame does not
    // include the input accessory view riding above it. Every sheet with an
    // input has been wearing that 36pt overlap; KeyboardFloor has accounted
    // for it since run 109 and this had not.
    expect(lift).toContain('KEYBOARD_BAR_HEIGHT');
    // Math.max at zero, or a pinned zone taller than the keyboard would push
    // the sheet DOWN off the bottom of the screen. Whitespace-insensitive:
    // prettier wraps this expression once it grows, and a literal
    // `Math.max(0,` broke on the wrap while the clamp was still there.
    expect(lift.replace(/\s+/g, '')).toContain('Math.max(0,');
    // And the sheet takes the LARGER of the caller's explicit allowance and
    // its own measured footer, so a `scrolls` sheet covers its pinned buttons
    // without every caller having to wire a shared value, and a caller that
    // does both is not counted twice.
    expect(lift.replace(/\s+/g, '')).toContain(
      'Math.max(keyboardAllowance?.value??0,footerHeight.value)'
    );
    expect(code).toContain('footerHeight.value = event.nativeEvent.layout.height');
  });

  it('the pin form measures the zone it pins, or the allowance is always zero', () => {
    const code = source('src/features/pins/pin-form-sheet.tsx');
    expect(code).toContain('keyboardAllowance={pinnedHeight}');
    expect(code).toContain('pinnedHeight.value = event.nativeEvent.layout.height');
  });

  it('no screen autofocuses a field into the zone the keyboard covers', () => {
    // business-email put an `autoFocus` address field in StepShell's `footer`
    // prop, so tapping "Use a different address" focused a field that was
    // already behind the keyboard — the founder's complaint, exactly, and it
    // shipped. The field lives in the shell's children now.
    //
    // Scanned across every screen rather than pinned to that one file,
    // because the mistake is a shape anyone can repeat: a footer is for
    // things it is FINE to cover, and a focused input never is.
    //
    // The prop's value is taken by BRACE MATCHING, not by an end anchor. The
    // first cut of this test looked for the line that closed the JSX and, on
    // files where that line reads differently, ran on for five thousand
    // characters into the children and reported every screen with an
    // autofocused field anywhere in it. An anchor that misses does not fail,
    // it over-matches, which is the failure source.ts exists to warn about.
    const footerProps = (code: string): string[] => {
      const out: string[] = [];
      let at = code.indexOf('footer={');
      while (at >= 0) {
        let depth = 0;
        let i = at + 'footer='.length;
        for (; i < code.length; i += 1) {
          if (code[i] === '{') depth += 1;
          else if (code[i] === '}') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        out.push(code.slice(at, i + 1));
        at = code.indexOf('footer={', i);
      }
      return out;
    };

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.tsx')) continue;
        const code = fs.readFileSync(full, 'utf8');
        for (const prop of footerProps(code)) {
          if (/\bautoFocus\b/.test(prop) && /<(FormTextField|TextInput)\b/.test(prop)) {
            offenders.push(path.relative(REPO, full));
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

/**
 * Apple's predictive bar is the second row above the keyboard, and we do not
 * own it.
 *
 * Founder, 2026-09-09: autocorrect off everywhere. The reason is layout rather
 * than spelling — on iOS the QuickType bar draws BETWEEN the keyboard and our
 * Hide keyboard bar, so an autocorrect field puts two rows above the keyboard
 * and the app controls only the top one. `autoCorrect={false}` is the one trait
 * that removes Apple's row.
 *
 * Scanned across every `<TextInput` in the app rather than pinned to the shared
 * field, because the ones that bite are the bare inputs somebody adds later.
 */
describe("Apple's predictive bar is off on every field", () => {
  const inputFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : inputFiles(full);
      return entry.isFile() && entry.name.endsWith('.tsx') ? [full] : [];
    });

  it('every TextInput in the app turns it off', () => {
    const SRC = path.join(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    for (const file of inputFiles(SRC)) {
      const code = fs.readFileSync(file, 'utf8');
      // ELEMENTS ONLY. Two things look like a field and are not:
      // `useRef<TextInput>(null)` is a type parameter, and the usage example
      // in keyboard-done-bar's own docstring is a comment. The first is
      // excluded by requiring whitespace or a slash after the name (a generic
      // closes immediately with `>`); the second by skipping comment lines.
      // Written this way after the first draft reported all five as offences.
      for (const m of code.matchAll(/<TextInput(?=[\s/])/g)) {
        const before = code.slice(0, m.index);
        const line = before.split('\n').length;
        const lineText = code.split('\n')[line - 1].trim();
        if (lineText.startsWith('*') || lineText.startsWith('//')) continue;
        // The props of this element, up to its self-closing slash.
        const props = code.slice(m.index, code.indexOf('/>', m.index));
        if (!/autoCorrect=\{false\}/.test(props) && !/\{\.\.\.rest\}/.test(props)) {
          offenders.push(`${path.relative(SRC, file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the red underline where people write sentences', () => {
    // spellCheck is a SEPARATE trait that React Native inherits from
    // autoCorrect — "The default value is inherited from autoCorrect", per the
    // installed TextInput types. So turning the predictive bar off would have
    // silently taken spell-check with it, on the bio and the first message to
    // a stranger. Multiline is this app's prose marker.
    const field = source('src/components/form/form-text-field.tsx');
    expect(field).toContain('spellCheck={rest.multiline === true}');
    expect(source('src/features/chat/composer.tsx')).toContain('spellCheck');
  });
});
