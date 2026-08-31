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

describe('the account page a business gets', () => {
  it('goes to the My business tab it names, rather than back to wherever you came from', () => {
    const branch = businessAccount();
    expect(branch).toContain('label="Manage your business"');
    expect(branch).toContain("router.navigate('/(tabs)/my-business')");
    // The old shape: back(), which returned an owner who came from Chat to
    // Chat, and never once opened the tab the button is named after.
    expect(branch).not.toContain('router.back()');
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
    const branch = businessAccount();
    expect(branch).toContain('await deleteAccount();');
    expect(branch).toContain('await signOut()');
    // This page is outside every guard, so it survives the sign-out it fires
    // and would otherwise sit there showing a deleted business's name.
    expect(branch).toContain("router.replace('/join')");
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
    // screen instead, so the sheet's slot stays a traveler's.
    expect(store).toContain("export type PrimerReason = 'hello-sent' | 'pin-posted';");
    const askBusiness = store.slice(store.indexOf('askBusiness: async'));
    expect(askBusiness.slice(0, 400)).toContain('set({ asking: reason });');
  });
});
