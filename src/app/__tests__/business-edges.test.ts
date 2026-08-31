import fs from 'node:fs';
import path from 'node:path';

/**
 * The edges of the business account: an invite link, the post form, and the
 * signup steps that build the listing.
 *
 * Founder, after testing as a business: "under no circumstances should a
 * business account ever have the option to join a chat of any other business
 * or other pin of any kind... it also doesn't make sense for the business
 * account to ever have to set a date for when it is leaving."
 *
 * The invite screen is the hard one, and the reason this file exists. It is
 * registered OUTSIDE every guard in app/_layout, because a link has to open
 * for somebody who has no account at all — so no router gate stands between a
 * business and the traveler join flow. Only the screen itself can, and the
 * next person to edit it will not be reading this comment.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const INVITE = 'src/app/join-group/[token].tsx';
const POST = 'src/app/business-post.tsx';
const SIGNUP = 'src/app/business-signup.tsx';

describe('a business opening an invite link', () => {
  it('is turned round before the join flow renders', () => {
    const code = src(INVITE);
    expect(code).toContain("import { useIsBusiness } from '@/features/business/hooks';");
    const guard = code.indexOf('if (viewerIsBusiness) {');
    expect(guard).toBeGreaterThan(-1);
    // In front of BOTH halves of the traveler flow: the leaving date, and
    // the button that walks to a database refusal.
    // The rendered prompt, not the sentence quoting it in the comment above
    // the guard.
    expect(guard).toBeLessThan(
      code.indexOf('<ThemedText type="smallBold">Stay in the group until</ThemedText>')
    );
    expect(guard).toBeLessThan(code.indexOf('continueLabel="Join the group"'));
    // And in front of the date picker itself, which is the control the
    // founder named.
    expect(guard).toBeLessThan(code.indexOf('<DateTimePicker'));
  });

  it('says why, and offers the way back to its own tabs', () => {
    const code = src(INVITE);
    // A refusal somebody could not have predicted is worse than no button,
    // so this screen explains rather than bouncing.
    expect(code).toContain('Groups are for travelers');
    expect(code).toContain("router.replace('/my-business')");
  });
});

describe('the post form tells the truth about what is up', () => {
  it('never prints a count above the cap', () => {
    const code = src(POST);
    // Renaming a verified business clears the check, so the cap drops from
    // ten to three with ten posts already live. "10 of 3 up right now" was
    // the screen reporting a state that cannot exist.
    expect(code).toContain('const overCap = livePosts.data != null && live > cap;');
    const over = code.indexOf('which is over the ${cap} you can have at once');
    expect(over).toBeGreaterThan(-1);
    // The over-cap branch has to come FIRST, or the "N of CAP" line prints
    // before anything gets a chance to clamp it.
    expect(over).toBeLessThan(code.indexOf('${live} of ${cap} up right now'));
    // And the note above the button says what to do about it.
    expect(code).toContain('${cap} is the most at once. Take some down on My business first.');
  });

  it('does not promise the map to a listing that is off it', () => {
    const code = src(POST);
    expect(code).toContain(
      "const onTheMap = business != null && business.state === 'listed' && business.active;"
    );
    expect(code).toContain('Only you can see it while your listing is off the map.');
  });
});

describe('the listing steps read as a business', () => {
  it('does not call a business a place', () => {
    const code = src(SIGNUP);
    // The design brief's banned vocabulary, founder 2026-08-28: a hostel,
    // bar, cafe or tour operator is a BUSINESS in every string anybody
    // reads.
    expect(code).toContain('title="Show your business"');
    expect(code).not.toContain('Show the place');
    // The traveler side of the same listing: the report action named the
    // banned noun three times, and disagreed with the screen it opens.
    expect(src('src/app/place/[id].tsx')).not.toContain('Report this place');
  });

  it('every docked button says what pressing it does', () => {
    const code = src(SIGNUP);
    // Photos, description, hours and links all open the editor when the
    // section is empty. A button that opens a modal while saying "Continue"
    // is the same lie four times over.
    for (const label of [
      "continueLabel={photoCount > 0 ? 'Continue' : 'Add photos'}",
      "continueLabel={detail?.description ? 'Continue' : 'Write it'}",
      "continueLabel={hourCount > 0 ? 'Continue' : 'Set your hours'}",
      "continueLabel={linkCount > 0 ? 'Continue' : 'Add a link'}",
    ]) {
      expect(code).toContain(label);
    }
  });

  it('the links step no longer has two buttons doing one thing', () => {
    const code = src(SIGNUP);
    // Continue and "Skip for now" both went to step 11, with a ghost "Add a
    // link" between them.
    expect(code).not.toContain('onContinue={() => go(11)}');
  });

  it('greys the blocked Continue on Where is it, instead of a note that lies', () => {
    const code = src(SIGNUP);
    // A full-brightness Continue that silently swallows the tap is the one
    // pattern every other step avoids. The grey button carries "not yet";
    // the note is free to talk about the street and the marker.
    expect(code).toContain('continueDisabled={city == null || coords == null}');
    expect(code).not.toContain('Pick your city first.');
  });

  it('says the launch state instead of leaving four bare chips', () => {
    const code = src(SIGNUP);
    // Derived from the list, not hardcoded "four", so city five keeps it true.
    expect(code).toContain('so far. Pick yours above and the map shows up.');
    // And the door for city five, so a hostel in Porto becomes a signal
    // instead of a silent quit.
    expect(code).toContain('Somewhere else? Tell us where.');
    expect(code).toContain("onPress={() => router.push('/contact')}");
  });
});
