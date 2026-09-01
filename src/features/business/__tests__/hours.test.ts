import fs from 'node:fs';
import path from 'node:path';

import { openLine } from '@/features/business/vocabulary';

/**
 * "Hours not set", rather than a section that quietly is not there.
 *
 * Signup is right not to make an owner guess their hours, and step 9 is
 * skippable. The consequence landed on the traveler: no open line in the meta
 * row and no Hours section at all, so a traveler standing on a street at 22:00
 * got a description, a photo, and no way to tell whether the door was open -
 * and an absent section is indistinguishable from one that failed to load.
 *
 * The unit half of this is `openLine` returning null on an empty hour list,
 * which vocabulary.test.ts already pins ("says nothing at all when the hours
 * are unknown"). What was untested is the two screens that read that null, so
 * these are source-reading, in the idiom of business-map.test.ts and
 * business-home.test.ts: they pin the shape so the next edit cannot quietly
 * take the line away again.
 */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const PAGE = 'src/app/place/[id].tsx';
const SHEET = 'src/features/business/place-sheet.tsx';

describe('the answer both screens are reading', () => {
  it('is null, not "Closed", when nobody has said', () => {
    // The whole feature hangs off this branch. Defaulting to closed would have
    // every business that skipped step 9 telling travelers it is shut, which
    // is worse than saying nothing: a wrong "Closed" sends nobody, and a wrong
    // "Open" sends somebody across a city.
    expect(openLine([], new Date())).toBeNull();
  });
});

describe('the listing page names the gap', () => {
  it('renders the Hours section whether or not there are hours in it', () => {
    const code = src(PAGE);
    // The old gate. A section conditioned on having something to show is a
    // section that disappears exactly when the reader most needs an answer.
    expect(code).not.toContain('{hours.length > 0 || place.hours_note ? (');
    expect(code).toContain('const unknown = hours.length === 0 && !note;');
    expect(code).toContain('Hours not set');
  });

  it('leaves the meta row alone, so the gap is stated once', () => {
    const code = src(PAGE);
    // An absent open line up beside the category is correct: the line is a
    // fact about today, and there is no fact. Saying it in both places would
    // make the missing hours louder than the business.
    const meta = code.slice(code.indexOf('<View style={styles.metaRow}>'));
    expect(meta.slice(0, meta.indexOf('</View>'))).not.toContain('Hours not set');
  });

  it('offers the one move left, where somebody is on the other end', () => {
    const code = src(PAGE);
    // message_business refuses an unclaimed venue, a guest has no account and
    // a business account may not write to another business - so the button is
    // offered only where it would work.
    expect(code).toContain(
      'hours.length === 0 && !place.hours_note && place.claimed && !isGuest && !isBusinessAccount'
    );
    expect(code).toContain('onMessage={askAboutHours ? openMessage : null}');
  });

  it('moves that button rather than growing a second one', () => {
    const code = src(PAGE);
    // One control, in one of two places. Two Message buttons on one page is
    // the same bug as two names for one act.
    expect((code.match(/label="Message"/g) ?? []).length).toBe(2);
    expect(code).toContain('askAboutHours ? null : (');
    // Both spellings go through the same push, so the two cannot drift apart
    // on which params /message-place is given.
    expect((code.match(/onPress=\{openMessage\}/g) ?? []).length).toBe(1);
    expect((code.match(/onMessage \? \(/g) ?? []).length).toBe(1);
  });
});

describe('the tapped-marker card says the same thing', () => {
  it('names the gap on the meta line, which is the only line it has', () => {
    const code = src(SHEET);
    // The card has no Hours section to carry it, so the one line under the
    // name is where it goes. Without this the sheet and the page disagreed
    // about whether a business had told anyone when it is open.
    expect(code).toContain("'Hours not set'");
    expect(code).toContain('CATEGORY_LABEL[place.category],');
    expect(code).toContain(".join(' · ')");
    // filter(Boolean) was how the clause used to vanish.
    expect(code).not.toContain('[CATEGORY_LABEL[place.category], open].filter(Boolean)');
  });

  it('counts a note as hours, because the page does', () => {
    const code = src(SHEET);
    // openLine() reads only the grid, so a business whose hours live in
    // hours_note ("open when the lights are on") has open === null. Saying
    // "Hours not set" about it would contradict the page one tap behind,
    // whose own gap test is `hours.length === 0 && !note` - and moving a
    // disagreement is not the same as ending one.
    expect(code).toContain('place.hours_note');
    const meta = code.slice(code.indexOf('CATEGORY_LABEL[place.category],'));
    const line = meta.slice(0, meta.indexOf(".join(' · ')"));
    expect(line).toContain('hours_note');
    // Trimmed: a note of three spaces is not hours.
    expect(line).toContain('trim()');
  });
});
