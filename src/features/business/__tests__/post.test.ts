import fs from 'node:fs';
import path from 'node:path';

import { lastShapeKey, liveCountExcluding, parseShape, shapeOfPost } from '@/app/business-post';

/**
 * Fixing a post, and putting one up again.
 *
 * Until now the only thing an owner could do to a live post was take it down,
 * so correcting "Live music at 9" meant deleting it and retyping it, and a
 * weekly quiz night meant retyping it every week. The permission was never
 * the problem: business_posts carries `grant insert, update, delete` and
 * business_posts_write_own covers all of it.
 *
 * Two things here are load-bearing. The cap must not count the post being
 * edited against itself, or opening your third one to fix a typo disables the
 * button that saves it. And putting a post up again has to go back through
 * the composer rather than flipping archived_at, because the composer is
 * where somebody sees that last week's date is still on it - and because the
 * cap check DOES fire on an un-archive (20260827110000).
 */

const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const POST = 'src/app/business-post.tsx';
const API = 'src/features/business/api.ts';

describe('reading a stored post back into the form', () => {
  it('recovers the shape from the two dates', () => {
    expect(shapeOfPost({ happens_at: '2026-09-04T20:00:00Z', ends_at: null })).toBe('happens');
    expect(shapeOfPost({ happens_at: null, ends_at: '2026-09-11T23:59:59Z' })).toBe('ends');
    expect(shapeOfPost({ happens_at: null, ends_at: null })).toBe('open');
    // A dated event wins if both are somehow set: happens_at is the one the
    // card prints and the one archive_expired_posts reads first.
    expect(
      shapeOfPost({ happens_at: '2026-09-04T20:00:00Z', ends_at: '2026-09-11T00:00:00Z' })
    ).toBe('happens');
  });
});

describe('the cap, while a post is being edited', () => {
  const live = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

  it('does not count the post being edited against itself', () => {
    // Three up, cap of three, editing one of them. Counting it would tell an
    // owner they are at the cap for changing a word in something already up.
    expect(liveCountExcluding(live, 'p2')).toBe(2);
  });

  it('counts everything when nothing is being edited', () => {
    expect(liveCountExcluding(live, null)).toBe(3);
    // Putting an ARCHIVED post up again is a new row, so the cap applies in
    // full: the id being repeated is not in the live list to begin with.
    expect(liveCountExcluding(live, 'archived-one')).toBe(3);
  });

  it('reads an unloaded list as nothing rather than as zero posts', () => {
    // The screen gates on `livePosts.data != null` before it believes this
    // number, which is what keeps "Nothing up right now" off a form whose
    // query has not answered yet.
    expect(liveCountExcluding(undefined, null)).toBe(0);
  });
});

describe('the shape this listing used last time', () => {
  it('is remembered per listing, not per phone', () => {
    expect(lastShapeKey('b1')).not.toEqual(lastShapeKey('b2'));
    expect(lastShapeKey('b1')).toContain('b1');
  });

  it('takes back only a value that is still one of the three shapes', () => {
    expect(parseShape('happens')).toBe('happens');
    expect(parseShape('ends')).toBe('ends');
    expect(parseShape('open')).toBe('open');
    expect(parseShape('tonight')).toBeNull();
    expect(parseShape(null)).toBeNull();
  });

  it('never preselects anything for a business that has not posted', () => {
    // The founder's ruling: "keep it up has to be a choice somebody makes
    // rather than the one they land on by not choosing". Memory hands back
    // an answer this account gave itself; it invents none. Both halves are
    // in the code - nothing is stored until a post is actually put up, and
    // the read never overwrites a choice made while storage was reading.
    const code = src(POST);
    expect(code).toContain('const [shape, setShape] = useState<Shape | null>(null);');
    expect(code).toContain('setShape((current) => current ?? remembered)');
    const write = code.indexOf('AsyncStorage.setItem(lastShapeKey(businessId), shape)');
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(code.indexOf('await post.mutateAsync('));
  });
});

describe('the composer when it has a post to open', () => {
  const code = src(POST);

  it('changes the docked label, because the post is already up', () => {
    expect(code).toContain("continueLabel={editing ? 'Save it' : 'Put it up'}");
    expect(code).toContain("title={editing ? 'Edit your post' : again ? 'Put this up again'");
  });

  it('saves over the row rather than adding a second one', () => {
    expect(code).toContain('editing && postId != null');
    expect(code).toContain('? updateBusinessPost({ postId, ...input })');
    expect(code).toContain(': createPost({ businessId: businessId!, ...input })');
  });

  it('treats a repeat as a new post with a date somebody has to look at', () => {
    // `again` seeds the words and the shape but not the dates, so the picker
    // opens on defaultHappensAt rather than on the night that has gone.
    expect(code).toContain("const again = postId != null && params.again === '1';");
    expect(code).toContain('const editing = postId != null && !again;');
    expect(code).toContain('if (!again && was != null && was.getTime() > openedAt)');
    // The clock is read once, at open: react-hooks/purity refuses Date.now()
    // during render, and one reading is the question the person is answering.
    expect(code).toContain('const [openedAt] = useState(() => Date.now());');
  });

  it('says so rather than showing a blank form when the post is gone', () => {
    expect(code).toContain(
      'const missing = postId != null && !seed.isPending && seed.data == null;'
    );
    expect(code).toContain('"That post isn\'t there any more."');
    expect(code).toContain('continueDisabled={!ready || atCap || missing}');
  });
});

describe('the update itself', () => {
  const code = src(API);

  it('never touches archived_at, so a re-post cannot skip the composer', () => {
    // screen_business_post counts an un-archive against the cap, so flipping
    // archived_at back to null here would not bypass the cap - it would
    // bypass the SCREEN, which is where somebody notices the stale date.
    const body = code.slice(code.indexOf('export async function updateBusinessPost'));
    expect(body).toContain('happens_at: input.happensAt');
    expect(body).not.toContain('archived_at');
  });

  it('reads a post back by id alone, because the policy is the filter', () => {
    // business_posts_select_own is `owns_business(business_id)`, so a post id
    // belonging to somebody else's listing comes back as no rows rather than
    // as somebody else's words. And never a star select.
    expect(code).toContain(
      "const OWN_POST_COLUMNS = 'id, business_id, title, body, happens_at, ends_at, archived_at';"
    );
    expect(code).toContain('.select(OWN_POST_COLUMNS)');
  });
});
