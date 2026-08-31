/**
 * Why a photo was refused, in words this app owns.
 *
 * The verdict stores a CATEGORY and an ENGINE and nothing else (see
 * supabase/migrations/20260901100000_a_photo_says_why.sql). The classifier's
 * free-text `reason` is deliberately not stored and must never be rendered:
 * it is model prose, it can be blunt or simply wrong, and one screenshot of
 * it becomes this app's voice.
 *
 * Two rules shape everything here:
 *
 *   1. A failsafe is not a rules breach. `engine = 'failsafe'` means the
 *      check gave up, the database records photo_rejected_failsafe, and
 *      apply_strike_policy does not count it. Telling that person they broke
 *      the rules is the bug this file exists to fix, so the failsafe copy
 *      says the opposite in as many words and the chip is warning, never
 *      danger.
 *   2. Every rejection says a machine decided, and every rejection offers a
 *      person (DSA Art. 17(3)(c) plus the appeal promise in the house rules
 *      and the privacy policy).
 *
 * An unknown category falls back to the generic sentence rather than showing
 * a raw token: the worker can emit 'refusal' and 'moderation_unavailable'
 * alongside the five the schema names, and a future model can emit anything.
 */

export type PhotoRejection = {
  /** The word on the tile. */
  chip: string;
  /** The sheet's headline. */
  title: string;
  /** What happened and what to do about it. */
  body: string;
  /** True when the check gave up, which is not a rules breach. */
  failsafe: boolean;
};

/**
 * The appeal, said once. Every rules rejection ends with it; the failsafe
 * case does not, because "try it again" is the honest advice there and
 * pointing somebody at a support queue for a timeout wastes both their time.
 */
const APPEAL = 'If that is wrong, tap Contact us and a person will look at the photo itself.';

const FAILSAFE: PhotoRejection = {
  chip: 'Try again',
  title: 'This one could not be checked',
  body: 'Our automatic check could not read this photo, so nobody else can see it. Nothing about it broke a rule. Upload it again and the check runs once more.',
  failsafe: true,
};

const BY_CATEGORY: Record<string, { title: string; rule: string }> = {
  explicit: {
    title: 'Nudity or sexual content',
    rule: 'Our house rules do not allow nudity or sexual photos, and an automatic check read this one that way.',
  },
  suggestive: {
    title: 'Read as suggestive',
    rule: 'An automatic check read this photo as sexual or suggestive, which our house rules do not allow.',
  },
  violent: {
    title: 'Violence or weapons',
    rule: 'An automatic check found violence or a weapon in this photo, which our house rules do not allow.',
  },
  other_violation: {
    title: 'Against the house rules',
    rule: 'An automatic check found something in this photo our house rules do not allow.',
  },
};

const GENERIC = {
  title: 'Against the house rules',
  rule: 'An automatic check could not clear this photo against our house rules.',
};

/** What to show for a photo whose moderation_status is 'rejected'. */
export function photoRejection(
  category: string | null | undefined,
  engine: string | null | undefined
): PhotoRejection {
  if (engine === 'failsafe') {
    return FAILSAFE;
  }
  const known = (category != null && BY_CATEGORY[category]) || GENERIC;
  return {
    chip: 'Removed',
    title: known.title,
    body: `${known.rule} Nobody else can see it. ${APPEAL}`,
    failsafe: false,
  };
}

/**
 * The line on your own profile above the photo grid, which used to say
 * "removed" for a hold that was nobody's fault.
 *
 * The two rejection states are COUNTED, not collapsed into one flag, and that
 * is the whole design of this function. A boolean pair read failsafe-first,
 * so somebody holding one classifier timeout AND one genuine rules rejection
 * was told the whole thing was a timeout and invited to upload it again -
 * which puts the refused photo back through the check and costs a second
 * strike. A rules rejection therefore outranks a failsafe here: it is the
 * half with a consequence, the per-photo chip on each tile still says which
 * of the two that photo was, and the sheet behind it names the reason.
 *
 * The failsafe wording is taken only when nothing else was rejected, which is
 * the case it was written for: nobody did anything wrong, so nobody should
 * read that they did.
 */
export function heldPhotoNotice({
  heldBack,
  rejected,
  failsafe,
}: {
  /** Photos a stranger is not being served, for any reason including pending. */
  heldBack: number;
  /** How many were rejected by a rule: engine anything but 'failsafe'. */
  rejected: number;
  /** How many were rejected because the check gave up. No strike is counted. */
  failsafe: number;
}): string {
  const subject = heldBack === 1 ? 'One photo' : `${heldBack} photos`;
  const object = heldBack === 1 ? 'it' : 'them';
  if (rejected > 0) {
    const verb = heldBack === 1 ? 'was' : 'were';
    return `${subject} ${verb} removed and nobody else can see ${object}. Tap to see why.`;
  }
  if (failsafe > 0) {
    return `${subject} could not be checked, so nobody else can see ${object}. Tap to try again.`;
  }
  const verb = heldBack === 1 ? 'is' : 'are';
  return `${subject} ${verb} still being checked, so nobody else can see ${object} yet.`;
}
