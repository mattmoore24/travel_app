import fs from 'node:fs';
import path from 'node:path';

/**
 * The page count is derived, and everything that draws a page reads it.
 *
 * The choice used to be bolted onto the last explainer, so four controls
 * stacked under a heading about something else and the two quiet doors
 * competed at the bottom of the visual stack. Splitting it onto a page of its
 * own is exactly the edit that invites a hardcoded count: the dot row, the
 * skip fade and `last` all key on it, and a stale literal would leave a dot
 * missing, Skip live on the final page, or a page nobody can reach.
 *
 * A source scan because none of this is observable from a render test: the
 * dots are driven by a shared scroll value on the UI thread.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'intro-tour.tsx'), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the tour page count', () => {
  it('is derived from the pages, plus the welcome scene and the choice', () => {
    expect(CODE).toContain('const PAGE_COUNT = PAGES.length + 2;');
    expect(CODE).toContain('const CHOICE_INDEX = PAGE_COUNT - 1;');
  });

  it('feeds the dot row rather than a literal', () => {
    expect(CODE).toContain('Array.from({ length: PAGE_COUNT }');
  });

  it('feeds the skip fade and the last-page test', () => {
    expect(CODE).toContain('[(PAGE_COUNT - 2) * width, (PAGE_COUNT - 1) * width]');
    expect(CODE).toContain('const last = page === PAGE_COUNT - 1;');
  });

  it('has no hardcoded page count anywhere near the pager', () => {
    // The shape of the bug: `length: 5`, `page === 4`, `width * 4`.
    expect(CODE).not.toMatch(/length:\s*\d+\s*}, \(_, i\) => \(?\s*<Dot/);
    expect(CODE).not.toMatch(/page === \d+/);
  });
});

describe('the choice is its own page', () => {
  it('is rendered outside the PAGES map, at CHOICE_INDEX', () => {
    const map = CODE.indexOf('{PAGES.map(');
    const choice = CODE.indexOf('index={CHOICE_INDEX}');
    expect(map).toBeGreaterThan(-1);
    expect(choice).toBeGreaterThan(map);
  });

  it('every explainer keeps its own Next', () => {
    // The rule this file already paid for: a page that teaches a full-width
    // pill and then takes it away leaves Skip as the only visible control.
    const map = CODE.indexOf('{PAGES.map(');
    const choice = CODE.indexOf('index={CHOICE_INDEX}');
    const explainers = CODE.slice(map, choice);
    expect(explainers).toContain('label="Next"');
    // ...and unconditionally: the old `{choice ? null : ...}` branch is what
    // made the last explainer carry the account decision instead.
    expect(explainers).not.toContain('choice ?');
  });

  it('sets the business door apart with a rule rather than making it a fourth option', () => {
    expect(CODE).toContain('styles.businessDoor');
    expect(CODE).toContain('borderTopWidth: StyleSheet.hairlineWidth');
  });
});

describe('the words on the choice page', () => {
  const title = 'Ready when you are';
  const body = 'Making a profile takes a couple of minutes. You can look around first either way.';

  it('head the page with the promise rather than a feature', () => {
    expect(CODE).toContain(title);
    // Split across lines by the formatter; match the halves.
    expect(CODE).toContain('Making a profile takes a couple of minutes.');
    expect(CODE).toContain('You can look around first either');
  });

  it('carry no em dash and none of the banned vocabulary', () => {
    for (const text of [title, body]) {
      expect(text).not.toContain('\u2014');
      expect(text).not.toMatch(/\b(swipe|deck|match|request)\b/i);
    }
  });
});

describe('the explainer stills', () => {
  it('are optional, so a missing asset falls back to the badge rather than a hole', () => {
    expect(CODE).toContain('image?: ImageSourcePropType');
    expect(CODE).toContain('{item.image ? (');
    expect(CODE).toContain('<SymbolView name={item.icon}');
  });

  it('are capped at 45% of the page, so the title, body and Next stay above the fold', () => {
    expect(CODE).toContain('maxHeight: height * 0.45');
  });

  it('draw on the same parallax layer and factor the badge did', () => {
    // Replacing the badge must not change how the page moves under a finger.
    expect(CODE).toContain(
      '<PageLayer scrollX={scrollX} index={index} width={width} factor={0.55}>'
    );
  });
});
