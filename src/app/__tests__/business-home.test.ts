import fs from 'node:fs';
import path from 'node:path';

/**
 * A business owner's own two screens: the My business tab and the account
 * page behind the header avatar.
 *
 * Founder, testing as a business: "The current build is extremely clunky and
 * completely unacceptable for business users expecting a tailored
 * experience." Every case below is one of the ways it was traveler-shaped -
 * a button that named a tab and went somewhere else, a rulebook about pins,
 * a delete that left the phone signed in, an avatar reading a table a
 * business can never have a row in.
 *
 * Source-reading, like business-cannot-join: these pin the shape so the next
 * edit cannot quietly undo it.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const MY_BUSINESS = 'src/app/(tabs)/my-business.tsx';
const ACCOUNT = 'src/app/profile-me.tsx';

/** Just the business branch of the account page, which is what this is about. */
function businessAccount(): string {
  const code = src(ACCOUNT);
  const start = code.indexOf('function BusinessAccount(');
  const end = code.indexOf('export default function ProfileScreen(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

/**
 * The confirmation both account pages now share. Deleting moved off the two
 * branches and into one component, so the assertions about what deleting DOES
 * follow it there; the assertions about what each branch OFFERS stay above.
 */
function deleteSheet(): string {
  const code = src(ACCOUNT);
  const start = code.indexOf('export function DeleteAccountSheet(');
  const end = code.indexOf('function BusinessAccount(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe('the account page a business gets', () => {
  it('is settings, and no longer a door back to the tab that sent you', () => {
    const branch = businessAccount();
    // This page used to open with a large "Manage your business" button
    // pointing at the My business tab - which is the tab whose avatar is the
    // only way in here. Two doors to one room, and the button was the
    // second one. The back gesture is the way back now.
    expect(branch).not.toContain('label="Manage your business"');
    expect(branch).not.toContain("router.navigate('/(tabs)/my-business')");
    // Still not back(): nothing here navigates for you at all.
    expect(branch).not.toContain('router.back()');
    // And it says what it is, under the business name.
    expect(branch).toContain("headerTitle: 'Account'");
  });

  it('shows a business the rules for a business, not the traveler rulebook', () => {
    const branch = businessAccount();
    expect(branch).toContain('BUSINESS_RULE_SECTIONS');
    expect(branch).toContain('BUSINESS_ZERO_TOLERANCE');
    // /guidelines is the traveler rulebook. It describes pins, socials and
    // "your profile", and it bans commercial solicitation, which is the one
    // thing a business account is for.
    expect(branch).not.toContain('/guidelines');
    // Somewhere to write in is what that button was also carrying.
    expect(branch).toContain("router.push('/contact')");
  });

  it('gives deleting an account the weight of deleting an account', () => {
    const branch = businessAccount();
    const danger = branch.indexOf('variant="danger"');
    const label = branch.indexOf('label="Delete account"');
    expect(danger).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(danger);
    // The same button, one prop apart, used to render in accent blue,
    // identical to Sign out directly above it.
    expect(label - danger).toBeLessThan(200);
  });

  it('leaves the app as somebody with no account, once the account is gone', () => {
    const sheet = deleteSheet();
    expect(sheet).toContain('await deleteAccount();');
    expect(sheet).toContain('await signOut()');
    // Both account pages are outside every guard, so each survives the
    // sign-out it fires and would otherwise sit there showing a deleted
    // business's name.
    expect(sheet).toContain("router.replace('/join')");
  });

  /**
   * prof-business-account-order. 73-business-account.png ended at Sign out
   * with Delete account below the visible area, so an owner closing down
   * scrolled past four sections of rulebook to reach the one control App
   * Review 5.1.1(v) requires to be reachable. Orderings are exactly the kind
   * of defect a render test cannot see.
   */
  it('puts the account controls above the reading material', () => {
    const branch = businessAccount();
    const controls = branch.indexOf('<SettingsGroup title="Account">');
    const leaving = branch.indexOf('<SettingsGroup title="Leaving">');
    const remove = branch.indexOf('label="Delete account"');
    const rules = branch.indexOf('BUSINESS_ZERO_TOLERANCE');
    for (const index of [controls, leaving, remove, rules]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect([controls, leaving, remove, rules]).toEqual(
      [controls, leaving, remove, rules].sort((a, b) => a - b)
    );
  });

  it('reads its controls as a row list, the same as the traveler side', () => {
    const branch = businessAccount();
    // Not four identical full-width ghost buttons, which weighted Privacy
    // the same as Sign out.
    expect(branch).not.toContain('variant="ghost"');
    for (const label of [
      'Email and password',
      'Send us a message',
      'Your reports and messages',
      'Privacy',
      'Sign out',
    ]) {
      expect(branch).toContain(`label="${label}"`);
    }
    // The rulebook keeps a heading of its own, or moving it down the page
    // turns it into an unlabelled slab at the bottom.
    expect(branch).toContain('The rules for businesses');
  });
});

/**
 * acct-deleting-asks-who-you-are. An unlocked phone on a hostel table was
 * enough to destroy an account and every chat on both sides of it, including
 * conversations belonging to people who never agreed to lose them.
 */
describe('deleting asks who is holding the phone', () => {
  it('confirms an identity before it deletes anything', () => {
    const sheet = deleteSheet();
    const confirm = sheet.indexOf('confirmIdentity(');
    const remove = sheet.indexOf('await deleteAccount();');
    expect(confirm).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(confirm);
    // And it STOPS rather than carrying on. `toContain('return;')` was the
    // assertion here, and every early return in the file satisfied it - the
    // one thing it could not see was the one thing the test is named for. So
    // the guard is located, and the return has to sit between it and the
    // delete: a reordering that let the check fall through fails here.
    const guard = sheet.indexOf("if (check.outcome !== 'confirmed')", confirm);
    expect(guard).toBeGreaterThan(confirm);
    expect(guard).toBeLessThan(remove);
    const stop = sheet.indexOf('return;', guard);
    expect(stop).toBeGreaterThan(guard);
    expect(stop).toBeLessThan(remove);
  });

  it("does not accuse somebody who backed out of Apple's sheet", () => {
    const sheet = deleteSheet();
    expect(sheet).toContain("if (check.outcome === 'failed')");
    expect(sheet).toContain('That did not check out. Try again.');
  });

  it('asks for a password only where there is one to ask for', () => {
    const sheet = deleteSheet();
    expect(sheet).toContain('identityProofFor(user)');
    expect(sheet).toContain("proof === 'password' ? (");
    // An Apple account has no password of ours at all, so a field would be a
    // form that can never succeed.
    expect(sheet).toContain("proof === 'apple' ?");
  });

  it('asks for the credential the server is going to check, from the same session', () => {
    // The sheet used to decide what to ASK for from the auth store while
    // confirmIdentity decided what to CHECK from supabase.auth.getSession().
    // Two sources for one decision, and where they part the person gets a
    // single confirm with no field on it and a server that wants a password.
    // The store may still seed the first paint; the live session has to
    // supersede it, through the same identityProofFor the checker applies.
    const sheet = deleteSheet();
    const seed = sheet.indexOf('identityProofFor(user)');
    expect(seed).toBeGreaterThan(-1);
    // From the seed onwards, so the sentence in the comment above it that
    // NAMES getSession cannot be what satisfies this.
    const live = sheet.indexOf('.getSession()', seed);
    expect(live).toBeGreaterThan(seed);
    expect(sheet).toContain('setProof(identityProofFor(data.session?.user ?? null))');
    // And it is re-asked when the account's credentials change under it,
    // which is the one moment the two could ever have disagreed.
    expect(sheet.slice(live, live + 700)).toContain('}, [user]);');
  });

  it('asks for the password through a real field on every platform', () => {
    // Alert.prompt exists only on iOS - its Android and web arm is a plain
    // alert with no input at all - and this repo has already paid for that
    // once on the invite paste (features/chat/invite-code-sheet). Comments
    // stripped, the same way invite-exits does it, because both files
    // deliberately NAME the thing they must not use.
    const code = src(ACCOUNT)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('Alert.prompt');
    expect(code).not.toContain('Platform.OS');
    expect(code).toContain('<FormTextField');
  });

  it('closes every exit while the delete is actually running, Cancel included', () => {
    // The scrim and the pull-down were already guarded. Cancel was not, and
    // it calls onClose directly: press it mid-delete and the sheet unmounts,
    // the owner is back on their account page believing they backed out, and
    // a second later remove() finishes and signs them out with the account
    // and both sides of every chat gone. Nothing aborts an Edge Function that
    // is already emptying storage buckets, so the only honest answer is to
    // stop offering a way out once it has started.
    const sheet = deleteSheet();
    expect(sheet).toContain('label="Cancel" disabled={busy}');
    expect(sheet).toContain('onCloseRequest={busy ? () => {} : onClose}');
  });

  it('dismisses the sheet before it navigates out from under it', () => {
    // router.replace from inside a presented Sheet leaves the full-screen
    // scrim on the screen and every tap afterwards lands on an invisible
    // overlay. leavingSheet owns both the rule and the timing.
    const sheet = deleteSheet();
    expect(sheet).toContain('leavingSheet(onClose)');
  });
});

describe('the rules a business is shown', () => {
  const policies = src('src/constants/policies.ts');

  it('exist as their own text', () => {
    expect(policies).toContain('export const BUSINESS_RULE_SECTIONS');
    expect(policies).toContain('export const BUSINESS_ZERO_TOLERANCE');
  });

  it("say the thing rule 8 says, in a business owner's words", () => {
    const business = policies.slice(policies.indexOf('BUSINESS_ZERO_TOLERANCE'));
    expect(business).toContain('Travelers write first');
    expect(business).toContain('cannot join a traveler plan or another business chat');
    // The traveler line that reads as banning what a business is here to do.
    expect(business).not.toContain('commercial solicitation');
  });
});

describe('the header avatar', () => {
  const avatar = src('src/components/ui/avatar-button.tsx');

  it('gives a business its own face and its own label', () => {
    expect(avatar).toContain('useOwnBusiness');
    expect(avatar).toContain('useBusinessPhotoUrl');
    expect(avatar).toContain("accessibilityLabel={business ? 'Your business' : 'Your profile'}");
    // Its name when it has no cover photo yet, because profile_photos is a
    // table a business can never have a row in.
    expect(avatar).toContain('business?.name.trim().charAt(0).toUpperCase()');
  });
});

describe('the My business tab', () => {
  const code = src(MY_BUSINESS);

  it('has a way to move the marker and change the city', () => {
    const row = code.indexOf('label="Where you are"');
    expect(row).toBeGreaterThan(-1);
    // The editor already holds all three (business-edit's location section),
    // and update_business_location is granted to the owner. What was missing
    // was any way in.
    expect(code.slice(row, row + 400)).toContain('section="location"');
  });

  it("puts the next real step in the screen's biggest button", () => {
    expect(code).toContain('primaryLabel={next.label}');
    expect(code).toContain("label: 'Confirm your email',");
    expect(code).toContain("label: 'Post something',");
    // The composer promises the map, so it cannot be the permanent primary
    // action of a listing that is not on it.
    const unconfirmed = code.indexOf("business.state === 'unconfirmed'\n      ? {");
    const post = code.indexOf("label: 'Post something',");
    expect(unconfirmed).toBeGreaterThan(-1);
    expect(unconfirmed).toBeLessThan(post);
  });

  it('does not claim a code has just been sent', () => {
    expect(code).toContain("Travelers can't find you until you confirm your business email.");
    expect(code).toContain('The code we sent has run out.');
    expect(code).toContain('useCodeRunOut');
    // The old sentence, which was still on the screen days later.
    expect(code).not.toContain('We sent a code to your business email');
  });

  it('has a route to the account controls', () => {
    // 'House rules and account', decision D32: the rulebook has one name in
    // every user-facing string, and this row leads with it.
    const row = code.indexOf('label="House rules and account"');
    expect(row).toBeGreaterThan(-1);
    expect(code.slice(row, row + 400)).toContain("router.push('/profile-me')");
  });

  it('asks a business about notifications, at the moment travelers can write in', () => {
    expect(code).toContain("askBusiness('listing-live')");
    expect(code).toContain('Travelers can write to you now');
    // Only when the listing is actually live, and only on the tab that is
    // being looked at.
    expect(code).toContain(
      "const live = business != null && business.state === 'listed' && business.active;"
    );
    expect(code).toContain('if (!focused || !live || asked.current)');
  });
});

describe('the notification primer', () => {
  const store = src('src/features/notifications/primer-store.ts');

  it('has a reason a business can reach', () => {
    expect(store).toContain("export type BusinessPrimerReason = 'listing-live';");
    expect(store).toContain('askBusiness: (reason: BusinessPrimerReason) => Promise<boolean>;');
  });

  it('does not raise the traveler sheet to ask it', () => {
    // push-primer.tsx keys its copy on PrimerReason and speaks to travelers
    // ("Want to know when they answer?"). A business is asked on its own
    // screen instead, so the sheet's slot stays a traveler's. PrimerReason
    // grew a third traveler moment when the primer learned to ask twice;
    // what must never happen is 'listing-live' joining it.
    expect(store).toContain(
      "export type PrimerReason = 'hello-sent' | 'pin-posted' | 'hello-received';"
    );
    expect(store.slice(0, store.indexOf('BusinessPrimerReason'))).not.toContain('listing-live');
    const askBusiness = store.slice(store.indexOf('askBusiness: async'));
    expect(askBusiness.slice(0, 400)).toContain('set({ asking: reason });');
  });
});

/**
 * The three things biz-my-business-worth-opening and biz-share-your-listing
 * put on the tab, pinned as source shape for the same reason as everything
 * above it: these are orderings and absences, and an assertion about a
 * rendered tree would not catch either.
 */
describe('My business is worth opening on a Tuesday', () => {
  it('orders Your details by what each one does to the listing', () => {
    const code = src(MY_BUSINESS);
    const at = (label: string) => code.indexOf(`label="${label}"`);
    // Where you are stays first: a listing on the wrong door is not a
    // listing. Then photos (the cover a traveler decides on), hours (the
    // question they opened the page to answer), description, links.
    const order = ['Where you are', 'Photos', 'Hours', 'Description', 'Links'].map(at);
    order.forEach((index) => expect(index).toBeGreaterThan(-1));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('says what filling a row buys instead of four shrugs', () => {
    const code = src(MY_BUSINESS);
    // The whole defect: four rows reading the same two words, telling an
    // owner who just signed up that this screen is a list of failures.
    // The fallbacks themselves, not the prose about them: both comments
    // above still quote the old string to say what it was.
    expect(code).not.toContain(": 'Nothing yet'");
    expect(code).not.toContain("?? 'Nothing yet'");
    expect(code).toContain('Add photos so you have a cover');
    expect(code).toContain('Add hours so travelers know when to come');
    expect(code).toContain('Say what it is like');
    expect(code).toContain('A menu, a booking page, your socials');
    // 'No address yet' is kept as it was: there is no version of an address
    // that is partly filled in.
    expect(code).toContain('No address yet');
  });

  it('gives the five rows a finish line', () => {
    const code = src(MY_BUSINESS);
    expect(code).toContain('of 5 done');
    expect(code).toContain('detailsDone({');
  });

  it('builds How it is going from the two numbers already on the screen', () => {
    const code = src(MY_BUSINESS);
    expect(code).toContain('title="How it\'s going"');
    expect(code).toContain('weekLine({ chatsThisWeek, memberCount:');
    // Conversations, never senders. The rating block's own comment records
    // the anti-retaliation control; a line naming a traveler one section
    // above it would undo that control from next door.
    const section = code.slice(code.indexOf("How it's going"), code.indexOf('title="Your rating"'));
    expect(section).not.toMatch(/user_id|sender|other_user/);
  });

  it('reads the clock once per data change, not once per render', () => {
    const code = src(MY_BUSINESS);
    // Same shape as hoursLine directly above it. The counting itself lives in
    // vocabulary.countChatsSince, which takes the clock as an argument - a
    // Date.now() inside the memo is both untestable and a number that moves
    // under a re-render.
    expect(code).toContain('countChatsSince(chats, new Date())');
    // Scoped to this memo, not the file: the code-delivery countdown at the
    // top legitimately reads Date.now() inside an interval, which is a
    // different thing from reading it during render.
    const memo = code.slice(code.indexOf('const chatsThisWeek'), code.indexOf('useEffect('));
    expect(memo).not.toContain('Date.now()');
    // And it is hoisted above every early return: the tab has three of them
    // (error, pending, no business), and a hook below one of those is the
    // crash this repo has already paid for once.
    expect(code.indexOf('countChatsSince')).toBeLessThan(code.indexOf('if (ownQuery.isError)'));
  });

  it('offers the listing as a link and as a square, with the square closed', () => {
    const code = src(MY_BUSINESS);
    expect(code).toContain('title="Share your page"');
    expect(code).toContain('shareListing({ id: business.id, name: business.name })');
    expect(code).toContain('<ShareLink');
    // Closed by default: a 200pt square on every open pushes the account
    // rows below the fold for everybody, to serve the counter case.
    expect(code).toContain('useState(false)');
    expect(code).toContain('qrOpen ? (');
    // Above the account section, which is where the spec puts it and where
    // an owner looking for "how do I show people this" would look.
    expect(code.indexOf('title="Share your page"')).toBeLessThan(
      code.indexOf('title="Your account"')
    );
  });
});

/**
 * The two halves of this batch that landed in nobody's file list, found by
 * the review pass rather than by a screen: my-business.tsx was not in any
 * implementer's ownership block, so the second half of
 * biz-photo-grid-in-place and the entire entry point for
 * biz-post-edit-and-repeat were written nowhere.
 */
describe('the owner sees their own listing, not the public read of it', () => {
  it('counts the photos the owner can see', () => {
    const code = src(MY_BUSINESS);
    // business_detail filters to moderation_status = 'approved'. With
    // require_photo_moderation on - which is how production runs - an owner
    // adds a cover, sees it chipped "In review" one tap away in the editor,
    // and comes back to a screen telling them to add photos. This batch made
    // that worse before it fixed it: the row now reads "Add photos so you
    // have a cover" and the counter scores it 0, so the lie was stated twice
    // and quantified.
    expect(code).toContain('useBusinessPhotos(business?.id ?? null)');
    expect(code).toContain('const photos = ownPhotos ?? detail?.photos ?? []');
  });

  it('still shows the public cover at the top, because that is what a traveler sees', () => {
    const code = src(MY_BUSINESS);
    // The hero image is the one honest use of the approved-only read on this
    // screen: it is a photograph of what a stranger gets.
    expect(code).toContain('useBusinessPhotoUrl(detail?.photos[0]?.storage_path ?? null)');
  });
});

describe('a post can be fixed and put up again', () => {
  it('has an entry point at all', () => {
    const code = src(MY_BUSINESS);
    // business-post.tsx has supported both since biz-post-edit-and-repeat -
    // postId opens a post to be fixed, postId + again copies its words onto a
    // new row - but nothing in the app navigated to it with either param, so
    // the screen was reachable only as a blank composer and every string
    // written for the other two paths was dead code.
    expect(code).toContain('params: { postId: post.id }');
    expect(code).toContain("params: { postId: post.id, again: '1' }");
  });

  it('keeps taking it down the only destructive choice', () => {
    const code = src(MY_BUSINESS);
    expect(code).toContain("{ text: 'Fix it', onPress: onFix }");
    expect(code).toContain("{ text: 'Put it up again', onPress: onAgain }");
    expect(code).toContain("{ text: 'Take it down', style: 'destructive', onPress: onTakeDown }");
    // And the card says all three, so the label is not a lie about what a tap
    // will offer.
    expect(code).toContain('Fix it, put it up again, or take it down.');
  });
});
