import fs from 'node:fs';
import path from 'node:path';
import { between } from '@/lib/__tests__/source';

/**
 * The list has to be reachable, and it has to reach something.
 *
 * This is the failure this project keeps paying for: a screen with no entry
 * point, a component mounted nowhere, a column the server stamps that no
 * client reads. A muted-word table with an editor nobody can find, or an
 * editor whose words nothing consults, is that failure again with a migration
 * attached. So both ends are asserted here by reading the source, because
 * what is being checked is that three files agree and no runtime test in this
 * repo mounts all three.
 *
 * The other half is the promise the fold must not break. Nothing about it may
 * reach the sender, and the reader must keep every answer they had before it:
 * the profile, the report link, Decline and Accept.
 */
const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

describe('the way in', () => {
  it('has a screen at the route the settings row names', () => {
    expect(fs.existsSync(path.join(REPO, 'src', 'app', 'muted-words.tsx'))).toBe(true);
  });

  it('is offered beside the house rules, which is the other line a person is held to', () => {
    const profile = src('src/app/profile-me.tsx');
    // The traveler's group, not the business account's: profile-me renders
    // two settings spines from one file, and the business one comes first.
    const start = profile.indexOf('<SettingsGroup title="Help and rules">');
    const group = profile.slice(start, profile.indexOf('</SettingsGroup>', start));
    expect(start).toBeGreaterThan(-1);
    expect(group).toContain('label="House rules and help"');
    expect(group).toContain('label="Words you would rather not see"');
    expect(group).toContain("router.push('/muted-words')");
  });

  it('is NOT hung off the visibility screen, whose header promises it does nothing to chat', () => {
    const visibility = src('src/app/visibility.tsx');
    expect(visibility).not.toContain('muted-words');
    expect(visibility).not.toContain('matchesMutedWord');
  });

  it('speaks the row by the name printed on it, so a flow can address what it shows', () => {
    // A Pressable carrying its own accessibilityLabel collapses to a single
    // element on iOS and its children stop being elements at all, so the
    // words on the row are addressable ONLY as that label. It used to be
    // label, detail and value joined into one sentence, which meant no test
    // and no flow could ask for the row by the name it prints. Every fact is
    // still spoken; the value carries the ones that are not the name.
    const account = src('src/app/profile-me.tsx');
    const row = between(account, 'function SettingsRow(', 'function SettingsGroup(');
    expect(row).toContain('accessibilityLabel={label}');
    expect(row).not.toContain('[label, detail, value].filter(Boolean).join');
  });
});

/**
 * The route half. /muted-words was the only real route file in src/app/ that
 * the root layout did not name, and expo-router appends those rather than
 * refusing them: it rendered outside every guard, with the root's
 * `headerShown: false` and a card presentation, which is a full-bleed page
 * under the Dynamic Island with no header, no back chevron and no Close on
 * it. This repo paid for that exact defect on /my-reports one batch ago, so
 * the registration is asserted here rather than left to be found a third
 * time.
 */
describe('the route the row names', () => {
  const layout = src('src/app/_layout.tsx');

  it('is declared, so it gets the modal chrome every sibling on this spine has', () => {
    expect(layout).toContain(
      '<Stack.Screen name="muted-words" options={{ presentation: \'modal\' }} />'
    );
  });

  it('is declared inside the guard blocked and visibility sit behind', () => {
    const start = layout.indexOf('<Stack.Protected guard={signedIn && onboarded}>');
    expect(start).toBeGreaterThan(-1);
    const guarded = layout.slice(start, layout.indexOf('</Stack.Protected>', start));
    expect(guarded).toContain('name="muted-words"');
    expect(guarded).toContain('name="blocked"');
    expect(guarded).toContain('name="visibility"');
  });

  it('and the row is hidden from the accounts that guard shuts out', () => {
    // `onboarded` is false for an account part way through listing a
    // business, and that account lands on the traveler settings spine. An
    // ungated row would push a route the navigator does not have and do
    // nothing at all, which is the bug /blocked above it already carries the
    // fix for.
    const account = src('src/app/profile-me.tsx');
    const row = account.indexOf('label="Words you would rather not see"');
    expect(row).toBeGreaterThan(-1);
    expect(account.slice(row - 300, row)).toContain(
      'profile.onboarding_completed_at == null ? null : ('
    );
  });

  it('has a visible way out, not only a swipe down nothing on it mentions', () => {
    expect(src('src/app/muted-words.tsx')).toContain('onClose={close}');
  });
});

/**
 * Four sentences on this screen, each of which has to be true of the code
 * under it. A control says exactly what happens.
 */
describe('what the screen says about itself', () => {
  const screenSource = src('src/app/muted-words.tsx');

  it('does not promise a whole-word match to somebody whose script it cannot segment', () => {
    // True in Latin, Greek and Cyrillic and the exact opposite of what
    // happens in Thai, Chinese, Japanese, Korean, Arabic, Hebrew and
    // Devanagari, where the matcher falls through to a bare substring. This
    // is an app for international travelers.
    expect(screenSource).not.toContain(
      'Matched whole, so a word inside a longer one is left alone.'
    );
    expect(screenSource).toContain('In scripts without capital letters');
  });

  it('says where the fold stops, rather than letting somebody find out', () => {
    expect(screenSource).toContain('The fold is only on the way in');
  });

  it('and that sentence is true: nothing after the accept consults the list', () => {
    // The fold lives on the incoming card and nowhere else. Once a hello is
    // accepted the same words render unfolded in the thread and in the chat
    // list preview, neither of which asks the matcher anything. If that ever
    // changes, this fires and the subtitle above gets revisited rather than
    // quietly becoming an understatement.
    expect(src('src/app/chat/[id].tsx')).not.toContain('matchesMutedWord');
    expect(src('src/features/chat/chat-row.tsx')).not.toContain('matchesMutedWord');
  });

  it('explains the length ceiling where it bites, instead of a branch that cannot run', () => {
    // maxLength caps the field at MUTED_WORD_MAX, so normalizeMutedWord can
    // never answer null for length and the "keep it to 40 characters" error
    // was unreachable - while the truncation it described happened in
    // silence.
    expect(screenSource).not.toContain('Keep it to ${MUTED_WORD_MAX} characters.');
    expect(screenSource).toContain('That is as long as one entry gets.');
  });
});

describe('the way out', () => {
  const card = src('src/features/matching/incoming-request-card.tsx');

  it('is consulted where a first message is actually rendered', () => {
    // One render site serves both the inbox and /first-messages, so folding
    // here is folding on both. A copy of this logic in the chat tab only
    // would leave the "waiting on you" screen unfolded, which is where the
    // helloes go the moment there are more than two of them.
    expect(card).toContain("from '@/features/profile/muted-words'");
    expect(card).toContain('matchesMutedWord(request.first_message');
  });

  it('leaves every answer the reader had, so a fold is never a decision', () => {
    expect(card).toContain('Does this feel off? Tell us.');
    expect(card).toContain('label="Decline"');
    expect(card).toContain('label="Accept"');
    expect(card).toContain("View ${request.display_name ?? 'traveler'}'s full profile");
  });

  it('tells the sender nothing: no write, no state, no verdict on the folded path', () => {
    // The one invariant this feature may not break, so the cut has to be
    // proven before the absence is asserted. The anchor used to be
    // `{mutedBy != null ? (` and a later round put `{checkingList ? (` in
    // front of it, which turned the opening brace into `) : ` — indexOf
    // answered -1, the slice collapsed to '', and this assertion passed
    // against an empty string for a whole round. `between` throws on a
    // missing anchor now, and the two lines below say out loud that what was
    // cut out is the fold and not nothing.
    const folded = between(card, 'mutedBy != null ? (', '      ) : (');
    expect(folded).toContain('This uses a word on your list: {mutedBy}');
    expect(folded).toContain('Show what they wrote');
    expect(folded).not.toMatch(/mutate|rpc|supabase|respond\./);
  });
});
