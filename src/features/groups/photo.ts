import type { GroupRow } from '@/lib/database.types';

/**
 * What a group's photo is, to the person looking at it.
 *
 * `groups.photo_path` used to be the whole story: a path, drawn by every
 * member and every invite holder the moment the admin chose it, checked by
 * nobody. 20260903050000 gave it a verdict (`photo_status`) and this is the
 * one place the client reads the two together, so the group page and the
 * room header cannot come to disagree about who may see what.
 *
 * THIS FILE IS UX, NOT THE BOUNDARY, and for a day it was the only thing
 * enforcing half of the rule below. `grant select on public.groups` was
 * table-level until 20260903130000, so a member could read `photo_status`
 * straight off the table and watch 'pending' become 'rejected' — the exact
 * inference the rule forbids — no matter what this function returned. The
 * server decides now: `group_detail` hands a member null for both columns
 * unless the photo is approved or they set it, the storage bucket refuses to
 * sign an unapproved object, and 74_a_verdict_is_for_its_subject_alone is
 * that written as the attack. What is left here is a screen never drawing a
 * frame the server would refuse to fill, which is worth keeping and is not a
 * lock.
 *
 *   ready      approved. Everybody draws it.
 *   checking   waiting on the worker, and you are the one who uploaded it.
 *              You get the path (the bucket lets you read your own upload
 *              anyway, so withholding it would hide nothing and leave the one
 *              person who chose the picture looking at an empty frame) and a
 *              sentence saying it is being checked.
 *   blocked    refused. The verdict removed the path server-side and left the
 *              status so the admin can be told to pick another; nobody gets a
 *              path here whatever the row says.
 *   none       no photo. ALSO what everybody but the uploader is told while a
 *              photo is being checked. A verdict is for its subject alone: a
 *              member who could watch "being checked" turn into nothing would
 *              know the admin's picture was refused, which is a moderation
 *              outcome reaching somebody it is not about. To a member there is
 *              no photo until there is one. A member's row arrives with both
 *              columns already null, so this branch is what the screen draws
 *              rather than what hides anything.
 *
 * The uploader is the path's first segment. Every group photo is uploaded
 * into the uploader's own folder (the bucket's insert policy enforces it) and
 * the trigger refuses any other path, so the prefix IS who set it, and it is
 * the same comparison my_chats and group_invite_preview make server-side.
 * `group_detail` compares `groups.photo_set_by` instead, for the one case a
 * path cannot answer: a REFUSED photo has had its path removed by the verdict
 * it is about, and the subject still has to be told.
 *
 * A row from BEFORE the migration reached the phone (the deploy window: an
 * expo-updates bundle is applied on the launch after the one that fetched
 * it) can carry a path with no status. That is read as pending: the uploader
 * sees it, nobody else does. Fail closed, never open.
 */
export type GroupPhotoState = 'none' | 'ready' | 'checking' | 'blocked';

export type GroupPhotoView = {
  /** What to sign and draw, or null. */
  path: string | null;
  state: GroupPhotoState;
  /** Whether the viewer is the one who uploaded the photo being checked. */
  own: boolean;
};

/** A group with no photo, and what a screen holds before the group loads. */
export const NO_GROUP_PHOTO: GroupPhotoView = { path: null, state: 'none', own: false };

export function uploaderOf(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const first = path.split('/')[0];
  return first.length > 0 ? first : null;
}

export function groupPhotoView(
  group: Pick<GroupRow, 'photo_path' | 'photo_status'> | null | undefined,
  ownUserId: string | null | undefined
): GroupPhotoView {
  const path = group?.photo_path ?? null;
  // `photo_status` is nullable on the wire and absent from a row cached by an
  // older bundle, so read it defensively rather than trusting the type.
  const status = group?.photo_status ?? null;
  const own = path != null && ownUserId != null && uploaderOf(path) === ownUserId;

  if (status === 'rejected') {
    return { path: null, state: 'blocked', own: false };
  }
  if (path == null) {
    return NO_GROUP_PHOTO;
  }
  if (status === 'approved') {
    return { path, state: 'ready', own };
  }
  // Pending, or no verdict yet. The uploader alone is told; to everybody
  // else there is no photo, for the reason the header gives.
  return own ? { path, state: 'checking', own: true } : NO_GROUP_PHOTO;
}

/**
 * The group as a screen is allowed to hold it: the row with its two raw photo
 * columns (and the worker's counter) replaced by the view above.
 *
 * `useGroup` hands out this shape and nothing else, so a screen cannot draw
 * `group.photo_path`, or bind it to a local and draw that, or spell it any
 * other way: the property is not on the object it was given, and
 * `npm run typecheck` is in the gate. The raw row exists in exactly three
 * files (api.ts fetches it, hooks.ts selects it into this, photo.ts reads
 * it), and photo.test.ts holds that.
 */
export type GroupView = Omit<GroupRow, 'photo_path' | 'photo_status' | 'moderation_attempts'> & {
  photo: GroupPhotoView;
};

export function groupView(
  row: GroupRow | null | undefined,
  ownUserId: string | null | undefined
): GroupView | null {
  if (!row) {
    return null;
  }
  // Removed, not merely shadowed: a spread that kept the columns would let a
  // cast reach them, and the runtime test asserts they are gone.
  const { photo_path: _path, photo_status: _status, moderation_attempts: _attempts, ...rest } = row;
  return { ...rest, photo: groupPhotoView(row, ownUserId) };
}

/**
 * What the admin's photo control offers, by state.
 *
 * Empty means the tap picks a photo directly: there is nothing to choose
 * between. Otherwise the tap opens a sheet with these on it. The second
 * option is how the refusal notice goes: 20260903050000's `p_clear_photo`
 * nulls `photo_status` along with the path, and until this list existed no
 * screen sent it, so the escape the migration documented did not exist on
 * the phone.
 *
 * `destructive` is the sheet's red: removing a picture that is up is
 * destructive, choosing to go without one after a refusal is not (nothing is
 * being taken away, the server already removed it).
 */
export type GroupPhotoAction = 'change' | 'remove';

export type GroupPhotoOption = {
  action: GroupPhotoAction;
  label: string;
  destructive: boolean;
};

export function groupPhotoActions(photo: GroupPhotoView): GroupPhotoOption[] {
  switch (photo.state) {
    case 'none':
      return [];
    case 'ready':
    case 'checking':
      return [
        { action: 'change', label: 'Change photo', destructive: false },
        { action: 'remove', label: 'Remove photo', destructive: true },
      ];
    case 'blocked':
      return [
        { action: 'change', label: 'Pick another photo', destructive: false },
        { action: 'remove', label: 'Go without a photo', destructive: false },
      ];
  }
}

/** The spoken name of the admin's photo control, in each state. */
export function groupPhotoControlLabel(photo: GroupPhotoView, isAdmin: boolean): string {
  if (!isAdmin) {
    return 'Group photo';
  }
  switch (photo.state) {
    case 'none':
      return 'Add a group photo';
    case 'ready':
      return 'Change or remove the group photo';
    case 'checking':
      return 'Change or remove the group photo, the current one is being checked';
    case 'blocked':
      return 'Pick another group photo, or go without one';
  }
}
