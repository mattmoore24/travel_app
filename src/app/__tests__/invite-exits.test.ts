import fs from 'node:fs';
import path from 'node:path';

/**
 * An invite link is very often somebody's FIRST launch of this app, and that
 * makes it the one route in the app that cannot assume a stack underneath it.
 *
 * A cold-start deep link builds a navigation state containing only the linked
 * route. With no anchor declared there is no tab bar, no back chevron, and
 * `router.back()` dispatches a GO_BACK that no navigator handles — silently,
 * with nothing thrown and nothing logged. The founder's report was that the
 * link "crashed the first time then worked the second time": the second tap
 * came in warm, on a running app that already had the tabs mounted.
 *
 * These are source assertions rather than renders because what is being
 * guarded is structural — which screens declare a way out at all. A render
 * test can only reach the branch it is set up for, and it is the branch
 * nobody set up that strands somebody.
 *
 * Comments are stripped before scanning so this file's prose, and the
 * screens', can name the things they are ruling out.
 */
const source = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a cold-start invite has somewhere to go', () => {
  it('declares the tabs as the stack anchor', () => {
    // Without this, every deep link opened from a cold start is alone in the
    // navigator and every back path in the app below is dead.
    expect(source('_layout.tsx')).toMatch(/unstable_settings = \{ anchor: '\(tabs\)' \}/);
  });

  it('never leaves a bare router.back() as the only exit on the invite', () => {
    const code = source('join-group', '[token].tsx');
    expect(code).toContain("router.canGoBack() ? router.back() : router.replace('/(tabs)')");
    expect(code).not.toMatch(/onPress=\{\(\) => router\.back\(\)\}/);
  });

  it('offers a way past every terminal branch of the invite', () => {
    const code = source('join-group', '[token].tsx');
    // Expired link, ended chat, already a member, signed out, and the join
    // form itself: five dead ends, five marked exits.
    expect((code.match(/onPress=\{leave\}/g) ?? []).length).toBe(4);
    expect(code).toContain('onClose={leave}');
  });

  it('does not hold a blank screen when the link carries no token', () => {
    // The query is disabled without one, so isPending never resolves and the
    // pending branch used to paint an empty screen forever.
    expect(source('join-group', '[token].tsx')).toContain('if (preview.isPending && token)');
  });

  it('carries the invite through sign-up rather than dropping it', () => {
    expect(source('join-group', '[token].tsx')).toContain('onNavigate={leaveForAccount}');
    expect(source('(tabs)', '_layout.tsx')).toContain('PendingInviteHandoff');
  });

  it('returns a new guest to the screen that asked for their name', () => {
    // `router.replace(next)` pushed a SECOND copy of the invite over the
    // first, which is why picking one of the two doors made the other
    // unreachable.
    const code = source('guest-name.tsx');
    expect(code).toContain('if (router.canGoBack()) {\n        router.back();');
    expect(code).toContain('onClose=');
  });
});
