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
const EDIT = 'src/app/business-edit.tsx';

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
    // Description, hours and links all open the editor when the section is
    // empty. A button that opens a modal while saying "Continue" is the same
    // lie three times over. The photo step is the fourth and it no longer
    // opens anything: it drives the grid's own picker (below).
    for (const label of [
      "continueLabel={usable ? 'Continue' : 'Add photos'}",
      "continueLabel={detail?.description ? 'Continue' : 'Write it'}",
      "continueLabel={hourCount > 0 ? 'Continue' : 'Set your hours'}",
      "continueLabel={linkCount > 0 ? 'Continue' : 'Add a link'}",
    ]) {
      expect(code).toContain(label);
    }
  });

  it('counts the photo the owner can see, not the one a traveler can', () => {
    const code = src(SIGNUP);
    // business_detail filters to moderation_status = 'approved' and is
    // granted to anon, so with require_photo_moderation ON — which is how
    // production runs — an owner added their cover, watched it chip "In
    // review", and was told by this step that they had none. The fix is the
    // owner-scoped table read, NOT a wider business_detail: a pending count
    // added there would tell any traveler that a non-approved photo exists.
    expect(code).toContain(
      "import { BusinessPhotos, useBusinessPhotos } from '@/features/business/business-photos';"
    );
    expect(code).toContain('const photosQuery = useBusinessPhotos(business?.id ?? null);');
    expect(code).toContain(
      "const usable = photos.some((photo) => photo.moderation_status !== 'rejected');"
    );
    // And the step draws the grid in place rather than routing into the
    // middle of a 1,430-line settings form.
    expect(code).toContain('<BusinessPhotos');
    expect(code).not.toContain("params: { section: 'photos' }");
  });

  it('says what the email costs on the screen that asks for it', () => {
    const code = src(SIGNUP);
    // The consequence used to be sprung one screen from the end, under the
    // heading "Exactly what a traveler sees when they tap you", which made
    // the review step read as a bait.
    expect(code).toContain('Nobody can find you on the map until you type that code in.');
    // The code goes out the moment there is an address to send it to, before
    // the photo step rather than nine screens later.
    const send = code.indexOf(
      'void requestCode.mutateAsync(email.trim()).catch(() => {});\n      go(8);'
    );
    expect(send).toBeGreaterThan(-1);
  });

  it('lets the code be typed mid-flow without leaving the form', () => {
    const code = src(SIGNUP);
    expect(code).toContain('function ConfirmEmailFooter(');
    expect(code).toContain('const confirm = useConfirmBusinessEmail();');
    // NEVER a push to /business-email from inside the footer: that screen
    // ends with router.replace('/(tabs)'), which would drop a mid-signup
    // owner out of the flow with an unfinished listing behind them.
    const footer = code.slice(code.indexOf('function ConfirmEmailFooter('));
    const footerBody = footer.slice(0, footer.indexOf('\nfunction CategoryGrid'));
    expect(footerBody).not.toContain('router.');
    // The resend is capped on the run-out timer. A business gets five codes a
    // day and a freely pressable resend on five consecutive screens would
    // burn them in a minute.
    expect(footerBody).toContain('{codeRunOut && !bounced ? (');
  });

  it('qualifies the promise the review step makes', () => {
    const code = src(SIGNUP);
    expect(code).toContain("badge={listed ? null : 'Not on the map yet'}");
    // And does not spend a second code when one is already live.
    expect(code).toContain('if (codeLive || codeBounced) {');
  });

  it('opens with what a listing is, and that it is free', () => {
    const code = src(SIGNUP);
    const offer = code.indexOf('title="What a listing gets you"');
    expect(offer).toBeGreaterThan(-1);
    // Before the name step, which is where the work starts.
    expect(offer).toBeLessThan(code.indexOf('title="What\'s your business called?"'));
    expect(code).toContain('Free, always. No paid placement, no promoted listings.');
    // The real listing component, not a bespoke card built for one screen.
    expect(code).toContain('<ListingPreview');
    // No skip: it is one tap and it is the offer.
    const step3 = code.slice(offer, code.indexOf('if (step === 4)'));
    expect(step3).not.toContain('onSkip');
  });

  it('the links step no longer has two buttons doing one thing', () => {
    const code = src(SIGNUP);
    // Continue and "Skip for now" both went to the review step, with a ghost
    // "Add a link" between them.
    expect(code).not.toContain('onContinue={() => go(12)}');
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

describe('the editor has one save model, or says it has two', () => {
  it('no longer promises you only lose what you typed', () => {
    const code = src(EDIT);
    // Photos and links commit the moment they are tapped. That sentence was
    // true of the text and false of the photo already destroyed, so an owner
    // who tidied their page and changed their mind found the photos gone and
    // the description restored, with no way to tell which was which.
    expect(code).not.toContain("You'll lose what you just typed.");
    expect(code).toContain('Photos and links are already saved. The rest goes back to how it was.');
  });

  it('keeps photos and links out of `dirty`, which drives Save', () => {
    const code = src(EDIT);
    // Widening `dirty` would make Save start saving photos, which it has
    // never owned and must not begin owning. The guard reads a separate
    // session flag the two children set.
    expect(code).toContain('const dirty = detailsChanged || hoursChanged || markerMoved;');
    expect(code).toContain('const [committed, setCommitted] = useState(false);');
    expect(code).toContain(
      '<BusinessPhotos businessId={business.id} userId={userId} onCommitted={noteCommitted} />'
    );
    expect(code).toContain(
      '<BusinessLinks businessId={business.id} onCommitted={noteCommitted} />'
    );
  });

  it('stops warning about the corrections that now cost nothing', () => {
    const code = src(EDIT);
    // A ten-metre nudge and an accent both used to null verified_at and drop
    // a listed business off the map (20260902100000 narrowed the trigger).
    // The warnings follow the trigger, or the screen goes on telling owners
    // that the safest thing they can do is leave a wrong name alone.
    expect(code).toContain(
      'const nameResets = normalizedName(name) !== normalizedName(business.name);'
    );
    expect(code).toContain(
      'const markerMovedFar = cityChanged || movedFar({ lat: business.lat, lng: business.lng }, coords);'
    );
    expect(code).toContain('if (!nameResets && !markerMovedFar) {');
    // But any move at all is still saved: update_business_location owns the
    // columns and an owner who nudges the marker means it.
    expect(code).toContain('if (markerMoved) {');
  });
});
