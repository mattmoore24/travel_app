import fs from 'node:fs';

import { lineAt, repoPath, sourceFiles, withoutComments } from '../source-scan';

/**
 * Every directional style in this app is PHYSICAL — `left`, `paddingRight`,
 * `marginLeft` — and React Native has had the logical spellings (`start`,
 * `end`, `paddingStart`, `paddingEnd`, `marginStart`, `marginEnd`) for years.
 *
 * Today that costs nothing: the app ships one locale and it reads left to
 * right. The day an Arabic or Hebrew locale is declared it becomes a
 * twenty-six-file retrofit, done under a deadline, by somebody who cannot see
 * the screens they are breaking. This scan buys the discipline now, while it
 * is free, without doing the retrofit.
 *
 * **It is a warning list, not a wall**, and that is deliberate. A gate that
 * goes red on the day it lands gets deleted on the day after, so the twenty-six
 * files that exist today are recorded below and keep what they have. Two
 * things are hard failures, and both are about NEW work:
 *
 *   - a physical directional style in a file that has none today, and
 *   - one MORE of them in a file that already has some.
 *
 * Everything else — a file that has got better, an entry that is now stale —
 * is a `console.warn`, because the right response to good news is not a red
 * build.
 *
 * ## What is flagged, and what deliberately is not
 *
 * Only the ASYMMETRIC uses. `left: 0` next to `right: 0` on a stretched
 * overlay, or `paddingLeft: 12` next to `paddingRight: 12`, mirrors correctly
 * under RTL because there is nothing to mirror — flagging those would triple
 * the list with findings that are not bugs, and a scan people learn to
 * ignore is worse than no scan. What is left is exactly the set that comes
 * out wrong in an RTL locale: a value on one side only, or two different
 * values on the two sides.
 *
 * Scoped to `StyleSheet.create` blocks, which is where this app puts its
 * styles. Inline `style={{ ... }}` objects in JSX are not scanned; if that
 * becomes a hiding place, widen it then rather than guessing now.
 *
 * `borderLeftWidth`, `borderTopLeftRadius` and the rest of the border family
 * have the same problem and the same fix (`borderStartWidth`,
 * `borderStartStartRadius`). They are out of scope on purpose: the chat
 * bubble's tail corner and the calendar band's end caps are the app's two
 * hardest RTL questions and they want a designer, not a lint rule.
 */

/** Physical property -> what to write instead. */
const LOGICAL: Record<string, string> = {
  left: 'start',
  right: 'end',
  marginLeft: 'marginStart',
  marginRight: 'marginEnd',
  paddingLeft: 'paddingStart',
  paddingRight: 'paddingEnd',
};

const PAIRS: [string, string][] = [
  ['left', 'right'],
  ['marginLeft', 'marginRight'],
  ['paddingLeft', 'paddingRight'],
];

/**
 * The physical directional styles that already exist, swept 2026-09-01.
 *
 * `where` names the style objects each entry covers, so the entry documents
 * itself: it is a list of the specific things that are grandfathered, not a
 * licence for the file. None of them is CORRECT — every one is debt, and the
 * honest thing to do when you next open one of these files is convert it and
 * lower the number.
 */
const RTL_DEBT: Record<string, { physical: number; where: string }> = {
  'src/app/(tabs)/chat.tsx': { physical: 2, where: 'notice.paddingLeft, faceOverlap.marginLeft' },
  'src/app/(tabs)/travelers.tsx': {
    physical: 3,
    where: 'profileCorner.right, queueHeader.paddingRight, undoCard.paddingLeft/paddingRight',
  },
  'src/app/business-post.tsx': { physical: 1, where: 'shapeExtra.paddingLeft' },
  'src/app/chat/[id].tsx': { physical: 1, where: 'attachmentRemove.right' },
  'src/app/place/[id].tsx': { physical: 2, where: 'hoursRange.textAlign, strip.paddingRight' },
  'src/app/rate-place.tsx': { physical: 1, where: 'header.paddingLeft/paddingRight' },
  'src/components/form/chip-rail.tsx': { physical: 1, where: 'row.paddingRight' },
  'src/components/form/form-text-field.tsx': {
    physical: 2,
    where: 'inputWithToggle.paddingRight, reveal.right',
  },
  'src/components/form/hours-slider.tsx': { physical: 2, where: 'fill.left, knob.left' },
  'src/components/form/step-screen.tsx': { physical: 1, where: 'close.marginRight' },
  'src/components/photo-grid.tsx': {
    physical: 3,
    where: 'statusAnchor.left, removeAnchor.right, arrangeAnchor.right',
  },
  'src/components/ui/collapsible.tsx': { physical: 1, where: 'content.marginLeft' },
  'src/components/ui/segmented.tsx': { physical: 1, where: 'thumb.left' },
  'src/features/business/business-marker.tsx': { physical: 1, where: 'liveDot.right' },
  'src/features/business/business-photos.tsx': {
    physical: 2,
    where: 'tileChipAnchor.left, removeAnchor.right',
  },
  'src/features/chat/chat-row.tsx': { physical: 1, where: 'separator.left/right' },
  'src/features/chat/composer.tsx': {
    physical: 2,
    where: 'replyBanner.paddingLeft, attachmentRemove.right',
  },
  'src/features/chat/message-thread.tsx': {
    physical: 3,
    where: 'authorLine.marginLeft, runAvatar.marginRight, quote.paddingLeft',
  },
  'src/features/chat/thread-header.tsx': { physical: 1, where: 'header.paddingLeft/paddingRight' },
  'src/features/intro/intro-tour.tsx': { physical: 1, where: 'skip.right' },
  'src/features/pins/map-screen.tsx': {
    physical: 3,
    where: 'devHeatCount.left, searchWrap.paddingLeft, avatarDock.marginRight',
  },
  'src/features/pins/pin-marker.tsx': {
    physical: 5,
    where:
      'stackRow.paddingRight, stackCount.marginLeft, ownRing.left, categoryDot.right, openDot.left',
  },
  'src/features/profile/finish-card.tsx': { physical: 1, where: 'dismiss.marginRight' },
  'src/features/profile/profile-view.tsx': {
    physical: 2,
    where: 'heroEditAnchor.right, replyAnchor.right',
  },
  'src/features/profile/social-handles-editor.tsx': {
    physical: 1,
    where: 'inputRow.paddingLeft/paddingRight',
  },
  'src/features/trips/trip-calendar.tsx': { physical: 1, where: 'monthLabel.paddingLeft' },
};

type Finding = { file: string; line: number; style: string; what: string; fix: string };

/**
 * Every `name: { ... }` that is a direct member of a `StyleSheet.create({...})`
 * call, with its text and where it starts. Brace-walked rather than
 * regex-matched, so a style holding a nested object (`shadowOffset`,
 * `transform`) does not end the block early.
 */
function styleObjects(code: string): { name: string; text: string; offset: number }[] {
  const found: { name: string; text: string; offset: number }[] = [];
  const create = /StyleSheet\.create\(\s*\{/g;
  let call: RegExpExecArray | null;
  while ((call = create.exec(code)) !== null) {
    const open = call.index + call[0].length - 1;
    const close = matching(code, open);
    if (close < 0) continue;
    const body = code.slice(open + 1, close);
    const named = /(\w+)\s*:\s*\{/g;
    let entry: RegExpExecArray | null;
    while ((entry = named.exec(body)) !== null) {
      const start = entry.index + entry[0].length - 1;
      const end = matching(body, start);
      if (end < 0) continue;
      found.push({ name: entry[1], text: body.slice(start, end + 1), offset: open + 1 + start });
      named.lastIndex = end;
    }
  }
  return found;
}

/** Index of the `}` closing the `{` at `open`, or -1. */
function matching(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function valueOf(style: string, property: string): string | null {
  const match = new RegExp(`(?:^|[{,\\s])${property}\\s*:\\s*([^,}\\n]+)`).exec(style);
  return match ? match[1].trim() : null;
}

function scan(file: string): Finding[] {
  const code = withoutComments(fs.readFileSync(file, 'utf8'));
  const where = repoPath(file);
  const findings: Finding[] = [];
  for (const style of styleObjects(code)) {
    const line = lineAt(code, style.offset);
    for (const [physicalStart, physicalEnd] of PAIRS) {
      const startValue = valueOf(style.text, physicalStart);
      const endValue = valueOf(style.text, physicalEnd);
      if (startValue == null && endValue == null) continue;
      // Both sides, same value: symmetric, and symmetric mirrors correctly.
      if (startValue != null && endValue != null && startValue === endValue) continue;
      const both = startValue != null && endValue != null;
      findings.push({
        file: where,
        line,
        style: style.name,
        what: both
          ? `${physicalStart}/${physicalEnd}`
          : startValue != null
            ? physicalStart
            : physicalEnd,
        fix: both
          ? `${LOGICAL[physicalStart]}/${LOGICAL[physicalEnd]} instead`
          : `${startValue != null ? LOGICAL[physicalStart] : LOGICAL[physicalEnd]} instead`,
      });
    }
    if (/textAlign\s*:\s*'(?:left|right)'/.test(style.text)) {
      findings.push({
        file: where,
        line,
        style: style.name,
        what: 'textAlign',
        fix: "nothing: drop the property, and the default 'auto' follows the writing direction",
      });
    }
  }
  return findings;
}

const describeFinding = (finding: Finding): string =>
  `${finding.file}:${finding.line} ${finding.style}.${finding.what} is physical. Write ${finding.fix}, so the layout mirrors itself in a right-to-left locale.`;

describe('directional styles', () => {
  const files = sourceFiles();
  const findings = files.flatMap(scan);
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
  }

  it('finds the source to scan', () => {
    expect(files.length).toBeGreaterThan(100);
    // Counts the BLOCKS, not the findings. A scan that quietly stopped
    // parsing `StyleSheet.create` would go green and stay green, and the
    // number of findings is the one figure this file wants to fall.
    const blocks = files.reduce(
      (total, file) => total + styleObjects(withoutComments(fs.readFileSync(file, 'utf8'))).length,
      0
    );
    expect(blocks).toBeGreaterThan(500);
  });

  it('are logical in every file that has no physical ones already', () => {
    const offenders = findings
      .filter((finding) => RTL_DEBT[finding.file] == null)
      .map(describeFinding);
    expect(offenders).toEqual([]);
  });

  it('do not grow in the files that carry the old ones', () => {
    const grown = [...byFile.entries()]
      .filter(([file, list]) => RTL_DEBT[file] != null && list.length > RTL_DEBT[file].physical)
      .map(
        ([file, list]) =>
          `${file} now has ${list.length} physical directional styles, up from ${RTL_DEBT[file].physical}. ` +
          list.map(describeFinding).join(' ')
      );
    expect(grown).toEqual([]);
  });

  // Good news, said out loud rather than as a red build: a file that has been
  // converted, or partly converted, only needs its number lowered.
  it('reports the debt that has been paid off', () => {
    const paid = Object.entries(RTL_DEBT)
      .map(([file, entry]) => ({ file, entry, now: byFile.get(file)?.length ?? 0 }))
      .filter(({ entry, now }) => now < entry.physical)
      .map(({ file, entry, now }) =>
        now === 0
          ? `${file} is clean. Delete its entry from RTL_DEBT.`
          : `${file} is down to ${now} from ${entry.physical}. Lower its number in RTL_DEBT so it cannot creep back.`
      );
    if (paid.length > 0) {
      console.warn(`[logical-directional-styles] ${paid.join('\n')}`);
    }
    expect(true).toBe(true);
  });
});
