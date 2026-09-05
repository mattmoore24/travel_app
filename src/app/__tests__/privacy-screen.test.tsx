import { render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';

import PrivacyScreen from '@/app/privacy';
import { GUIDELINE_SECTIONS, PRIVACY_SECTIONS } from '@/constants/policies';

/**
 * The privacy screen is the 5.1.1(i) surface: App Review wants the policy
 * readable inside the app, and the person who most needs it is a guest being
 * asked to agree before an account exists. So this file pins three things a
 * refactor could quietly break: that the screen renders the sections at all,
 * that the location denial is the first thing under the promise rather than
 * page two, and that the bundled summary is still anchored to the long-form
 * document it claims to summarise.
 */

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

const ROOT = path.join(__dirname, '..', '..', '..');
const source = (...segments: string[]) =>
  fs.readFileSync(path.join(ROOT, 'src', 'app', ...segments), 'utf8');

describe('the privacy screen', () => {
  it('leads with the promise and then the section that denies the collection', () => {
    render(<PrivacyScreen />);
    expect(
      screen.getByText(
        'We never collect your location. The map only shows plans people typed in themselves.'
      )
    ).toBeTruthy();
    // Not "a do-not-collect section exists somewhere": it has to be the
    // first one, because the strongest sentence in a policy nobody reads to
    // the end belongs at the top.
    expect(PRIVACY_SECTIONS[0].title).toBe('What we never collect');
    expect(screen.getByText(PRIVACY_SECTIONS[0].title)).toBeTruthy();
    expect(screen.getByText(PRIVACY_SECTIONS[0].body)).toBeTruthy();
  });

  it('renders every section it was given', () => {
    render(<PrivacyScreen />);
    for (const section of PRIVACY_SECTIONS) {
      expect(screen.getByText(section.title)).toBeTruthy();
    }
  });

  it('offers the house rules and a way to reach a person', () => {
    render(<PrivacyScreen />);
    expect(screen.getByText('House rules')).toBeTruthy();
    expect(screen.getByText('Read the house rules')).toBeTruthy();
    expect(screen.getByText('Send us a message')).toBeTruthy();
  });
});

describe('the bundled policy text', () => {
  it('has both rulebooks in it', () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThan(0);
    expect(GUIDELINE_SECTIONS.length).toBeGreaterThan(0);
  });

  it('keeps the meeting-safety advice the source document has', () => {
    const guidelines = fs.readFileSync(
      path.join(ROOT, 'docs', 'legal', 'COMMUNITY_GUIDELINES.md'),
      'utf8'
    );
    const meeting = GUIDELINE_SECTIONS.find((s) => s.title === 'Meeting up');
    expect(meeting).toBeDefined();
    expect(meeting?.body).toContain('public places');
    // The source document is where the advice came from, and it dropped out
    // of the app once already.
    expect(guidelines).toContain('Make plans in public places');
  });

  it('summarises headings that actually exist in the long-form policy', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'PRIVACY_POLICY.md'), 'utf8');
    const headings = new Set(
      policy
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3).trim())
    );
    const orphans = PRIVACY_SECTIONS.filter((section) => !headings.has(section.source)).map(
      (section) => `${section.title} -> ${section.source}`
    );
    expect(orphans).toEqual([]);
  });

  it('still carries the promises the policy is judged on', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'docs', 'legal', 'PRIVACY_POLICY.md'), 'utf8');
    expect(policy).toContain('Your device location. Never.');
    expect(policy).toContain('72 hours');
    expect(policy).toContain('biometric');
    expect(policy).toContain('Anthropic');
  });
});

describe('the route declaration', () => {
  it('declares privacy outside every guard, so a signed-out reader can open it', () => {
    const layout = source('_layout.tsx');
    const declaration = '<Stack.Screen name="privacy"';
    const at = layout.indexOf(declaration);
    expect(at).toBeGreaterThan(-1);
    // Count the guards opened and closed before the declaration: if they
    // balance, it is not inside one. This is the shape invite-exits already
    // uses, and it is what a signed-out consent line depends on.
    const before = layout.slice(0, at);
    const opened = (before.match(/<Stack\.Protected/g) ?? []).length;
    const closed = (before.match(/<\/Stack\.Protected>/g) ?? []).length;
    expect(opened).toBe(closed);
  });

  it('gives the guidelines and privacy screens the same treatment', () => {
    const layout = source('_layout.tsx');
    expect(layout).toContain(
      '<Stack.Screen name="guidelines" options={{ presentation: \'modal\' }} />'
    );
    expect(layout).toContain(
      '<Stack.Screen name="privacy" options={{ presentation: \'modal\' }} />'
    );
  });
});

/**
 * The profile page is THREE pages - a guest's, a business's and a traveler's -
 * and App Review is told the policy is one tap from it. That was true of two
 * of them: the business account had 'Send us a message' and no route to
 * /privacy at all, so an owner (or a reviewer signed in on the business demo
 * account, looking for 5.1.1(i)) reached a dead end. A source scan rather
 * than a render, because rendering the traveler branch means standing up the
 * whole profile query stack, and what is being pinned is a route.
 */
describe('every variant of the profile page', () => {
  it('offers the privacy policy, whichever of the three you are', () => {
    const page = source('profile-me.tsx');
    const at = (marker: string) => {
      const index = page.indexOf(marker);
      expect(index).toBeGreaterThan(-1);
      return index;
    };
    const guest = at('function GuestProfile');
    const business = at('function BusinessAccount');
    const traveler = at('export default function ProfileScreen');
    const variants: [string, string][] = [
      ['guest', page.slice(guest, business)],
      ['business', page.slice(business, traveler)],
      ['traveler', page.slice(traveler)],
    ];
    for (const [name, body] of variants) {
      expect([name, body.includes("router.push('/privacy')")]).toEqual([name, true]);
    }
  });
});

describe('the consent line', () => {
  it('links both documents from the moment somebody is asked to agree', () => {
    const note = fs.readFileSync(
      path.join(ROOT, 'src', 'features', 'auth', 'consent-note.tsx'),
      'utf8'
    );
    expect(note).toContain("router.push('/guidelines')");
    expect(note).toContain("router.push('/privacy')");
    // Both spans keep the role, or VoiceOver cannot land on either.
    expect((note.match(/accessibilityRole="link"/g) ?? []).length).toBe(2);
  });
});
