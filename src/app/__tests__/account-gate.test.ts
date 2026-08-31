import fs from 'node:fs';
import path from 'node:path';

import { gateCopy } from '@/features/auth/gate-copy';

/**
 * The one screen a suspended or closed account can reach.
 *
 * docs/legal/COMMUNITY_GUIDELINES.md promises an appeal "from Contact us in
 * the app, which is open even when you cannot sign in", and the app had
 * hidden exactly that from exactly that person: `guidelines` and `contact`
 * are declared inside the <Stack> the gate is returned INSTEAD OF, so a
 * router.push from the gate is a silent no-op. So half of this file is about
 * the words and half is about the mechanism, and the mechanism half has to be
 * a source assertion: no render test can see that a push would have gone
 * nowhere, because in a test there is no navigator either way.
 */

const source = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

/** The gate component, comments stripped, so a comment cannot pass a test. */
const gateSource = (): string => {
  const layout = source('_layout.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const from = layout.indexOf('function AccountGate(');
  const to = layout.indexOf('function RootNavigator(');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return layout.slice(from, to);
};

describe('what the gate says', () => {
  it('uses the same words as the notification the person just got', () => {
    // The push titles are in
    // supabase/migrations/20260901130000_a_notice_says_where_to_go.sql. Two
    // names for one event reads as two events.
    expect(gateCopy('suspended', null).title).toBe('Account paused');
    expect(gateCopy('banned', null).title).toBe('Account closed');
  });

  it('names the way back, and the window the legal documents promise', () => {
    for (const status of ['suspended', 'banned']) {
      const copy = gateCopy(status, null);
      expect(copy.body).toContain('Appeal this');
      expect(copy.body).toContain('30 days');
    }
  });

  it('still says when a pause ends, when there is an end date', () => {
    const copy = gateCopy('suspended', '2026-09-08T10:00:00.000Z');
    expect(copy.body).toContain('paused until');
    // And says nothing false when there is not one.
    expect(gateCopy('suspended', null).body).not.toContain('until');
  });

  it('pre-fills an appeal that says which decision it is about', () => {
    expect(gateCopy('suspended', null).appeal).toBe('Appeal: account paused');
    expect(gateCopy('banned', null).appeal).toBe('Appeal: account closed');
  });

  it('carries no em dash and none of the banned vocabulary', () => {
    const lines = ['suspended', 'banned'].flatMap((status) => {
      const copy = gateCopy(status, '2026-09-08T10:00:00.000Z');
      return [copy.title, copy.body, copy.appeal];
    });
    expect(lines.filter((line) => line.includes('—'))).toEqual([]);
    expect(
      lines.filter((line) => /\b(swipe|deck|match|unmatch(?:ed)?|request)\b/i.test(line))
    ).toEqual([]);
  });
});

describe('how the gate gets there', () => {
  it('offers the rules and an appeal, not only a sign out', () => {
    const gate = gateSource();
    expect(gate).toContain('label="Read the house rules"');
    expect(gate).toContain('label="Appeal this"');
    expect(gate).toContain('label="Sign out"');
  });

  it('switches view instead of navigating, because there is no navigator', () => {
    const gate = gateSource();
    expect(gate).toContain("setView('rules')");
    expect(gate).toContain("setView('appeal')");
    // The bug this whole package is about: a push from here does nothing.
    expect(gate).not.toContain('router.');
  });

  it('renders the same two components the routed screens do', () => {
    const gate = gateSource();
    expect(gate).toContain('<GuidelinesBody');
    expect(gate).toContain('<ContactForm');
    // And every view has a way back to the gate, or it is a dead end with no
    // back chevron anywhere on screen.
    expect(gate.match(/setView\('gate'\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('gives the appeal form the top inset that a Stack route would have', () => {
    // StepScreen's SafeAreaView is edges={['bottom']} because every other
    // thing that renders one is a modal route with a native header over it.
    // The gate is returned INSTEAD OF the Stack, so there is neither, and the
    // form drew its title under the status bar and into the notch.
    const gate = gateSource();
    const appeal = gate.slice(gate.indexOf("view === 'appeal'"), gate.indexOf('<ContactForm'));
    expect(appeal).toContain("edges={['top']}");
    // And only the top: the bottom is StepScreen's, where its Send sits.
    expect(appeal).not.toContain("'bottom'");
  });

  it('scrolls, so the appeal button cannot fall off the bottom of it', () => {
    // A title, a paragraph and three buttons in a centred column that did not
    // scroll. At the larger Dynamic Type sizes Appeal this left the screen
    // with no way to reach it, on the one screen whose entire purpose is
    // being able to press it.
    const layout = source('_layout.tsx');
    expect(layout).toContain('<ScrollView contentContainerStyle={styles.errorScroll}>');
    expect(layout).toMatch(
      /errorScroll: \{\s*flexGrow: 1,\s*alignItems: 'stretch',\s*justifyContent: 'center',/
    );
    // Shared with AccountLoadError, which is the same column and grew the
    // same way.
    expect(layout.match(/<CenteredPage>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the extracted bodies free of the router they cannot use', () => {
    const support = (name: string) =>
      fs.readFileSync(path.join(__dirname, '..', '..', 'features', 'support', name), 'utf8');
    for (const name of ['guidelines-body.tsx', 'contact-form.tsx']) {
      expect(support(name)).not.toContain('expo-router');
    }
  });
});
