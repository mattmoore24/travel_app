import fs from 'node:fs';
import path from 'node:path';

import { after, between } from '@/lib/__tests__/source';

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
    // Hours and links still open the editor when the section is empty, and a
    // button that opens a modal while saying "Continue" is the same lie
    // twice. The photo step drives the grid's own picker (below) and the
    // description step now takes the text in place, so neither of those two
    // has a handoff left to name.
    for (const label of [
      "continueLabel={usable ? 'Continue' : 'Add photos'}",
      "continueLabel={hourCount > 0 ? 'Continue' : 'Set your hours'}",
      "continueLabel={linkCount > 0 ? 'Continue' : 'Add a link'}",
    ]) {
      expect(code).toContain(label);
    }
  });

  it('takes the description in place instead of handing off to the editor', () => {
    const code = src(SIGNUP);
    // Three steps in a row promised a step and delivered a 1,430-line
    // settings form scroll-positioned at a heading. This is the one that did
    // not have to: it is a single text field, so it is one here.
    const step = after(code, 'if (step === 9) {');
    const body = step.slice(0, step.indexOf('if (step === 10) {'));
    // No handoff at all: nothing on this step pushes anywhere.
    expect(body).not.toContain('router.');
    expect(body).not.toContain("section: 'details'");
    // The editor's own field, cap and hint, because it is the same text and
    // two ways of typing it is two things to keep in step.
    expect(body).toContain('label="About the business"');
    expect(code).toContain('const DESCRIPTION_MAX = 600;');
    expect(body).toContain('characters left');
    // Saved through the mutation that owns the column, not held for a Save
    // button this step does not have.
    expect(code).toContain('await updateBusiness.mutateAsync({ description: trimmed || null });');
    // And the field falls through to the saved row until somebody types, so
    // the step is right on the way BACK to it as well as the first time. A
    // string seeded at mount would have been seeded from a row that had not
    // landed yet.
    expect(code).toContain("const descriptionText = description ?? business?.description ?? '';");
    // A failed save keeps the person on the step. Moving on would leave them
    // believing words that never landed.
    expect(code).toContain("setDescriptionProblem('We could not save that just then. Try again.')");
  });

  it('gives the empty hours and links steps something to look at', () => {
    const code = src(SIGNUP);
    // Two of the three content steps were mostly empty black before a
    // handoff, so an owner deciding whether this app is real had nothing to
    // decide on. The example is furniture and must read as furniture: one
    // accessibility element saying what it is, so VoiceOver never reads a
    // fake set of hours as this business's own.
    expect(code).toContain('function ExampleBlock(');
    expect(code).toContain('<ExampleBlock what="One line of hours looks like this">');
    expect(code).toContain('<ExampleBlock what="Two links look like this">');
    const block = after(code, 'function ExampleBlock(');
    expect(block.slice(0, block.indexOf('\n/**'))).toContain('accessibilityLabel={what}');
    // And only while the step is empty, or it would sit under the real thing
    // as a second, greyed copy of it.
    expect(code).toContain('{hourCount > 0 ? (');
    expect(code).toContain('{linkCount > 0 ? (');
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
    // the photo step rather than nine screens later - but only when one is
    // not already in flight. Continue, back one screen, Continue again is an
    // ordinary thing to do while checking a phone number, and an unguarded
    // send spent one of the five daily codes on each pass while invalidating
    // the digits already in the owner's inbox.
    // The code goes out the moment there is an address to send it to, before
    // the photo step rather than nine screens later - but only when one is
    // not already in flight TO THAT ADDRESS.
    expect(code).toContain('if (sentTo !== target || !(codeLive || codeBounced))');
    expect(code).toContain('void requestCode');
    expect(code).toContain('go(8);');
  });

  it('lets the code be typed mid-flow without leaving the form', () => {
    const code = src(SIGNUP);
    expect(code).toContain('function ConfirmEmailFooter(');
    expect(code).toContain('const confirm = useConfirmBusinessEmail();');
    // NEVER a push to /business-email from inside the footer: that screen
    // ends with router.replace('/(tabs)'), which would drop a mid-signup
    // owner out of the flow with an unfinished listing behind them.
    const footer = after(code, 'function ConfirmEmailFooter(');
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

describe('a named section gets that section, not the whole settings form', () => {
  it('gates every block on the section param', () => {
    const code = src(EDIT);
    // Run 49: an owner asked for photos and got 'Add different hours for some
    // days', a links list, an orphaned 'What is it? / Pick one' showing no
    // selection, '2 of 10', a dashed square, '0 of 10' and Save. Every block
    // is behind the gate now, and the screen wears the section's name.
    expect(code).toContain('const shows = (key: Section) => section == null || section === key;');
    for (const key of ['details', 'location', 'hours', 'links', 'photos']) {
      expect(code).toContain(`{shows('${key}') ? (`);
    }
    expect(code).toContain("title={section ? SECTION_TITLE[section] : 'Edit your business'}");
  });

  it('treats an unrecognised section as no section at all', () => {
    const code = src(EDIT);
    // It is a route param, so anything can arrive in it. Under a gate, an
    // unknown value would render a form with no fields and a Save button.
    expect(code).toContain('params.section != null && params.section in SECTION_TITLE');
  });

  it('leaves nothing unreachable: every field belongs to a section', () => {
    const code = src(EDIT);
    // 'Finding the door' and 'Anything the hours miss' are not in the spec's
    // list of what details and location render, and with a gate in front of
    // them an unassigned field is a field no caller can ever open.
    const location = after(code, "{shows('location') ? (");
    expect(location.slice(0, location.indexOf("{shows('hours') ? ("))).toContain(
      'label="Finding the door"'
    );
    const hours = after(code, "{shows('hours') ? (");
    expect(hours.slice(0, hours.indexOf("{shows('links') ? ("))).toContain(
      'label="Anything the hours miss"'
    );
    const details = after(code, "{shows('details') ? (");
    expect(details.slice(0, details.indexOf("{shows('location') ? ("))).toContain(
      'label="Website"'
    );
  });

  it('drops the scroll-to, which a block that never mounts can never satisfy', () => {
    const code = src(EDIT);
    // measure() set targetY from an onLayout, and an unmounted block never
    // calls onLayout. Leaving it in would mean waiting forever on a scroll
    // that has nothing to scroll to. The named block is the only one on
    // screen, so it is already at the top.
    expect(code).not.toContain('const measure =');
    expect(code).not.toContain('setTargetY');
    expect(code).not.toContain('scrollTo(');
    expect(code).not.toContain('scrollRef=');
  });

  it('commit() cannot save a block that is not on screen', () => {
    const code = src(EDIT);
    // The whole safety of the gate: an unmounted block leaves its state equal
    // to the row it was seeded from, so its half of the dirty check is false
    // and commit() skips the write. That holds only while every piece of
    // state is seeded FROM the row and the comparison is against the row.
    for (const seed of [
      'useState(business.name)',
      "useState(business.description ?? '')",
      "useState(business.address ?? '')",
      "useState(business.place_label ?? '')",
      "useState(business.hours_note ?? '')",
      "useState(business.website_url ?? '')",
      'useState({ lat: business.lat, lng: business.lng })',
      'useState(business.city_id)',
    ]) {
      expect(code).toContain(seed);
    }
    // And the hours seed is the one that is NOT literally the rows: a place
    // with none gets a blank line to fill in. serializeRules drops a rule
    // with no days, so the fingerprint still matches the empty week.
    expect(code).toContain('.filter((rule) => rule.days.length > 0)');
    expect(code).toContain(
      'const hoursChanged = serializeRules(rules) !== serializeRules(rulesFromRows(hourRows));'
    );
  });

  it('says Done where there is nothing left to save', () => {
    const code = src(EDIT);
    // Photos and links commit on the tap. A "Save" over a screen with nothing
    // held is the same kind of lie the signup steps just stopped telling.
    expect(code).toContain(
      "continueLabel={section === 'photos' || section === 'links' ? 'Done' : 'Save'}"
    );
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

describe('the review step says the true thing about the code', () => {
  it('does not promise a send that already happened', () => {
    const code = src(SIGNUP);
    // Since the code goes out from the contact step, the review screen's
    // normal path carried three statements and two were false: a footer
    // saying a code had been sent and offering a box for it, a note
    // promising one in the future, and a button offering to send a thing
    // sendCode() was not going to send.
    expect(code).toContain('const reviewAction =');
    expect(code).toContain("label: 'Type in your code'");
    expect(code).toContain("We've emailed you a code.");
    // The fixed pair is gone from the screen.
    expect(code).not.toContain("continueLabel={listed ? 'You are on the map' : 'Email me a code'}");
  });

  it('has a branch for every state the owner can be in', () => {
    const code = src(SIGNUP);
    const block = between(code, 'const reviewAction =', 'const sendCode');
    // Listed, bounced, live, run out, never sent. A bounce leads with the
    // fix, because re-sending to an address that just bounced bounces again.
    expect(block).toContain("label: 'You are on the map'");
    expect(block).toContain("label: 'Use a different address'");
    expect(block).toContain("label: 'Email me a new code'");
    expect(block).toContain("label: 'Email me a code'");
    // Every branch carries its own note, so none of them can inherit a
    // sentence written for a different state.
    expect((block.match(/note:/g) ?? []).length).toBe(5);
  });
});

describe('the contact step guard is scoped to the address', () => {
  it('still sends when the address changed, which is why people come back', () => {
    const code = src(SIGNUP);
    // my_business_code_status returns sent_at/delivered/attempts/failed and
    // NO address, so codeLive means "a code is live", never "for this
    // address". A guard on codeLive alone skipped the send for a CORRECTED
    // email and left the owner with a listing whose code went to the typo -
    // no way to ask for one that was never sent. The commonest reason to
    // come back to this step is exactly that correction.
    expect(code).toContain('const [sentTo, setSentTo] = useState<string | null>(null)');
    expect(code).toContain('sentTo !== target');
  });

  it('records an address only when the send actually resolved', () => {
    const code = src(SIGNUP);
    // Optimistically recording it would mean a refusal (the fifth of the
    // day) left an address looking covered by a code nobody received, and
    // the next pass would skip it too.
    expect(code).toContain('.then(() => setSentTo(target))');
    const block = after(code, 'const target = email.trim()');
    expect(block.slice(0, block.indexOf('go(8)'))).not.toContain('setSentTo(target);');
  });

  it('fails safe: an unset mirror sends rather than staying silent', () => {
    const code = src(SIGNUP);
    // null !== target, so the first pass and any remount send. The guard can
    // only ever suppress a send it can prove is redundant.
    expect(code).toContain('useState<string | null>(null)');
  });
});
