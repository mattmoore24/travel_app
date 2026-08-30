import fs from 'node:fs';
import path from 'node:path';

import { WEB_ORIGIN, WebLinks } from '@/constants/links';

/**
 * An invite is the one thing this app produces for somebody who does not have
 * it yet. Three separate things have to agree for that to work, and each has
 * been wrong on its own: the URL the app builds, the host it points at, and
 * whether the route tree answers the path the association file promises iOS.
 *
 * Comments are stripped before scanning, same as invite-exits.test.ts, so a
 * screen's prose can name the things it is ruling out.
 */
const APP = path.join(__dirname, '..');
const read = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(APP, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('an invite survives leaving the app', () => {
  it('is an https link, because the recipient has no app to open a scheme with', () => {
    const code = read('group', '[id].tsx');
    expect(code).toContain('WebLinks.invite(token)');
    expect(code).not.toContain('Linking.createURL');
  });

  it('points at the host the pages and the association file are served from', () => {
    expect(WEB_ORIGIN).toBe('https://link.samewhere.io');
    expect(WebLinks.invite('abc123')).toBe('https://link.samewhere.io/i/abc123');
  });

  it('answers the path in the app as well as on the web', () => {
    // Without this route the same URL opens the app and lands on +not-found,
    // which tells the reader the invite expired. It did not. It is the join
    // screen itself rather than a redirect to it: a router.replace from a
    // focus effect is exactly what the root hold loses when it unmounts the
    // stack, and a route that IS the destination cannot be lost that way.
    expect(read('i', '[token].tsx')).toContain("export { default } from '../join-group/[token]'");
  });

  it('gives the https spelling of the invite the same chrome as the scheme one', () => {
    // Root screenOptions are headerShown: false. An invite arriving on a
    // first launch has no tab bar, so the header IS the back chevron.
    expect(read('_layout.tsx')).toMatch(/name="i\/\[token\]"\s*options=\{\{ headerShown: true/);
  });

  it('offers the paste-a-code way in to somebody with no account', () => {
    // web/i/index.html sends a fresh installer to Chat, then Groups, then
    // "Have an invite?". A fresh installer has no account, so they are a
    // guest, and the guest branch of the Chat tab returns early — the row
    // has to be in both branches or the page's instruction is false for the
    // one person it was written for.
    const code = read('(tabs)', 'chat.tsx');
    expect((code.match(/onPress=\{promptForInvite\}/g) ?? []).length).toBe(2);
  });

  it('promises iOS nothing the route tree cannot answer', () => {
    // Every entry here is a URL space claimed for the life of every install.
    // Adding one means adding a route under src/app in the SAME commit.
    const aasa = JSON.parse(
      fs.readFileSync(
        path.join(APP, '..', '..', 'web', '.well-known', 'apple-app-site-association'),
        'utf8'
      )
    );
    const details = aasa.applinks.details[0];
    expect(details.appIDs).toEqual(['9GSR77B4U5.com.mattmoore.samewhere']);
    expect(details.components.map((c: Record<string, string>) => c['/'])).toEqual(['/i/*']);
  });

  it('claims the domain the pages are actually served from', () => {
    const appConfig = JSON.parse(fs.readFileSync(path.join(APP, '..', '..', 'app.json'), 'utf8'));
    expect(appConfig.expo.ios.associatedDomains).toEqual(['applinks:link.samewhere.io']);
  });
});
