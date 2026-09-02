import fs from 'node:fs';
import path from 'node:path';

import {
  NO_GROUP_PHOTO,
  groupPhotoActions,
  groupPhotoControlLabel,
  groupPhotoView,
  groupView,
  uploaderOf,
  type GroupView,
} from '@/features/groups/photo';
import { between, source } from '@/lib/__tests__/source';
import type { GroupRow } from '@/lib/database.types';

const ANA = '00000000-0000-0000-0000-0000000000a5';
const BRUNO = '00000000-0000-0000-0000-0000000000b5';
const PHOTO = `${ANA}/two.jpg`;

/**
 * Who may see a group's photo, on the client. The server masks the path in
 * my_chats and group_invite_preview and the bucket refuses to sign it; this
 * is the same rule applied to the one read that comes straight off the
 * table (`fetchGroup` is `select *`), and it has to agree with the server.
 */
describe('groupPhotoView', () => {
  it('draws an approved photo for everybody', () => {
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: 'approved' }, BRUNO)).toEqual({
      path: PHOTO,
      state: 'ready',
      own: false,
    });
  });

  it('shows a pending photo to the person who uploaded it, and says it is being checked', () => {
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: 'pending' }, ANA)).toEqual({
      path: PHOTO,
      state: 'checking',
      own: true,
    });
  });

  it('tells everybody else nothing while it is being checked: to them there is no photo', () => {
    // Not 'checking' with no path. A member who could watch "being checked"
    // turn into nothing would know the admin's picture was refused, and a
    // verdict is for its subject alone.
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: 'pending' }, BRUNO)).toEqual({
      path: null,
      state: 'none',
      own: false,
    });
  });

  it('gives a signed-out reader nothing either', () => {
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: 'pending' }, null)).toEqual(
      NO_GROUP_PHOTO
    );
  });

  it('fails closed on a row with a path and no verdict, which is the deploy window', () => {
    // A cached row from before the migration reached this phone: a path and
    // no status. Never open, and never a pending state for a member.
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: null }, BRUNO)).toEqual({
      path: null,
      state: 'none',
      own: false,
    });
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: null }, ANA)).toEqual({
      path: PHOTO,
      state: 'checking',
      own: true,
    });
  });

  it('never hands out a refused photo, even if the row still carried a path', () => {
    // The verdict removes the path server-side. If a bundle ever saw one
    // anyway, it must not draw it.
    expect(groupPhotoView({ photo_path: PHOTO, photo_status: 'rejected' }, ANA)).toEqual({
      path: null,
      state: 'blocked',
      own: false,
    });
    expect(groupPhotoView({ photo_path: null, photo_status: 'rejected' }, ANA).state).toBe(
      'blocked'
    );
  });

  it('says none for a group with no photo', () => {
    expect(groupPhotoView({ photo_path: null, photo_status: null }, ANA)).toEqual({
      path: null,
      state: 'none',
      own: false,
    });
    expect(groupPhotoView(null, ANA).state).toBe('none');
    expect(groupPhotoView(undefined, ANA).state).toBe('none');
  });

  it('reads the uploader off the path, the way the bucket and the RPCs do', () => {
    expect(uploaderOf(PHOTO)).toBe(ANA);
    expect(uploaderOf(null)).toBeNull();
    expect(uploaderOf('')).toBeNull();
  });
});

/**
 * The admin's photo control. Its second option is the only way the refusal
 * notice ("That photo was not approved and has been removed. Pick another.")
 * goes away without choosing a new picture: update_group's p_clear_photo
 * nulls photo_status with the path (67_a_group_photo_is_checked asserts
 * that), and the group page maps 'remove' onto clearPhoto: true below.
 */
describe('groupPhotoActions', () => {
  it('offers nothing to choose between for a group with no photo: the tap picks', () => {
    expect(groupPhotoActions(NO_GROUP_PHOTO)).toEqual([]);
  });

  it('offers change and remove for a photo that is up', () => {
    expect(
      groupPhotoActions({ path: PHOTO, state: 'ready', own: true }).map((o) => o.action)
    ).toEqual(['change', 'remove']);
  });

  it('and for one still being checked', () => {
    expect(
      groupPhotoActions({ path: PHOTO, state: 'checking', own: true }).map((o) => o.action)
    ).toEqual(['change', 'remove']);
  });

  it('after a refusal, offers another photo or none, and none is how the notice goes', () => {
    const options = groupPhotoActions({ path: null, state: 'blocked', own: false });
    expect(options.map((o) => o.action)).toEqual(['change', 'remove']);
    // Nothing is being taken away here (the server already removed the
    // picture), so the sheet does not paint the choice red.
    expect(options.every((o) => !o.destructive)).toBe(true);
    // And once the clear lands, the row has no path and no status, which the
    // view reads as no photo: no notice, no veil.
    expect(groupPhotoView({ photo_path: null, photo_status: null }, ANA)).toEqual(NO_GROUP_PHOTO);
  });

  it('paints removing a picture that is up as destructive, and only that', () => {
    const options = groupPhotoActions({ path: PHOTO, state: 'ready', own: true });
    expect(options.filter((o) => o.destructive).map((o) => o.action)).toEqual(['remove']);
  });

  it('names the control by what it does, and never tells a member a photo is being checked', () => {
    expect(groupPhotoControlLabel(NO_GROUP_PHOTO, true)).toBe('Add a group photo');
    expect(groupPhotoControlLabel({ path: PHOTO, state: 'ready', own: true }, true)).toBe(
      'Change or remove the group photo'
    );
    expect(groupPhotoControlLabel({ path: null, state: 'blocked', own: false }, true)).toBe(
      'Pick another group photo, or go without one'
    );
    // A member is never handed 'checking' (above), and the label does not
    // say it for them in any state either.
    for (const state of ['none', 'ready', 'checking', 'blocked'] as const) {
      expect(groupPhotoControlLabel({ path: null, state, own: false }, false)).toBe('Group photo');
    }
  });
});

/**
 * No screen holds the raw group row, so no screen can read `.photo_path` on
 * one, however it spells it.
 *
 * The first version of this test pinned two spellings of the leak
 * (`useChatPhotoUrl(group?.photo_path` and the `group.` form), which a screen
 * that bound the column to a local first walked straight past. The
 * assertion is structural now: useGroup's `select` replaces the two columns
 * with the view, so the property is not on the object a screen is given
 * (typecheck is in the gate, and the `@ts-expect-error` lines below fail it
 * the day the columns come back), and the raw row is confined to the three
 * files that have to read it.
 */
describe('no screen holds the raw group row', () => {
  const REPO = path.join(__dirname, '..', '..', '..', '..');
  const RAW_READERS = new Set([
    'src/features/groups/api.ts',
    'src/features/groups/hooks.ts',
    'src/features/groups/photo.ts',
  ]);

  function everySourceFile(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') {
            walk(full);
          }
        } else if (/\.tsx?$/.test(entry.name) && entry.name !== 'database.types.ts') {
          found.push(path.relative(REPO, full));
        }
      }
    };
    walk(path.join(REPO, 'src'));
    return found;
  }

  it('finds the sources at all', () => {
    const files = everySourceFile();
    expect(files.length).toBeGreaterThan(50);
    for (const raw of RAW_READERS) {
      expect(files).toContain(raw);
    }
  });

  it('confines the raw row to the three files that have to read it', () => {
    // Three ways to hold a raw row outside them: fetch it, select the table,
    // or type something as GroupRow (the query cache, say: useAcceptedCelebration
    // casts it to Pick<GroupRow, 'photo_status'>, which is a state and not a
    // picture). So a file may not fetch or select, and the only GroupRow it
    // may name is a Pick that leaves photo_path out.
    const offenders = everySourceFile()
      .filter((file) => !RAW_READERS.has(file))
      .filter((file) => {
        const src = fs
          .readFileSync(path.join(REPO, file), 'utf8')
          .replace(/import type \{[^}]*\} from '@\/lib\/database\.types';/g, '')
          .replace(/Pick<GroupRow,\s*((?:'\w+'\s*\|?\s*)+)>/g, (whole, keys: string) =>
            keys.includes("'photo_path'") ? whole : ''
          );
        return (
          /\bfetchGroup\b/.test(src) || /from\('groups'\)/.test(src) || /\bGroupRow\b/.test(src)
        );
      });
    expect(offenders).toEqual([]);
  });

  it('and useGroup hands out the view, not the row', () => {
    const block = between(
      source('src/features/groups/hooks.ts'),
      'export function useGroup(',
      'export function useGroupMembers('
    );
    expect(block).toMatch(/select,|select:/);
    expect(block).toContain('groupView(row, ownUserId)');
  });

  it('strips the columns rather than shadowing them', () => {
    const row: GroupRow = {
      chat_id: 'c',
      created_by: ANA,
      name: 'Porto crew',
      photo_path: PHOTO,
      photo_status: 'pending',
      moderation_attempts: 3,
      speaking: 'everyone',
      invites: 'everyone',
      max_stay_until: null,
      pin_id: null,
      plan_ended_at: null,
      created_at: '2026-09-02T00:00:00Z',
    };
    const view = groupView(row, BRUNO) as GroupView;
    expect(view.photo).toEqual(NO_GROUP_PHOTO);
    expect(view.name).toBe('Porto crew');
    // The whole point: a screen cannot spell the column, because it is not
    // there. Each of these is a typecheck failure the day it stops being an
    // error, and a runtime failure the day the value comes back.
    // @ts-expect-error photo_path is not on the view
    expect(view.photo_path).toBeUndefined();
    // @ts-expect-error photo_status is not on the view
    expect(view.photo_status).toBeUndefined();
    // @ts-expect-error the worker's counter is not for screens
    expect(view.moderation_attempts).toBeUndefined();
    expect(groupView(null, ANA)).toBeNull();
  });

  it.each([
    ['the group page', 'src/app/group/[id].tsx'],
    ['the room header', 'src/app/room/[id].tsx'],
  ])('%s asks useGroup and draws the view it is handed', (_label, file) => {
    const src = source(file);
    expect(src).toContain('useGroup(');
    expect(src).toContain('.photo ?? NO_GROUP_PHOTO');
  });

  it('the group page maps the remove option onto the clear the server documents', () => {
    const page = source('src/app/group/[id].tsx');
    const control = between(page, 'const runPhotoAction = (', 'const openPhotoControl = (');
    expect(control).toContain("action === 'remove'");
    expect(control).toContain('update.mutate({ clearPhoto: true })');
    // And the sheet is built from the one list, so an option cannot exist
    // on the phone without an action behind it.
    expect(page).toContain('groupPhotoActions(photo)');
  });
});
