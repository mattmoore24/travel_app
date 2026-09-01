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
const LIST = 'src/features/pins/plan-list.tsx';

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
      "'id, business_id, title, body, photo_path, photo_status, happens_at, ends_at, archived_at'"
    );
    expect(code).toContain('.select(OWN_POST_COLUMNS)');
  });
});

/**
 * The photo a post can carry.
 *
 * `business_posts.photo_path` shipped with the table and place/[id].tsx has
 * always drawn it; the composer had no picker, no upload and no field, so a
 * bar posting "Live music, no cover" could not show the band. The half that is
 * easy to get wrong is the check: moderation attaches to the ROW a photo
 * creates, so sharing the photo grid's bucket buys a post photo neither the
 * screening nor the readability, and shipping the picker without the migration
 * would have put an unreviewed image on a page granted to anon.
 */
describe('the photo a post can carry', () => {
  const code = src(POST);
  const api = src(API);

  it('never gates the post on having one', () => {
    // The whole control is optional. `ready` decides the docked button, and it
    // asks for a title and a shape and nothing else - a photo that could stop
    // a post going up would be a worse feature than no photo at all.
    const ready = code.slice(code.indexOf('const ready ='), code.indexOf('const note ='));
    expect(ready).toContain('trimmedTitle.length >= TITLE_MIN');
    expect(ready).toContain('shape != null');
    expect(ready).not.toContain('photo');
    expect(code).toContain('continueDisabled={!ready || atCap || missing}');
  });

  it('is actually rendered, and reaches both writes', () => {
    // A control nobody can see is the failure this project has already paid
    // for twice. It is mounted in the composer's own body, between the words
    // and the shape rows.
    expect(code).toContain('<PostPhotoField');
    expect(code).toContain('onPick={() => void pickPhoto()}');
    expect(code).toContain('onRemove={removePhoto}');
    // And the value it holds is on the payload for a new post and an edit
    // alike, which is the difference between a picker and a picker that works.
    expect(code).toContain('photoPath,');
    expect(code).toContain('photo_path: input.photoPath');
    expect(api).toContain('photo_path: input.photoPath');
  });

  it('says the photo is checked before anybody spends a minute picking one', () => {
    expect(code).toContain('Optional. Photos are checked before travelers see them.');
    // And names the state of a stored one rather than showing a blank frame:
    // the same two words the photo grid draws.
    expect(code).toContain("'Removed' : 'In review'");
  });

  it('uploads through the same door every other business photo uses', () => {
    // processAndUploadImage with the resolution floor on, because a post photo
    // is drawn at cover width on the place page and is judged the same way.
    const upload = api.slice(api.indexOf('export async function uploadPostPhoto'));
    expect(upload).toContain('BUSINESS_PHOTO_BUCKET');
    expect(upload).toContain('{ fillsAFrame: true }');
  });

  it('deletes only what no row has ever named', () => {
    // A path that came from the database may be named by another row - a
    // repeat carries the original's picture across - and an object nothing
    // names is already unreadable, because every read resolves through a post
    // row. So only this session's own strays are swept.
    expect(code).toContain('strays.current.includes(path)');
    expect(code).toContain('strays.current = [];');
  });
});

/**
 * A post reaching somebody.
 *
 * The map has always known WHICH businesses have news - city_businesses
 * returns has_live_post, which is what brightens a marker's ring - and never
 * what the news is. So the only way to learn that a hostel is running a quiz
 * night was to tap that exact marker among six clusters, and the one piece of
 * fresh content a business produces reached nobody. A bar that posts twice and
 * hears nothing stops posting.
 *
 * Source-reading, in the idiom hours.test.ts sets out: the behaviour the
 * function itself has is pinned by the pgTAP suite (54), and what these guard
 * is that the words actually reach the row a person reads.
 */
describe('what is on, said out loud', () => {
  const list = src(LIST);
  const api = src(API);

  it('puts the post words in the row, through the list it already has', () => {
    // No new query and no new screen: the map already reads city_businesses
    // and hands the rows to this list, so the words ride in on a call that is
    // already being made and reach a surface that is already mounted.
    expect(list).toContain('export function whatsOnLine(');
    expect(list).toContain('{whatsOnLine(place, clock ?? new Date())}');
    expect(api).toContain("supabase.rpc('city_whats_on', { p_city_id: cityId })");
    expect(api).toContain('live_post: whatsOn.get(place.id) ?? null');
  });

  it('keeps the old line when the words are not there', () => {
    // JavaScript ships over the air and the database deploys separately, so a
    // phone can be minutes ahead of its own server. Losing every business on
    // the map over a missing function would be a far worse trade than losing
    // a line of text, and what is left is what the list said before.
    expect(list).toContain("return 'Something on tonight';");
    expect(api).toContain('fetchCityWhatsOn(cityId).catch(');
  });

  it('stops the heading claiming tonight about a post for Friday', () => {
    // The rows carry a day now. A heading that says tonight over a row that
    // says Friday is the heading contradicting the row underneath it.
    expect(list).not.toContain('ON TONIGHT');
    expect(list).toContain('WHAT&apos;S ON');
  });

  it('says the time on the venue clock rather than the reader one', () => {
    // "21:00" has to mean nine at that door. Same approximation the open line
    // already makes, from the same function, so the two cannot disagree.
    expect(list).toContain('cityNow(new Date(post.happens_at), place.lng)');
    expect(list).toContain('clockTime(at)');
  });
});
