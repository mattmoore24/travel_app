import { after, between, source } from '@/lib/__tests__/source';

/**
 * ds-stack-header, as a contract over the root navigator.
 *
 * Seven pushed routes used to set `headerTitle: ''` and each screen then
 * drew its own title under the lone back chevron. The package's answer is
 * one of two mechanisms per route, and this pins which route uses which:
 *
 * - a STATIC title on the route in _layout, where the screen has one name
 *   (archived-chats, first-messages, both spellings of the invite);
 * - a title set FROM THE SCREEN once its query lands, where the name does
 *   not exist before that (place/[id], profile/[userId]); the layout's ''
 *   is then the pre-resolve placeholder, and the screen must not set
 *   anything until it has the name;
 * - profile-me, which already named itself in every branch.
 *
 * The one global setting the whole scheme leans on is pinned first, because
 * it is the one that would fail silently: with `headerBackButtonDisplayMode:
 * 'minimal'` gone, the NEXT screen's back button prints the previous title
 * (react-native-screens writes the current screen's display mode and the
 * previous item's title onto the previous item, RNSScreenStackHeaderConfig
 * configureBackItem), so "Waiting on you" would appear beside the chevron
 * on every profile opened from that page.
 */

const layout = source('src/app/_layout.tsx');

/**
 * The `<Stack.Screen name="…" … />` element for one route, with its comment
 * lines cut out.
 *
 * The routes are commented in the JSX, and `place/[id]`'s comment says
 * `headerTitle: ''` in prose before the real options object does. A regex
 * over the whole element matched the comment first, so the layout could be
 * given any title at all and the assertion that it holds the placeholder
 * stayed green — reproduced by setting it to 'Mutated' and watching all
 * nine tests pass. Comments are stripped, and `staticTitle` then reads the
 * options object alone.
 */
const route = (name: string): string =>
  between(layout, `name="${name}"`, '/>')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

/** The static title a route's `options={{ … }}` carry, or null when it is ''. */
const staticTitle = (name: string): string | null => {
  const element = route(name);
  if (!element.includes('options={{')) {
    throw new Error(`route ${name} sets no options at all`);
  }
  const m = between(element, 'options={{', '}}').match(/headerTitle: '([^']*)'/);
  if (!m) {
    throw new Error(`route ${name} sets no headerTitle at all`);
  }
  return m[1] === '' ? null : m[1];
};

describe('the root stack', () => {
  it('keeps the back button minimal, so a titled screen never becomes the next back label', () => {
    expect(layout).toMatch(
      /<Stack screenOptions=\{\{ headerShown: false, headerBackButtonDisplayMode: 'minimal' \}\}>/
    );
  });
});

describe('routes with one name carry it on the route', () => {
  it.each([
    ['archived-chats', 'Archived'],
    ['first-messages', 'Waiting on you'],
    ['join-group/[token]', 'Group invite'],
    ['i/[token]', 'Group invite'],
  ])('%s is titled %s', (name, title) => {
    expect(staticTitle(name)).toBe(title);
    expect(route(name)).toContain('headerShown: true');
  });

  it('gives both spellings of the invite the same title, so they cannot drift', () => {
    // i/[token] re-exports join-group/[token]: one screen, two URLs, and a
    // person who tapped an https link must read the same bar as one who
    // tapped the scheme.
    expect(staticTitle('i/[token]')).toBe(staticTitle('join-group/[token]'));
  });
});

describe('routes whose name arrives with a query set it from the screen', () => {
  it.each([
    // [route, screen file, the anchor that starts the loaded branch, the title]
    ['place/[id]', 'src/app/place/[id].tsx', 'if (place == null) {', 'headerTitle: place.name'],
    ['profile/[userId]', 'src/app/profile/[userId].tsx', 'if (!profile) {', 'headerTitle: name,'],
  ])('%s: the layout holds the placeholder and %s sets the name', (name, file, loaded, title) => {
    expect(staticTitle(name)).toBeNull();
    const screen = source(file);
    // Nothing before the loaded branch touches the bar: the skeleton and
    // the error state stand under the placeholder.
    expect(between(screen, 'export default function', loaded)).not.toContain('headerTitle');
    // The loaded branch sets it, as a string, through the same
    // <Stack.Screen options> the profile has used since it was written.
    const rest = after(screen, loaded);
    expect(rest).toContain('<Stack.Screen');
    expect(rest).toContain(title);
  });
});

describe('profile-me names itself', () => {
  it('sets a title in every branch that renders a page', () => {
    const screen = source('src/app/profile-me.tsx');
    const pages = (screen.match(/<ThemedView style=\{styles\.root\}>/g) ?? []).length;
    const titles = (
      screen.match(/<Stack\.Screen options=\{\{ headerTitle: '[^']+' \}\} \/>/g) ?? []
    ).length;
    expect(pages).toBeGreaterThan(0);
    expect(titles).toBe(pages);
    expect(staticTitle('profile-me')).toBeNull();
  });
});
