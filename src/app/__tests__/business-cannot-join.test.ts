import fs from 'node:fs';
import path from 'node:path';

/**
 * A business account is never offered a traveler's controls.
 *
 * Founder, after testing as a business: "under no circumstances should a
 * business account ever have the option to join a chat of any other business
 * or other pin of any kind... It also doesn't make any sense for a business
 * account to ever be able to join its own chat, and it also doesn't make
 * sense for the business account to ever have to set a date for when it is
 * leaving."
 *
 * The database enforces it (assert_not_business, 20260829190000, proved by
 * supabase/tests/database/28). This guards the other half: that nobody is
 * ever shown the button. A refusal somebody could not have predicted is
 * worse than no button, and "under no circumstances" is not a thing to leave
 * to whoever edits these screens next.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

/**
 * Every screen that offers a join, the branch that has to stand in front of
 * it, and the control itself. Matching the branch text exactly is the point:
 * "the file mentions the hook somewhere" proves nothing, because each of
 * these screens imports it for other reasons too.
 */
const GATED: { what: string; file: string; guard: string; control: string }[] = [
  {
    what: 'joining a plan from the map',
    file: 'src/features/pins/map-screen.tsx',
    guard: 'openToJoin && !viewerIsBusiness ? (',
    control: "'Join this plan'",
  },
  {
    what: 'saying hi to a traveler from the map',
    file: 'src/features/pins/map-screen.tsx',
    guard: ') : viewerIsBusiness ? (',
    control: 'label="Say hi"',
  },
  {
    what: 'joining a room',
    file: 'src/app/room/[id].tsx',
    guard: ') : viewerIsBusiness ? (',
    control: 'label="Join this room"',
  },
];

describe('a business is never offered a traveler control', () => {
  it.each(GATED.map((g) => [g.what, g] as const))('%s is behind the business check', (_what, g) => {
    const code = src(g.file);
    const control = code.indexOf(g.control);
    expect(control).toBeGreaterThan(-1);
    const guard = code.indexOf(g.guard);
    expect(guard).toBeGreaterThan(-1);
    // In front of the control, in the same ternary chain - not merely
    // present somewhere further down the render.
    expect(guard).toBeLessThan(control);
    // A screen's worth of JSX, so the branch cannot drift into a different
    // chain and still pass.
    expect(control - guard).toBeLessThan(3000);
  });

  it('the leaving-date screen turns a business round', () => {
    const code = src('src/app/join-place.tsx');
    expect(code).toContain('useIsBusiness');
    // Not a hidden button on a screen whose entire question is "when do you
    // leave" - the screen itself does not apply.
    expect(code).toMatch(/if \(viewerIsBusiness\) \{\s*return <Redirect/);
  });

  it('one hook answers the question, so the rule reads the same everywhere', () => {
    expect(src('src/features/business/hooks.ts')).toContain('export function useIsBusiness()');
  });
});
